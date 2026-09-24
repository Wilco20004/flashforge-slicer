import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Viewport } from './Viewport';
import { SettingsPanel } from './SettingsPanel';
import { ObjectsPanel } from './ObjectsPanel';
import { OutputPanel, defaultPrinterConfig, type PrinterConfig } from './OutputPanel';
import { MonitorView } from './MonitorView';
import { usePrinterStatus } from './usePrinterStatus';
import { relayAvailable } from '../printer/relay';
import { isPrintingStatus, statusLabel } from '../printer/flashforge';
import { createPlateObject, arrangeObjects, worldPositions, worldBounds, worldMatrix, type PlateObject, type Transform } from './model';
import { loadModelFile, SUPPORTED_EXTENSIONS } from '../geometry/loaders';
import { mergeMeshes } from '../geometry/mesh';
import { sampleMesh } from '../geometry/primitives';
import { SlicerClient, type SliceOutput } from '../slicer/client';
import { updateAvailable, reloadForUpdate, alreadyReloadedForThisBuild } from './buildInfo';
import { isHomeAssistantIngress } from './host';
import type { SliceSettings } from '../slicer/settings';
import { MACHINES, FILAMENTS, PROCESSES, DEFAULT_MACHINE_ID, DEFAULT_FILAMENT_ID, buildSettings, defaultProcessForNozzle } from '../profiles';
import { normalizeSpool, spoolName, spoolSettings, withUsage, type Spool } from '../profiles/spools';
import { FilamentView } from './FilamentView';
import { defaultLabelForgeConfig, type LabelForgeConfig } from '../label/labelforge';
import { renderThumbnail } from '../preview/thumbnail';
import { PATH_TYPES, PATH_TYPE_COLOR, PATH_TYPE_LABEL } from '../slicer/plan';
import { formatDuration } from '../slicer/gcode';
import { loadLocal, saveLocal, loadRemote, pickNewer, createRemoteSaver, settingsStoreAvailable, type Stamped } from '../store/settingsStore';

interface Persisted extends Stamped {
  machineId: string;
  filamentId: string;
  processId: string;
  overrides: Partial<SliceSettings>;
  printer: PrinterConfig;
  spools: Spool[];
  /** The spool the slice follows, or null for the bare filament preset. */
  spoolId: string | null;
  labels: LabelForgeConfig;
  /**
   * The plan for the file last sent to the printer. The add-on's failure
   * watcher reads it to judge a layer that is taking too long against what this
   * slice predicted for that layer, rather than against a flat timeout.
   */
  lastPrint: { fileName: string; layerTimes: number[]; startedAt: number } | null;
}

const defaultPersisted = (): Persisted => ({
  updatedAt: 0,
  machineId: DEFAULT_MACHINE_ID, filamentId: DEFAULT_FILAMENT_ID,
  processId: defaultProcessForNozzle(0.4).id, overrides: {}, printer: defaultPrinterConfig(),
  spools: [], spoolId: null, labels: defaultLabelForgeConfig(), lastPrint: null,
});

function normalize(p: Partial<Persisted> | null): Persisted {
  const d = defaultPersisted();
  if (!p) return d;
  const spools = Array.isArray(p.spools) ? p.spools.map(normalizeSpool) : d.spools;
  return {
    ...d, ...p,
    printer: { ...d.printer, ...(p.printer ?? {}) },
    labels: { ...d.labels, ...(p.labels ?? {}) },
    spools,
    // A spool deleted on another device must not leave this one following a
    // record that is no longer there.
    spoolId: spools.some((s) => s.id === p.spoolId) ? p.spoolId ?? null : null,
    updatedAt: p.updatedAt ?? 1,
  };
}

export type StorageMode = 'checking' | 'server' | 'browser' | 'server-error';

/** The spool id in `#spool=<id>`, as printed on a label's QR code. */
function spoolIdFromHash(): string | null {
  if (typeof location === 'undefined') return null;
  const m = /[#&?]spool=([^&]+)/i.exec(location.hash);
  return m ? decodeURIComponent(m[1]).trim().toUpperCase() || null : null;
}

export function App() {
  const [persisted, setPersistedRaw] = useState<Persisted>(() => normalize(loadLocal<Persisted>()));
  const [storage, setStorage] = useState<StorageMode>('checking');
  const remoteSaver = useRef(createRemoteSaver<Persisted>());
  const hydrated = useRef(false);

  /** All settings changes go through here so they get a timestamp. */
  const setPersisted = useCallback((update: (p: Persisted) => Persisted) => {
    setPersistedRaw((p) => ({ ...update(p), updatedAt: Date.now() }));
  }, []);

  // On start: if the server keeps settings, take whichever side changed most recently.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await settingsStoreAvailable();
      if (cancelled) return;
      if (!available) { setStorage('browser'); hydrated.current = true; return; }
      const remote = await loadRemote<Persisted>();
      if (cancelled) return;
      setPersistedRaw((local) => {
        const chosen = pickNewer(local.updatedAt ? local : null, remote ? normalize(remote) : null) ?? local;
        return chosen;
      });
      hydrated.current = true;
      setStorage('server');
    })();
    const off = remoteSaver.current.onResult((ok) => setStorage(ok ? 'server' : 'server-error'));
    return () => { cancelled = true; off(); };
  }, []);

  // Persist every change: browser always, server when available (after hydration, so a stale
  // local copy never overwrites a newer server copy).
  useEffect(() => {
    saveLocal(persisted);
    if (hydrated.current && (storage === 'server' || storage === 'server-error') && persisted.updatedAt) {
      remoteSaver.current.save(persisted);
    }
  }, [persisted, storage]);

  const machine = MACHINES.find((m) => m.id === persisted.machineId) ?? MACHINES[0];
  const filament = FILAMENTS.find((f) => f.id === persisted.filamentId) ?? FILAMENTS[0];
  const process = PROCESSES.find((p) => p.id === persisted.processId && p.nozzles.includes(machine.nozzle)) ?? defaultProcessForNozzle(machine.nozzle);
  const spool = persisted.spools.find((s) => s.id === persisted.spoolId) ?? null;
  // Most of a spool has nothing to do with the slice. Keying the settings on
  // what it actually contributes — rather than on the record's identity — keeps
  // a note, a purchase date, or the grams booked after a print from rebuilding
  // the settings and making a finished result look stale.
  const spoolKey = JSON.stringify(spool ? spoolSettings(spool) : null);
  /* eslint-disable react-hooks/exhaustive-deps */
  const baseSettings = useMemo(() => buildSettings(machine, filament, process, {}, spool), [machine, filament, process, spoolKey]);
  const settings = useMemo(() => buildSettings(machine, filament, process, persisted.overrides, spool), [machine, filament, process, persisted.overrides, spoolKey]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const [objects, setObjects] = useState<PlateObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'prepare' | 'preview' | 'monitor' | 'filament'>('prepare');
  const [relay, setRelay] = useState<boolean | null>(null);
  useEffect(() => { relayAvailable().then(setRelay); }, []);
  const [progress, setProgress] = useState<{ stage: string; fraction: number } | null>(null);
  const [result, setResult] = useState<SliceOutput | null>(null);
  const [resultStale, setResultStale] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState(1);
  const [showTravel, setShowTravel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  /** Spool id from a scanned label (#spool=...), until the spools are loaded. */
  const [scannedSpool, setScannedSpool] = useState<string | null>(() => spoolIdFromHash());
  const ingress = useMemo(() => isHomeAssistantIngress(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const client = useRef(new SlicerClient());

  // The add-on can be updated while this page is open. Its old asset chunks are
  // then gone from the server, so anything loaded on demand (the slicing worker)
  // would 404. Watch for a new build and offer a reload.
  useEffect(() => {
    let alive = true;
    const check = () => { if (document.visibilityState === 'visible') void updateAvailable().then((u) => { if (alive && u) setUpdateReady(true); }); };
    check();
    const timer = window.setInterval(check, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, []);

  // A label scanned with a phone opens this page at #spool=<id>. The spools may
  // still be coming from the server at that point, so the id is held until they
  // arrive and only then resolved — or reported as unknown.
  useEffect(() => {
    const onHash = () => { const id = spoolIdFromHash(); if (id) setScannedSpool(id); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!scannedSpool || storage === 'checking') return;
    const match = persisted.spools.find((s) => s.id === scannedSpool);
    if (match) {
      setPersisted((p) => ({ ...p, spoolId: match.id, filamentId: match.filamentId }));
      setNotice(`Scanned ${spoolName(match)} — now in use.`);
      setMode('filament');
    } else {
      setError(`No spool here has the id ${scannedSpool}. It may have been added on another device, or deleted.`);
    }
    setScannedSpool(null);
  }, [scannedSpool, storage, persisted.spools, setPersisted]);

  // Anything that changes the plate or the settings makes the previous result stale.
  useEffect(() => { if (result) setResultStale(true); }, [objects, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const outOfBounds = useMemo(() => {
    const s = new Set<string>();
    const hx = settings.bedSizeX / 2 + 1e-3, hy = settings.bedSizeY / 2 + 1e-3;
    for (const o of objects) {
      const b = worldBounds(o);
      if (b.min[0] < -hx || b.max[0] > hx || b.min[1] < -hy || b.max[1] > hy || b.max[2] > settings.maxZ + 1e-3) s.add(o.id);
    }
    return s;
  }, [objects, settings.bedSizeX, settings.bedSizeY, settings.maxZ]);

  /** Arrange with the current bed and adhesion settings; warns when parts don't fit. */
  const arrange = useCallback((list: PlateObject[]): PlateObject[] => {
    const adhesion = settings.brimType === 'outer' ? settings.brimWidth * 2 + 2 : settings.skirtLoops > 0 ? settings.skirtDistance + settings.skirtLoops * settings.lineWidth + 2 : 0;
    const res = arrangeObjects(list, { bedX: settings.bedSizeX, bedY: settings.bedSizeY, gap: Math.max(6, adhesion) });
    if (res.unplaced.length) {
      setError(`${res.unplaced.length} object${res.unplaced.length > 1 ? 's' : ''} did not fit on the bed: ${res.unplaced.map((o) => o.name).join(', ')}`);
    }
    return res.objects;
  }, [settings.bedSizeX, settings.bedSizeY, settings.brimType, settings.brimWidth, settings.skirtLoops, settings.skirtDistance, settings.lineWidth]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    const added: PlateObject[] = [];
    for (const f of Array.from(files)) {
      try {
        const meshes = await loadModelFile(f);
        for (const m of meshes) {
          if (m.positions.length === 0) continue;
          added.push(createPlateObject(m));
        }
      } catch (e) {
        setError(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!added.length) return;
    setObjects((prev) => {
      const next = [...prev, ...added];
      return next.length > 1 ? arrange(next) : next;
    });
    setSelectedId(added[added.length - 1].id);
    setMode('prepare');
  }, [arrange]);

  const addSample = () => {
    const o = createPlateObject(sampleMesh());
    setObjects((prev) => (prev.length ? arrange([...prev, o]) : [o]));
    setSelectedId(o.id);
    setMode('prepare');
  };

  const updateTransform = (id: string, t: Partial<Transform>) =>
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, transform: { ...o.transform, ...t } } : o)));

  const removeObject = (id: string) => {
    setObjects((prev) => prev.filter((o) => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const duplicateObject = (id: string) => {
    const src = objects.find((o) => o.id === id);
    if (!src) return;
    const copy = createPlateObject({ ...src.mesh, name: src.mesh.name });
    copy.transform = { ...src.transform, x: src.transform.x + 10, y: src.transform.y + 10 };
    setObjects((prev) => arrange([...prev, copy]));
    setSelectedId(copy.id);
  };

  const setOverride = (key: keyof SliceSettings, value: unknown) =>
    setPersisted((p) => ({ ...p, overrides: { ...p.overrides, [key]: value } }));
  const resetOverride = (key: keyof SliceSettings) =>
    setPersisted((p) => { const o = { ...p.overrides }; delete o[key]; return { ...p, overrides: o }; });

  /**
   * Choosing a spool also moves the filament preset to that spool's material,
   * so the two selects never disagree about what is loaded. Choosing a preset
   * by hand means the user has moved off the spool, so the spool is released.
   */
  const setSpool = (id: string | null) => {
    setPersisted((p) => {
      const s = p.spools.find((x) => x.id === id);
      return { ...p, spoolId: s ? s.id : null, filamentId: s ? s.filamentId : p.filamentId };
    });
  };
  const setFilament = (id: string) => {
    setPersisted((p) => {
      const current = p.spools.find((x) => x.id === p.spoolId);
      return { ...p, filamentId: id, spoolId: current && current.filamentId !== id ? null : p.spoolId };
    });
  };

  /** Book filament against the spool in use; silent when there is none. */
  const bookUsage = useCallback((grams: number) => {
    setPersisted((p) => {
      if (!p.spoolId || !(grams > 0)) return p;
      return { ...p, spools: p.spools.map((s) => (s.id === p.spoolId ? withUsage(s, grams) : s)) };
    });
  }, [setPersisted]);

  const setMachine = (id: string) => {
    const m = MACHINES.find((x) => x.id === id) ?? MACHINES[0];
    setPersisted((p) => {
      const proc = PROCESSES.find((x) => x.id === p.processId);
      const processId = proc && proc.nozzles.includes(m.nozzle) ? p.processId : defaultProcessForNozzle(m.nozzle).id;
      return { ...p, machineId: id, processId };
    });
  };

  const modelName = useMemo(() => {
    if (!objects.length) return 'plate';
    return objects.length === 1 ? objects[0].name : `${objects[0].name}+${objects.length - 1}`;
  }, [objects]);
  const fileName = useMemo(() => {
    const t = result ? formatDuration(result.stats.printTimeSec).replace(/\s+/g, '') : '';
    return `${modelName.replace(/[^0-9A-Za-z._-]+/g, '_')}_${settings.filamentType}${t ? '_' + t : ''}.gcode`;
  }, [modelName, settings.filamentType, result]);

  const slice = async () => {
    if (!objects.length || progress) return;
    if (outOfBounds.size) { setError('Some objects are outside the printable area. Move or scale them first.'); return; }
    setError(null);
    setNotice(null);
    setProgress({ stage: 'Preparing', fraction: 0 });
    try {
      const merged = mergeMeshes(objects.map((o) => ({ positions: worldPositions(o), name: o.name })));
      const thumbMeshes = objects.map((o) => {
        const m = new THREE.Mesh(o.geometry);
        m.matrixAutoUpdate = false;
        m.matrix.copy(worldMatrix(o));
        return m;
      });
      const thumbnailPng = renderThumbnail(thumbMeshes, settings.thumbnailWidth, settings.thumbnailHeight);
      const out = await client.current.slice(merged.positions, settings, {
        thumbnailPng, modelName,
        onProgress: (stage, fraction) => setProgress({ stage, fraction }),
        onFallback: () => setNotice('Slicing in the page because the background worker could not start. The interface will not respond until it finishes.'),
      });
      setResult(out);
      setResultStale(false);
      setVisibleLayers(out.stats.layerCount);
      setMode('preview');
    } catch (e) {
      // A page left open across an add-on update cannot load its own code any
      // more. Reload once instead of showing a failure the user cannot act on.
      if (await updateAvailable() && !alreadyReloadedForThisBuild()) {
        setProgress({ stage: 'Updated on the server, reloading', fraction: 1 });
        if (reloadForUpdate()) return;
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const cancelSlice = () => { client.current.cancel(); setProgress(null); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'preview' || !result) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowUp') { e.preventDefault(); setVisibleLayers((v) => Math.min(result.stats.layerCount, v + 1)); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setVisibleLayers((v) => Math.max(1, v - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, result]);

  const ff = persisted.printer.ff;
  const printerConfigured = Boolean(ff.host && ff.serialNumber && ff.checkCode) && persisted.printer.kind === 'flashforge';
  const printerStatus = usePrinterStatus(printerConfigured ? ff : null, relay, mode === 'monitor');
  const live = printerStatus.detail;
  const printerPct = live?.printProgress != null && isPrintingStatus(live.status) ? Math.round(live.printProgress * 100) : null;

  const layerZ = result && visibleLayers > 0 ? result.layerZs[Math.min(visibleLayers, result.layerZs.length) - 1] : 0;

  return (
    <div className={mode === 'monitor' ? 'app monitoring' : 'app'}>
      <header className="topbar">
        {/* Home Assistant's own panel header already names the add-on. */}
        {!ingress && (
          <div className="brand">
            <span className="logo">🖨️</span>
            <div>
              <strong>Flashforge Slicer</strong>
              <small>Adventurer 5M / 5M Pro · runs entirely in your browser</small>
            </div>
          </div>
        )}
        <div className="modes">
          <button className={mode === 'prepare' ? 'tab active' : 'tab'} onClick={() => setMode('prepare')}>Prepare</button>
          <button className={mode === 'preview' ? 'tab active' : 'tab'} disabled={!result} onClick={() => setMode('preview')}>Preview</button>
          <button className={mode === 'filament' ? 'tab active' : 'tab'} onClick={() => setMode('filament')} title="Spools, temperatures and labels">
            Filament{spool ? <i className="swatch tiny" style={{ background: spool.color }} title={spoolName(spool)} /> : null}
          </button>
          <button className={mode === 'monitor' ? 'tab active' : 'tab'} disabled={!printerConfigured} title={printerConfigured ? 'Live printer status and camera' : 'Set up the printer under Send to printer first'} onClick={() => setMode('monitor')}>
            Monitor{live ? <span className={`live-chip ${isPrintingStatus(live.status) ? 'live' : ''}`}>{printerPct !== null ? `${printerPct}%` : statusLabel(live.status)}</span> : null}
          </button>
        </div>
        <div className="actions">
          {/* Stays mounted whatever the tab: the objects panel's Add button opens it too. */}
          <input ref={fileInput} type="file" accept={SUPPORTED_EXTENSIONS.join(',')} multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          {mode === 'prepare' && <button className="btn" onClick={() => fileInput.current?.click()}>Open model</button>}
          {/* Opening a model and slicing belong to Prepare; they say nothing on the
              other tabs. Cancel is the exception — a slice started on Prepare keeps
              running when the tab is switched, so the way to stop it goes with it. */}
          {progress ? (
            <button className="btn danger" onClick={cancelSlice}>Cancel</button>
          ) : mode === 'prepare' ? (
            <button className="btn primary" disabled={!objects.length} onClick={slice}>Slice plate</button>
          ) : null}
        </div>
      </header>

      {updateReady && (
        <div className="update-bar">
          <span>A newer version of Flashforge Slicer is on the server.</span>
          <button className="btn small" onClick={() => { if (!reloadForUpdate()) location.reload(); }}>Reload</button>
          <button className="btn ghost small" onClick={() => setUpdateReady(false)}>Later</button>
        </div>
      )}

      <SettingsPanel
        machine={machine} filament={filament} process={process}
        settings={settings} baseSettings={baseSettings} overrides={persisted.overrides}
        onMachine={setMachine}
        onFilament={setFilament}
        spools={persisted.spools}
        spoolId={persisted.spoolId}
        onSpool={setSpool}
        onProcess={(id) => setPersisted((p) => ({ ...p, processId: id }))}
        onOverride={setOverride}
        onResetOverride={resetOverride}
        onResetAll={() => setPersisted((p) => ({ ...p, overrides: {} }))}
        storage={storage}
      />

      <main className="stage">
        <Viewport
          objects={objects} selectedId={selectedId} onSelect={setSelectedId}
          mode={mode === 'filament' ? 'prepare' : mode} preview={result?.preview ?? null} visibleLayers={visibleLayers} showTravel={showTravel}
          bedX={settings.bedSizeX} bedY={settings.bedSizeY} maxZ={settings.maxZ}
          outOfBounds={outOfBounds} onDropFiles={addFiles}
        />
        {progress && (
          <div className="overlay progress">
            <div className="progress-card">
              <strong>{progress.stage}</strong>
              <div className="bar"><div style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></div>
            </div>
          </div>
        )}
        {error && <div className="overlay error" onClick={() => setError(null)}>{error}</div>}
        {!error && notice && <div className="overlay notice" onClick={() => setNotice(null)}>{notice}</div>}
        {!objects.length && !progress && (
          <div className="overlay empty">
            <p>Drop an <b>STL</b>, <b>3MF</b> or <b>OBJ</b> here to start.</p>
            <button className="btn ghost" onClick={addSample}>Try the sample model</button>
          </div>
        )}
        {mode === 'filament' && (
          <div className="overlay filament-overlay">
            <FilamentView
              spools={persisted.spools}
              selectedId={persisted.spoolId}
              onSelect={setSpool}
              onChange={(spools) => setPersisted((p) => ({
                ...p,
                spools,
                spoolId: spools.some((s) => s.id === p.spoolId) ? p.spoolId : null,
              }))}
              config={persisted.labels}
              onConfig={(labels) => setPersisted((p) => ({ ...p, labels }))}
              relay={Boolean(relay)}
              lastSliceG={result && !resultStale ? result.stats.filamentG : null}
            />
          </div>
        )}
        {mode === 'monitor' && printerConfigured && (
          <div className="overlay monitor-overlay">
            <MonitorView
              cfg={ff} relay={Boolean(relay)} detail={live} error={printerStatus.error} updatedAt={printerStatus.updatedAt} onRefresh={printerStatus.refresh}
              customCameraUrl={persisted.printer.cameraUrl}
              onCustomCameraUrl={(url) => setPersisted((p) => ({ ...p, printer: { ...p.printer, cameraUrl: url || undefined } }))}
            />
          </div>
        )}
        {mode === 'preview' && result && (
          <div className="layer-controls">
            <div className="legend">
              {PATH_TYPES.filter((t) => t !== 'travel').map((t) => (
                <span key={t}><i style={{ background: PATH_TYPE_COLOR[t] }} />{PATH_TYPE_LABEL[t]}</span>
              ))}
              <label className="travel-toggle"><input type="checkbox" checked={showTravel} onChange={(e) => setShowTravel(e.target.checked)} /> Travel</label>
            </div>
            <div className="slider">
              <span>Layer {visibleLayers} / {result.stats.layerCount} · Z {layerZ.toFixed(2)} mm</span>
              <input type="range" min={1} max={result.stats.layerCount} value={visibleLayers} onChange={(e) => setVisibleLayers(Number(e.target.value))} />
            </div>
          </div>
        )}
      </main>

      <aside className="panel right">
        <ObjectsPanel
          objects={objects} selectedId={selectedId} outOfBounds={outOfBounds}
          onSelect={setSelectedId} onRemove={removeObject} onDuplicate={duplicateObject}
          onTransform={updateTransform} onArrange={() => { setError(null); setObjects((p) => arrange(p)); }}
          onClear={() => { setObjects([]); setSelectedId(null); }}
          onAddFiles={() => fileInput.current?.click()} onAddSample={addSample}
        />
        <OutputPanel
          result={result} fileName={fileName} stale={resultStale}
          printer={persisted.printer} onPrinter={(printer) => setPersisted((p) => ({ ...p, printer }))}
          onPrintStarted={() => {
            if (result) {
              setPersisted((p) => ({
                ...p,
                lastPrint: { fileName, layerTimes: result.stats.layerTimes, startedAt: Date.now() },
              }));
            }
            const grams = result?.stats.filamentG ?? 0;
            if (spool && grams > 0) {
              bookUsage(grams);
              setNotice(`Booked ${grams.toFixed(1)} g against ${spoolName(spool)}.`);
            }
            setMode('monitor');
            setTimeout(printerStatus.refresh, 1500);
          }}
        />
      </aside>
    </div>
  );
}
