/**
 * Flat slicing settings. Profiles (machine / filament / process) are merged
 * into one of these before slicing. Units: mm, mm/s, mm/s², °C, percent 0-100.
 */

export type InfillPattern = 'rectilinear' | 'grid' | 'triangles' | 'concentric' | 'lines';
export type SeamPosition = 'nearest' | 'aligned' | 'rear' | 'random';
export type WallOrder = 'inner-outer' | 'outer-inner';
export type BrimType = 'none' | 'outer';

export interface SliceSettings {
  // ---- Machine ----
  machineName: string;
  nozzleDiameter: number;
  bedSizeX: number;
  bedSizeY: number;
  maxZ: number;
  /** Bed origin at centre (Adventurer 5M: X/Y from -110 to 110). */
  originCenter: boolean;
  startGcode: string;
  endGcode: string;
  beforeLayerChangeGcode: string;
  afterLayerChangeGcode: string;
  retractionLength: number;
  retractionSpeed: number;
  deretractionSpeed: number;
  retractMinTravel: number;
  retractOnLayerChange: boolean;
  zHop: number;
  zHopEnabled: boolean;
  travelSpeed: number;
  travelAcceleration: number;
  zSpeed: number;
  maxSpeedXY: number;
  emitAccelerations: boolean;
  /** Thumbnail size expected by the printer UI (Orca profile: 140x110). */
  thumbnailWidth: number;
  thumbnailHeight: number;

  // ---- Filament ----
  filamentName: string;
  filamentType: string;
  filamentDiameter: number;
  filamentDensity: number;
  flowRatio: number;
  nozzleTemp: number;
  nozzleTempFirstLayer: number;
  bedTemp: number;
  bedTempFirstLayer: number;
  fanMin: number;
  fanMax: number;
  fanOffLayers: number;
  /** Layer time (s) below which the fan is at fanMax. */
  fanFullLayerTime: number;
  /** Slow down so each layer takes at least this long (s). 0 disables. */
  minLayerTime: number;
  minSpeed: number;
  maxVolumetricSpeed: number;
  pressureAdvance: number;
  enablePressureAdvance: boolean;
  filamentStartGcode: string;

  // ---- Process: layers & walls ----
  processName: string;
  layerHeight: number;
  firstLayerHeight: number;
  lineWidth: number;
  outerWallLineWidth: number;
  firstLayerLineWidth: number;
  wallLoops: number;
  wallOrder: WallOrder;
  topLayers: number;
  bottomLayers: number;
  seamPosition: SeamPosition;
  elephantFootCompensation: number;
  /** Simplification tolerance for contours (mm). */
  resolution: number;
  /** Extra infill overlap into walls, as a fraction of line width (0-1). */
  infillWallOverlap: number;
  /** Sparse areas smaller than this (mm²) are filled solid. */
  minSparseInfillArea: number;

  // ---- Process: infill ----
  infillDensity: number; // percent
  infillPattern: InfillPattern;
  infillAngle: number;

  // ---- Process: speeds ----
  speedOuterWall: number;
  speedInnerWall: number;
  speedSparseInfill: number;
  speedSolidInfill: number;
  speedTopSurface: number;
  speedBridge: number;
  speedFirstLayer: number;
  speedFirstLayerInfill: number;
  speedSupport: number;
  speedSupportInterface: number;

  // ---- Process: accelerations ----
  accelOuterWall: number;
  accelInnerWall: number;
  accelInfill: number;
  accelTopSurface: number;
  accelFirstLayer: number;
  accelDefault: number;

  // ---- Process: adhesion ----
  skirtLoops: number;
  skirtDistance: number;
  brimType: BrimType;
  brimWidth: number;
  brimGap: number;

  // ---- Process: support ----
  supportEnabled: boolean;
  supportThresholdAngle: number;
  supportSpacing: number;
  supportZGap: number;
  supportXYGap: number;
  supportInterfaceLayers: number;
  supportInterfaceSpacing: number;
  supportWalls: number;
  supportMinArea: number;
}

export const DEFAULT_SETTINGS: SliceSettings = {
  machineName: 'Flashforge Adventurer 5M 0.4 Nozzle',
  nozzleDiameter: 0.4,
  bedSizeX: 220,
  bedSizeY: 220,
  maxZ: 220,
  originCenter: true,
  startGcode: '',
  endGcode: '',
  beforeLayerChangeGcode: ';BEFORE_LAYER_CHANGE\n;[layer_z]',
  afterLayerChangeGcode: ';AFTER_LAYER_CHANGE\n;[layer_z]',
  retractionLength: 0.8,
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

  filamentName: 'Generic PLA @Flashforge',
  filamentType: 'PLA',
  filamentDiameter: 1.75,
  filamentDensity: 1.24,
  flowRatio: 0.98,
  nozzleTemp: 220,
  nozzleTempFirstLayer: 220,
  bedTemp: 50,
  bedTempFirstLayer: 55,
  fanMin: 100,
  fanMax: 100,
  fanOffLayers: 1,
  fanFullLayerTime: 100,
  minLayerTime: 6,
  minSpeed: 20,
  maxVolumetricSpeed: 25,
  pressureAdvance: 0.025,
  enablePressureAdvance: true,
  filamentStartGcode: '; filament start gcode\n;right_extruder_material: PLA\n',

  processName: '0.20mm Standard @Flashforge AD5M 0.4 Nozzle',
  layerHeight: 0.2,
  firstLayerHeight: 0.2,
  lineWidth: 0.42,
  outerWallLineWidth: 0.42,
  firstLayerLineWidth: 0.5,
  wallLoops: 2,
  wallOrder: 'inner-outer',
  topLayers: 5,
  bottomLayers: 3,
  seamPosition: 'aligned',
  elephantFootCompensation: 0.15,
  resolution: 0.012,
  infillWallOverlap: 0.25,
  minSparseInfillArea: 15,

  infillDensity: 15,
  infillPattern: 'grid',
  infillAngle: 45,

  speedOuterWall: 200,
  speedInnerWall: 300,
  speedSparseInfill: 270,
  speedSolidInfill: 250,
  speedTopSurface: 200,
  speedBridge: 50,
  speedFirstLayer: 50,
  speedFirstLayerInfill: 80,
  speedSupport: 150,
  speedSupportInterface: 80,

  accelOuterWall: 5000,
  accelInnerWall: 5000,
  accelInfill: 7000,
  accelTopSurface: 2000,
  accelFirstLayer: 500,
  accelDefault: 8000,

  skirtLoops: 0,
  skirtDistance: 2,
  brimType: 'none',
  brimWidth: 5,
  brimGap: 0.1,

  supportEnabled: false,
  supportThresholdAngle: 30,
  supportSpacing: 2.5,
  supportZGap: 0.18,
  supportXYGap: 0.3,
  supportInterfaceLayers: 3,
  supportInterfaceSpacing: 0.5,
  supportWalls: 0,
  supportMinArea: 2,
};
