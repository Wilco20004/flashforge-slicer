/// <reference lib="webworker" />
import { planLayers } from './engine';
import { generateGcode } from './gcode';
import type { SliceSettings } from './settings';
import type { GcodeStats, PreviewData } from './gcode';

export interface SliceRequest {
  type: 'slice';
  id: number;
  positions: Float32Array;
  settings: SliceSettings;
  thumbnailPng?: string;
  modelName?: string;
}
export interface SliceProgress { type: 'progress'; id: number; stage: string; fraction: number }
export interface SliceDone {
  type: 'done';
  id: number;
  gcode: string;
  stats: GcodeStats;
  preview: PreviewData;
  layerZs: Float32Array;
}
export interface SliceError { type: 'error'; id: number; message: string }
export type WorkerMessage = SliceProgress | SliceDone | SliceError;

self.onmessage = (ev: MessageEvent<SliceRequest>) => {
  const req = ev.data;
  if (req.type !== 'slice') return;
  const post = (m: WorkerMessage, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);
  try {
    const plan = planLayers(req.positions, req.settings, (stage, fraction) => post({ type: 'progress', id: req.id, stage, fraction }));
    post({ type: 'progress', id: req.id, stage: 'Writing G-code', fraction: 0 });
    const res = generateGcode(plan.layers, req.settings, { thumbnailPng: req.thumbnailPng, modelName: req.modelName });
    const layerZs = new Float32Array(plan.layers.map((l) => l.z));
    post(
      { type: 'done', id: req.id, gcode: res.gcode, stats: res.stats, preview: res.preview, layerZs },
      [res.preview.segments.buffer, res.preview.types.buffer, res.preview.layerOffsets.buffer, layerZs.buffer],
    );
  } catch (e) {
    post({ type: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) });
  }
};
