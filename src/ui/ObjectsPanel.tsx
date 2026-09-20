import type { PlateObject, Transform } from './model';
import { worldBounds } from './model';

export interface ObjectsPanelProps {
  objects: PlateObject[];
  selectedId: string | null;
  outOfBounds: Set<string>;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onTransform: (id: string, t: Partial<Transform>) => void;
  onArrange: () => void;
  onClear: () => void;
  onAddFiles: () => void;
  onAddSample: () => void;
}

export function ObjectsPanel(p: ObjectsPanelProps) {
  const sel = p.objects.find((o) => o.id === p.selectedId) ?? null;
  const b = sel ? worldBounds(sel) : null;
  const t = sel?.transform;
  const num = (key: keyof Transform, step = 1, unit = 'mm') => (
    <label className="field" key={key}>
      <span>{LABELS[key]}</span>
      <span className="control">
        <input type="number" step={step} value={round(t![key])} onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v) && sel) p.onTransform(sel.id, { [key]: key === 'scale' ? Math.max(1, v) : v });
        }} />
        <em>{unit}</em>
      </span>
    </label>
  );

  return (
    <section className="panel-block">
      <div className="row between">
        <h3>Objects</h3>
        <div className="row gap">
          <button className="btn small" onClick={p.onAddFiles}>+ Add</button>
          <button className="btn small ghost" onClick={p.onAddSample} title="Load a built-in test model">Sample</button>
        </div>
      </div>
      {p.objects.length === 0 ? (
        <p className="hint">Drop STL, 3MF or OBJ files onto the bed, or click <b>Add</b>.</p>
      ) : (
        <ul className="object-list">
          {p.objects.map((o) => (
            <li key={o.id} className={[o.id === p.selectedId ? 'selected' : '', p.outOfBounds.has(o.id) ? 'oob' : ''].join(' ')} onClick={() => p.onSelect(o.id)}>
              <span className="name" title={o.name}>{o.name}</span>
              <span className="tri">{(o.mesh.positions.length / 9).toLocaleString()} tri</span>
              <button className="icon" title="Duplicate" onClick={(e) => { e.stopPropagation(); p.onDuplicate(o.id); }}>⧉</button>
              <button className="icon" title="Remove" onClick={(e) => { e.stopPropagation(); p.onRemove(o.id); }}>✕</button>
            </li>
          ))}
        </ul>
      )}
      {p.objects.length > 0 && (
        <div className="row gap">
          <button className="btn small ghost" onClick={p.onArrange} title="Pack all parts around the bed centre">Arrange all</button>
          <button className="btn small ghost" onClick={p.onClear}>Clear plate</button>
        </div>
      )}
      {sel && t && b && (
        <div className="transform">
          <h4>Transform · {sel.name}</h4>
          {p.outOfBounds.has(sel.id) && <p className="warn">Outside the printable area.</p>}
          <div className="grid2">
            {num('x')}{num('y')}
            {num('rotX', 15, '°')}{num('rotY', 15, '°')}
            {num('rotZ', 15, '°')}{num('scale', 5, '%')}
          </div>
          <p className="dims">
            Size: {(b.max[0] - b.min[0]).toFixed(1)} × {(b.max[1] - b.min[1]).toFixed(1)} × {(b.max[2] - b.min[2]).toFixed(1)} mm
          </p>
          <div className="row gap">
            <button className="btn small ghost" onClick={() => p.onTransform(sel.id, { x: 0, y: 0 })}>Center</button>
            <button className="btn small ghost" onClick={() => p.onTransform(sel.id, { rotX: 0, rotY: 0, rotZ: 0, scale: 100 })}>Reset</button>
            <button className="btn small ghost" onClick={() => p.onTransform(sel.id, { rotZ: (t.rotZ + 90) % 360 })}>Rotate 90°</button>
          </div>
        </div>
      )}
    </section>
  );
}

const LABELS: Record<keyof Transform, string> = { x: 'X', y: 'Y', rotX: 'Rotate X', rotY: 'Rotate Y', rotZ: 'Rotate Z', scale: 'Scale' };
const round = (v: number) => Math.round(v * 100) / 100;
