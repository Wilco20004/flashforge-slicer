/**
 * Client for a LabelForge add-on on the LAN.
 *
 * LabelForge knows templates, variables and pixels — not filament. This is the
 * whole of what the slicer needs from it: which templates exist and what each
 * one wants filled in, a PNG preview, and a print.
 *
 * It answers CORS from any origin, so a plain-HTTP page can call it directly.
 * An HTTPS page cannot (mixed content), so when this app is served by its own
 * nginx the requests go through the same LAN relay the printer uses.
 */
import { relayUrl, isPrivateIPv4, explainNetworkFailure, pageIsHttps } from '../printer/relay';

export const DEFAULT_LABELFORGE_PORT = 8095;

export interface LabelForgeConfig {
  /** LAN IPv4 of the machine running LabelForge. */
  host: string;
  port: number;
  /** Template used for spool labels. */
  templateId: string;
  /**
   * Put in front of the spool id in the QR code. Empty encodes the bare id;
   * set it to this slicer's own address (e.g. `http://192.168.1.4:8099/#spool=`)
   * and scanning a spool opens the slicer with that spool selected.
   */
  qrPrefix: string;
  copies: number;
}

export function defaultLabelForgeConfig(): LabelForgeConfig {
  return { host: '', port: DEFAULT_LABELFORGE_PORT, templateId: '', qrPrefix: '', copies: 1 };
}

/** The image block of a template, as LabelForge reports it. */
export interface LabelImageBlock {
  variable: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelTemplate {
  id: string;
  name: string;
  label_size: string;
  variables: string[];
  /** Which variable, if any, takes a base64 image rather than text. */
  image_variable: string | null;
  image: LabelImageBlock | null;
}

export interface PrintLabelRequest {
  template_id: string;
  variables: Record<string, string>;
  copies?: number;
}

export function labelForgeConfigured(cfg: LabelForgeConfig): boolean {
  return Boolean(cfg.host.trim()) && cfg.port > 0;
}

/** Where to send a request, relative to this page so it also works behind Ingress. */
export function labelForgeUrl(cfg: LabelForgeConfig, path: string, relay: boolean): string {
  const clean = path.replace(/^\/+/, '');
  if (relay) return relayUrl(cfg.host.trim(), cfg.port, clean);
  return `http://${cfg.host.trim()}:${cfg.port}/${clean}`;
}

/** Why a configured host still cannot be reached, or null when it should work. */
export function labelForgeBlocked(cfg: LabelForgeConfig, relay: boolean): string | null {
  if (!labelForgeConfigured(cfg)) return 'Enter the address of the machine running LabelForge.';
  if (relay && !isPrivateIPv4(cfg.host.trim())) {
    return 'The relay only forwards to private LAN addresses, so LabelForge has to be given as an IP address like 192.168.1.20 rather than a host name.';
  }
  if (!relay && pageIsHttps()) return explainNetworkFailure(false);
  return null;
}

async function request(cfg: LabelForgeConfig, relay: boolean, path: string, init?: RequestInit): Promise<Response> {
  const blocked = labelForgeBlocked(cfg, relay);
  if (blocked) throw new Error(blocked);
  let res: Response;
  try {
    res = await fetch(labelForgeUrl(cfg, path, relay), init);
  } catch {
    throw new Error(`Could not reach LabelForge at ${cfg.host}:${cfg.port}. ${explainNetworkFailure(relay)}`);
  }
  if (!res.ok) {
    // LabelForge reports failures as {"detail": "..."} — a printer that is off
    // or a wrong device path arrives that way, and is worth passing on verbatim.
    let detail = '';
    try {
      const body = await res.clone().json() as { detail?: unknown };
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch { /* not JSON; the status is all there is */ }
    throw new Error(`LabelForge returned ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res;
}

export async function listTemplates(cfg: LabelForgeConfig, relay: boolean): Promise<LabelTemplate[]> {
  const res = await request(cfg, relay, 'api/templates', { cache: 'no-store' });
  const list = await res.json() as LabelTemplate[];
  return Array.isArray(list) ? list : [];
}

/** PNG of the label exactly as it would print, for a preview. */
export async function renderLabel(cfg: LabelForgeConfig, relay: boolean, templateId: string, variables: Record<string, string>): Promise<Blob> {
  const res = await request(cfg, relay, 'api/labels/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: templateId, variables }),
  });
  return res.blob();
}

export async function printLabel(cfg: LabelForgeConfig, relay: boolean, req: PrintLabelRequest): Promise<void> {
  await request(cfg, relay, 'api/labels/print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ copies: 1, ...req }),
  });
}
