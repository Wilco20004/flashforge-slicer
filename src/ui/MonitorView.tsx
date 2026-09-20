import { useEffect, useRef, useState } from 'react';
import {
  cameraUrl, defaultCameraUrl, cancelPrint, pausePrint, resumePrint, setCameraStream, setLight, statusLabel, isPrintingStatus,
  type FlashforgeConfig, type PrinterDetail,
} from '../printer/flashforge';
import { formatDuration } from '../slicer/gcode';
import { pageIsHttps } from '../printer/relay';

export interface MonitorViewProps {
  cfg: FlashforgeConfig;
  relay: boolean;
  detail: PrinterDetail | null;
  error: string | null;
  updatedAt: number | null;
  onRefresh: () => void;
  /** Manual camera URL (persisted with the printer). */
  customCameraUrl?: string;
  onCustomCameraUrl: (url: string) => void;
}

export function MonitorView(p: MonitorViewProps) {
  const [camera, setCamera] = useState(false);
  const [camKey, setCamKey] = useState(0);
  const [camError, setCamError] = useState(false);
  /** The printer's camera server restarts on "stream open" and resets connections that arrive
   *  meanwhile, so the <img> is mounted after a short delay and re-tried with backoff. */
  const [camReady, setCamReady] = useState(false);
  const attempts = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_ATTEMPTS = 5;
  const armImage = (delayMs: number) => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    setCamReady(false);
    retryTimer.current = setTimeout(() => { setCamKey((k) => k + 1); setCamReady(true); }, delayMs);
  };
  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);
  const [camDiag, setCamDiag] = useState<string | null>(null);
  /** When the <img> fails, ask for the stream headers once so the message says why. */
  const diagnose = async (url: string) => {
    setCamDiag('checking…');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      const ct = r.headers.get('content-type') ?? 'no content-type';
      let hint = '';
      if (r.status === 502 || r.status === 504) hint = ' — the relay could not connect to the camera port; is the camera enabled on the printer?';
      else if (r.status === 403) hint = ' — the relay refused this address (only private LAN IPs are allowed).';
      else if (r.status === 404) hint = ' — nothing answers at this path; the camera may be off or use a different URL.';
      else if (r.ok && !/multipart|image|video|octet/i.test(ct)) hint = ' — not an image or MJPEG stream.';
      else if (r.ok) hint = ' — the stream answers; the browser could not decode it. Try Retry.';
      setCamDiag(`HTTP ${r.status}, ${ct}${hint}`);
      ctrl.abort();
    } catch (e) {
      const name = e instanceof Error ? e.name : String(e);
      setCamDiag(name === 'AbortError' ? 'no answer within 8 s (the camera port did not respond)' : `request failed (${name}) — blocked by the browser or unreachable`);
    } finally { clearTimeout(timer); }
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const d = p.detail;
  const cam = cameraUrl(p.cfg, d, p.relay, p.customCameraUrl);
  const hasCamera = Boolean(d?.cameraStreamUrl) || Boolean(p.customCameraUrl?.trim());
  const [urlDraft, setUrlDraft] = useState(p.customCameraUrl ?? '');
  const printing = isPrintingStatus(d?.status);
  const paused = (d?.status ?? '').toLowerCase().startsWith('pause');

  // Ask the printer to start/stop streaming only when the user toggles the camera
  // (never on mount, so we don't cut off a stream another app is watching).
  const touched = useRef(false);
  useEffect(() => {
    if (!hasCamera) return;
    if (!touched.current) { if (!camera) return; touched.current = true; }
    setCameraStream(p.cfg, p.relay, camera).catch(() => { /* older firmware streams regardless */ });
    if (camera) { setCamError(false); setCamDiag(null); attempts.current = 0; armImage(1200); }
    else if (retryTimer.current) clearTimeout(retryTimer.current);
  }, [camera, hasCamera]); // eslint-disable-line react-hooks/exhaustive-deps
  const onImageError = () => {
    attempts.current += 1;
    if (attempts.current < MAX_ATTEMPTS) {
      // 1 s, 2 s, 3 s, 4 s — the printer's streamer is usually back within a second
      armImage(1000 * attempts.current);
      return;
    }
    setCamError(true);
    diagnose(cam ?? '');
  };

  const run = async (label: string, fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(label); setMsg(null);
    try { await fn(); setMsg(`${label}: OK`); setTimeout(p.onRefresh, 800); }
    catch (e) { setMsg(`${label} failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  };

  const pct = d?.printProgress != null ? Math.round(Math.min(1, Math.max(0, d.printProgress)) * 100) : null;
  const temp = (cur?: number, target?: number) =>
    cur == null ? '—' : `${Math.round(cur)}°${target != null && target > 0 ? ` / ${Math.round(target)}°` : ''}`;

  return (
    <div className="monitor">
      <div className="monitor-camera">
        {camera && cam && !camError && camReady ? (
          <img key={camKey} src={cam} alt="Printer camera" onError={onImageError} />
        ) : camera && cam && !camError ? (
          <div className="camera-placeholder"><p>Starting camera{attempts.current ? ` (attempt ${attempts.current + 1} of ${MAX_ATTEMPTS})` : ''}…</p></div>
        ) : (
          <div className="camera-placeholder">
            {!d ? <p>Waiting for the printer…</p>
              : !hasCamera ? (
                <div className="camera-setup">
                  <p>The printer does not report a camera. The Adventurer 5M Pro has one built in; on the 5M the firmware exposes a supported USB camera on port 8080 once it recognises it.</p>
                  <div className="row gap wrap">
                    <button className="btn small primary" onClick={() => { p.onCustomCameraUrl(defaultCameraUrl(p.cfg)); setCamera(true); }}>Try the printer's camera port</button>
                  </div>
                  <label className="field column">
                    <span>Or any MJPEG stream URL</span>
                    <span className="row gap">
                      <input value={urlDraft} placeholder={defaultCameraUrl(p.cfg)} onChange={(e) => setUrlDraft(e.target.value)} />
                      <button className="btn small" disabled={!urlDraft.trim()} onClick={() => { p.onCustomCameraUrl(urlDraft.trim()); setCamera(true); }}>Use</button>
                    </span>
                  </label>
                </div>
              )
              : camError ? (
                <p>
                  The camera stream did not load from <code>{cam}</code>.
                  {camDiag ? <><br /><small>{camDiag}</small></> : null}
                  {pageIsHttps() && !p.relay ? ' On an HTTPS page the stream needs the relay (Docker / Home Assistant version).' : ''}
                  {' '}<button className="btn small ghost" onClick={() => { setCamError(false); setCamDiag(null); attempts.current = 0; armImage(300); }}>Retry</button>
                  {p.customCameraUrl ? <button className="btn small ghost" onClick={() => { p.onCustomCameraUrl(''); setCamera(false); setCamError(false); }}>Clear URL</button> : null}
                </p>
              )
              : <p>Camera is off. <button className="btn small" onClick={() => setCamera(true)}>Show camera</button></p>}
          </div>
        )}
        {hasCamera && (
          <div className="camera-bar">
            <label><input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} /> Camera</label>
            <button className="btn small ghost" disabled={busy !== null} onClick={() => run('Light', () => setLight(p.cfg, p.relay, d?.lightStatus !== 'open'))}>
              Light {d?.lightStatus === 'open' ? 'off' : 'on'}
            </button>
            {p.customCameraUrl ? <button className="btn small ghost" title={p.customCameraUrl} onClick={() => { p.onCustomCameraUrl(''); setCamera(false); }}>Forget camera URL</button> : null}
          </div>
        )}
      </div>

      <div className="monitor-status">
        <div className="row between">
          <h3>{d?.name || 'Printer'} <span className={`chip ${printing ? 'live' : ''}`}>{statusLabel(d?.status)}</span></h3>
          <span className="hint">{p.updatedAt ? `updated ${Math.max(0, Math.round((Date.now() - p.updatedAt) / 1000))}s ago` : ''}</span>
        </div>
        {p.error && <p className="status err">{p.error}</p>}
        {d?.errorCode && <p className="status err">Printer error: {d.errorCode}</p>}
        {d?.printFileName && <p className="filename" title={d.printFileName}>{d.printFileName}</p>}
        {pct !== null && (printing || (d?.status ?? '').toLowerCase() === 'completed') && (
          <div className="progress-line">
            <div className="bar"><div style={{ width: `${pct}%` }} /></div>
            <span>{pct}%</span>
          </div>
        )}
        <table className="stats">
          <tbody>
            <tr><td>Layer</td><td>{d?.printLayer != null ? `${d.printLayer}${d.targetPrintLayer ? ` / ${d.targetPrintLayer}` : ''}` : '—'}</td></tr>
            <tr><td>Remaining</td><td>{d?.estimatedTime != null && printing ? formatDuration(d.estimatedTime) : '—'}</td></tr>
            <tr><td>Elapsed</td><td>{d?.printDuration != null && (printing || pct) ? formatDuration(d.printDuration) : '—'}</td></tr>
            <tr><td>Nozzle</td><td>{temp(d?.rightTemp, d?.rightTargetTemp)}</td></tr>
            <tr><td>Bed</td><td>{temp(d?.platTemp, d?.platTargetTemp)}</td></tr>
            {d?.chamberTemp ? <tr><td>Chamber</td><td>{Math.round(d.chamberTemp)}°</td></tr> : null}
            <tr><td>Speed / fan</td><td>{d?.currentPrintSpeed != null ? `${d.currentPrintSpeed}%` : '—'} · {d?.coolingFanSpeed != null ? `${d.coolingFanSpeed}%` : '—'}</td></tr>
            {d?.rightFilamentType ? <tr><td>Filament</td><td>{d.rightFilamentType}{d.nozzleModel ? ` · ${d.nozzleModel} nozzle` : ''}</td></tr> : null}
            {d?.firmwareVersion ? <tr><td>Firmware</td><td>{d.firmwareVersion}</td></tr> : null}
          </tbody>
        </table>
        <div className="row gap wrap">
          {paused ? (
            <button className="btn small primary" disabled={busy !== null} onClick={() => run('Resume', () => resumePrint(p.cfg, p.relay))}>Resume</button>
          ) : (
            <button className="btn small" disabled={busy !== null || !printing} onClick={() => run('Pause', () => pausePrint(p.cfg, p.relay))}>Pause</button>
          )}
          <button className="btn small danger" disabled={busy !== null || !printing} onClick={() => run('Cancel', () => cancelPrint(p.cfg, p.relay), 'Cancel the current print?')}>Cancel print</button>
          <button className="btn small ghost" onClick={p.onRefresh}>Refresh</button>
        </div>
        {msg && <p className={`status ${msg.includes('failed') ? 'err' : 'ok'}`}>{msg}</p>}
      </div>
    </div>
  );
}
