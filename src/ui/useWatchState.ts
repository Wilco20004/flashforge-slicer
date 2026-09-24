import { useEffect, useState } from 'react';

/**
 * What the add-on's failure watcher last saw.
 *
 * The watcher writes this whether or not a broker is configured, so the page can
 * show it without MQTT in the picture. Served only by the add-on's own nginx;
 * anywhere else the fetch 404s and there is simply nothing to show.
 */
export interface WatchState {
  status: string;
  faults: string[];
  summary: string;
  reachable: boolean;
  updated_at: string;
}

function looksLikeWatchState(v: unknown): v is WatchState {
  const s = v as Partial<WatchState> | null;
  return Boolean(s && Array.isArray(s.faults) && typeof s.summary === 'string');
}

export function useWatchState(pollMs = 15000): WatchState | null {
  const [state, setState] = useState<WatchState | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('watch-state.json', { cache: 'no-store' });
        if (!r.ok) return;
        const j: unknown = await r.json();
        if (alive && looksLikeWatchState(j)) setState(j);
      } catch {
        /* not served here, or not written yet: there is nothing to report */
      }
    };
    void load();
    const timer = window.setInterval(load, pollMs);
    return () => { alive = false; window.clearInterval(timer); };
  }, [pollMs]);
  return state;
}
