/**
 * What counts as a print going wrong, judged from the printer's own telemetry.
 *
 * Deliberately not here: bed detachment, spaghetti, layer shift, warping. The
 * printer cannot see any of them — when a part comes off the bed the firmware
 * carries on extruding into the air with correct temperatures, an advancing
 * layer counter and no error. Those need a camera and a model, and claiming
 * otherwise would be worse than not watching at all.
 *
 * Everything here is a pure function of a window of samples, so the rules can
 * be tested against a printer that never existed.
 */

/** One poll of the printer. `ok` false means the poll itself failed. */
export interface Sample {
  at: number;
  ok: boolean;
  status?: string;
  errorCode?: string;
  printLayer?: number;
  targetPrintLayer?: number;
  printFileName?: string;
  nozzle?: number;
  nozzleTarget?: number;
  bed?: number;
  bedTarget?: number;
}

export type FaultKind = 'offline' | 'printer-error' | 'nozzle-temp' | 'bed-temp' | 'stalled' | 'paused';

export interface Fault {
  kind: FaultKind;
  /** When the condition started holding. */
  since: number;
  /** One line, ready to put in a notification. */
  detail: string;
}

export interface WatchThresholds {
  /** How far the nozzle may sit from its target before it counts, in °C. */
  nozzleToleranceC: number;
  bedToleranceC: number;
  /** How long a temperature deviation must persist before it counts, in seconds. */
  tempGraceSec: number;
  /** A layer may take this multiple of its predicted time before it counts as stalled. */
  stallFactor: number;
  /** ...but never less than this, in seconds. */
  stallMinSec: number;
  /** How long the printer must be unreachable before it counts, in seconds. */
  offlineSec: number;
}

export const DEFAULT_THRESHOLDS: WatchThresholds = {
  nozzleToleranceC: 15,
  bedToleranceC: 10,
  tempGraceSec: 120,
  stallFactor: 4,
  stallMinSec: 600,
  offlineSec: 120,
};

/** The plan for the file currently printing, when the slicer produced it. */
export interface PrintPlan {
  fileName: string;
  /** Predicted seconds per layer, in order. */
  layerTimes: number[];
}

/** Statuses during which the printer is working and the rules apply. */
const ACTIVE = new Set(['printing', 'heating', 'busy', 'calibrate_doing']);
/** Statuses where the printer has stopped on purpose and nothing is wrong. */
const PAUSED = new Set(['pause', 'paused', 'pausing']);

export function isActive(status?: string): boolean {
  return ACTIVE.has((status ?? '').toLowerCase());
}

export function isPaused(status?: string): boolean {
  return PAUSED.has((status ?? '').toLowerCase());
}

/** The most recent sample whose poll succeeded. */
function lastOk(history: Sample[]): Sample | undefined {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].ok) return history[i];
  return undefined;
}

/**
 * How long a condition has held continuously up to the newest sample: the time
 * of the oldest sample in the unbroken run that satisfies `holds`, or null when
 * the newest sample does not satisfy it.
 */
function heldSince(history: Sample[], holds: (s: Sample) => boolean): number | null {
  if (!history.length || !holds(history[history.length - 1])) return null;
  let since = history[history.length - 1].at;
  for (let i = history.length - 1; i >= 0; i--) {
    if (!holds(history[i])) break;
    since = history[i].at;
  }
  return since;
}

function seconds(from: number, to: number): number {
  return (to - from) / 1000;
}

/** A duration a notification can read out loud. */
export function humanDuration(sec: number): string {
  if (sec < 90) return `${Math.round(sec)} s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

/** Predicted seconds for the layer currently printing, when the plan is known. */
export function predictedLayerSec(plan: PrintPlan | null, sample: Sample): number | null {
  if (!plan || !sample.printFileName || !sample.printLayer) return null;
  // The printer reports the name it stored, which may have been sanitised on
  // upload, so compare on the stem rather than demanding an exact match.
  if (stem(plan.fileName) !== stem(sample.printFileName)) return null;
  const t = plan.layerTimes[sample.printLayer - 1];
  return typeof t === 'number' && t > 0 ? t : null;
}

function stem(name: string): string {
  return name.replace(/\.[^.]*$/, '').replace(/[^0-9A-Za-z]+/g, '').toLowerCase();
}

/**
 * The faults holding as of the newest sample.
 *
 * `history` must be in time order and should span at least the longest
 * threshold; anything older can be dropped.
 */
export function evaluate(
  history: Sample[],
  thresholds: WatchThresholds = DEFAULT_THRESHOLDS,
  plan: PrintPlan | null = null,
): Fault[] {
  const faults: Fault[] = [];
  if (!history.length) return faults;
  const now = history[history.length - 1].at;
  const latest = history[history.length - 1];
  const recent = lastOk(history);

  // --- unreachable ---------------------------------------------------------
  // Only worth reporting when the printer was doing something: one that is
  // simply switched off between prints is not a fault.
  if (!latest.ok && recent && isActive(recent.status)) {
    const since = heldSince(history, (s) => !s.ok);
    if (since !== null && seconds(since, now) >= thresholds.offlineSec) {
      faults.push({
        kind: 'offline',
        since,
        detail: `The printer stopped answering ${humanDuration(seconds(since, now))} ago, while it was printing.`,
      });
    }
  }

  // Every remaining rule needs a reading to judge.
  if (!latest.ok) return faults;

  // --- the printer says so itself ------------------------------------------
  if (latest.errorCode && latest.errorCode !== '0') {
    const since = heldSince(history, (s) => Boolean(s.ok && s.errorCode && s.errorCode !== '0')) ?? now;
    faults.push({ kind: 'printer-error', since, detail: `The printer reported error ${latest.errorCode}.` });
  }

  // --- stopped on its own ---------------------------------------------------
  // Nothing here knows whether a person pressed pause; a runout or a firmware
  // pause looks the same. Worth telling someone about either way.
  if (isPaused(latest.status)) {
    const since = heldSince(history, (s) => s.ok && isPaused(s.status)) ?? now;
    faults.push({ kind: 'paused', since, detail: 'The print is paused. Filament runout and a manual pause look the same from here.' });
  }

  // --- temperatures ---------------------------------------------------------
  // Only while actually printing: the climb at the start of a print is not a
  // fault, and 'heating' is exactly when the nozzle is legitimately far off.
  const printing = (latest.status ?? '').toLowerCase() === 'printing';
  if (printing) {
    for (const probe of [
      { kind: 'nozzle-temp' as const, name: 'nozzle', tol: thresholds.nozzleToleranceC, get: (s: Sample) => ({ v: s.nozzle, t: s.nozzleTarget }) },
      { kind: 'bed-temp' as const, name: 'bed', tol: thresholds.bedToleranceC, get: (s: Sample) => ({ v: s.bed, t: s.bedTarget }) },
    ]) {
      const off = (s: Sample) => {
        if (!s.ok || (s.status ?? '').toLowerCase() !== 'printing') return false;
        const { v, t } = probe.get(s);
        if (typeof v !== 'number' || typeof t !== 'number' || t <= 0) return false;
        return Math.abs(v - t) > probe.tol;
      };
      const since = heldSince(history, off);
      if (since !== null && seconds(since, now) >= thresholds.tempGraceSec) {
        const { v, t } = probe.get(latest);
        const dir = (v as number) < (t as number) ? 'below' : 'above';
        faults.push({
          kind: probe.kind,
          since,
          detail: `The ${probe.name} has been ${Math.round(Math.abs((v as number) - (t as number)))} °C ${dir} its ${Math.round(t as number)} °C target for ${humanDuration(seconds(since, now))}.`,
        });
      }
    }
  }

  // --- not getting on with it ----------------------------------------------
  if (printing && typeof latest.printLayer === 'number') {
    const layer = latest.printLayer;
    const since = heldSince(history, (s) => s.ok && s.printLayer === layer && (s.status ?? '').toLowerCase() === 'printing');
    if (since !== null) {
      const predicted = predictedLayerSec(plan, latest);
      const allowed = Math.max(thresholds.stallMinSec, (predicted ?? 0) * thresholds.stallFactor);
      const stuck = seconds(since, now);
      if (stuck >= allowed) {
        faults.push({
          kind: 'stalled',
          since,
          detail: predicted
            ? `Layer ${layer} has been going ${humanDuration(stuck)} against the ${Math.round(predicted)} s this slice predicted for it.`
            : `Layer ${layer} has been going ${humanDuration(stuck)}.`,
        });
      }
    }
  }

  return faults;
}

/** Samples worth keeping: anything that could still be part of a held condition. */
export function trim(history: Sample[], thresholds: WatchThresholds, now: number): Sample[] {
  const longest = Math.max(thresholds.tempGraceSec, thresholds.offlineSec, thresholds.stallMinSec) * 1000;
  // One extra sample beyond the window keeps `heldSince` able to see the edge.
  const cutoff = now - longest - 60_000;
  const first = history.findIndex((s) => s.at >= cutoff);
  return first <= 0 ? history : history.slice(first - 1);
}
