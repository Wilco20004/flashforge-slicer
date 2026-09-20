import { DEFAULT_SETTINGS, type SliceSettings } from '../slicer/settings';
import { MACHINES, DEFAULT_MACHINE_ID, type MachineProfile } from './machines';
import { FILAMENTS, DEFAULT_FILAMENT_ID, type FilamentProfile } from './filaments';
import { PROCESSES, defaultProcessForNozzle, processesForNozzle, type ProcessProfile } from './processes';

export { MACHINES, FILAMENTS, PROCESSES, DEFAULT_MACHINE_ID, DEFAULT_FILAMENT_ID, processesForNozzle, defaultProcessForNozzle };
export type { MachineProfile, FilamentProfile, ProcessProfile };

/** Merge machine, filament and process presets (in that order) over the defaults, then user overrides. */
export function buildSettings(
  machine: MachineProfile,
  filament: FilamentProfile,
  process: ProcessProfile,
  overrides: Partial<SliceSettings> = {},
): SliceSettings {
  return { ...DEFAULT_SETTINGS, ...machine.settings, ...process.settings, ...filament.settings, ...overrides };
}
