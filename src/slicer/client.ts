import type { SliceSettings } from './settings';
import type { SliceRequest, WorkerMessage, SliceDone } from './worker';

export type SliceOutput = Omit<SliceDone, 'type' | 'id'>;

export interface SliceOpts {
  thumbnailPng?: string;
  modelName?: string;
  onProgress?: (stage: string, fraction: number) => void;
  /** Called when the Web Worker could not be started and slicing runs on the page's own thread. */
  onFallback?: (reason: string) => void;
}

/** How long to wait for the worker to report that it loaded. */
const READY_TIMEOUT_MS = 20000;

export class WorkerUnavailableError extends Error {}

/**
 * Runs the slicing pipeline in a Web Worker. One job at a time; a new job cancels
 * the previous one. The worker is started and handshaked *before* the job is sent,
 * so a worker that cannot load (its chunk is missing after an update, workers are
 * blocked, module workers unsupported) falls back to slicing on the page's own
 * thread with the model data intact.
 */
export class SlicerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  /** Set once a worker fails to start, so later jobs do not pay the timeout again. */
  private workerUnavailable: string | null = null;
  private cancelled = false;

  async slice(positions: Float32Array, settings: SliceSettings, opts: SliceOpts = {}): Promise<SliceOutput> {
    this.cancel();
    this.cancelled = false;

    let worker: Worker | null = null;
    if (this.workerUnavailable === null) {
      try {
        worker = await this.spawn();
      } catch (e) {
        this.workerUnavailable = e instanceof Error ? e.message : String(e);
      }
    }
    if (this.cancelled) throw new Error('Slicing cancelled');

    if (!worker) {
      opts.onFallback?.(this.workerUnavailable ?? 'the background worker is unavailable');
      return sliceOnThisThread(positions, settings, opts);
    }

    this.worker = worker;
    const id = this.nextId++;
    return new Promise<SliceOutput>((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
        const m = ev.data;
        if (m.type === 'ready' || m.id !== id) return;
        if (m.type === 'progress') opts.onProgress?.(m.stage, m.fraction);
        else if (m.type === 'done') {
          const { type: _t, id: _i, ...rest } = m;
          void _t; void _i;
          resolve(rest);
          this.dispose(worker);
        } else if (m.type === 'error') {
          reject(new Error(m.message));
          this.dispose(worker);
        }
      };
      // A worker that already reported ready and then dies has run out of memory
      // or hit a bug; the model data has been transferred away, so there is
      // nothing left to retry with on this thread.
      worker.onerror = (e) => {
        reject(new Error(
          (e.message ? `${e.message}. ` : '') +
          'The slicing worker stopped. This model may need more memory than the device has; ' +
          'try a larger layer height, fewer objects, or slicing on a computer.',
        ));
        this.dispose(worker);
      };
      const req: SliceRequest = { type: 'slice', id, positions, settings, thumbnailPng: opts.thumbnailPng, modelName: opts.modelName };
      worker.postMessage(req, [positions.buffer]);
    });
  }

  /** Start a worker and wait for its ready message. Rejects if it cannot load. */
  private spawn(): Promise<Worker> {
    return new Promise<Worker>((resolve, reject) => {
      let w: Worker;
      try {
        w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      } catch (e) {
        reject(new WorkerUnavailableError(e instanceof Error ? e.message : 'workers are not available'));
        return;
      }
      const settle = (fn: () => void) => { clearTimeout(timer); w.onmessage = null; w.onerror = null; fn(); };
      const timer = setTimeout(() => settle(() => {
        w.terminate();
        reject(new WorkerUnavailableError('the slicing worker did not start in time'));
      }), READY_TIMEOUT_MS);
      w.onmessage = (ev: MessageEvent<WorkerMessage>) => {
        if (ev.data?.type === 'ready') settle(() => resolve(w));
      };
      // Fires when the worker's script cannot be fetched or fails to evaluate.
      w.onerror = (e) => settle(() => {
        w.terminate();
        reject(new WorkerUnavailableError(e.message || 'the slicing worker could not be loaded'));
      });
    });
  }

  cancel() {
    this.cancelled = true;
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }

  private dispose(w: Worker) {
    if (this.worker === w) this.worker = null;
    w.terminate();
  }
}

/** Same pipeline, run inline. The interface cannot repaint while this runs. */
async function sliceOnThisThread(positions: Float32Array, settings: SliceSettings, opts: SliceOpts): Promise<SliceOutput> {
  const [{ planLayers }, { generateGcode }] = await Promise.all([import('./engine'), import('./gcode')]);
  // Let the progress card paint before the thread is blocked.
  await new Promise((r) => setTimeout(r, 30));
  const plan = planLayers(positions, settings, (stage, fraction) => opts.onProgress?.(stage, fraction));
  opts.onProgress?.('Writing G-code', 0);
  const res = generateGcode(plan.layers, settings, { thumbnailPng: opts.thumbnailPng, modelName: opts.modelName });
  return {
    gcode: res.gcode,
    stats: res.stats,
    preview: res.preview,
    layerZs: new Float32Array(plan.layers.map((l) => l.z)),
  };
}
