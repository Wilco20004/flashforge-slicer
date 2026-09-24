import { describe, it, expect } from 'vitest';
import {
  evaluate, trim, predictedLayerSec, isActive, isPaused,
  humanDuration, DEFAULT_THRESHOLDS, type Sample, type PrintPlan, type WatchThresholds,
} from '../src/watch/rules';

const T0 = 1_760_000_000_000;
const th: WatchThresholds = DEFAULT_THRESHOLDS;

const ok = (over: Partial<Sample> = {}): Sample => ({
  at: T0, ok: true, status: 'printing', printLayer: 10, targetPrintLayer: 89,
  printFileName: 'part_PLA_26m15s.gcode',
  nozzle: 220, nozzleTarget: 220, bed: 60, bedTarget: 60, ...over,
});

/** `count` samples `stepSec` apart, ending now, each built from `at`. */
const series = (count: number, stepSec: number, build: (at: number, i: number) => Partial<Sample>): Sample[] =>
  Array.from({ length: count }, (_, i) => {
    const at = T0 + i * stepSec * 1000;
    return ok({ at, ...build(at, i) });
  });

const kinds = (s: Sample[], plan: PrintPlan | null = null) => evaluate(s, th, plan).map((f) => f.kind).sort();

describe('a print going fine', () => {
  it('raises nothing', () => {
    expect(kinds(series(60, 10, (_at, i) => ({ printLayer: 10 + i })))).toEqual([]);
  });

  it('raises nothing from an empty history', () => {
    expect(evaluate([], th)).toEqual([]);
  });

  it('raises nothing while the printer is idle', () => {
    expect(kinds(series(60, 10, () => ({ status: 'ready', printLayer: undefined })))).toEqual([]);
  });
});

describe('unreachable', () => {
  it('is reported once it has lasted, if it was printing', () => {
    const s = [...series(5, 10, () => ({})), ...series(20, 10, () => ({})).map((x, i) => ({ ...x, at: T0 + 50_000 + i * 10_000, ok: false }))];
    const f = evaluate(s, th);
    expect(f.map((x) => x.kind)).toEqual(['offline']);
    expect(f[0].detail).toMatch(/stopped answering/);
  });

  it('is not reported before the grace period', () => {
    const s = [...series(5, 10, () => ({})), ...series(5, 10, () => ({})).map((x, i) => ({ ...x, at: T0 + 50_000 + i * 10_000, ok: false }))];
    expect(kinds(s)).toEqual([]);
  });

  it('is not reported for a printer that was simply switched off when idle', () => {
    const s = [...series(5, 10, () => ({ status: 'ready' })), ...series(30, 10, () => ({})).map((x, i) => ({ ...x, at: T0 + 50_000 + i * 10_000, ok: false }))];
    expect(kinds(s)).toEqual([]);
  });

  it('suppresses the other rules, which have nothing to read', () => {
    const s = [...series(5, 10, () => ({ errorCode: 'E42' })), ...series(30, 10, () => ({})).map((x, i) => ({ ...x, at: T0 + 50_000 + i * 10_000, ok: false }))];
    expect(kinds(s)).toEqual(['offline']);
  });
});

describe('the printer reporting for itself', () => {
  it('passes on an error code', () => {
    const f = evaluate(series(3, 10, () => ({ errorCode: 'E0301' })), th);
    expect(f.map((x) => x.kind)).toContain('printer-error');
    expect(f.find((x) => x.kind === 'printer-error')!.detail).toMatch(/E0301/);
  });

  it('ignores a zero code, which is not an error', () => {
    expect(kinds(series(3, 10, () => ({ errorCode: '0' })))).toEqual([]);
    expect(kinds(series(3, 10, () => ({ errorCode: '' })))).toEqual([]);
  });

  it('reports a pause without pretending to know why', () => {
    const f = evaluate(series(3, 10, () => ({ status: 'pause' })), th);
    expect(f.map((x) => x.kind)).toEqual(['paused']);
    expect(f[0].detail).toMatch(/runout and a manual pause look the same/i);
  });
});

describe('temperatures', () => {
  const cold = (n: number) => series(n, 10, () => ({ nozzle: 180, nozzleTarget: 220 }));

  it('are reported once the deviation has persisted', () => {
    const f = evaluate(cold(20), th); // 190 s > 120 s grace
    expect(f.map((x) => x.kind)).toEqual(['nozzle-temp']);
    expect(f[0].detail).toMatch(/40 °C below its 220 °C target/);
  });

  it('are not reported for a brief dip', () => {
    expect(kinds(cold(5))).toEqual([]); // 40 s
  });

  it('are not reported while the printer is still heating up', () => {
    expect(kinds(series(30, 10, () => ({ status: 'heating', nozzle: 60, nozzleTarget: 220 })))).toEqual([]);
  });

  it('are not reported when nothing is being asked of the heater', () => {
    expect(kinds(series(30, 10, () => ({ nozzle: 25, nozzleTarget: 0, bed: 25, bedTarget: 0 })))).toEqual([]);
  });

  it('catch a runaway above target, not just a cold one', () => {
    const f = evaluate(series(20, 10, () => ({ nozzle: 260, nozzleTarget: 220 })), th);
    expect(f[0].detail).toMatch(/40 °C above/);
  });

  it('watch the bed on its own tolerance', () => {
    // 12 °C off: inside the nozzle's 15 °C tolerance, outside the bed's 10 °C.
    expect(kinds(series(20, 10, () => ({ bed: 48, bedTarget: 60, nozzle: 208, nozzleTarget: 220 })))).toEqual(['bed-temp']);
  });

  it('reset once the temperature comes back', () => {
    const s = [...cold(20), ...series(3, 10, () => ({})).map((x, i) => ({ ...x, at: T0 + 200_000 + i * 10_000 }))];
    expect(kinds(s)).toEqual([]);
  });
});

describe('a layer that will not finish', () => {
  // The same name the samples carry: the plan is recorded when the file is sent.
  const plan: PrintPlan = { fileName: 'part_PLA_26m15s.gcode', layerTimes: Array(89).fill(20) };

  it('is judged against what this slice predicted for it', () => {
    // 20 s predicted x4 = 80 s allowed, but never below the 600 s floor.
    const s = series(70, 10, () => ({ printLayer: 10 })); // 690 s on one layer
    const f = evaluate(s, th, plan);
    expect(f.map((x) => x.kind)).toEqual(['stalled']);
    expect(f[0].detail).toMatch(/against the 20 s this slice predicted/);
  });

  it('gives a slow layer the time its own prediction earns it', () => {
    const slow: PrintPlan = { fileName: 'part_PLA_26m15s.gcode', layerTimes: Array(89).fill(400) };
    // 400 s x4 = 1600 s allowed; 690 s in is fine.
    expect(kinds(series(70, 10, () => ({ printLayer: 10 })), slow)).toEqual([]);
    // ...and 1700 s in is not.
    expect(kinds(series(171, 10, () => ({ printLayer: 10 })), slow)).toEqual(['stalled']);
  });

  it('falls back to a flat floor when no plan matches', () => {
    expect(kinds(series(70, 10, () => ({ printLayer: 10 })))).toEqual(['stalled']);
    expect(kinds(series(50, 10, () => ({ printLayer: 10 })))).toEqual([]); // 490 s < 600 s
  });

  it('says nothing while layers keep arriving', () => {
    expect(kinds(series(200, 10, (_at, i) => ({ printLayer: 10 + i })), plan)).toEqual([]);
  });

  it('matches the plan through the name the printer stored', () => {
    // Upload sanitises the name, so the stems are compared rather than the text.
    expect(predictedLayerSec({ fileName: 'my part (v2).gcode', layerTimes: [5, 6, 7] }, ok({ printLayer: 2, printFileName: 'my_part__v2_.gcode' }))).toBe(6);
  });

  it('will not borrow another file\'s plan', () => {
    expect(predictedLayerSec({ fileName: 'other.gcode', layerTimes: [5, 6, 7] }, ok({ printLayer: 2 }))).toBeNull();
  });

  it('has no prediction to offer past the end of the plan', () => {
    expect(predictedLayerSec(plan, ok({ printLayer: 900 }))).toBeNull();
  });
});

describe('several things wrong at once', () => {
  it('are all reported, so a notification can say which', () => {
    const s = series(30, 10, () => ({ status: 'printing', errorCode: 'E7', nozzle: 100, nozzleTarget: 220, printLayer: 10 }));
    expect(kinds(s)).toEqual(['nozzle-temp', 'printer-error']);
  });
});

describe('how long something has been wrong', () => {
  it('reads in the unit that suits the length, not always minutes', () => {
    // A deviation reported "for 0 min" is worse than useless in a notification.
    expect(humanDuration(45)).toBe('45 s');
    expect(humanDuration(89)).toBe('89 s');
    expect(humanDuration(200)).toBe('3 min');
    expect(humanDuration(5400)).toBe('1.5 h');
  });

  it('never says 0 of anything', () => {
    for (const sec of [1, 30, 91, 3599, 7200]) expect(humanDuration(sec)).not.toMatch(/^0 /);
  });
});

describe('housekeeping', () => {
  it('keeps enough history for the longest rule and drops the rest', () => {
    const s = series(400, 10, () => ({})); // 4000 s
    const kept = trim(s, th, s[s.length - 1].at);
    expect(kept.length).toBeLessThan(s.length);
    // The stall floor is 600 s; the window must comfortably cover it.
    expect((kept[kept.length - 1].at - kept[0].at) / 1000).toBeGreaterThanOrEqual(th.stallMinSec);
  });

  it('leaves a short history alone', () => {
    const s = series(5, 10, () => ({}));
    expect(trim(s, th, s[s.length - 1].at)).toBe(s);
  });

  it('classifies the statuses the rules branch on', () => {
    expect(isActive('printing')).toBe(true);
    expect(isActive('heating')).toBe(true);
    expect(isActive('ready')).toBe(false);
    expect(isActive(undefined)).toBe(false);
    expect(isPaused('pause')).toBe(true);
    expect(isPaused('Paused')).toBe(true);
    expect(isPaused('printing')).toBe(false);
  });
});
