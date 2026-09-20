import type { SliceSettings } from '../slicer/settings';

/** Quality presets, from OrcaSlicer's "@Flashforge AD5M" process profiles. */
export interface ProcessProfile {
  id: string;
  name: string;
  /** Nozzle diameters this preset is meant for. */
  nozzles: number[];
  settings: Partial<SliceSettings>;
}

const ffCommon: Partial<SliceSettings> = {
  wallLoops: 2,
  wallOrder: 'inner-outer',
  topLayers: 5,
  bottomLayers: 3,
  seamPosition: 'aligned',
  elephantFootCompensation: 0.15,
  resolution: 0.012,
  infillWallOverlap: 0.5,
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
  supportType: 'tree',
  supportThresholdAngle: 30,
  supportSpacing: 2.5,
  supportZGap: 0.18,
  supportXYGap: 0.3,
  supportInterfaceLayers: 3,
  supportInterfaceSpacing: 0.5,
  supportWalls: 0,
  supportMinArea: 2,
  treeBranchAngle: 40,
  treeBranchDiameter: 2,
  treeTipDiameter: 1.2,
  treeTipSpacing: 3,
  treeMaxDiameter: 8,
  treeDiameterAngle: 5,
};

function preset(id: string, name: string, nozzles: number[], s: Partial<SliceSettings>): ProcessProfile {
  return { id, name, nozzles, settings: { ...ffCommon, processName: name, ...s } };
}

export const PROCESSES: ProcessProfile[] = [
  // 0.4 nozzle
  preset('0.12-fine-0.4', '0.12mm Fine @Flashforge AD5M 0.4 Nozzle', [0.4], {
    layerHeight: 0.12, firstLayerHeight: 0.3, lineWidth: 0.42, outerWallLineWidth: 0.42, firstLayerLineWidth: 0.5,
    supportZGap: 0.15, supportInterfaceSpacing: 0.3, speedSupport: 100, topLayers: 7, bottomLayers: 4,
  }),
  preset('0.16-optimal-0.4', '0.16mm Optimal @Flashforge AD5M 0.4 Nozzle', [0.4], {
    layerHeight: 0.16, firstLayerHeight: 0.24, lineWidth: 0.42, outerWallLineWidth: 0.42, firstLayerLineWidth: 0.5,
    topLayers: 6, bottomLayers: 4,
  }),
  preset('0.20-standard-0.4', '0.20mm Standard @Flashforge AD5M 0.4 Nozzle', [0.4], {
    layerHeight: 0.2, firstLayerHeight: 0.2, lineWidth: 0.42, outerWallLineWidth: 0.42, firstLayerLineWidth: 0.5,
  }),
  preset('0.24-draft-0.4', '0.24mm Draft @Flashforge AD5M 0.4 Nozzle', [0.4], {
    layerHeight: 0.24, firstLayerHeight: 0.3, lineWidth: 0.42, outerWallLineWidth: 0.42, firstLayerLineWidth: 0.5,
    infillWallOverlap: 0.25, supportZGap: 0.15, speedSupport: 100, topLayers: 4, bottomLayers: 3,
  }),
  preset('0.28-extra-draft-0.4', '0.28mm Extra Draft @Flashforge AD5M 0.4 Nozzle', [0.4], {
    layerHeight: 0.28, firstLayerHeight: 0.3, lineWidth: 0.44, outerWallLineWidth: 0.44, firstLayerLineWidth: 0.5,
    infillWallOverlap: 0.25, topLayers: 4, bottomLayers: 3,
  }),
  // 0.25 nozzle
  preset('0.08-standard-0.25', '0.08mm Standard @Flashforge AD5M 0.25 Nozzle', [0.25], {
    layerHeight: 0.08, firstLayerHeight: 0.15, lineWidth: 0.27, outerWallLineWidth: 0.27, firstLayerLineWidth: 0.3,
    topLayers: 8, bottomLayers: 5, speedOuterWall: 120, speedInnerWall: 180, speedSparseInfill: 180, speedSolidInfill: 150,
    speedTopSurface: 120, elephantFootCompensation: 0.1, supportZGap: 0.1, supportInterfaceSpacing: 0.25,
  }),
  preset('0.12-standard-0.25', '0.12mm Standard @Flashforge AD5M 0.25 Nozzle', [0.25], {
    layerHeight: 0.12, firstLayerHeight: 0.15, lineWidth: 0.27, outerWallLineWidth: 0.27, firstLayerLineWidth: 0.3,
    topLayers: 7, bottomLayers: 4, speedOuterWall: 120, speedInnerWall: 180, speedSparseInfill: 180, speedSolidInfill: 150,
    speedTopSurface: 120, elephantFootCompensation: 0.1, supportZGap: 0.12, supportInterfaceSpacing: 0.25,
  }),
  // 0.6 nozzle
  preset('0.18-fine-0.6', '0.18mm Fine @Flashforge AD5M 0.6 Nozzle', [0.6], {
    layerHeight: 0.18, firstLayerHeight: 0.3, lineWidth: 0.62, outerWallLineWidth: 0.62, firstLayerLineWidth: 0.7,
    topLayers: 5, bottomLayers: 3, supportZGap: 0.18,
  }),
  preset('0.30-standard-0.6', '0.30mm Standard @Flashforge AD5M 0.6 Nozzle', [0.6], {
    layerHeight: 0.3, firstLayerHeight: 0.3, lineWidth: 0.62, outerWallLineWidth: 0.62, firstLayerLineWidth: 0.7,
    topLayers: 4, bottomLayers: 3, supportZGap: 0.3,
  }),
  preset('0.42-draft-0.6', '0.42mm Draft @Flashforge AD5M 0.6 Nozzle', [0.6], {
    layerHeight: 0.42, firstLayerHeight: 0.42, lineWidth: 0.64, outerWallLineWidth: 0.64, firstLayerLineWidth: 0.7,
    topLayers: 3, bottomLayers: 3, supportZGap: 0.42,
  }),
  // 0.8 nozzle
  preset('0.24-fine-0.8', '0.24mm Fine @Flashforge AD5M 0.8 Nozzle', [0.8], {
    layerHeight: 0.24, firstLayerHeight: 0.4, lineWidth: 0.82, outerWallLineWidth: 0.82, firstLayerLineWidth: 0.9,
    topLayers: 4, bottomLayers: 3, supportZGap: 0.24,
  }),
  preset('0.40-standard-0.8', '0.40mm Standard @Flashforge AD5M 0.8 Nozzle', [0.8], {
    layerHeight: 0.4, firstLayerHeight: 0.4, lineWidth: 0.82, outerWallLineWidth: 0.82, firstLayerLineWidth: 0.9,
    topLayers: 3, bottomLayers: 3, supportZGap: 0.4,
  }),
  preset('0.56-draft-0.8', '0.56mm Draft @Flashforge AD5M 0.8 Nozzle', [0.8], {
    layerHeight: 0.56, firstLayerHeight: 0.56, lineWidth: 0.84, outerWallLineWidth: 0.84, firstLayerLineWidth: 0.9,
    topLayers: 3, bottomLayers: 2, supportZGap: 0.56,
  }),
];

export function processesForNozzle(nozzle: number): ProcessProfile[] {
  return PROCESSES.filter((p) => p.nozzles.includes(nozzle));
}

export function defaultProcessForNozzle(nozzle: number): ProcessProfile {
  const list = processesForNozzle(nozzle);
  return list.find((p) => p.name.toLowerCase().includes('standard')) ?? list[0] ?? PROCESSES[2];
}
