import React from "react";

export function Panel({
  children,
  className = "",
  hover = false,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return <div className={`panel ${hover ? "panel-hover" : ""} ${className}`}>{children}</div>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="section-title">{children}</div>
      {right}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "accent";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
      ? "text-amber-700"
      : tone === "accent"
      ? "text-accent-soft"
      : "text-slate-100";
  return (
    <div className="panel panel-pad">
      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`num mt-2 text-[26px] leading-none ${toneCls}`}>{value}</div>
      {hint && <div className="mt-2 text-[11.5px] leading-relaxed text-slate-500">{hint}</div>}
    </div>
  );
}

export function ProbBar({
  label,
  p,
  active,
  tone = "accent",
}: {
  label: string;
  p: number;
  active?: boolean;
  tone?: "accent" | "muted";
}) {
  const w = `${Math.max(1.5, Math.min(100, p * 100))}%`;
  const fill =
    tone === "muted"
      ? "bg-slate-500/60"
      : active
      ? "bg-gradient-to-r from-accent-deep to-accent"
      : "bg-slate-600/70";
  return (
    <div className="py-[3px]">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span
          className={`truncate text-[12.5px] ${
            active ? "font-medium text-slate-100" : "text-slate-400"
          }`}
          title={label}
        >
          {label}
        </span>
        <span className={`num text-[12px] ${active ? "text-accent-soft" : "text-slate-500"}`}>
          {(p * 100).toFixed(1)}%
        </span>
      </div>
      <div className="prob-track">
        <div className={`prob-fill ${fill}`} style={{ width: w }} />
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px] text-slate-400">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
      {label}
    </span>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-ink-600 px-6 py-12 text-center">
      <div className="text-[13px] text-slate-500">{children}</div>
      {action}
    </div>
  );
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700">
      {children}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-[12.5px] text-slate-400"
    >
      <span
        className={`relative h-4 w-8 rounded-full transition ${
          checked ? "bg-accent/60" : "bg-ink-700"
        }`}
      >
        <span
          className={`absolute top-[2px] h-3 w-3 rounded-full border border-ink-500 bg-white transition-all ${
            checked ? "left-[18px]" : "left-[2px]"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-ink-600 bg-ink-800 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-[12px] transition ${
            value === o.value
              ? "bg-accent/20 text-accent-soft"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-700 accent-accent"
    />
  );
}

export function Histogram({
  values,
  labels,
  height = 92,
  color = "#0891b2",
}: {
  values: number[];
  labels?: string[];
  height?: number;
  color?: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="group relative flex-1">
          <div
            className="w-full rounded-t-[3px] transition-all"
            style={{
              height: `${Math.max(2, (v / max) * (height - 14))}px`,
              background: color,
              opacity: v === 0 ? 0.12 : 0.75,
            }}
          />
          {labels && (
            <div className="mt-1 text-center text-[9px] text-slate-600">{labels[i]}</div>
          )}
        </div>
      ))}
    </div>
  );
}
