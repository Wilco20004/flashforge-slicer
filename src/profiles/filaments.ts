import type { SliceSettings } from '../slicer/settings';

/** Filament presets, from OrcaSlicer's "Generic * @Flashforge" profiles. */
export interface FilamentProfile {
  id: string;
  name: string;
  type: string;
  settings: Partial<SliceSettings>;
}

const base: Partial<SliceSettings> = {
  filamentDiameter: 1.75,
  enablePressureAdvance: true,
  fanFullLayerTime: 100,
};

export const FILAMENTS: FilamentProfile[] = [
  {
    id: 'pla', name: 'Generic PLA', type: 'PLA',
    settings: {
      ...base, filamentName: 'Generic PLA @Flashforge', filamentType: 'PLA', filamentDensity: 1.24, flowRatio: 0.98,
      nozzleTemp: 220, nozzleTempFirstLayer: 220, bedTemp: 50, bedTempFirstLayer: 55,
      fanMin: 100, fanMax: 100, fanOffLayers: 1, minLayerTime: 6, minSpeed: 20, maxVolumetricSpeed: 25,
      pressureAdvance: 0.025, filamentStartGcode: '; filament start gcode\n;right_extruder_material: PLA',
    },
  },
  {
    id: 'hs-pla', name: 'Generic HS PLA', type: 'PLA',
    settings: {
      ...base, filamentName: 'Generic HS PLA @Flashforge', filamentType: 'PLA', filamentDensity: 1.24, flowRatio: 0.98,
      nozzleTemp: 220, nozzleTempFirstLayer: 220, bedTemp: 50, bedTempFirstLayer: 55,
      fanMin: 100, fanMax: 100, fanOffLayers: 1, minLayerTime: 6, minSpeed: 20, maxVolumetricSpeed: 25,
      pressureAdvance: 0.025, filamentStartGcode: '; filament start gcode\n;right_extruder_material: HS PLA',
    },
  },
  {
    id: 'pla-silk', name: 'Generic PLA Silk', type: 'PLA',
    settings: {
      ...base, filamentName: 'Generic PLA-Silk @Flashforge', filamentType: 'PLA', filamentDensity: 1.24, flowRatio: 0.98,
      nozzleTemp: 225, nozzleTempFirstLayer: 225, bedTemp: 50, bedTempFirstLayer: 55,
      fanMin: 100, fanMax: 100, fanOffLayers: 1, minLayerTime: 6, minSpeed: 20, maxVolumetricSpeed: 12,
      pressureAdvance: 0.025, filamentStartGcode: '; filament start gcode\n;right_extruder_material: PLA',
    },
  },
  {
    id: 'petg', name: 'Generic PETG', type: 'PETG',
    settings: {
      ...base, filamentName: 'Generic PETG @Flashforge', filamentType: 'PETG', filamentDensity: 1.27, flowRatio: 1.0,
      nozzleTemp: 255, nozzleTempFirstLayer: 255, bedTemp: 70, bedTempFirstLayer: 70,
      fanMin: 80, fanMax: 100, fanOffLayers: 1, fanFullLayerTime: 30, minLayerTime: 8, minSpeed: 30, maxVolumetricSpeed: 12,
      pressureAdvance: 0.046, filamentStartGcode: '; filament start gcode\n;right_extruder_material:PETG',
    },
  },
  {
    id: 'abs', name: 'Generic ABS', type: 'ABS',
    settings: {
      ...base, filamentName: 'Generic ABS @Flashforge', filamentType: 'ABS', filamentDensity: 1.04, flowRatio: 0.98,
      nozzleTemp: 265, nozzleTempFirstLayer: 265, bedTemp: 105, bedTempFirstLayer: 105,
      fanMin: 10, fanMax: 20, fanOffLayers: 2, fanFullLayerTime: 30, minLayerTime: 8, minSpeed: 20, maxVolumetricSpeed: 15,
      pressureAdvance: 0.04, filamentStartGcode: '; filament start gcode\n;right_extruder_material: ABS',
    },
  },
  {
    id: 'asa', name: 'Generic ASA', type: 'ASA',
    settings: {
      ...base, filamentName: 'Generic ASA @Flashforge', filamentType: 'ASA', filamentDensity: 1.05, flowRatio: 0.98,
      nozzleTemp: 260, nozzleTempFirstLayer: 260, bedTemp: 105, bedTempFirstLayer: 105,
      fanMin: 10, fanMax: 20, fanOffLayers: 2, fanFullLayerTime: 30, minLayerTime: 8, minSpeed: 20, maxVolumetricSpeed: 15,
      pressureAdvance: 0.04, filamentStartGcode: '; filament start gcode\n;right_extruder_material: ASA',
    },
  },
  {
    id: 'tpu', name: 'Generic TPU', type: 'TPU',
    settings: {
      ...base, filamentName: 'Generic TPU @Flashforge', filamentType: 'TPU', filamentDensity: 1.24, flowRatio: 1.0,
      nozzleTemp: 225, nozzleTempFirstLayer: 225, bedTemp: 45, bedTempFirstLayer: 45,
      fanMin: 100, fanMax: 100, fanOffLayers: 1, minLayerTime: 8, minSpeed: 20, maxVolumetricSpeed: 3.5,
      pressureAdvance: 0.035, retractionLength: 1.2, zHopEnabled: false,
      filamentStartGcode: '; filament start gcode\n;right_extruder_material:TPU',
    },
  },
];

export const DEFAULT_FILAMENT_ID = 'pla';
