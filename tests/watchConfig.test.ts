import { describe, it, expect } from 'vitest';
import { resolveConfig, readSettings, splitHost, DEFAULT_CONFIG } from '../src/watch/config';
import { discoveryMessages, statePayload, slug, topics } from '../src/watch/discovery';

describe('resolving the watcher\'s configuration', () => {
  it('falls back to defaults with nothing configured', () => {
    expect(resolveConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('takes the add-on options Home Assistant writes', () => {
    const c = resolveConfig({ mqtt_host: 'core-mosquitto', mqtt_port: 1884, mqtt_username: 'ha', mqtt_password: 'secret', nozzle_tolerance_c: 25 });
    expect(c.mqtt).toMatchObject({ host: 'core-mosquitto', port: 1884, username: 'ha', password: 'secret' });
    expect(c.thresholds.nozzleToleranceC).toBe(25);
    expect(c.thresholds.bedToleranceC).toBe(DEFAULT_CONFIG.thresholds.bedToleranceC);
  });

  it('lets the environment win, so plain Docker needs no options file', () => {
    const c = resolveConfig({ mqtt_host: 'from-options' }, { MQTT_HOST: 'from-env', STALL_MIN_SECONDS: '900' });
    expect(c.mqtt.host).toBe('from-env');
    expect(c.thresholds.stallMinSec).toBe(900);
  });

  it('reads numbers that arrive as strings, the way an environment gives them', () => {
    expect(resolveConfig({}, { MQTT_PORT: '8883', TEMP_GRACE_SECONDS: '45' }).mqtt.port).toBe(8883);
    expect(resolveConfig({}, { TEMP_GRACE_SECONDS: '45' }).thresholds.tempGraceSec).toBe(45);
  });

  it('ignores nonsense rather than watching with a zero threshold', () => {
    const c = resolveConfig({ mqtt_port: 'banana', temp_grace_seconds: 0, stall_factor: -3 });
    expect(c.mqtt.port).toBe(DEFAULT_CONFIG.mqtt.port);
    expect(c.thresholds.tempGraceSec).toBe(DEFAULT_CONFIG.thresholds.tempGraceSec);
    expect(c.thresholds.stallFactor).toBe(DEFAULT_CONFIG.thresholds.stallFactor);
  });

  it('can be switched off', () => {
    expect(resolveConfig({ watch_enabled: false }).enabled).toBe(false);
    expect(resolveConfig({}, { WATCH_ENABLED: 'false' }).enabled).toBe(false);
    expect(resolveConfig({}, { WATCH_ENABLED: 'true' }).enabled).toBe(true);
  });
});

describe('reading the browser\'s settings file', () => {
  const settings = (over: Record<string, unknown> = {}) => ({
    printer: { kind: 'flashforge', ff: { host: '10.0.0.9', serialNumber: 'SN', checkCode: 'cc' } },
    ...over,
  });

  it('picks up the printer the user already configured in the UI', () => {
    expect(readSettings(settings()).printer).toEqual({ host: '10.0.0.9', port: 8898, serialNumber: 'SN', checkCode: 'cc' });
  });

  it('honours a port typed into the host field', () => {
    expect(readSettings({ printer: { kind: 'flashforge', ff: { host: 'http://10.0.0.9:9000/', serialNumber: 'SN', checkCode: 'cc' } } }).printer)
      .toMatchObject({ host: '10.0.0.9', port: 9000 });
  });

  it('has nothing to watch until the printer is fully set up', () => {
    expect(readSettings(null).printer).toBeNull();
    expect(readSettings({}).printer).toBeNull();
    expect(readSettings({ printer: { kind: 'flashforge', ff: { host: '10.0.0.9', serialNumber: '', checkCode: 'cc' } } }).printer).toBeNull();
  });

  it('leaves a Moonraker printer alone, since it speaks a different API', () => {
    expect(readSettings({ printer: { kind: 'moonraker', ff: { host: '10.0.0.9', serialNumber: 'SN', checkCode: 'cc' } } }).printer).toBeNull();
  });

  it('picks up the plan recorded when the file was sent', () => {
    expect(readSettings(settings({ lastPrint: { fileName: 'part.gcode', layerTimes: [1, 2, 3] } })).plan)
      .toEqual({ fileName: 'part.gcode', layerTimes: [1, 2, 3] });
  });

  it('ignores a half-written plan rather than judging stalls against nothing', () => {
    expect(readSettings(settings({ lastPrint: { fileName: 'part.gcode', layerTimes: [] } })).plan).toBeNull();
    expect(readSettings(settings({ lastPrint: { layerTimes: [1, 2] } })).plan).toBeNull();
    expect(readSettings(settings({ lastPrint: 'nonsense' })).plan).toBeNull();
  });

  it('splits a host that carries a port', () => {
    expect(splitHost('10.0.0.9')).toEqual({ host: '10.0.0.9', port: 8898 });
    expect(splitHost('10.0.0.9:7125')).toEqual({ host: '10.0.0.9', port: 7125 });
  });
});

describe('the Home Assistant discovery messages', () => {
  const msgs = discoveryMessages('homeassistant', 'flashforge-slicer', { uniqueBase: 'ff_sn1', name: 'AD5M', model: 'Adventurer 5M' });

  it('announces a problem binary sensor, a state sensor and a summary', () => {
    expect(msgs.map((m) => m.topic)).toEqual([
      'homeassistant/binary_sensor/ff_sn1/problem/config',
      'homeassistant/sensor/ff_sn1/state/config',
      'homeassistant/sensor/ff_sn1/problem_summary/config',
    ]);
  });

  it('gives the problem sensor the device class that makes Home Assistant treat it as one', () => {
    expect(msgs[0].payload).toMatchObject({ device_class: 'problem', unique_id: 'ff_sn1_problem' });
  });

  it('points every entity at one state topic and one availability topic', () => {
    const t = topics('flashforge-slicer');
    for (const m of msgs) {
      expect(m.payload.state_topic).toBe(t.state);
      expect(m.payload.availability_topic).toBe(t.availability);
      expect(m.payload.json_attributes_topic).toBe(t.state);
    }
  });

  it('groups them under one device so they appear together', () => {
    for (const m of msgs) expect(m.payload.device).toMatchObject({ identifiers: ['ff_sn1'], manufacturer: 'Flashforge' });
  });

  it('makes ids safe for a topic', () => {
    expect(slug('SN 12/34-Ab')).toBe('sn_12_34_ab');
    expect(slug('')).toBe('printer');
    expect(slug('!!!')).toBe('printer');
  });
});

describe('the state payload every entity reads', () => {
  const base = { status: 'printing', progress: 42, layer: 10, targetLayer: 89, fileName: 'p.gcode', nozzle: 220, bed: 60, reachable: true, updatedAt: 'now' };

  it('says so plainly when nothing is wrong', () => {
    const p = statePayload({ ...base, faults: [] });
    expect(p.faults).toEqual([]);
    expect(p.summary).toBe('No problems detected.');
  });

  it('lists the kinds for the template and the sentences for a person', () => {
    const p = statePayload({ ...base, faults: [
      { kind: 'nozzle-temp', since: 1, detail: 'Nozzle is cold.' },
      { kind: 'stalled', since: 2, detail: 'Layer 10 is stuck.' },
    ] });
    expect(p.faults).toEqual(['nozzle-temp', 'stalled']);
    expect(p.summary).toBe('Nozzle is cold. Layer 10 is stuck.');
    expect(p.fault_details).toHaveLength(2);
  });
});
