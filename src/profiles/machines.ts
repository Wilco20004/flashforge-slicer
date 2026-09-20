import type { SliceSettings } from '../slicer/settings';

/**
 * Machine profiles for the Flashforge Adventurer 5M family, derived from the
 * OrcaSlicer system profiles (fdm_adventurer5m_common + per-nozzle variants).
 * Coordinates are centre-origin: X/Y run from -110 to +110.
 */

export const AD5M_START_GCODE = [
  'M190 S[bed_temperature_initial_layer_single]',
  'M109 S[nozzle_temperature_initial_layer]',
  'G90',
  'M83',
  'G1 Z5 F6000',
  'G1 E-0.2 F800',
  'G1 X110 Y-110 F6000',
  'G1 E2 F800',
  'G1 Y-110 X55 Z0.25 F4800',
  'G1 X-55 E8 F2400',
  'G1 Y-109.6 F2400',
  'G1 X55 E5 F2400',
  'G1 Y-110 X55 Z0.45 F4800',
  'G1 X-55 E8 F2400',
  'G1 Y-109.6 F2400',
  'G1 X55 E5 F2400',
  'G92 E0',
].join('\n');

export const AD5M_END_GCODE = [
  'G1 E-3 F3600',
  'G0 X50 Y50 F30000',
  'M104 S0 ; turn off temperature',
].join('\n');

export interface MachineProfile {
  id: string;
  name: string;
  model: 'Adventurer 5M' | 'Adventurer 5M Pro';
  nozzle: number;
  settings: Partial<SliceSettings>;
}

const common: Partial<SliceSettings> = {
  bedSizeX: 220,
  bedSizeY: 220,
  maxZ: 220,
  originCenter: true,
  startGcode: AD5M_START_GCODE,
  endGcode: AD5M_END_GCODE,
  beforeLayerChangeGcode: ';BEFORE_LAYER_CHANGE\n;[layer_z]',
  afterLayerChangeGcode: ';AFTER_LAYER_CHANGE\n;[layer_z]',
  retractionSpeed: 35,
  deretractionSpeed: 35,
  retractMinTravel: 1,
  retractOnLayerChange: true,
  zHop: 0.4,
  zHopEnabled: true,
  travelSpeed: 500,
  travelAcceleration: 10000,
  zSpeed: 20,
  maxSpeedXY: 600,
  emitAccelerations: true,
  thumbnailWidth: 140,
  thumbnailHeight: 110,
};

function variant(model: MachineProfile['model'], nozzle: number): MachineProfile {
  const short = model === 'Adventurer 5M' ? 'AD5M' : 'AD5M Pro';
  const id = `${short.replace(' ', '-').toLowerCase()}-${nozzle}`;
  const name = `Flashforge ${model} ${nozzle} Nozzle`;
  // Retraction from Orca's per-nozzle variants; layer-height bounds scale with the nozzle.
  const retraction = nozzle <= 0.25 ? 0.6 : nozzle >= 0.8 ? 1.0 : 0.8;
  return {
    id, name, model, nozzle,
    settings: { ...common, machineName: name, nozzleDiameter: nozzle, retractionLength: retraction },
  };
}

export const MACHINES: MachineProfile[] = [
  variant('Adventurer 5M', 0.4),
  variant('Adventurer 5M', 0.25),
  variant('Adventurer 5M', 0.6),
  variant('Adventurer 5M', 0.8),
  variant('Adventurer 5M Pro', 0.4),
  variant('Adventurer 5M Pro', 0.25),
  variant('Adventurer 5M Pro', 0.6),
  variant('Adventurer 5M Pro', 0.8),
];

export const DEFAULT_MACHINE_ID = MACHINES[0].id;
