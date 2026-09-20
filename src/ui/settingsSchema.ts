import type { SliceSettings } from '../slicer/settings';

export type FieldType = 'number' | 'boolean' | 'select' | 'text' | 'gcode';

export interface Field {
  key: keyof SliceSettings;
  label: string;
  type: FieldType;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  help?: string;
}

export interface Group { title: string; fields: Field[] }
export interface Tab { id: 'quality' | 'strength' | 'speed' | 'support' | 'filament' | 'machine'; title: string; groups: Group[] }

const n = (key: keyof SliceSettings, label: string, unit?: string, step = 0.01, min?: number, max?: number, help?: string): Field =>
  ({ key, label, type: 'number', unit, step, min, max, help });
const b = (key: keyof SliceSettings, label: string, help?: string): Field => ({ key, label, type: 'boolean', help });
const sel = (key: keyof SliceSettings, label: string, options: { value: string; label: string }[], help?: string): Field =>
  ({ key, label, type: 'select', options, help });

export const SETTINGS_TABS: Tab[] = [
  {
    id: 'quality', title: 'Quality', groups: [
      { title: 'Layer height', fields: [
        n('layerHeight', 'Layer height', 'mm', 0.01, 0.04, 0.6),
        n('firstLayerHeight', 'First layer height', 'mm', 0.01, 0.04, 0.6),
      ] },
      { title: 'Line width', fields: [
        n('lineWidth', 'Default line width', 'mm', 0.01, 0.1, 1.5),
        n('outerWallLineWidth', 'Outer wall line width', 'mm', 0.01, 0.1, 1.5),
        n('firstLayerLineWidth', 'First layer line width', 'mm', 0.01, 0.1, 1.5),
      ] },
      { title: 'Seam & precision', fields: [
        sel('seamPosition', 'Seam position', [
          { value: 'aligned', label: 'Aligned' }, { value: 'nearest', label: 'Nearest' },
          { value: 'rear', label: 'Rear' }, { value: 'random', label: 'Random' },
        ]),
        n('elephantFootCompensation', 'Elephant foot compensation', 'mm', 0.01, 0, 1),
        n('resolution', 'Resolution', 'mm', 0.001, 0, 0.2, 'Contour simplification tolerance'),
      ] },
    ],
  },
  {
    id: 'strength', title: 'Strength', groups: [
      { title: 'Walls', fields: [
        n('wallLoops', 'Wall loops', '', 1, 0, 20),
        sel('wallOrder', 'Wall order', [{ value: 'inner-outer', label: 'Inner / outer' }, { value: 'outer-inner', label: 'Outer / inner' }]),
      ] },
      { title: 'Top / bottom shells', fields: [
        n('topLayers', 'Top shell layers', '', 1, 0, 30),
        n('bottomLayers', 'Bottom shell layers', '', 1, 0, 30),
      ] },
      { title: 'Sparse infill', fields: [
        n('infillDensity', 'Infill density', '%', 1, 0, 100),
        sel('infillPattern', 'Pattern', [
          { value: 'grid', label: 'Grid' }, { value: 'rectilinear', label: 'Rectilinear' }, { value: 'lines', label: 'Lines' },
          { value: 'triangles', label: 'Triangles' }, { value: 'concentric', label: 'Concentric' },
        ]),
        n('infillAngle', 'Infill direction', '°', 1, 0, 359),
        n('infillWallOverlap', 'Infill/wall overlap', '× line width', 0.05, 0, 1),
        n('minSparseInfillArea', 'Min. sparse infill area', 'mm²', 1, 0, 500, 'Smaller regions are filled solid'),
      ] },
    ],
  },
  {
    id: 'speed', title: 'Speed', groups: [
      { title: 'First layer', fields: [
        n('speedFirstLayer', 'First layer', 'mm/s', 1, 1, 600),
        n('speedFirstLayerInfill', 'First layer infill', 'mm/s', 1, 1, 600),
      ] },
      { title: 'Other layers', fields: [
        n('speedOuterWall', 'Outer wall', 'mm/s', 1, 1, 600),
        n('speedInnerWall', 'Inner wall', 'mm/s', 1, 1, 600),
        n('speedSparseInfill', 'Sparse infill', 'mm/s', 1, 1, 600),
        n('speedSolidInfill', 'Internal solid infill', 'mm/s', 1, 1, 600),
        n('speedTopSurface', 'Top surface', 'mm/s', 1, 1, 600),
        n('speedBridge', 'Bridge', 'mm/s', 1, 1, 600),
        n('speedSupport', 'Support', 'mm/s', 1, 1, 600),
        n('speedSupportInterface', 'Support interface', 'mm/s', 1, 1, 600),
        n('travelSpeed', 'Travel', 'mm/s', 1, 1, 600),
      ] },
      { title: 'Acceleration', fields: [
        b('emitAccelerations', 'Emit accelerations (M204)'),
        n('accelFirstLayer', 'First layer', 'mm/s²', 100, 100, 20000),
        n('accelOuterWall', 'Outer wall', 'mm/s²', 100, 100, 20000),
        n('accelInnerWall', 'Inner wall', 'mm/s²', 100, 100, 20000),
        n('accelInfill', 'Infill', 'mm/s²', 100, 100, 20000),
        n('accelTopSurface', 'Top surface', 'mm/s²', 100, 100, 20000),
        n('travelAcceleration', 'Travel', 'mm/s²', 100, 100, 20000),
        n('accelDefault', 'Default', 'mm/s²', 100, 100, 20000),
      ] },
    ],
  },
  {
    id: 'support', title: 'Support & adhesion', groups: [
      { title: 'Support', fields: [
        b('supportEnabled', 'Enable support'),
        n('supportThresholdAngle', 'Threshold angle', '°', 1, 1, 89, 'Overhangs flatter than this angle (from horizontal) get support'),
        n('supportSpacing', 'Base line spacing', 'mm', 0.1, 0.5, 10),
        n('supportZGap', 'Top Z distance', 'mm', 0.01, 0, 1),
        n('supportXYGap', 'Object XY distance', 'mm', 0.05, 0, 5),
        n('supportInterfaceLayers', 'Interface layers', '', 1, 0, 10),
        n('supportInterfaceSpacing', 'Interface spacing', 'mm', 0.05, 0.1, 5),
        n('supportWalls', 'Support walls', '', 1, 0, 3),
        n('supportMinArea', 'Min. overhang area', 'mm²', 0.5, 0, 100),
      ] },
      { title: 'Skirt', fields: [
        n('skirtLoops', 'Skirt loops', '', 1, 0, 10),
        n('skirtDistance', 'Skirt distance', 'mm', 0.5, 0, 50),
      ] },
      { title: 'Brim', fields: [
        sel('brimType', 'Brim', [{ value: 'none', label: 'None' }, { value: 'outer', label: 'Outer brim' }]),
        n('brimWidth', 'Brim width', 'mm', 0.5, 0, 50),
        n('brimGap', 'Brim-object gap', 'mm', 0.05, 0, 2),
      ] },
    ],
  },
  {
    id: 'filament', title: 'Filament', groups: [
      { title: 'Temperatures', fields: [
        n('nozzleTempFirstLayer', 'Nozzle, first layer', '°C', 5, 150, 300),
        n('nozzleTemp', 'Nozzle, other layers', '°C', 5, 150, 300),
        n('bedTempFirstLayer', 'Bed, first layer', '°C', 5, 0, 120),
        n('bedTemp', 'Bed, other layers', '°C', 5, 0, 120),
      ] },
      { title: 'Cooling', fields: [
        n('fanMin', 'Min fan speed', '%', 5, 0, 100),
        n('fanMax', 'Max fan speed', '%', 5, 0, 100),
        n('fanOffLayers', 'No fan for first layers', '', 1, 0, 20),
        n('fanFullLayerTime', 'Full fan below layer time', 's', 1, 0, 300),
        n('minLayerTime', 'Slow down below layer time', 's', 1, 0, 120),
        n('minSpeed', 'Min print speed when slowing', 'mm/s', 1, 1, 200),
      ] },
      { title: 'Material', fields: [
        n('filamentDiameter', 'Diameter', 'mm', 0.01, 1, 3.2),
        n('filamentDensity', 'Density', 'g/cm³', 0.01, 0.5, 3),
        n('flowRatio', 'Flow ratio', '', 0.01, 0.5, 1.5),
        n('maxVolumetricSpeed', 'Max volumetric speed', 'mm³/s', 0.5, 0.5, 60),
        b('enablePressureAdvance', 'Set pressure advance'),
        n('pressureAdvance', 'Pressure advance', '', 0.001, 0, 1),
      ] },
    ],
  },
  {
    id: 'machine', title: 'Machine', groups: [
      { title: 'Retraction', fields: [
        n('retractionLength', 'Retraction length', 'mm', 0.1, 0, 10),
        n('retractionSpeed', 'Retraction speed', 'mm/s', 1, 1, 120),
        n('deretractionSpeed', 'Deretraction speed', 'mm/s', 1, 1, 120),
        n('retractMinTravel', 'Min. travel for retraction', 'mm', 0.5, 0, 50),
        b('retractOnLayerChange', 'Retract on layer change'),
        b('zHopEnabled', 'Z hop when retracted'),
        n('zHop', 'Z hop height', 'mm', 0.05, 0, 2),
      ] },
      { title: 'Limits', fields: [
        n('maxSpeedXY', 'Max XY speed', 'mm/s', 10, 10, 600),
        n('zSpeed', 'Z speed', 'mm/s', 1, 1, 30),
      ] },
      { title: 'Custom G-code', fields: [
        { key: 'startGcode', label: 'Start G-code', type: 'gcode' },
        { key: 'endGcode', label: 'End G-code', type: 'gcode' },
        { key: 'beforeLayerChangeGcode', label: 'Before layer change', type: 'gcode' },
        { key: 'afterLayerChangeGcode', label: 'After layer change', type: 'gcode' },
      ] },
    ],
  },
];
