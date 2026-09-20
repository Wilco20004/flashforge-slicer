import { useEffect, useRef, useState } from 'react';
import { fetchDetail, type FlashforgeConfig, type PrinterDetail } from '../printer/flashforge';

export interface PrinterStatusState {
  detail: PrinterDetail | null;
  error: string | null;
  updatedAt: number | null;
  refresh: () => void;
}

/**
 * Polls /detail while a printer is configured. Fast while the Monitor view is
 * open, slow otherwise, paused while the tab is hidden.
 */
export function usePrinterStatus(cfg: FlashforgeConfig | null, relay: boolean | null, fast: boolean): PrinterStatusState {
  const [detail, setDetail] = useState<PrinterDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const inflight = useRef(false);
  const enabled = Boolean(cfg && cfg.host && cfg.serialNumber && cfg.checkCode) && relay !== null;

  useEffect(() => {
    if (!enabled || !cfg) { setDetail(null); setError(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const period = () => (document.visibilityState === 'hidden' ? 30000 : fast ? 3000 : 10000);
    const poll = async () => {
      if (cancelled) return;
      if (!inflight.current && document.visibilityState !== 'hidden') {
        inflight.current = true;
        try {
          const d = await fetchDetail(cfg, Boolean(relay));
          if (!cancelled) { setDetail(d); setError(null); setUpdatedAt(Date.now()); }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        } finally { inflight.current = false; }
      }
      if (!cancelled) timer = setTimeout(poll, period());
    };
    poll();
    const onVis = () => { if (document.visibilityState === 'visible') { if (timer) clearTimeout(timer); poll(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, cfg?.host, cfg?.serialNumber, cfg?.checkCode, relay, fast, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return { detail, error, updatedAt, refresh: () => setTick((t) => t + 1) };
}
