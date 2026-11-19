import type { ReactNode } from 'react';

export function NumberField(props: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>
        {props.label}
        {props.unit ? <span className="muted">（{props.unit}）</span> : null}
      </span>
      <input
        type="number"
        value={Number.isFinite(props.value) ? props.value : ''}
        step={props.step ?? 0.1}
        min={props.min}
        max={props.max}
        disabled={props.disabled}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) props.onChange(v);
        }}
      />
    </label>
  );
}

export function TextField(props: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input type="text" value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Card(props: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {props.title}
        {props.extra}
      </h3>
      {props.children}
    </section>
  );
}

export function MultiToggle<T extends string>(props: {
  options: { value: T; label: string }[];
  values: T[];
  onChange: (values: T[]) => void;
}) {
  const toggle = (v: T) => {
    props.onChange(props.values.includes(v) ? props.values.filter((x) => x !== v) : [...props.values, v]);
  };
  return (
    <div className="switch-list">
      {props.options.map((o) => (
        <button key={o.value} className={props.values.includes(o.value) ? 'on' : ''} onClick={() => toggle(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
