/**
 * Flashforge Adventurer 5M / 5M Pro LAN API (firmware 2.6.6+ / 3.x, port 8898).
 * Same protocol OrcaSlicer's "Flashforge" print host uses. The printer's
 * serial number and check code are shown under Settings > Network on the printer.
 *
 * Browser note: the printer must answer CORS preflight requests for this to work
 * from a web page. If it doesn't, the upload fails in the browser even though
 * the printer is reachable; download the G-code instead and use USB / Orca.
 */

export interface FlashforgeConfig {
  host: string; // IP or hostname
  serialNumber: string;
  checkCode: string;
}

export interface UploadOptions {
  fileName: string;
  printNow: boolean;
  levelingBeforePrint: boolean;
  onProgress?: (fraction: number) => void;
}

export interface ApiResponse { code: number; message: string; [k: string]: unknown }

export function sanitizeFilename(name: string): string {
  let base = name.split(/[\\/]/).pop() || 'print.gcode';
  base = base.replace(/[^0-9A-Za-z._-]/g, '_');
  if (!/\.(gcode|3mf)$/i.test(base)) base += '.gcode';
  return base;
}

export function apiUrl(cfg: FlashforgeConfig, path: string): string {
  const host = cfg.host.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `http://${host}${host.includes(':') ? '' : ':8898'}/${path}`;
}

export async function getDetail(cfg: FlashforgeConfig): Promise<ApiResponse> {
  const res = await fetch(apiUrl(cfg, 'detail'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serialNumber: cfg.serialNumber, checkCode: cfg.checkCode }),
  });
  return parseResponse(res);
}

export function uploadGcode(cfg: FlashforgeConfig, gcode: string | Blob, opts: UploadOptions): Promise<ApiResponse> {
  const blob = gcode instanceof Blob ? gcode : new Blob([gcode], { type: 'application/octet-stream' });
  const fileName = sanitizeFilename(opts.fileName);
  const form = new FormData();
  form.append('gcodeFile', blob, fileName);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl(cfg, 'uploadGcode'));
    xhr.setRequestHeader('serialNumber', cfg.serialNumber);
    xhr.setRequestHeader('checkCode', cfg.checkCode);
    xhr.setRequestHeader('fileSize', String(blob.size));
    xhr.setRequestHeader('printNow', opts.printNow ? 'true' : 'false');
    xhr.setRequestHeader('levelingBeforePrint', opts.levelingBeforePrint ? 'true' : 'false');
    xhr.setRequestHeader('flowCalibration', 'false');
    xhr.setRequestHeader('firstLayerInspection', 'false');
    xhr.setRequestHeader('timeLapseVideo', 'false');
    xhr.setRequestHeader('useMatlStation', 'false');
    xhr.setRequestHeader('gcodeToolCnt', '0');
    xhr.setRequestHeader('materialMappings', btoa('[]'));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText || '{}') as ApiResponse;
        if (xhr.status >= 200 && xhr.status < 300 && (body.code === 0 || body.code === undefined)) resolve(body);
        else reject(new Error(`Printer rejected upload (HTTP ${xhr.status}): ${body.message ?? xhr.responseText}`));
      } catch {
        if (xhr.status >= 200 && xhr.status < 300) resolve({ code: 0, message: xhr.responseText });
        else reject(new Error(`Printer rejected upload (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error(
      'Could not reach the printer from the browser. Check the IP address, that LAN mode is enabled, and that the printer firmware allows cross-origin (CORS) requests. Otherwise download the G-code and copy it via USB.',
    ));
    xhr.send(form);
  });
}

export async function printGcode(cfg: FlashforgeConfig, fileName: string, levelingBeforePrint: boolean): Promise<ApiResponse> {
  const res = await fetch(apiUrl(cfg, 'printGcode'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serialNumber: cfg.serialNumber, checkCode: cfg.checkCode, fileName: sanitizeFilename(fileName), levelingBeforePrint }),
  });
  return parseResponse(res);
}

async function parseResponse(res: Response): Promise<ApiResponse> {
  const text = await res.text();
  let body: ApiResponse;
  try { body = JSON.parse(text); } catch { body = { code: res.ok ? 0 : res.status, message: text }; }
  if (!res.ok || (typeof body.code === 'number' && body.code !== 0)) {
    throw new Error(`Printer API error ${body.code ?? res.status}: ${body.message ?? text}`);
  }
  return body;
}
