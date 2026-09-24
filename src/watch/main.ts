/**
 * The failure watcher.
 *
 * Runs inside the add-on beside nginx, polling the printer on its own schedule.
 * The point is that it keeps watching when no browser is open: the page's own
 * polling stops the moment the tab is hidden, which is exactly when a print is
 * least supervised.
 *
 * It reports what the printer's telemetry can actually show. Bed detachment and
 * spaghetti are not in that set — see rules.ts.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import { evaluate, trim, type Fault, type Sample } from './rules.js';
import { resolveConfig, readSettings, type WatchConfig, type SettingsSlice } from './config.js';
import { fetchDetail, type RawDetail } from './printer.js';
import { discoveryMessages, statePayload, topics, slug, type StateSnapshot } from './discovery.js';

const DATA_DIR = process.env.WATCH_DATA_DIR ?? '/data';
const OPTIONS_FILE = join(DATA_DIR, 'options.json');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');
const STATE_FILE = join(DATA_DIR, 'watch-state.json');

function log(...parts: unknown[]): void {
  console.log(`[watch ${new Date().toISOString()}]`, ...parts);
}

function readJson(path: string): unknown {
  try {
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf8');
    return text.trim() ? JSON.parse(text) : null;
  } catch (e) {
    log(`could not read ${path}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

function sampleFrom(at: number, detail: RawDetail): Sample {
  return {
    at,
    ok: true,
    status: detail.status,
    errorCode: detail.errorCode,
    printLayer: detail.printLayer,
    targetPrintLayer: detail.targetPrintLayer,
    printFileName: detail.printFileName,
    nozzle: detail.rightTemp,
    nozzleTarget: detail.rightTargetTemp,
    bed: detail.platTemp,
    bedTarget: detail.platTargetTemp,
  };
}

function snapshot(latest: RawDetail | null, faults: Fault[], reachable: boolean): StateSnapshot {
  return {
    status: latest?.status ?? (reachable ? 'unknown' : 'unreachable'),
    faults,
    progress: typeof latest?.printProgress === 'number' ? Math.round(latest.printProgress * 100) : null,
    layer: latest?.printLayer ?? null,
    targetLayer: latest?.targetPrintLayer ?? null,
    fileName: latest?.printFileName ?? '',
    nozzle: latest?.rightTemp ?? null,
    bed: latest?.platTemp ?? null,
    reachable,
    updatedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const config: WatchConfig = resolveConfig(
    (readJson(OPTIONS_FILE) as Record<string, unknown>) ?? {},
    process.env as unknown as Record<string, unknown>,
  );

  if (!config.enabled) {
    log('disabled by configuration; exiting.');
    return;
  }
  log(`polling every ${config.pollSec}s; thresholds`, config.thresholds);

  let client: MqttClient | null = null;
  const t = topics(config.mqtt.baseTopic);
  let announced = '';

  if (config.mqtt.host) {
    client = mqtt.connect(`mqtt://${config.mqtt.host}:${config.mqtt.port}`, {
      username: config.mqtt.username || undefined,
      password: config.mqtt.password || undefined,
      // Entities go unavailable rather than freezing on a stale value if this
      // process dies, which is the whole point of watching.
      will: { topic: t.availability, payload: 'offline', qos: 1, retain: true },
      reconnectPeriod: 10_000,
    });
    client.on('connect', () => {
      log(`connected to MQTT at ${config.mqtt.host}:${config.mqtt.port}`);
      client!.publish(t.availability, 'online', { qos: 1, retain: true });
      announced = ''; // re-announce discovery after a reconnect
    });
    client.on('error', (e) => log('MQTT error:', e.message));
  } else {
    log('no MQTT broker configured; writing local state only.');
  }

  let history: Sample[] = [];
  let latest: RawDetail | null = null;

  const tick = async (): Promise<void> => {
    const settings = readJson(SETTINGS_FILE);
    const { printer, plan }: SettingsSlice = readSettings(settings);
    const at = Date.now();

    if (!printer) {
      latest = null;
      history = [];
      publish(snapshot(null, [], false), null);
      return;
    }

    try {
      latest = await fetchDetail(printer);
      history.push(sampleFrom(at, latest));
    } catch (e) {
      history.push({ at, ok: false });
      log('printer unreachable:', e instanceof Error ? e.message : e);
    }
    history = trim(history, config.thresholds, at);

    const faults = evaluate(history, config.thresholds, plan);
    const reachable = history[history.length - 1]?.ok ?? false;
    publish(snapshot(reachable ? latest : null, faults, reachable), printer.serialNumber);
    if (faults.length) log('faults:', faults.map((f) => f.kind).join(', '));
  };

  const publish = (snap: StateSnapshot, serial: string | null): void => {
    const payload = statePayload(snap);
    try {
      writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
    } catch (e) {
      log('could not write the state file:', e instanceof Error ? e.message : e);
    }
    if (!client?.connected) return;
    const uniqueBase = `flashforge_slicer_${slug(serial ?? 'printer')}`;
    if (serial && announced !== uniqueBase) {
      for (const m of discoveryMessages(config.mqtt.discoveryPrefix, config.mqtt.baseTopic, {
        uniqueBase,
        name: latest?.name || 'Flashforge Adventurer 5M',
        model: latest?.name || 'Adventurer 5M',
      })) {
        client.publish(m.topic, JSON.stringify(m.payload), { qos: 1, retain: true });
      }
      announced = uniqueBase;
      log(`announced discovery as ${uniqueBase}`);
    }
    client.publish(t.state, JSON.stringify(payload), { qos: 0, retain: true });
  };

  const stop = (signal: string) => {
    log(`${signal}; shutting down.`);
    if (client?.connected) client.publish(t.availability, 'offline', { qos: 1, retain: true });
    setTimeout(() => process.exit(0), 250);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  // A failure in one poll must never take the loop down with it.
  const loop = async () => {
    try { await tick(); } catch (e) { log('poll failed:', e instanceof Error ? e.message : e); }
    setTimeout(loop, config.pollSec * 1000);
  };
  await loop();
}

main().catch((e) => {
  log('fatal:', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
