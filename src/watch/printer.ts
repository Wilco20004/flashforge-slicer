/**
 * The one call the watcher makes to the printer.
 *
 * Deliberately not the app's own printer client: that one is built around a
 * browser — a same-origin relay, CORS, mixed content, `location`. None of it
 * applies to a process sitting on the same machine as nginx, and importing it
 * here would drag those assumptions into a place they cannot hold.
 */
import type { PrinterTarget } from './config.js';

/** The fields the rules read. The printer sends more; firmware decides how much. */
export interface RawDetail {
  status?: string;
  errorCode?: string;
  printLayer?: number;
  targetPrintLayer?: number;
  printFileName?: string;
  printProgress?: number;
  rightTemp?: number;
  rightTargetTemp?: number;
  platTemp?: number;
  platTargetTemp?: number;
  name?: string;
}

export async function fetchDetail(target: PrinterTarget, timeoutMs = 8000): Promise<RawDetail> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${target.host}:${target.port}/detail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber: target.serialNumber, checkCode: target.checkCode }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`printer answered HTTP ${res.status}`);
    const body = (await res.json()) as { code?: number; message?: string; detail?: RawDetail };
    if (typeof body.code === 'number' && body.code !== 0) {
      throw new Error(`printer API error ${body.code}: ${body.message ?? ''}`);
    }
    if (!body.detail || typeof body.detail !== 'object') throw new Error('printer answered without a detail block');
    return body.detail;
  } finally {
    clearTimeout(timer);
  }
}
