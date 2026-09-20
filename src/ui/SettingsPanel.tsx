import { useState } from 'react';
import type { SliceSettings } from '../slicer/settings';
import { SETTINGS_TABS, type Field } from './settingsSchema';
import { MACHINES, FILAMENTS, processesForNozzle, type MachineProfile, type FilamentProfile, type ProcessProfile } from '../profiles';

export interface SettingsPanelProps {
  machine: MachineProfile;
  filament: FilamentProfile;
  process: ProcessProfile;
  settings: SliceSettings;
  /** Settings as they'd be with no user overrides. */
  baseSettings: SliceSettings;
  overrides: Partial<SliceSettings>;
  onMachine: (id: string) => void;
  onFilament: (id: string) => void;
  onProcess: (id: string) => void;
  onOverride: (key: keyof SliceSettings, value: unknown) => void;
  onResetOverride: (key: keyof SliceSettings) => void;
  onResetAll: () => void;
}

export function SettingsPanel(p: SettingsPanelProps) {
  const [tab, setTab] = useState(SETTINGS_TABS[0].id);
  const [filter, setFilter] = useState('');
  const overrideCount = Object.keys(p.overrides).length;
  const processes = processesForNozzle(p.machine.nozzle);
  const f = filter.trim().toLowerCase();

  return (
    <aside className="panel settings">
      <div className="panel-section">
        <label className="field">
          <span>Printer</span>
          <select value={p.machine.id} onChange={(e) => p.onMachine(e.target.value)}>
            {MACHINES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Filament</span>
          <select value={p.filament.id} onChange={(e) => p.onFilament(e.target.value)}>
            {FILAMENTS.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.type})</option>)}
          </select>
        </label>
        <label className="field">
          <span>Process</span>
          <select value={p.process.id} onChange={(e) => p.onProcess(e.target.value)}>
            {processes.map((m) => <option key={m.id} value={m.id}>{m.name.replace(/ @Flashforge.*$/, '')}</option>)}
          </select>
        </label>
      </div>
      <div className="tabs">
        {SETTINGS_TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>{t.title}</button>
        ))}
      </div>
      <div className="panel-section row">
        <input className="search" placeholder="Search settings…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {overrideCount > 0 && (
          <button className="btn small ghost" title="Reset all modified settings to the preset values" onClick={p.onResetAll}>
            Reset {overrideCount}
          </button>
        )}
      </div>
      <div className="panel-scroll">
        {SETTINGS_TABS.filter((t) => f ? true : t.id === tab).map((t) => (
          <div key={t.id}>
            {t.groups.map((g) => {
              const fields = g.fields.filter((fl) => !f || fl.label.toLowerCase().includes(f) || String(fl.key).toLowerCase().includes(f));
              if (!fields.length) return null;
              return (
                <section key={g.title} className="group">
                  <h4>{f ? `${t.title} · ${g.title}` : g.title}</h4>
                  {fields.map((fl) => <FieldRow key={fl.key} field={fl} panel={p} />)}
                </section>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}

function FieldRow({ field, panel }: { field: Field; panel: SettingsPanelProps }) {
  const value = panel.settings[field.key];
  const modified = field.key in panel.overrides && panel.overrides[field.key] !== panel.baseSettings[field.key];
  const cls = modified ? 'field modified' : 'field';
  const reset = modified ? (
    <button className="reset" title="Reset to preset value" onClick={() => panel.onResetOverride(field.key)}>↺</button>
  ) : null;

  if (field.type === 'boolean') {
    return (
      <label className={cls} title={field.help}>
        <span>{field.label}</span>
        <span className="control">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => panel.onOverride(field.key, e.target.checked)} />
          {reset}
        </span>
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <label className={cls} title={field.help}>
        <span>{field.label}</span>
        <span className="control">
          <select value={String(value)} onChange={(e) => panel.onOverride(field.key, e.target.value)}>
            {field.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {reset}
        </span>
      </label>
    );
  }
  if (field.type === 'gcode') {
    return (
      <label className={`${cls} column`} title={field.help}>
        <span>{field.label} {reset}</span>
        <textarea rows={6} spellCheck={false} value={String(value ?? '')} onChange={(e) => panel.onOverride(field.key, e.target.value)} />
      </label>
    );
  }
  return (
    <label className={cls} title={field.help}>
      <span>{field.label}</span>
      <span className="control">
        <input
          type="number"
          value={value as number}
          step={field.step}
          min={field.min}
          max={field.max}
          onChange={(e) => {
            const v = e.target.value === '' ? 0 : Number(e.target.value);
            if (!Number.isNaN(v)) panel.onOverride(field.key, v);
          }}
        />
        {field.unit ? <em>{field.unit}</em> : null}
        {reset}
      </span>
    </label>
  );
}
