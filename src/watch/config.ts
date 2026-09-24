/**
 * What the watcher needs to know, and where it comes from.
 *
 * The broker's password is deliberately NOT read from the settings store the
 * browser writes: nginx serves that file to anyone who can reach the add-on.
 * Credentials come from the add-on's own options (Home Assistant writes them to
 * /data/options.json) or, for plain Docker, from the environment.
 *
 * The printer's address does come from the settings store, because the user
 * already typed it there and having to type it twice would be its own bug.
 */
import { DEFAULT_THRESHOLDS, type PrintPlan, type WatchThresholds } from './rules.js';

export interface PrinterTarget {
  host: string;
  port: number;
  serialNumber: string;
  checkCode: string;
}

export interface WatchConfig {
  enabled: boolean;
  pollSec: number;
  mqtt: {
    host: string;
    port: number;
    username: string;
    password: string;
    /** Where Home Assistant listens for discovery messages. */
    discoveryPrefix: string;
    /** Root of this add-on's own topics. */
    baseTopic: string;
  };
  thresholds: WatchThresholds;
}

export const DEFAULT_CONFIG: WatchConfig = {
  enabled: true,
  pollSec: 15,
  mqtt: { host: '', port: 1883, username: '', password: '', discoveryPrefix: 'homeassistant', baseTopic: 'flashforge-slicer' },
  thresholds: { ...DEFAULT_THRESHOLDS },
};

type Raw = Record<string, unknown>;

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return !/^(false|0|no|off)$/i.test(v.trim());
  return fallback;
}

/**
 * Merges the add-on options over the defaults, then the environment over both,
 * so a plain Docker run can set anything without an options file.
 */
export function resolveConfig(options: Raw = {}, env: Raw = {}): WatchConfig {
  const d = DEFAULT_CONFIG;
  const pick = (optKey: string, envKey: string) => env[envKey] ?? options[optKey];
  return {
    enabled: bool(pick('watch_enabled', 'WATCH_ENABLED'), d.enabled),
    pollSec: num(pick('watch_poll_seconds', 'WATCH_POLL_SECONDS'), d.pollSec),
    mqtt: {
      host: str(pick('mqtt_host', 'MQTT_HOST'), d.mqtt.host),
      port: num(pick('mqtt_port', 'MQTT_PORT'), d.mqtt.port),
      username: str(pick('mqtt_username', 'MQTT_USERNAME'), d.mqtt.username),
      password: str(pick('mqtt_password', 'MQTT_PASSWORD'), d.mqtt.password),
      discoveryPrefix: str(pick('mqtt_discovery_prefix', 'MQTT_DISCOVERY_PREFIX'), d.mqtt.discoveryPrefix),
      baseTopic: str(pick('mqtt_base_topic', 'MQTT_BASE_TOPIC'), d.mqtt.baseTopic),
    },
    thresholds: {
      nozzleToleranceC: num(pick('nozzle_tolerance_c', 'NOZZLE_TOLERANCE_C'), d.thresholds.nozzleToleranceC),
      bedToleranceC: num(pick('bed_tolerance_c', 'BED_TOLERANCE_C'), d.thresholds.bedToleranceC),
      tempGraceSec: num(pick('temp_grace_seconds', 'TEMP_GRACE_SECONDS'), d.thresholds.tempGraceSec),
      stallFactor: num(pick('stall_factor', 'STALL_FACTOR'), d.thresholds.stallFactor),
      stallMinSec: num(pick('stall_min_seconds', 'STALL_MIN_SECONDS'), d.thresholds.stallMinSec),
      offlineSec: num(pick('offline_seconds', 'OFFLINE_SECONDS'), d.thresholds.offlineSec),
    },
  };
}

/** Everything the watcher reads out of the browser's settings file. */
export interface SettingsSlice {
  printer: PrinterTarget | null;
  plan: PrintPlan | null;
}

/** `host` may carry a port, the way the UI accepts it. */
export function splitHost(raw: string, fallbackPort = 8898): { host: string; port: number } {
  const s = raw.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const m = /^(.+?):(\d+)$/.exec(s);
  return m ? { host: m[1], port: Number(m[2]) } : { host: s, port: fallbackPort };
}

/** Picks the printer and the last plan out of whatever the browser last wrote. */
export function readSettings(raw: unknown): SettingsSlice {
  const s = (raw ?? {}) as Raw;
  const printerRaw = (s.printer ?? {}) as Raw;
  const ff = (printerRaw.ff ?? {}) as Raw;
  const host = typeof ff.host === 'string' ? ff.host : '';
  const serialNumber = typeof ff.serialNumber === 'string' ? ff.serialNumber : '';
  const checkCode = typeof ff.checkCode === 'string' ? ff.checkCode : '';
  // Moonraker printers are not watched: this speaks the Flashforge LAN API.
  const kind = typeof printerRaw.kind === 'string' ? printerRaw.kind : 'flashforge';
  const usable = kind === 'flashforge' && host && serialNumber && checkCode;
  const { host: h, port } = splitHost(host);

  const planRaw = (s.lastPrint ?? null) as Raw | null;
  const layerTimes = Array.isArray(planRaw?.layerTimes) ? (planRaw!.layerTimes as unknown[]).filter((x): x is number => typeof x === 'number') : [];
  const fileName = typeof planRaw?.fileName === 'string' ? planRaw.fileName : '';

  return {
    printer: usable ? { host: h, port, serialNumber, checkCode } : null,
    plan: fileName && layerTimes.length ? { fileName, layerTimes } : null,
  };
}
