/**
 * The Home Assistant MQTT discovery messages the watcher publishes.
 *
 * One retained JSON state topic feeds every entity through value templates,
 * so a poll is one publish rather than one per field, and an entity added
 * later needs no new topic. Availability is a separate topic with a last will,
 * so entities go unavailable if the watcher dies rather than freezing on their
 * last value and quietly lying.
 */
import type { Fault } from './rules.js';

export interface DiscoveryTopics {
  state: string;
  availability: string;
}

export interface DeviceInfo {
  /** Stable across restarts; the printer's serial is the only thing that is. */
  uniqueBase: string;
  name: string;
  model: string;
}

export function topics(baseTopic: string): DiscoveryTopics {
  return { state: `${baseTopic}/state`, availability: `${baseTopic}/availability` };
}

/** A slug safe for an MQTT topic and an entity id. */
export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'printer';
}

export interface DiscoveryMessage {
  topic: string;
  payload: Record<string, unknown>;
}

export function discoveryMessages(
  discoveryPrefix: string,
  baseTopic: string,
  device: DeviceInfo,
): DiscoveryMessage[] {
  const t = topics(baseTopic);
  const dev = {
    identifiers: [device.uniqueBase],
    name: device.name,
    manufacturer: 'Flashforge',
    model: device.model,
  };
  const common = {
    state_topic: t.state,
    availability_topic: t.availability,
    json_attributes_topic: t.state,
    device: dev,
  };
  return [
    {
      topic: `${discoveryPrefix}/binary_sensor/${device.uniqueBase}/problem/config`,
      payload: {
        ...common,
        name: 'Print problem',
        unique_id: `${device.uniqueBase}_problem`,
        device_class: 'problem',
        // Anything in the fault list means trouble; the attributes say what.
        value_template: '{{ "ON" if value_json.faults | length > 0 else "OFF" }}',
      },
    },
    {
      topic: `${discoveryPrefix}/sensor/${device.uniqueBase}/state/config`,
      payload: {
        ...common,
        name: 'Printer state',
        unique_id: `${device.uniqueBase}_state`,
        icon: 'mdi:printer-3d',
        value_template: '{{ value_json.status }}',
      },
    },
    {
      topic: `${discoveryPrefix}/sensor/${device.uniqueBase}/problem_summary/config`,
      payload: {
        ...common,
        name: 'Print problem summary',
        unique_id: `${device.uniqueBase}_problem_summary`,
        icon: 'mdi:alert-circle-outline',
        entity_category: 'diagnostic',
        // Kept inside MQTT's practical state length; the detail is an attribute.
        value_template: '{{ value_json.summary[:255] }}',
      },
    },
  ];
}

export interface StateSnapshot {
  status: string;
  faults: Fault[];
  progress: number | null;
  layer: number | null;
  targetLayer: number | null;
  fileName: string;
  nozzle: number | null;
  bed: number | null;
  reachable: boolean;
  updatedAt: string;
}

/** The retained state payload every entity reads. */
export function statePayload(s: StateSnapshot): Record<string, unknown> {
  return {
    status: s.status,
    faults: s.faults.map((f) => f.kind),
    summary: s.faults.length ? s.faults.map((f) => f.detail).join(' ') : 'No problems detected.',
    fault_details: s.faults,
    progress: s.progress,
    layer: s.layer,
    target_layer: s.targetLayer,
    file_name: s.fileName,
    nozzle: s.nozzle,
    bed: s.bed,
    reachable: s.reachable,
    updated_at: s.updatedAt,
  };
}
