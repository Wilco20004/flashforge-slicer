declare const __BUILD_ID__: string | undefined;

/** Identifies the build this page was loaded from ('dev' when not built by Vite). */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const RELOAD_KEY = 'flashforge-slicer-reloaded-for';

/**
 * The build id the server is offering now, or null when it cannot be read
 * (dev server, offline, hosted without version.json).
 */
export async function serverBuildId(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
    const url = new URL(`version.json?t=${Date.now()}`, base).toString();
    const r = await fetcher(url, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: unknown };
    return typeof j.build === 'string' ? j.build : null;
  } catch {
    return null;
  }
}

/** True when the server has a different build than the one running in this page. */
export async function updateAvailable(fetcher: typeof fetch = fetch): Promise<boolean> {
  if (BUILD_ID === 'dev') return false;
  const latest = await serverBuildId(fetcher);
  return latest !== null && latest !== BUILD_ID;
}

/**
 * Reload to pick up a new build. Guarded so a page that keeps coming back with
 * the same build (a cached index.html) cannot reload in a loop.
 */
export function reloadForUpdate(): boolean {
  if (alreadyReloadedForThisBuild()) return false;
  try { sessionStorage.setItem(RELOAD_KEY, BUILD_ID); } catch { /* private mode */ }
  location.reload();
  return true;
}

export function alreadyReloadedForThisBuild(): boolean {
  try { return sessionStorage.getItem(RELOAD_KEY) === BUILD_ID; } catch { return false; }
}
