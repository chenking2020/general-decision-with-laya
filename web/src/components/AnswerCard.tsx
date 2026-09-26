import React from "react";
import type { AnswerItem } from "../lib/types";
import { boolOptions, pct, typeColor, typeLabel } from "../lib/format";
import { Panel, ProbBar } from "./ui";

export function AnswerCard({
  answer,
  compactMode = false,
  onTruth,
  truth,
}: {
  answer: AnswerItem;
  compactMode?: boolean;
  onTruth?: (truth: string) => void;
  truth?: string;
}) {
  const gateAct = answer.gate?.decision === "act";
  const isNoul = answer.type === "noul";
  const isScore = answer.type === "score";

  return (
    <Panel className="p-4 animate-fade-up">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] text-slate-200">{answer.key}</span>
        <span className={`chip ${typeColor[answer.type] ?? ""}`}>{typeLabel[answer.type]}</span>
        <span className={gateAct ? "chip chip-act" : "chip chip-escalate"}>
          {gateAct ? "自动执行" : "升级人工"}
        </span>
        <span className="ml-auto num text-[11.5px] text-slate-500">
          置信 {pct(answer.answer_confidence)}
          {answer.temperature && Math.abs(answer.temperature - 1) > 1e-6 && (
            <span className="ml-1.5 text-slate-600">T={answer.temperature.toFixed(2)}</span>
          )}
        </span>
      </div>

      <div className="mb-3">
        {isNoul ? (
          <div>
            <div className="flex items-baseline gap-2">
              <span className="num text-[30px] leading-none text-emerald-700">
                {(Number(answer.value) * 100).toFixed(1)}%
              </span>
              <span className="text-[12px] text-slate-500">P(是)</span>
              <span className="chip ml-2">{answer.boolean ? "判定为「是」" : "判定为「否」"}</span>
            </div>
            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500"
                style={{ width: `${Math.max(1.5, Number(answer.value) * 100)}%` }}
              />
            </div>
          </div>
        ) : isScore ? (
          <div>
            <div className="flex items-baseline gap-2">
              <span className="num text-[30px] leading-none text-violet-700">
                {Number(answer.value).toFixed(2)}
              </span>
              <span className="text-[12px] text-slate-500">
                / 共 {Object.keys(answer.legend || {}).length} 级
              </span>
              <span className="chip chip-accent ml-2">
                落到第 {(answer.level ?? 0) + 1} 级 · 期望 {Number(answer.value).toFixed(2)}
              </span>
            </div>
            {answer.display && (
              <div className="mt-1.5 truncate text-[13px] text-slate-300">{answer.display}</div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-[22px] leading-tight text-cyan-700">{String(answer.display)}</div>
          </div>
        )}
      </div>

      {!compactMode && (
        <div className="mb-3">
          <div className="section-title mb-1">概率分布</div>
          {answer.probabilities.map((p) => (
            <ProbBar
              key={p.label}
              label={isScore ? `${p.label} · ${answer.legend?.[p.label] ?? ""}` : p.label}
              p={p.p}
              active={p.is_answer}
            />
          ))}
        </div>
      )}

      <div className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-[11.5px] leading-relaxed text-slate-500">
        {answer.gate?.reason}
      </div>

      {onTruth && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-600 pt-3">
          <span className="text-[11.5px] text-slate-500">人工标注真值</span>
          {(answer.type === "noul"
            ? boolOptions
            : answer.probabilities.map((p) => ({ label: p.label, value: p.label }))
          ).map((opt) => (
            <button
              key={opt.value}
              className={`btn btn-sm ${truth === opt.value ? "btn-primary" : ""}`}
              onClick={() => onTruth(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          {truth && (
            <button className="btn btn-sm" onClick={() => onTruth("")}>
              清除
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

export function VerdictBanner({
  verdict,
  avg,
  min,
  elapsed,
  threshold,
  routing,
}: {
  verdict: string;
  avg: number | null;
  min: number | null;
  elapsed?: number;
  threshold: number;
  routing?: any;
}) {
  const map: Record<string, { cls: string; title: string; desc: string }> = {
    act: {
      cls: "border-emerald-500/30 bg-emerald-500/[0.07]",
      title: "自动执行",
      desc: "所有问题的置信度都达到阈值，可以按答案直接驱动下游动作。",
    },
    review: {
      cls: "border-sky-500/30 bg-sky-500/[0.07]",
      title: "部分复核",
      desc: "至少有一个问题低于阈值：可执行的部分照常执行，其余进人工队列。",
    },
    escalate: {
      cls: "border-amber-500/30 bg-amber-500/[0.07]",
      title: "升级人工",
      desc: "所有问题都没达到阈值。这不是失败，而是系统在告诉你：它不知道。",
    },
  };
  const m = map[verdict] ?? map.review;
  return (
    <div className={`rounded-2xl border px-4 py-3.5 ${m.cls}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[15px] font-semibold text-slate-50">{m.title}</span>
        <span className="num text-[12px] text-slate-400">
          平均置信 {pct(avg)} · 最低 {pct(min)} · 阈值 {pct(threshold, 0)}
        </span>
        {elapsed != null && (
          <span className="num text-[12px] text-slate-500">{elapsed.toFixed(0)} ms</span>
        )}
        {routing?.script && (
          <span className="chip">
            {routing.script}
            {routing.language ? ` / ${routing.language}` : ""}
          </span>
        )}
      </div>
      <div className="mt-1.5 text-[12px] leading-relaxed text-slate-400">{m.desc}</div>
      {routing?.advice && (
        <div className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">{routing.advice}</div>
      )}
    </div>
  );
}
