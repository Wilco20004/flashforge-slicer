/**
 * Where settings live.
 *
 * - Always in this browser's localStorage (works everywhere, per device/origin).
 * - Additionally on the server when the app is served by its own nginx (Docker /
 *   Home Assistant add-on): GET/PUT /settings.json, persisted in the container's
 *   /data volume. Every device that opens the slicer then shares one set of
 *   settings and the saved printer.
 *
 * The record carries `updatedAt`; on start the newer of local/server wins.
 */
import { serverFeatures } from '../printer/relay';

export const STORAGE_KEY = 'flashforge-slicer-v1';

export interface Stamped { updatedAt: number }

export function loadLocal<T extends Stamped>(): T | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

export function saveLocal<T extends Stamped>(value: T): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export async function settingsStoreAvailable(): Promise<boolean> {
  return (await serverFeatures()).store;
}

export async function loadRemote<T extends Stamped>(): Promise<T | null> {
  try {
    const r = await fetch('settings.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const text = await r.text();
    if (!text.trim()) return null;
    const v = JSON.parse(text) as T;
    return typeof v === 'object' && v ? v : null;
  } catch { return null; }
}

export async function saveRemote<T extends Stamped>(value: T): Promise<boolean> {
  try {
    const r = await fetch('settings.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    return r.ok;
  } catch { return false; }
}

/** Pick the more recently changed record; a missing side loses. */
export function pickNewer<T extends Stamped>(a: T | null, b: T | null): T | null {
  if (!a) return b;
  if (!b) return a;
  return (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a;
}

/** Debounced remote writer so rapid edits (typing, sliders) coalesce into one PUT. */
export function createRemoteSaver<T extends Stamped>(delayMs = 600) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;
  let listeners: ((ok: boolean) => void)[] = [];
  const flush = async () => {
    timer = null;
    if (!pending) return;
    const v = pending;
    pending = null;
    const ok = await saveRemote(v);
    listeners.forEach((l) => l(ok));
  };
  return {
    save(v: T) {
      pending = v;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    onResult(l: (ok: boolean) => void) { listeners.push(l); return () => { listeners = listeners.filter((x) => x !== l); }; },
    flushNow: flush,
  };
}
