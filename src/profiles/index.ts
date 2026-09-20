import { DEFAULT_SETTINGS, type SliceSettings } from '../slicer/settings';
import { MACHINES, DEFAULT_MACHINE_ID, type MachineProfile } from './machines';
import { FILAMENTS, DEFAULT_FILAMENT_ID, type FilamentProfile } from './filaments';
import { PROCESSES, defaultProcessForNozzle, processesForNozzle, type ProcessProfile } from './processes';
import { spoolSettings, type Spool } from './spools';

export { MACHINES, FILAMENTS, PROCESSES, DEFAULT_MACHINE_ID, DEFAULT_FILAMENT_ID, processesForNozzle, defaultProcessForNozzle };
export type { MachineProfile, FilamentProfile, ProcessProfile };
export * from './spools';

/**
 * Merge machine, filament and process presets (in that order) over the
 * defaults, then the selected spool, then user overrides.
 *
 * The spool sits between the presets and the overrides: it is a more specific
 * statement about the material than the generic preset, but a setting the user
 * typed in still wins over both.
 */
export function buildSettings(
  machine: MachineProfile,
  filament: FilamentProfile,
  process: ProcessProfile,
  overrides: Partial<SliceSettings> = {},
  spool: Spool | null = null,
): SliceSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...machine.settings,
    ...process.settings,
    ...filament.settings,
    ...(spool ? spoolSettings(spool) : {}),
    ...overrides,
  };
}
