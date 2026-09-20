import type { SliceSettings } from './settings';
import type { SliceRequest, WorkerMessage, SliceDone } from './worker';

export type SliceOutput = Omit<SliceDone, 'type' | 'id'>;

/** Runs the slicing pipeline in a Web Worker. One job at a time; a new job cancels the previous one. */
export class SlicerClient {
  private worker: Worker | null = null;
  private nextId = 1;

  slice(
    positions: Float32Array,
    settings: SliceSettings,
    opts: { thumbnailPng?: string; modelName?: string; onProgress?: (stage: string, fraction: number) => void } = {},
  ): Promise<SliceOutput> {
    this.cancel();
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
        const m = ev.data;
        if (m.id !== id) return;
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
      worker.onerror = (e) => {
        reject(new Error(e.message || 'Slicing worker crashed'));
        this.dispose(worker);
      };
      const req: SliceRequest = { type: 'slice', id, positions, settings, thumbnailPng: opts.thumbnailPng, modelName: opts.modelName };
      worker.postMessage(req, [positions.buffer]);
    });
  }

  cancel() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }

  private dispose(w: Worker) {
    if (this.worker === w) this.worker = null;
    w.terminate();
  }
}
