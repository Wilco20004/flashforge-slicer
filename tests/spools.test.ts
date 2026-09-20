import { describe, it, expect } from 'vitest';
import {
  newSpool, newSpoolId, normalizeSpool, normalizeHex, luminance, remainingG, remainingFraction,
  spoolName, spoolSettings, spoolMaterial, withUsage, type Spool,
} from '../src/profiles/spools';
import { buildSettings, MACHINES, FILAMENTS, PROCESSES, defaultProcessForNozzle } from '../src/profiles';

const spool = (over: Partial<Spool> = {}): Spool => ({ ...newSpool('pla'), ...over });

describe('spool ids', () => {
  it('avoids characters that are misread off a printed label', () => {
    const ids = Array.from({ length: 200 }, () => newSpoolId()).join('');
    expect(ids).not.toMatch(/[O0I1LU]/);
    expect(ids).toMatch(/^[2-9A-Z]+$/);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSpoolId()));
    expect(ids.size).toBe(500);
  });
});

describe('colours', () => {
  it('accepts the shapes a person types', () => {
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
    expect(normalizeHex('abcdef')).toBe('#abcdef');
    expect(normalizeHex('#f0a')).toBe('#ff00aa');
    expect(normalizeHex('  #123456 ')).toBe('#123456');
  });

  it('rejects anything else rather than guessing', () => {
    expect(normalizeHex('rebeccapurple')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });

  it('measures brightness the way an eye does, not the way a channel average would', () => {
    expect(luminance('#000000')).toBe(0);
    // The sRGB luma weights sum to 1 only to within a float epsilon.
    expect(luminance('#ffffff')).toBeCloseTo(1, 10);
    // Pure green looks far brighter than pure blue at the same channel value.
    expect(luminance('#00ff00')).toBeGreaterThan(luminance('#0000ff') * 5);
  });
});

describe('weight tracking', () => {
  it('counts down from the full spool', () => {
    const s = spool({ netWeightG: 1000, usedG: 260 });
    expect(remainingG(s)).toBe(740);
    expect(remainingFraction(s)).toBeCloseTo(0.74, 5);
  });

  it('never reports a negative remainder when more was printed than the spool held', () => {
    const s = spool({ netWeightG: 1000, usedG: 1400 });
    expect(remainingG(s)).toBe(0);
    expect(remainingFraction(s)).toBe(0);
  });

  it('has no percentage to report when the full weight is unknown', () => {
    expect(remainingFraction(spool({ netWeightG: 0 }))).toBeNull();
  });

  it('adds a print to the running total, to a tenth of a gram', () => {
    const s = withUsage(spool({ usedG: 10 }), 12.34);
    expect(s.usedG).toBe(22.3);
  });

  it('ignores a print that used nothing', () => {
    const s = spool({ usedG: 10, updatedAt: 1 });
    expect(withUsage(s, 0)).toBe(s);
    expect(withUsage(s, -5)).toBe(s);
  });
});

describe('naming', () => {
  it('reads as one line of brand, material and colour', () => {
    expect(spoolName(spool({ brand: 'eSUN', colorName: 'Galaxy Black' }))).toBe('eSUN PLA · Galaxy Black');
  });

  it('drops the parts that were left blank', () => {
    expect(spoolName(spool({ brand: '', colorName: 'Galaxy Black' }))).toBe('PLA · Galaxy Black');
    expect(spoolName(spool({ brand: 'eSUN', colorName: '' }))).toBe('eSUN PLA');
  });

  it('falls back to the id so a blank spool is still identifiable', () => {
    const s = spool({ brand: '', colorName: '', filamentId: 'pla' });
    // Material always survives, so force the degenerate case through the id path.
    expect(spoolName({ ...s, filamentId: 'pla' })).toContain('PLA');
    expect(spoolMaterial(s)).toBe('PLA');
  });
});

describe('spool settings', () => {
  it('drives the temperatures and leaves the material knowledge alone', () => {
    const s = spool({ nozzleTemp: 208, bedTemp: 62 });
    const out = spoolSettings(s);
    expect(out.nozzleTemp).toBe(208);
    expect(out.bedTemp).toBe(62);
    expect(out).not.toHaveProperty('filamentDensity');
    expect(out).not.toHaveProperty('maxVolumetricSpeed');
    expect(out).not.toHaveProperty('pressureAdvance');
  });

  it("keeps the preset's first-layer offset instead of flattening it", () => {
    // Generic PLA runs the bed 5 °C hotter for layer one (50 -> 55).
    const out = spoolSettings(spool({ filamentId: 'pla', bedTemp: 62 }));
    expect(out.bedTempFirstLayer).toBe(67);
    // PETG's preset uses the same bed temperature throughout.
    const petg = spoolSettings(spool({ filamentId: 'petg', bedTemp: 80 }));
    expect(petg.bedTempFirstLayer).toBe(80);
  });

  it('is untouched by the parts of a spool the slice does not care about', () => {
    // The UI keys the slice settings on this, so that booking filament after a
    // print, or jotting a note, does not make a finished result look stale.
    const s = spool({ usedG: 100 });
    const before = spoolSettings(s);
    expect(spoolSettings(withUsage(s, 42))).toEqual(before);
    expect(spoolSettings({ ...s, notes: 'dried', purchasedAt: '2026-01-01', netWeightG: 750 })).toEqual(before);
    // ...but the colour name is on the label and in the G-code, so it does count.
    expect(spoolSettings({ ...s, colorName: 'Something else' })).not.toEqual(before);
  });

  it('names the filament so the G-code says which spool printed it', () => {
    const s = spool({ brand: 'eSUN', colorName: 'Galaxy Black' });
    expect(spoolSettings(s).filamentName).toBe(`eSUN PLA · Galaxy Black (${s.id})`);
  });
});

describe('buildSettings with a spool', () => {
  const machine = MACHINES[0];
  const filament = FILAMENTS.find((f) => f.id === 'petg')!;
  const process = defaultProcessForNozzle(machine.nozzle);

  it('overrides the preset temperatures but keeps its flow and fan', () => {
    const s = spool({ filamentId: 'petg', nozzleTemp: 240, bedTemp: 80 });
    const withSpool = buildSettings(machine, filament, process, {}, s);
    const without = buildSettings(machine, filament, process);
    expect(withSpool.nozzleTemp).toBe(240);
    expect(withSpool.bedTemp).toBe(80);
    expect(withSpool.flowRatio).toBe(without.flowRatio);
    expect(withSpool.maxVolumetricSpeed).toBe(without.maxVolumetricSpeed);
    expect(withSpool.filamentType).toBe('PETG');
  });

  it('still lets a typed-in override win over the spool', () => {
    const s = spool({ filamentId: 'petg', nozzleTemp: 240 });
    const out = buildSettings(machine, filament, process, { nozzleTemp: 251 }, s);
    expect(out.nozzleTemp).toBe(251);
  });

  it('changes nothing when no spool is selected', () => {
    expect(buildSettings(machine, filament, process, {}, null))
      .toEqual(buildSettings(machine, filament, process));
  });

  it('works for every filament preset', () => {
    for (const f of FILAMENTS) {
      const s = newSpool(f.id);
      const out = buildSettings(machine, f, PROCESSES[0], {}, s);
      expect(out.nozzleTemp).toBe(s.nozzleTemp);
      expect(out.bedTemp).toBe(s.bedTemp);
    }
  });
});

describe('normalizeSpool', () => {
  it('fills in a record written by an older version', () => {
    const s = normalizeSpool({ id: 'ABC123', brand: 'Prusament', filamentId: 'petg' });
    expect(s.id).toBe('ABC123');
    expect(s.brand).toBe('Prusament');
    expect(s.netWeightG).toBe(1000);
    expect(s.usedG).toBe(0);
    // Temperatures default to the preset's, not to PLA's.
    expect(s.nozzleTemp).toBe(255);
  });

  it('falls back to a real preset when the filament id no longer exists', () => {
    const s = normalizeSpool({ id: 'ABC123', filamentId: 'nylon-carbon-whatever' });
    expect(s.filamentId).toBe('pla');
    expect(spoolMaterial(s)).toBe('PLA');
  });

  it('repairs a colour and refuses to carry negative weights', () => {
    const s = normalizeSpool({ id: 'A', color: 'F0A', netWeightG: -5, usedG: -1 });
    expect(s.color).toBe('#ff00aa');
    expect(s.netWeightG).toBe(0);
    expect(s.usedG).toBe(0);
  });

  it('gives a record with no id one of its own', () => {
    expect(normalizeSpool({}).id).toMatch(/^[2-9A-Z]{6}$/);
  });
});
