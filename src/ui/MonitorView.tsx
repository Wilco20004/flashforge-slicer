import { useEffect, useRef, useState } from 'react';
import {
  cameraUrl, cancelPrint, pausePrint, resumePrint, setCameraStream, setLight, statusLabel, isPrintingStatus,
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
}

export function MonitorView(p: MonitorViewProps) {
  const [camera, setCamera] = useState(false);
  const [camKey, setCamKey] = useState(0);
  const [camError, setCamError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const d = p.detail;
  const cam = cameraUrl(p.cfg, d, p.relay);
  const hasCamera = Boolean(d?.cameraStreamUrl);
  const printing = isPrintingStatus(d?.status);
  const paused = (d?.status ?? '').toLowerCase().startsWith('pause');

  // Ask the printer to start/stop streaming only when the user toggles the camera
  // (never on mount, so we don't cut off a stream another app is watching).
  const touched = useRef(false);
  useEffect(() => {
    if (!hasCamera) return;
    if (!touched.current) { if (!camera) return; touched.current = true; }
    setCameraStream(p.cfg, p.relay, camera).catch(() => { /* older firmware streams regardless */ });
    if (camera) { setCamError(false); setCamKey((k) => k + 1); }
  }, [camera, hasCamera]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {camera && cam && !camError ? (
          <img key={camKey} src={cam + (cam.includes('?') ? '&' : '?') + 't=' + camKey} alt="Printer camera" onError={() => setCamError(true)} />
        ) : (
          <div className="camera-placeholder">
            {!d ? <p>Waiting for the printer…</p>
              : !hasCamera ? <p>This printer reports no camera. The Adventurer 5M Pro has one built in; on the 5M a supported USB camera can be added.</p>
              : camError ? <p>The camera stream did not load.{pageIsHttps() && !p.relay ? ' On an HTTPS page the stream needs the relay (Docker / Home Assistant version).' : ''} <button className="btn small ghost" onClick={() => { setCamError(false); setCamKey((k) => k + 1); }}>Retry</button></p>
              : <p>Camera is off. <button className="btn small" onClick={() => setCamera(true)}>Show camera</button></p>}
          </div>
        )}
        {hasCamera && (
          <div className="camera-bar">
            <label><input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} /> Camera</label>
            <button className="btn small ghost" disabled={busy !== null} onClick={() => run('Light', () => setLight(p.cfg, p.relay, d?.lightStatus !== 'open'))}>
              Light {d?.lightStatus === 'open' ? 'off' : 'on'}
            </button>
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
