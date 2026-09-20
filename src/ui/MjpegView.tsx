import { useEffect, useRef, useState } from 'react';
import { openMjpegStream, snapshotUrlFor } from '../printer/mjpeg';

export interface MjpegViewProps {
  url: string;
  /** Called when the stream cannot be (re)established after the built-in retries. */
  onFailed: (reason: string) => void;
  onFirstFrame?: () => void;
}

/**
 * Renders an MJPEG stream by decoding it in the page (works behind proxies that
 * drop the multipart boundary, e.g. Home Assistant Ingress). Reconnects with
 * backoff; after repeated failures falls back to polling still images.
 */
export function MjpegView({ url, onFailed, onFirstFrame }: MjpegViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [mode, setMode] = useState<'stream' | 'snapshot'>('stream');

  useEffect(() => {
    let stopped = false;
    let handle: { stop(): void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let frames = 0;
    let gotFrame = false;
    let lastUrl: string | null = null;
    const fpsTimer = setInterval(() => { setFps(frames); frames = 0; }, 1000);

    const show = (blob: Blob) => {
      const img = imgRef.current;
      if (!img || stopped) return;
      const next = URL.createObjectURL(blob);
      img.onload = () => { if (lastUrl) URL.revokeObjectURL(lastUrl); lastUrl = next; };
      img.src = next;
      frames++;
      if (!gotFrame) { gotFrame = true; onFirstFrame?.(); }
    };

    const connect = () => {
      if (stopped) return;
      handle = openMjpegStream(url, {
        onFrame: (b) => { failures = 0; show(b); },
        onEnd: (info) => {
          if (stopped) return;
          failures++;
          const desc = info.error ? `request failed (${info.error})` : `HTTP ${info.status ?? '?'}, ${info.contentType ?? 'no content-type'}`;
          if (failures >= 6) {
            // Last resort: poll still images if the URL has a snapshot variant.
            const snap = snapshotUrlFor(url);
            if (snap && !gotFrame) { setMode('snapshot'); pollSnapshots(snap); return; }
            onFailed(desc);
            return;
          }
          timer = setTimeout(connect, Math.min(5000, 500 * failures));
        },
      });
    };

    const pollSnapshots = (snap: string) => {
      let snapFailures = 0;
      const tick = async () => {
        if (stopped) return;
        try {
          const r = await fetch(snap, { cache: 'no-store' });
          if (r.ok && /^image\//i.test(r.headers.get('content-type') ?? '')) { show(await r.blob()); snapFailures = 0; }
          else if (++snapFailures > 5) { onFailed(`snapshot HTTP ${r.status}`); return; }
        } catch (e) {
          if (++snapFailures > 5) { onFailed(`snapshot failed (${e instanceof Error ? e.name : String(e)})`); return; }
        }
        timer = setTimeout(tick, 400);
      };
      tick();
    };

    connect();
    return () => {
      stopped = true;
      handle?.stop();
      if (timer) clearTimeout(timer);
      clearInterval(fpsTimer);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <img ref={imgRef} alt="Printer camera" />
      {fps !== null && <span className="fps">{mode === 'snapshot' ? 'stills · ' : ''}{fps} fps</span>}
    </>
  );
}
