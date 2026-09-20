/**
 * MJPEG decoding in the page.
 *
 * Browsers can render multipart/x-mixed-replace in an <img>, but only when the
 * Content-Type header carries the multipart boundary. Home Assistant Ingress
 * rewrites that header to the bare media type, so the built-in decoder fails
 * after the first frame. This module fetches the stream and cuts JPEG frames out
 * of the byte stream itself: by each part's Content-Length header when present
 * (MJPG-Streamer sends it), otherwise by the JPEG SOI/EOI markers.
 */

const SOI = [0xff, 0xd8, 0xff];
const EOI = [0xff, 0xd9];

export class FrameSplitter {
  private buf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** Max bytes to keep while waiting for a frame end (guards against garbage). */
  private readonly maxBuffer: number;
  constructor(maxBuffer = 8 * 1024 * 1024) { this.maxBuffer = maxBuffer; }

  /** Feed bytes; returns every complete JPEG frame found. */
  push(chunk: Uint8Array): Uint8Array[] {
    this.buf = concat(this.buf, chunk);
    const frames: Uint8Array[] = [];
    for (;;) {
      const soi = indexOf(this.buf, SOI, 0);
      if (soi < 0) {
        // keep only a tail in case a marker straddles chunks
        if (this.buf.length > 4096) this.buf = this.buf.slice(-16);
        break;
      }
      // Part header (text before the image) may carry Content-Length.
      const headerText = latin1(this.buf.subarray(Math.max(0, soi - 512), soi));
      const m = /content-length:\s*(\d+)/i.exec(headerText);
      let end = -1;
      if (m) {
        const len = Number(m[1]);
        if (len > 0 && len < this.maxBuffer) {
          if (this.buf.length < soi + len) break; // wait for the rest
          end = soi + len;
        }
      }
      if (end < 0) {
        const eoi = indexOf(this.buf, EOI, soi + 2);
        if (eoi < 0) {
          if (this.buf.length > this.maxBuffer) this.buf = this.buf.slice(soi); // drop junk before frame
          if (this.buf.length > this.maxBuffer) this.buf = new Uint8Array(0);
          break;
        }
        end = eoi + 2;
      }
      frames.push(this.buf.slice(soi, end));
      this.buf = this.buf.slice(end);
    }
    return frames;
  }
}

export interface MjpegHandle { stop(): void }

export interface MjpegCallbacks {
  onFrame: (frame: Blob) => void;
  /** Stream ended or failed; `status` is the HTTP status when a response was received. */
  onEnd: (info: { status?: number; contentType?: string | null; error?: string }) => void;
}

/** Start reading an MJPEG stream; call stop() to abort. */
export function openMjpegStream(url: string, cb: MjpegCallbacks): MjpegHandle {
  const ctrl = new AbortController();
  (async () => {
    let res: Response;
    try {
      res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    } catch (e) {
      if (!ctrl.signal.aborted) cb.onEnd({ error: e instanceof Error ? e.name : String(e) });
      return;
    }
    const contentType = res.headers.get('content-type');
    if (!res.ok || !res.body) { cb.onEnd({ status: res.status, contentType }); return; }
    // A single JPEG (snapshot endpoint) is also fine: one frame.
    if (/^image\/jpeg/i.test(contentType ?? '')) {
      try { cb.onFrame(await res.blob()); } catch { /* aborted */ }
      cb.onEnd({ status: res.status, contentType });
      return;
    }
    const reader = res.body.getReader();
    const splitter = new FrameSplitter();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) for (const f of splitter.push(value)) cb.onFrame(new Blob([f as BlobPart], { type: 'image/jpeg' }));
      }
      if (!ctrl.signal.aborted) cb.onEnd({ status: res.status, contentType });
    } catch (e) {
      if (!ctrl.signal.aborted) cb.onEnd({ status: res.status, contentType, error: e instanceof Error ? e.name : String(e) });
    }
  })();
  return { stop: () => ctrl.abort() };
}

/** MJPG-Streamer style: the still-image variant of a stream URL, or null if not applicable. */
export function snapshotUrlFor(streamUrl: string): string | null {
  return /action=stream/.test(streamUrl) ? streamUrl.replace('action=stream', 'action=snapshot') : null;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}
function indexOf(hay: Uint8Array, needle: number[], from: number): number {
  outer: for (let i = Math.max(0, from); i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
