/**
 * Moonraker upload, for Adventurer 5M units running the community Klipper mod
 * (Fluidd/Mainsail). Moonraker sends CORS headers when `cors_domains` in
 * moonraker.conf includes the origin this page is served from (or "*").
 */
export interface MoonrakerConfig { url: string; apiKey?: string }

export function uploadToMoonraker(cfg: MoonrakerConfig, gcode: string, fileName: string, print: boolean, onProgress?: (f: number) => void): Promise<unknown> {
  const base = cfg.url.trim().replace(/\/+$/, '');
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
      } else reject(new Error(`Moonraker upload failed (HTTP ${xhr.status}): ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error('Could not reach Moonraker. Check the URL and that cors_domains allows this page.'));
    xhr.send(form);
  });
}
