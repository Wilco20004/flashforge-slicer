/**
 * Moonraker upload, for Adventurer 5M units running the community Klipper mod
 * (Fluidd/Mainsail). Goes through the same-origin relay when available and the
 * host is a LAN IP; otherwise Moonraker must list this page's origin in
 * `cors_domains` (moonraker.conf).
 */
import { explainNetworkFailure, isPrivateIPv4, relayUrl } from './relay';

export interface MoonrakerConfig { url: string; apiKey?: string }

export function moonrakerBase(cfg: MoonrakerConfig, relay: boolean): string {
  const raw = cfg.url.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 7125));
    if (relay && isPrivateIPv4(u.hostname)) return relayUrl(u.hostname, port, '').replace(/\/$/, '');
    return `${u.protocol}//${u.hostname}:${port}`;
  } catch {
    return withScheme;
  }
}

export function uploadToMoonraker(cfg: MoonrakerConfig, gcode: string, fileName: string, print: boolean, relay: boolean, onProgress?: (f: number) => void): Promise<unknown> {
  const base = moonrakerBase(cfg, relay);
  const form = new FormData();
  form.append('file', new Blob([gcode], { type: 'text/plain' }), fileName);
  form.append('root', 'gcodes');
  form.append('print', print ? 'true' : 'false');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/server/files/upload`);
    if (cfg.apiKey) xhr.setRequestHeader('X-Api-Key', cfg.apiKey);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(xhr.responseText); }
      } else reject(new Error(`Moonraker upload failed (HTTP ${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error(explainNetworkFailure(relay)));
    xhr.send(form);
  });
}
