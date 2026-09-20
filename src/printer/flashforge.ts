/**
 * Flashforge Adventurer 5M / 5M Pro LAN API (firmware 2.6.6+ / 3.x, port 8898).
 * Same protocol OrcaSlicer's "Flashforge" print host uses. The printer's
 * serial number and check code are shown under Settings > Network on the printer.
 *
 * Requests go through the same-origin relay when the hosting server provides one
 * (Docker / Home Assistant add-on); otherwise straight to the printer, which only
 * works from an http:// page and if the firmware answers CORS preflights.
 */
import { explainNetworkFailure, relayUrl } from './relay';

export interface FlashforgeConfig {
  host: string; // IP or hostname, optional :port
  serialNumber: string;
  checkCode: string;
}

export interface UploadOptions {
  fileName: string;
  printNow: boolean;
  levelingBeforePrint: boolean;
  relay: boolean;
  onProgress?: (fraction: number) => void;
}

export interface ApiResponse { code: number; message: string; [k: string]: unknown }

export const FLASHFORGE_PORT = 8898;

export function sanitizeFilename(name: string): string {
  let base = name.split(/[\\/]/).pop() || 'print.gcode';
  base = base.replace(/[^0-9A-Za-z._-]/g, '_');
  if (!/\.(gcode|3mf)$/i.test(base)) base += '.gcode';
  return base;
}

export function splitHost(input: string): { host: string; port: number } {
  const s = input.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const m = /^(.*):(\d+)$/.exec(s);
  return m ? { host: m[1], port: Number(m[2]) } : { host: s, port: FLASHFORGE_PORT };
}

export function apiUrl(cfg: FlashforgeConfig, path: string, relay: boolean): string {
  const { host, port } = splitHost(cfg.host);
  return relay ? relayUrl(host, port, path) : `http://${host}:${port}/${path}`;
}

export async function getDetail(cfg: FlashforgeConfig, relay: boolean): Promise<ApiResponse> {
  let res: Response;
  try {
    res = await fetch(apiUrl(cfg, 'detail', relay), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber: cfg.serialNumber, checkCode: cfg.checkCode }),
    });
  } catch {
    throw new Error(explainNetworkFailure(relay));
  }
  return parseResponse(res);
}

export function uploadGcode(cfg: FlashforgeConfig, gcode: string | Blob, opts: UploadOptions): Promise<ApiResponse> {
  const blob = gcode instanceof Blob ? gcode : new Blob([gcode], { type: 'application/octet-stream' });
  const fileName = sanitizeFilename(opts.fileName);
  const form = new FormData();
  form.append('gcodeFile', blob, fileName);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl(cfg, 'uploadGcode', opts.relay));
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
        else reject(new Error(`Printer rejected upload (HTTP ${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
      }
    };
    xhr.onerror = () => reject(new Error(explainNetworkFailure(opts.relay)));
    xhr.send(form);
  });
}

export async function printGcode(cfg: FlashforgeConfig, fileName: string, levelingBeforePrint: boolean, relay: boolean): Promise<ApiResponse> {
  let res: Response;
  try {
    res = await fetch(apiUrl(cfg, 'printGcode', relay), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber: cfg.serialNumber, checkCode: cfg.checkCode, fileName: sanitizeFilename(fileName), levelingBeforePrint }),
    });
  } catch {
    throw new Error(explainNetworkFailure(relay));
  }
  return parseResponse(res);
}

async function parseResponse(res: Response): Promise<ApiResponse> {
  const text = await res.text();
  let body: ApiResponse;
  try { body = JSON.parse(text); } catch { body = { code: res.ok ? 0 : res.status, message: text.slice(0, 200) }; }
  if (res.status === 502 || res.status === 504) {
    throw new Error('The relay could not reach the printer (no answer on port 8898). Check the IP address and that LAN mode is enabled on the printer.');
  }
  if (!res.ok || (typeof body.code === 'number' && body.code !== 0)) {
    throw new Error(`Printer API error ${body.code ?? res.status}: ${body.message ?? text.slice(0, 200)}`);
  }
  return body;
}
