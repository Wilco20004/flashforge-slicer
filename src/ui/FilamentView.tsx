import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  newSpool, normalizeHex, remainingG, remainingFraction, spoolName, filamentById, withUsage, type Spool,
} from '../profiles/spools';
import { FILAMENTS } from '../profiles';
import {
  listTemplates, printLabel, renderLabel, labelForgeBlocked, labelForgeConfigured,
  DEFAULT_LABELFORGE_PORT, type LabelForgeConfig, type LabelTemplate,
} from '../label/labelforge';
import { planSpoolLabel, SPOOL_LABEL_VARIABLES } from '../label/spoolLabel';
import { spoolArtPng } from '../label/spoolArt';

export interface FilamentViewProps {
  spools: Spool[];
  /** The spool the slice settings currently follow, or null for the generic preset. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (spools: Spool[]) => void;
  config: LabelForgeConfig;
  onConfig: (cfg: LabelForgeConfig) => void;
  relay: boolean;
  /** Grams the last slice came to, so a print can be booked against the spool. */
  lastSliceG: number | null;
}

export function FilamentView(p: FilamentViewProps) {
  const [editingId, setEditingId] = useState<string | null>(p.selectedId ?? p.spools[0]?.id ?? null);
  const editing = p.spools.find((s) => s.id === editingId) ?? null;

  const update = useCallback((id: string, patch: Partial<Spool>) => {
    p.onChange(p.spools.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)));
  }, [p]);

  const add = () => {
    const s = newSpool();
    p.onChange([...p.spools, s]);
    setEditingId(s.id);
  };

  const remove = (id: string) => {
    p.onChange(p.spools.filter((s) => s.id !== id));
    if (p.selectedId === id) p.onSelect(null);
    if (editingId === id) setEditingId(null);
  };

  return (
    <div className="filament-view">
      <div className="spool-list">
        <div className="row between">
          <h3>Spools</h3>
          <button className="btn small" onClick={add}>New spool</button>
        </div>
        {!p.spools.length && <p className="hint">No spools yet. Add one to record its colour and temperatures, print a label for it, and have the slicer follow it.</p>}
        <ul className="spools">
          {p.spools.map((s) => {
            const frac = remainingFraction(s);
            return (
              <li key={s.id} className={s.id === editingId ? 'selected' : ''} onClick={() => setEditingId(s.id)}>
                <i className="swatch" style={{ background: s.color }} />
                <div className="spool-text">
                  <span className="name">{spoolName(s)}</span>
                  <small>
                    {s.id} · {Math.round(s.nozzleTemp)}/{Math.round(s.bedTemp)} °C
                    {frac !== null && ` · ${Math.round(remainingG(s))} g left`}
                  </small>
                  {frac !== null && <div className="bar thin"><div style={{ width: `${Math.round(frac * 100)}%` }} /></div>}
                </div>
                {s.id === p.selectedId
                  ? <span className="chip live">In use</span>
                  : <button className="btn ghost small" onClick={(e) => { e.stopPropagation(); p.onSelect(s.id); }}>Use</button>}
              </li>
            );
          })}
        </ul>
        {p.selectedId && (
          <button className="btn ghost small" onClick={() => p.onSelect(null)}>Stop using a spool</button>
        )}
      </div>

      <div className="spool-detail">
        {!editing ? (
          <p className="hint">Pick a spool on the left, or add one.</p>
        ) : (
          <>
            <SpoolEditor spool={editing} onChange={(patch) => update(editing.id, patch)} onDelete={() => remove(editing.id)} />
            <UsageBlock spool={editing} lastSliceG={p.lastSliceG} onChange={(patch) => update(editing.id, patch)} />
            <LabelBlock spool={editing} config={p.config} onConfig={p.onConfig} relay={p.relay} />
          </>
        )}
      </div>
    </div>
  );
}

function SpoolEditor({ spool, onChange, onDelete }: { spool: Spool; onChange: (p: Partial<Spool>) => void; onDelete: () => void }) {
  const [hex, setHex] = useState(spool.color);
  useEffect(() => { setHex(spool.color); }, [spool.id, spool.color]);

  /** Changing the material re-seeds the temperatures from that preset, which is
   *  what correcting a mistyped material should do; edit them after, not before. */
  const setMaterial = (filamentId: string) => {
    const fresh = newSpool(filamentId);
    onChange({ filamentId, nozzleTemp: fresh.nozzleTemp, bedTemp: fresh.bedTemp });
  };

  return (
    <section className="group">
      <h4>Spool {spool.id}</h4>
      <label className="field"><span>Brand</span>
        <input value={spool.brand} placeholder="eSUN" onChange={(e) => onChange({ brand: e.target.value })} />
      </label>
      <label className="field"><span>Colour name</span>
        <input value={spool.colorName} placeholder="Galaxy Black" onChange={(e) => onChange({ colorName: e.target.value })} />
      </label>
      <label className="field"><span>Colour</span>
        <span className="row gap">
          <input type="color" value={spool.color} onChange={(e) => onChange({ color: e.target.value })} />
          <input
            className="hex" value={hex} spellCheck={false}
            onChange={(e) => {
              setHex(e.target.value);
              const norm = normalizeHex(e.target.value);
              if (norm) onChange({ color: norm });
            }}
            onBlur={() => setHex(spool.color)}
          />
        </span>
      </label>
      <label className="field"><span>Material</span>
        <select value={spool.filamentId} onChange={(e) => setMaterial(e.target.value)}>
          {FILAMENTS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <div className="grid2">
        <label className="field"><span>Nozzle °C</span>
          <input type="number" min={150} max={320} value={spool.nozzleTemp} onChange={(e) => onChange({ nozzleTemp: Number(e.target.value) })} />
        </label>
        <label className="field"><span>Bed °C</span>
          <input type="number" min={0} max={120} value={spool.bedTemp} onChange={(e) => onChange({ bedTemp: Number(e.target.value) })} />
        </label>
      </div>
      <p className="hint">
        These override {filamentById(spool.filamentId).name}'s temperatures while this spool is in use.
        Everything else about the material — flow, fan, pressure advance — stays with that preset.
      </p>
      <label className="field"><span>Purchased</span>
        <input type="date" value={spool.purchasedAt} onChange={(e) => onChange({ purchasedAt: e.target.value })} />
      </label>
      <label className="field column"><span>Notes</span>
        <textarea rows={2} value={spool.notes} placeholder="Dried 6 h @ 50 °C" onChange={(e) => onChange({ notes: e.target.value })} />
      </label>
      <button className="btn ghost small danger-text" onClick={onDelete}>Delete this spool</button>
    </section>
  );
}

function UsageBlock({ spool, lastSliceG, onChange }: { spool: Spool; lastSliceG: number | null; onChange: (p: Partial<Spool>) => void }) {
  const left = remainingG(spool);
  const frac = remainingFraction(spool);
  return (
    <section className="group">
      <h4>Filament left</h4>
      <div className="grid2">
        <label className="field"><span>Full spool g</span>
          <input type="number" min={0} step={50} value={spool.netWeightG} onChange={(e) => onChange({ netWeightG: Math.max(0, Number(e.target.value)) })} />
        </label>
        <label className="field"><span>Used g</span>
          <input type="number" min={0} step={1} value={spool.usedG} onChange={(e) => onChange({ usedG: Math.max(0, Number(e.target.value)) })} />
        </label>
      </div>
      {frac !== null && (
        <>
          <div className="bar"><div style={{ width: `${Math.round(frac * 100)}%` }} /></div>
          <p className="hint">{Math.round(left)} g left of {Math.round(spool.netWeightG)} g ({Math.round(frac * 100)}%).</p>
        </>
      )}
      <div className="row gap wrap">
        <button
          className="btn small" disabled={!lastSliceG}
          title={lastSliceG ? 'Add the last slice to this spool' : 'Slice something first'}
          onClick={() => { if (lastSliceG) onChange(withUsage(spool, lastSliceG)); }}
        >
          {lastSliceG ? `Book ${lastSliceG.toFixed(1)} g from the last slice` : 'Nothing sliced yet'}
        </button>
        <button className="btn ghost small" onClick={() => onChange({ usedG: 0 })}>Reset to full</button>
      </div>
      <p className="hint">A print sent to the printer while this spool is in use is booked automatically; use the button for prints taken away on a USB stick.</p>
    </section>
  );
}

function LabelBlock({ spool, config, onConfig, relay }: { spool: Spool; config: LabelForgeConfig; onConfig: (c: LabelForgeConfig) => void; relay: boolean }) {
  const [templates, setTemplates] = useState<LabelTemplate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  const setPreviewUrl = useCallback((url: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  }, []);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const template = templates?.find((t) => t.id === config.templateId) ?? null;
  const plan = useMemo(
    () => (template ? planSpoolLabel(spool, template, config.qrPrefix) : null),
    [spool, template, config.qrPrefix],
  );
  const blocked = labelForgeBlocked(config, relay);

  /** Text variables plus the rendered art, ready to post. */
  const variables = useCallback((): { vars: Record<string, string>; warning: string | null } => {
    if (!plan) throw new Error('Pick a template first');
    const vars = { ...plan.variables };
    let warning: string | null = null;
    if (plan.imageVariable && plan.art) {
      const { base64, art } = spoolArtPng(plan.art);
      vars[plan.imageVariable] = base64;
      warning = art.warning;
    }
    return { vars, warning };
  }, [plan]);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setError(null); setMessage(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const load = () => run('templates', async () => {
    const list = await listTemplates(config, relay);
    setTemplates(list);
    if (!list.length) setMessage('LabelForge has no templates yet. Design one there first.');
    else if (!list.some((t) => t.id === config.templateId)) onConfig({ ...config, templateId: list[0].id });
  });

  const doPreview = () => run('preview', async () => {
    const { vars, warning } = variables();
    const blob = await renderLabel(config, relay, config.templateId, vars);
    setPreviewUrl(URL.createObjectURL(blob));
    if (warning) setMessage(warning);
  });

  const doPrint = () => run('print', async () => {
    const { vars, warning } = variables();
    await printLabel(config, relay, { template_id: config.templateId, variables: vars, copies: Math.max(1, config.copies) });
    setMessage(`Sent to the label printer.${warning ? ` ${warning}` : ''}`);
  });

  return (
    <section className="group">
      <h4>Label</h4>
      <div className="grid2">
        <label className="field"><span>LabelForge IP</span>
          <input value={config.host} placeholder="192.168.1.20" spellCheck={false} onChange={(e) => onConfig({ ...config, host: e.target.value })} />
        </label>
        <label className="field"><span>Port</span>
          <input type="number" min={1} max={65535} value={config.port} onChange={(e) => onConfig({ ...config, port: Number(e.target.value) || DEFAULT_LABELFORGE_PORT })} />
        </label>
      </div>
      <div className="row gap wrap">
        <button className="btn small" disabled={!labelForgeConfigured(config) || busy === 'templates'} onClick={load}>
          {busy === 'templates' ? 'Loading…' : templates ? 'Reload templates' : 'Load templates'}
        </button>
        {templates && templates.length > 0 && (
          <label className="field inline"><span>Template</span>
            <select value={config.templateId} onChange={(e) => { onConfig({ ...config, templateId: e.target.value }); setPreviewUrl(null); }}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <label className="field column"><span>QR prefix</span>
        <input
          value={config.qrPrefix} spellCheck={false} placeholder="(blank: the QR holds just the spool id)"
          onChange={(e) => { onConfig({ ...config, qrPrefix: e.target.value }); setPreviewUrl(null); }}
        />
      </label>
      <p className="hint">
        Set this to this page's own address ending in <code>#spool=</code> and scanning a label opens the slicer
        with that spool selected. The QR on this spool will read <code>{config.qrPrefix}{spool.id}</code>.
      </p>

      {plan?.warnings.map((w) => <p className="warn" key={w}>{w}</p>)}

      <div className="row gap wrap">
        <label className="field inline"><span>Copies</span>
          <input type="number" min={1} max={20} value={config.copies} onChange={(e) => onConfig({ ...config, copies: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
        <button className="btn small" disabled={!template || Boolean(busy)} onClick={doPreview}>{busy === 'preview' ? 'Rendering…' : 'Preview'}</button>
        <button className="btn primary small" disabled={!template || Boolean(busy)} onClick={doPrint}>{busy === 'print' ? 'Printing…' : 'Print label'}</button>
      </div>

      {blocked && <p className="warn">{blocked}</p>}
      {error && <p className="status err">{error}</p>}
      {message && <p className="status ok">{message}</p>}
      {preview && (
        <div className="label-preview">
          <img src={preview} alt={`Label for ${spoolName(spool)}`} />
          <p className="hint">Exactly what will be printed, before the printer reduces it to black and white.</p>
        </div>
      )}

      <details className="printer">
        <summary>Variables a template can use</summary>
        <table className="stats">
          <tbody>
            {SPOOL_LABEL_VARIABLES.map((v) => (
              <tr key={v.name}><td><code>{`{{${v.name}}}`}</code></td><td>{v.what}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          The template's image block is filled in automatically with the QR code and colour patch — give that image
          an override variable in LabelForge (any name) and it will be used.
        </p>
      </details>
    </section>
  );
}
