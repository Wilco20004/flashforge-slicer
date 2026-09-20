/**
 * Flashforge Adventurer 5M / 5M Pro LAN API (firmware 2.6.6+ / 3.x, port 8898).
 * Same protocol OrcaSlicer's "Flashforge" print host uses. The printer's
 * serial number and check code are shown under Settings > Network on the printer.
 *
 * Requests go through the same-origin relay when the hosting server provides one
 * (Docker / Home Assistant add-on); otherwise straight to the printer, which only
 * works from an http:// page and if the firmware answers CORS preflights.
 */
import { explainNetworkFailure, isPrivateIPv4, relayUrl } from './relay';

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

// ---------------------------------------------------------------------------
// Live status and control
// ---------------------------------------------------------------------------

/** Subset of the POST /detail payload the UI uses (all optional: firmware differs). */
export interface PrinterDetail {
  status?: string;            // ready | heating | printing | pause | completed | cancel | error | busy
  name?: string;
  firmwareVersion?: string;
  pid?: number;               // 35 = 5M, 36 = 5M Pro
  printFileName?: string;
  printProgress?: number;     // 0..1
  printLayer?: number;
  targetPrintLayer?: number;
  estimatedTime?: number;     // seconds remaining
  printDuration?: number;     // seconds elapsed
  rightTemp?: number;
  rightTargetTemp?: number;
  platTemp?: number;
  platTargetTemp?: number;
  chamberTemp?: number;
  currentPrintSpeed?: number; // percent
  coolingFanSpeed?: number;   // percent
  lightStatus?: 'open' | 'close' | string;
  doorStatus?: string;
  errorCode?: string;
  cameraStreamUrl?: string;   // "http://<ip>:8080/?action=stream", empty without a camera
  nozzleModel?: string;
  rightFilamentType?: string;
  zAxisCompensation?: number;
}

export async function fetchDetail(cfg: FlashforgeConfig, relay: boolean): Promise<PrinterDetail> {
  const res = await getDetail(cfg, relay);
  const d = (res as { detail?: PrinterDetail }).detail;
  if (!d || typeof d !== 'object') throw new Error('Printer answered without a detail block');
  return d;
}

export type ControlCommand =
  | { cmd: 'jobCtl_cmd'; args: { jobID: string; action: 'pause' | 'continue' | 'cancel' } }
  | { cmd: 'lightControl_cmd'; args: { status: 'open' | 'close' } }
  | { cmd: 'streamCtrl_cmd'; args: { action: 'open' | 'close' } }
  | { cmd: 'temperatureCtl_cmd'; args: { rightNozzle?: number; platform?: number } }
  | { cmd: 'printerCtl_cmd'; args: { speed?: number; coolingFan?: number; zAxisCompensation?: number } };

export async function sendControl(cfg: FlashforgeConfig, relay: boolean, payload: ControlCommand): Promise<ApiResponse> {
  let res: Response;
  try {
    res = await fetch(apiUrl(cfg, 'control', relay), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber: cfg.serialNumber, checkCode: cfg.checkCode, payload }),
    });
  } catch {
    throw new Error(explainNetworkFailure(relay));
  }
  return parseResponse(res);
}

export const pausePrint = (cfg: FlashforgeConfig, relay: boolean) => sendControl(cfg, relay, { cmd: 'jobCtl_cmd', args: { jobID: '', action: 'pause' } });
export const resumePrint = (cfg: FlashforgeConfig, relay: boolean) => sendControl(cfg, relay, { cmd: 'jobCtl_cmd', args: { jobID: '', action: 'continue' } });
export const cancelPrint = (cfg: FlashforgeConfig, relay: boolean) => sendControl(cfg, relay, { cmd: 'jobCtl_cmd', args: { jobID: '', action: 'cancel' } });
export const setLight = (cfg: FlashforgeConfig, relay: boolean, on: boolean) => sendControl(cfg, relay, { cmd: 'lightControl_cmd', args: { status: on ? 'open' : 'close' } });
export const setCameraStream = (cfg: FlashforgeConfig, relay: boolean, on: boolean) => sendControl(cfg, relay, { cmd: 'streamCtrl_cmd', args: { action: on ? 'open' : 'close' } });

/**
 * URL to show the printer's MJPEG camera from this page. Through the relay when
 * available (required on HTTPS pages); otherwise the printer's own URL.
 */
export function cameraUrl(cfg: FlashforgeConfig, detail: PrinterDetail | null, relay: boolean): string | null {
  const raw = detail?.cameraStreamUrl?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname || splitHost(cfg.host).host;
    const port = Number(u.port || 8080);
    if (relay && isPrivateIPv4(host)) return relayUrl(host, port, u.pathname) + u.search;
    return raw;
  } catch {
    return null;
  }
}

const STATUS_LABEL: Record<string, string> = {
  ready: 'Ready', idle: 'Ready', heating: 'Heating', printing: 'Printing', pause: 'Paused', paused: 'Paused',
  pausing: 'Pausing', completed: 'Completed', cancel: 'Cancelled', cancelled: 'Cancelled', canceling: 'Cancelling',
  error: 'Error', busy: 'Busy', calibrate_doing: 'Calibrating',
};
export function statusLabel(status?: string): string {
  if (!status) return 'Unknown';
  return STATUS_LABEL[status.toLowerCase()] ?? status;
}
export function isPrintingStatus(status?: string): boolean {
  const s = (status ?? '').toLowerCase();
  return s === 'printing' || s === 'heating' || s === 'pause' || s === 'paused' || s === 'pausing' || s === 'busy';
}
