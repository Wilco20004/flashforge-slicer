import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Viewport } from './Viewport';
import { SettingsPanel } from './SettingsPanel';
import { ObjectsPanel } from './ObjectsPanel';
import { OutputPanel, defaultPrinterConfig, type PrinterConfig } from './OutputPanel';
import { createPlateObject, arrangeObjects, worldPositions, worldBounds, worldMatrix, type PlateObject, type Transform } from './model';
import { loadModelFile, SUPPORTED_EXTENSIONS } from '../geometry/loaders';
import { mergeMeshes } from '../geometry/mesh';
import { sampleMesh } from '../geometry/primitives';
import { SlicerClient, type SliceOutput } from '../slicer/client';
import type { SliceSettings } from '../slicer/settings';
import { MACHINES, FILAMENTS, PROCESSES, DEFAULT_MACHINE_ID, DEFAULT_FILAMENT_ID, buildSettings, defaultProcessForNozzle } from '../profiles';
import { renderThumbnail } from '../preview/thumbnail';
import { PATH_TYPES, PATH_TYPE_COLOR, PATH_TYPE_LABEL } from '../slicer/plan';
import { formatDuration } from '../slicer/gcode';

const STORAGE_KEY = 'planty-slicer-v1';

interface Persisted {
  machineId: string;
  filamentId: string;
  processId: string;
  overrides: Partial<SliceSettings>;
  printer: PrinterConfig;
}

function loadPersisted(): Persisted {
  const fallback: Persisted = {
    machineId: DEFAULT_MACHINE_ID, filamentId: DEFAULT_FILAMENT_ID,
    processId: defaultProcessForNozzle(0.4).id, overrides: {}, printer: defaultPrinterConfig(),
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Persisted>;
    return { ...fallback, ...p, printer: { ...fallback.printer, ...(p.printer ?? {}) } };
  } catch { return fallback; }
}

export function App() {
  const [persisted, setPersisted] = useState<Persisted>(loadPersisted);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted)); } catch { /* ignore */ } }, [persisted]);

  const machine = MACHINES.find((m) => m.id === persisted.machineId) ?? MACHINES[0];
  const filament = FILAMENTS.find((f) => f.id === persisted.filamentId) ?? FILAMENTS[0];
  const process = PROCESSES.find((p) => p.id === persisted.processId && p.nozzles.includes(machine.nozzle)) ?? defaultProcessForNozzle(machine.nozzle);
  const baseSettings = useMemo(() => buildSettings(machine, filament, process), [machine, filament, process]);
  const settings = useMemo(() => buildSettings(machine, filament, process, persisted.overrides), [machine, filament, process, persisted.overrides]);

  const [objects, setObjects] = useState<PlateObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'prepare' | 'preview'>('prepare');
  const [progress, setProgress] = useState<{ stage: string; fraction: number } | null>(null);
  const [result, setResult] = useState<SliceOutput | null>(null);
  const [resultStale, setResultStale] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState(1);
  const [showTravel, setShowTravel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const client = useRef(new SlicerClient());

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
      });
      setResult(out);
      setResultStale(false);
      setVisibleLayers(out.stats.layerCount);
      setMode('preview');
    } catch (e) {
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

  const layerZ = result && visibleLayers > 0 ? result.layerZs[Math.min(visibleLayers, result.layerZs.length) - 1] : 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🌿</span>
          <div>
            <strong>Planty Slicer</strong>
            <small>for Flashforge Adventurer 5M · runs entirely in your browser</small>
          </div>
        </div>
        <div className="modes">
          <button className={mode === 'prepare' ? 'tab active' : 'tab'} onClick={() => setMode('prepare')}>Prepare</button>
          <button className={mode === 'preview' ? 'tab active' : 'tab'} disabled={!result} onClick={() => setMode('preview')}>Preview</button>
        </div>
        <div className="actions">
          <input ref={fileInput} type="file" accept={SUPPORTED_EXTENSIONS.join(',')} multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          <button className="btn" onClick={() => fileInput.current?.click()}>Open model</button>
          {progress ? (
            <button className="btn danger" onClick={cancelSlice}>Cancel</button>
          ) : (
            <button className="btn primary" disabled={!objects.length} onClick={slice}>Slice plate</button>
          )}
        </div>
      </header>

      <SettingsPanel
        machine={machine} filament={filament} process={process}
        settings={settings} baseSettings={baseSettings} overrides={persisted.overrides}
        onMachine={setMachine}
        onFilament={(id) => setPersisted((p) => ({ ...p, filamentId: id }))}
        onProcess={(id) => setPersisted((p) => ({ ...p, processId: id }))}
        onOverride={setOverride}
        onResetOverride={resetOverride}
        onResetAll={() => setPersisted((p) => ({ ...p, overrides: {} }))}
      />

      <main className="stage">
        <Viewport
          objects={objects} selectedId={selectedId} onSelect={setSelectedId}
          mode={mode} preview={result?.preview ?? null} visibleLayers={visibleLayers} showTravel={showTravel}
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
        {!objects.length && !progress && (
          <div className="overlay empty">
            <p>Drop an <b>STL</b>, <b>3MF</b> or <b>OBJ</b> here to start.</p>
            <button className="btn ghost" onClick={addSample}>Try the sample model</button>
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
        />
      </aside>
    </div>
  );
}
