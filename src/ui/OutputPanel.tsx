import { useEffect, useState } from 'react';
import type { SliceOutput } from '../slicer/client';
import { formatDuration } from '../slicer/gcode';
import { uploadGcode, getDetail, type FlashforgeConfig } from '../printer/flashforge';
import { uploadToMoonraker } from '../printer/moonraker';

export interface PrinterConfig {
  kind: 'flashforge' | 'moonraker';
  ff: FlashforgeConfig;
  moonraker: { url: string; apiKey: string };
  leveling: boolean;
}

export const defaultPrinterConfig = (): PrinterConfig => ({
  kind: 'flashforge',
  ff: { host: '', serialNumber: '', checkCode: '' },
  moonraker: { url: '', apiKey: '' },
  leveling: true,
});

export interface OutputPanelProps {
  result: SliceOutput | null;
  fileName: string;
  stale: boolean;
  printer: PrinterConfig;
  onPrinter: (c: PrinterConfig) => void;
}

export function OutputPanel(p: OutputPanelProps) {
  const [status, setStatus] = useState<{ kind: 'info' | 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStatus(null); }, [p.result]);
  const r = p.result;

  const download = () => {
    if (!r) return;
    const blob = new Blob([r.gcode], { type: 'text/x-gcode' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = p.fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const send = async (printNow: boolean) => {
    if (!r) return;
    setBusy(true);
    setStatus({ kind: 'info', text: 'Uploading…' });
    try {
      if (p.printer.kind === 'flashforge') {
        await uploadGcode(p.printer.ff, r.gcode, {
          fileName: p.fileName, printNow, levelingBeforePrint: p.printer.leveling,
          onProgress: (f) => setStatus({ kind: 'info', text: `Uploading… ${(f * 100).toFixed(0)}%` }),
        });
      } else {
        await uploadToMoonraker({ url: p.printer.moonraker.url, apiKey: p.printer.moonraker.apiKey || undefined }, r.gcode, p.fileName, printNow,
          (f) => setStatus({ kind: 'info', text: `Uploading… ${(f * 100).toFixed(0)}%` }));
      }
      setStatus({ kind: 'ok', text: printNow ? 'Uploaded and print started.' : 'Uploaded to the printer.' });
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true);
    setStatus({ kind: 'info', text: 'Connecting…' });
    try {
      const d = await getDetail(p.printer.ff) as { detail?: { status?: string; name?: string; firmwareVersion?: string } };
      const det = d.detail ?? {};
      setStatus({ kind: 'ok', text: `Connected: ${det.name ?? 'printer'} ${det.firmwareVersion ?? ''} (${det.status ?? 'ok'})` });
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  const setFF = (k: keyof FlashforgeConfig, v: string) => p.onPrinter({ ...p.printer, ff: { ...p.printer.ff, [k]: v } });

  return (
    <section className="panel-block">
      <h3>Output</h3>
      {!r ? <p className="hint">Slice the plate to see time and filament estimates.</p> : (
        <>
          {p.stale && <p className="warn">Settings or objects changed since the last slice.</p>}
          <table className="stats">
            <tbody>
              <tr><td>Print time</td><td>{formatDuration(r.stats.printTimeSec)}</td></tr>
              <tr><td>Filament</td><td>{(r.stats.filamentMm / 1000).toFixed(2)} m · {r.stats.filamentG.toFixed(1)} g</td></tr>
              <tr><td>Layers</td><td>{r.stats.layerCount} · {r.stats.maxZ.toFixed(2)} mm</td></tr>
              <tr><td>File</td><td>{(r.gcode.length / 1024).toFixed(0)} KB</td></tr>
            </tbody>
          </table>
          <button className="btn primary wide" onClick={download}>Download {p.fileName}</button>
        </>
      )}
      <details className="printer" open={Boolean(p.printer.ff.host || p.printer.moonraker.url)}>
        <summary>Send to printer</summary>
        <div className="tabs small">
          <button className={p.printer.kind === 'flashforge' ? 'tab active' : 'tab'} onClick={() => p.onPrinter({ ...p.printer, kind: 'flashforge' })}>Flashforge LAN</button>
          <button className={p.printer.kind === 'moonraker' ? 'tab active' : 'tab'} onClick={() => p.onPrinter({ ...p.printer, kind: 'moonraker' })}>Moonraker</button>
        </div>
        {p.printer.kind === 'flashforge' ? (
          <>
            <label className="field"><span>Printer IP</span><input value={p.printer.ff.host} placeholder="192.168.1.50" onChange={(e) => setFF('host', e.target.value)} /></label>
            <label className="field"><span>Serial number</span><input value={p.printer.ff.serialNumber} placeholder="SNADVA5M…" onChange={(e) => setFF('serialNumber', e.target.value)} /></label>
            <label className="field"><span>Check code</span><input value={p.printer.ff.checkCode} placeholder="Printer ID" onChange={(e) => setFF('checkCode', e.target.value)} /></label>
            <label className="field"><span>Level before print</span><span className="control"><input type="checkbox" checked={p.printer.leveling} onChange={(e) => p.onPrinter({ ...p.printer, leveling: e.target.checked })} /></span></label>
            <p className="hint">Uses the printer's LAN API (port 8898, firmware 2.6.6+). Serial number and check code are under Settings → Network on the printer. Some firmware versions block browser requests (CORS); if so, download the file and print via USB or Orca-Flashforge.</p>
            <div className="row gap">
              <button className="btn small ghost" disabled={busy || !p.printer.ff.host} onClick={test}>Test</button>
              <button className="btn small" disabled={busy || !r || !p.printer.ff.host} onClick={() => send(false)}>Upload</button>
              <button className="btn small primary" disabled={busy || !r || !p.printer.ff.host} onClick={() => send(true)}>Upload & print</button>
            </div>
          </>
        ) : (
          <>
            <label className="field"><span>Moonraker URL</span><input value={p.printer.moonraker.url} placeholder="http://ad5m.local:7125" onChange={(e) => p.onPrinter({ ...p.printer, moonraker: { ...p.printer.moonraker, url: e.target.value } })} /></label>
            <label className="field"><span>API key</span><input value={p.printer.moonraker.apiKey} placeholder="optional" onChange={(e) => p.onPrinter({ ...p.printer, moonraker: { ...p.printer.moonraker, apiKey: e.target.value } })} /></label>
            <p className="hint">For a 5M running the community Klipper mod. Add this page's origin to <code>cors_domains</code> in moonraker.conf.</p>
            <div className="row gap">
              <button className="btn small" disabled={busy || !r || !p.printer.moonraker.url} onClick={() => send(false)}>Upload</button>
              <button className="btn small primary" disabled={busy || !r || !p.printer.moonraker.url} onClick={() => send(true)}>Upload & print</button>
            </div>
          </>
        )}
        {status && <p className={`status ${status.kind}`}>{status.text}</p>}
      </details>
    </section>
  );
}
