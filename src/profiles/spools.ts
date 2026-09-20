/**
 * Physical filament spools.
 *
 * A {@link FilamentProfile} describes a *kind* of filament — "Generic PETG",
 * with the temperatures Flashforge publishes for it. A spool is the roll on the
 * shelf: one brand, one colour, one set of temperatures that may differ from
 * the generic preset, and a weight that goes down as it is printed. Spools are
 * what labels are printed for, and selecting one drives the slice settings.
 */
import { DEFAULT_SETTINGS, type SliceSettings } from '../slicer/settings';
import { FILAMENTS, DEFAULT_FILAMENT_ID, type FilamentProfile } from './filaments';

export interface Spool {
  /** Short, stable, printed on the label and carried in its QR code. */
  id: string;
  brand: string;
  /** The manufacturer's colour name, e.g. "Galaxy Black". */
  colorName: string;
  /** `#rrggbb`. The only place colour is recorded; the material has none. */
  color: string;
  /** Which {@link FILAMENTS} preset supplies everything not overridden here. */
  filamentId: string;
  nozzleTemp: number;
  bedTemp: number;
  /** Filament on a full spool, in grams — the number on the box, not gross weight. */
  netWeightG: number;
  /** Printed so far, in grams. */
  usedG: number;
  /** `YYYY-MM-DD`, or '' when not recorded. */
  purchasedAt: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Alphabet for generated ids: no O/0, I/1, L or U, so an id read off a printed
 * label and typed back in cannot land on a different spool.
 */
const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_LENGTH = 6;

export function newSpoolId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  // Rejection-free: 256 is not a multiple of 30, so the low ids are marginally
  // more likely. That bias is irrelevant for telling a dozen spools apart.
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

export function filamentById(id: string): FilamentProfile {
  return FILAMENTS.find((f) => f.id === id) ?? FILAMENTS.find((f) => f.id === DEFAULT_FILAMENT_ID) ?? FILAMENTS[0];
}

/** A setting from a filament preset, falling back to the global default. */
function preset<K extends keyof SliceSettings>(f: FilamentProfile, key: K): SliceSettings[K] {
  return (f.settings[key] ?? DEFAULT_SETTINGS[key]) as SliceSettings[K];
}

export function newSpool(filamentId = DEFAULT_FILAMENT_ID, now = Date.now()): Spool {
  const f = filamentById(filamentId);
  return {
    id: newSpoolId(),
    brand: '',
    colorName: '',
    color: '#7a8496',
    filamentId: f.id,
    nozzleTemp: preset(f, 'nozzleTemp'),
    bedTemp: preset(f, 'bedTemp'),
    netWeightG: 1000,
    usedG: 0,
    purchasedAt: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

/** Everything a stored spool may be missing after a settings file from an older version. */
export function normalizeSpool(raw: Partial<Spool> | null | undefined): Spool {
  const base = newSpool(raw?.filamentId ?? DEFAULT_FILAMENT_ID, raw?.createdAt ?? Date.now());
  const s: Spool = { ...base, ...raw, id: raw?.id || base.id, filamentId: base.filamentId };
  s.color = normalizeHex(s.color) ?? base.color;
  s.netWeightG = Math.max(0, Number(s.netWeightG) || 0);
  s.usedG = Math.max(0, Number(s.usedG) || 0);
  s.nozzleTemp = Number(s.nozzleTemp) || base.nozzleTemp;
  s.bedTemp = Number(s.bedTemp) || base.bedTemp;
  return s;
}

/** `#abc`, `abcdef`, `#ABCDEF` -> `#abcdef`. Null when it is not a hex colour. */
export function normalizeHex(value: string | undefined | null): string | null {
  const v = String(value ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(v)) return '#' + v.toLowerCase().split('').map((c) => c + c).join('');
  if (/^[0-9a-fA-F]{6}$/.test(v)) return '#' + v.toLowerCase();
  return null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** Perceived brightness, 0 (black) to 1 (white), by the sRGB luma weights. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function remainingG(s: Spool): number {
  return Math.max(0, s.netWeightG - s.usedG);
}

/** 0–1, or null when the spool's full weight is unknown. */
export function remainingFraction(s: Spool): number | null {
  if (s.netWeightG <= 0) return null;
  return Math.min(1, Math.max(0, remainingG(s) / s.netWeightG));
}

export function spoolMaterial(s: Spool): string {
  return filamentById(s.filamentId).type;
}

/** "eSUN PLA · Galaxy Black", skipping whichever parts are blank. */
export function spoolName(s: Spool): string {
  const head = [s.brand, spoolMaterial(s)].filter(Boolean).join(' ');
  return [head, s.colorName].filter(Boolean).join(' · ') || `Spool ${s.id}`;
}

/**
 * What selecting this spool changes about the slice.
 *
 * Only the temperatures and the filament's name — everything else (density,
 * flow, fan, pressure advance, volumetric limit) stays with the material
 * preset, which is where that knowledge lives.
 *
 * The first-layer temperatures follow the preset's own offset rather than
 * being set equal to the steady-state ones: PLA's preset runs the bed 5 °C
 * hotter for layer one, and a spool that only says "bed 55" should keep that
 * behaviour rather than silently flattening it.
 */
export function spoolSettings(s: Spool): Partial<SliceSettings> {
  const f = filamentById(s.filamentId);
  const nozzleDelta = preset(f, 'nozzleTempFirstLayer') - preset(f, 'nozzleTemp');
  const bedDelta = preset(f, 'bedTempFirstLayer') - preset(f, 'bedTemp');
  return {
    filamentName: `${spoolName(s)} (${s.id})`,
    nozzleTemp: s.nozzleTemp,
    nozzleTempFirstLayer: s.nozzleTemp + nozzleDelta,
    bedTemp: s.bedTemp,
    bedTempFirstLayer: s.bedTemp + bedDelta,
  };
}

/** Grams of this spool used by a print, added to its running total. */
export function withUsage(s: Spool, grams: number, now = Date.now()): Spool {
  if (!(grams > 0)) return s;
  return { ...s, usedG: Math.round((s.usedG + grams) * 10) / 10, updatedAt: now };
}
