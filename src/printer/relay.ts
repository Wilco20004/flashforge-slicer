/**
 * Same-origin printer relay.
 *
 * Browsers block a web page from talking to a plain-HTTP device on the LAN when the
 * page itself is served over HTTPS (mixed content), and the printer would also have
 * to answer CORS preflight requests. When this app is served by its own nginx
 * (Docker image / Home Assistant add-on) that server exposes
 *   /printer/<ip>[:port]/<path>  ->  http://<ip>:<port>/<path>
 * for private LAN addresses only, plus /relay-status to advertise the feature.
 */

let probe: Promise<boolean> | null = null;

/** True when the server hosting this page offers the /printer/ relay. Cached. */
export function relayAvailable(): Promise<boolean> {
  if (!probe) {
    probe = fetch('relay-status', { cache: 'no-store' })
      .then((r) => r.ok && r.headers.get('x-printer-relay') === '1')
      .catch(() => false);
  }
  return probe;
}

/** Relay URL, relative to the page so it also works behind Home Assistant Ingress. */
export function relayUrl(host: string, port: number, path: string): string {
  return `printer/${host}:${port}/${path.replace(/^\/+/, '')}`;
}

export function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host.trim());
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function pageIsHttps(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:';
}

/** Human explanation for a network-level failure (no HTTP response at all). */
export function explainNetworkFailure(relay: boolean): string {
  if (relay) {
    return 'The relay could not reach the printer. Check the IP address, that the printer is on and in LAN mode, and that this server is on the same network as the printer.';
  }
  if (pageIsHttps()) {
    return 'This page is served over HTTPS, so the browser blocks plain-HTTP requests to the printer. Use the Docker or Home Assistant version of this app (it relays to the printer), or download the G-code and print it via USB or Orca-Flashforge.';
  }
  return 'The browser could not reach the printer. Check the IP address and LAN mode. The printer firmware must also allow cross-origin (CORS) requests; if it does not, use the Docker or Home Assistant version of this app, which relays to the printer, or download the G-code.';
}
