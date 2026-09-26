import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { CalRow, FitEntry, MetricsBundle, SweepPoint, Settings } from "../lib/types";
import { num, pct, truthLabel, typeLabel } from "../lib/format";
import { Empty, ErrorBox, Panel, SectionTitle, Slider, Spinner, Stat, Toggle } from "../components/ui";

export default function Calibration() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rows, setRows] = useState<CalRow[]>([]);
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null);
  const [curve, setCurve] = useState<SweepPoint[]>([]);
  const [fit, setFit] = useState<Record<string, FitEntry> | null>(null);
  const [target, setTarget] = useState(0.9);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([api.settings(), api.calRows({ limit: 40 }), api.calMetrics({}), api.calSweep({ steps: 40 })])
      .then(([s, r, m, sw]) => {
        setSettings(s);
        setRows(r.items);
        setMetrics(m.metrics);
        setCurve(sw.curve);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  const recommended = React.useMemo(() => {
    const ok = curve.filter((p) => (p.accuracy ?? 0) >= target && p.count > 0);
    if (!ok.length) return null;
    return ok.reduce((a, b) => (b.coverage > a.coverage ? b : a));
  }, [curve, target]);

  const updateSettings = async (patch: Partial<Settings>) => {
    try {
      const s = await api.putSettings(patch);
      setSettings(s);
      const [m, sw] = await Promise.all([api.calMetrics({}), api.calSweep({ steps: 40 })]);
      setMetrics(m.metrics);
      setCurve(sw.curve);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  const runFit = async () => {
    setBusy("fit");
    try {
      const r = await api.calFit({});
      setFit(r.fit);
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(null);
    }
  };

  const applyFit = async () => {
    if (!fit) return;
    const t: Record<string, number> = {};
    for (const [k, v] of Object.entries(fit)) if (v.fitted) t[k] = v.temperature;
    if (!Object.keys(t).length) return;
    setBusy("apply");
    try {
      const s = await api.calApply(t);
      setSettings(s.settings);
      const [m, sw] = await Promise.all([api.calMetrics({}), api.calSweep({ steps: 40 })]);
      setMetrics(m.metrics);
      setCurve(sw.curve);
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(null);
    }
  };

  const n = metrics?.samples ?? 0;

  return (
    <div className="space-y-4">
      <Panel className="panel-pad">
        <SectionTitle>标定与门控</SectionTitle>
        <p className="max-w-3xl text-[13px] leading-relaxed text-slate-400">
          Laya 用严格适当评分规则训练，概率有统计意义；但出厂未标定，整体偏自信。
          这一页把概率变成策略：<strong className="text-slate-200">先拟合温度</strong>把校准误差压下来，
          <strong className="text-slate-200">再选阈值</strong>决定你愿意用多少错误换多少自动化覆盖率。
          没有人工标注样本时，这里的曲线是空的——先去账本或批量结果里给答案打真值。
        </p>
      </Panel>

      <ErrorBox>{error}</ErrorBox>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="标注样本" value={n} hint="人工反馈的（问题，答案，真值）三元组" tone={n ? "good" : "warn"} />
        <Stat label="准确率" value={pct(metrics?.accuracy)} hint="所有类型混合" />
        <Stat label="平均置信" value={pct(metrics?.mean_confidence)} hint="与准确率的差就是过度自信" />
        <Stat
          label="ECE"
          value={num(metrics?.ece)}
          hint="期望校准误差，越低越好"
          tone={(metrics?.ece ?? 1) < 0.1 ? "good" : "warn"}
        />
        <Stat label="Brier" value={num(metrics?.brier)} hint="概率整体质量，越低越好" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 阈值扫描 */}
        <Panel className="panel-pad lg:col-span-2">
          <SectionTitle
            right={
              <div className="flex items-center gap-2 text-[12px] text-slate-500">
                <span>目标准确率</span>
                <input
                  className="input num w-[74px] py-1 text-[12px]"
                  value={target}
                  onChange={(e) => setTarget(Math.max(0.5, Math.min(1, Number(e.target.value) || 0.9)))}
                />
              </div>
            }
          >
            阈值扫描：覆盖率 ↔ 准确率
          </SectionTitle>
          {loading ? (
            <Spinner label="计算扫描曲线" />
          ) : curve.length === 0 ? (
            <Empty>还没有标注样本。在账本里给任意答案点一下真值即可。</Empty>
          ) : (
            <>
              <SweepChart curve={curve} threshold={settings?.threshold ?? 0.6} recommended={recommended?.threshold ?? null} />
              <div className="mt-2 flex flex-wrap items-center gap-4 text-[11.5px]">
                <Legend color="#4f46e5" label="覆盖率（被自动执行的比例）" />
                <Legend color="#059669" label="覆盖率内的准确率" />
                <Legend color="#d97706" label="ECE（越低越好）" />
              </div>
              {recommended ? (
                <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2.5 text-[12.5px] text-emerald-700">
                  在准确率 ≥ {pct(target, 0)} 的约束下，最高覆盖率出现在阈值{" "}
                  <span className="num font-semibold">{recommended.threshold.toFixed(2)}</span>：
                  覆盖 <span className="num">{pct(recommended.coverage)}</span> 的决策，其准确率{" "}
                  <span className="num">{pct(recommended.accuracy)}</span>。
                  <button
                    className="btn btn-sm btn-primary ml-3"
                    onClick={() => updateSettings({ threshold: recommended.threshold })}
                  >
                    采用这个阈值
                  </button>
                </div>
              ) : (
                <div className="mt-3 text-[12px] text-amber-700/90">
                  在目标准确率 {pct(target, 0)} 下没有可用阈值：要么降低目标，要么先标定温度、再补样本。
                </div>
              )}
            </>
          )}
        </Panel>

        {/* 全局策略 */}
        <Panel className="panel-pad">
          <SectionTitle>全局门控策略</SectionTitle>
          {settings && (
            <div className="space-y-4">
              <div>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-slate-500">默认阈值</span>
                  <span className="num text-accent-soft">{pct(settings.threshold, 0)}</span>
                </div>
                <Slider
                  value={settings.threshold}
                  min={0.3}
                  max={0.95}
                  step={0.01}
                  onChange={(v) => setSettings({ ...settings, threshold: v })}
                />
                <button className="btn btn-sm mt-2 w-full" onClick={() => updateSettings({ threshold: settings.threshold })}>
                  保存阈值
                </button>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-slate-500">是非问题中点的容忍带</span>
                  <span className="num text-slate-300">±{settings.noul_margin.toFixed(2)}</span>
                </div>
                <Slider
                  value={settings.noul_margin}
                  min={0}
                  max={0.4}
                  step={0.01}
                  onChange={(v) => setSettings({ ...settings, noul_margin: v })}
                />
                <button
                  className="btn btn-sm mt-2 w-full"
                  onClick={() => updateSettings({ noul_margin: settings.noul_margin })}
                >
                  保存容忍带
                </button>
              </div>
              <Toggle
                checked={settings.auto_act}
                onChange={(v) => updateSettings({ auto_act: v })}
                label="允许自动执行"
              />
              <div>
                <div className="section-title mb-1.5">当前温度</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {Object.entries(settings.temperature).map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-ink-600 bg-ink-800 py-2">
                      <div className="text-[10.5px] text-slate-500">{k}</div>
                      <div className="num text-[15px] text-slate-100">{Number(v).toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* 温度拟合 */}
      <Panel className="panel-pad">
        <SectionTitle
          right={
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={runFit} disabled={busy === "fit" || n === 0}>
                {busy === "fit" ? <Spinner label="拟合中" /> : "拟合温度"}
              </button>
              <button className="btn btn-sm btn-primary" onClick={applyFit} disabled={!fit || busy === "apply"}>
                应用到运行时
              </button>
            </div>
          }
        >
          温度标定（每个问题类型一个温度）
        </SectionTitle>
        {n === 0 ? (
          <Empty>需要先有 ≥8 条同类标注样本才能拟合。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 font-medium">类型</th>
                  <th className="py-2 font-medium">样本</th>
                  <th className="py-2 font-medium">建议温度</th>
                  <th className="py-2 font-medium">ECE 前 → 后</th>
                  <th className="py-2 font-medium">Brier 前 → 后</th>
                  <th className="py-2 font-medium">NLL 前 → 后</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-600">
                {fit
                  ? Object.entries(fit).map(([k, v]) => (
                      <tr key={k}>
                        <td className="py-2 font-mono text-slate-200">{typeLabel[k] ?? k}</td>
                        <td className="num py-2 text-slate-400">{v.n}</td>
                        <td className="num py-2 text-accent-soft">
                          {v.fitted ? v.temperature.toFixed(3) : "1.000"}
                          {v.note && <div className="mt-0.5 max-w-[220px] text-[10.5px] font-normal leading-tight text-amber-700/80">{v.note}</div>}
                        </td>
                        <td className="num py-2 text-slate-400">
                          {v.fitted ? `${num(v.ece_before)} → ${num(v.ece_after)}` : v.note}
                        </td>
                        <td className="num py-2 text-slate-400">
                          {v.fitted ? `${num(v.brier_before)} → ${num(v.brier_after)}` : "—"}
                        </td>
                        <td className="num py-2 text-slate-400">
                          {v.fitted ? `${num(v.nll_before)} → ${num(v.nll_after)}` : "—"}
                        </td>
                      </tr>
                    ))
                  : ["choice", "score", "noul"].map((k) => (
                      <tr key={k}>
                        <td className="py-2 font-mono text-slate-300">{k}</td>
                        <td className="py-2 text-slate-600" colSpan={5}>
                          点击「拟合温度」计算
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 text-[11.5px] leading-relaxed text-slate-600">
          拟合在概率上做温度缩放 <span className="num">p′ = softmax(log p / T)</span>，最小化负对数似然。
          官方实测：拟合后平均 ECE 由 0.314 降到 0.106。温度只影响「置信度是否可信」，不改变答案排序。
        </div>
      </Panel>

      {/* 分类型指标 + 样本 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="panel-pad">
          <SectionTitle>分类型指标</SectionTitle>
          {metrics && Object.keys(metrics.per_type).length ? (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 font-medium">类型</th>
                  <th className="py-2 font-medium">n</th>
                  <th className="py-2 font-medium">准确率</th>
                  <th className="py-2 font-medium">平均置信</th>
                  <th className="py-2 font-medium">ECE</th>
                  <th className="py-2 font-medium">{metrics.per_type.score ? "MAE" : "Brier"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-600">
                {Object.entries(metrics.per_type).map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-2 font-mono text-slate-200">{k}</td>
                    <td className="num py-2 text-slate-400">{v.n}</td>
                    <td className="num py-2 text-slate-300">{pct(v.accuracy)}</td>
                    <td className="num py-2 text-slate-300">{pct(v.mean_confidence)}</td>
                    <td className="num py-2 text-slate-400">{num(v.ece)}</td>
                    <td className="num py-2 text-slate-400">{num(k === "score" ? v.mae : v.brier)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>暂无</Empty>
          )}
        </Panel>

        <Panel className="panel-pad">
          <SectionTitle>最近标注样本</SectionTitle>
          {rows.length ? (
            <div className="scroll-thin max-h-[320px] overflow-auto">
              <table className="w-full text-[12px]">
                <tbody className="divide-y divide-ink-600">
                  {rows.slice(0, 30).map((r, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pr-2 font-mono text-slate-400">{r.question_key}</td>
                      <td className="py-1.5 pr-2 text-slate-500">{typeLabel[r.type] ?? r.type}</td>
                      <td className="py-1.5 pr-2 text-slate-300">{truthLabel(r.prediction)}</td>
                      <td className="num py-1.5 pr-2 text-slate-500">{pct(r.confidence)}</td>
                      <td className="py-1.5 text-right">
                        <span className={String(r.prediction) === r.truth ? "text-emerald-700" : "text-rose-700"}>
                          真值 {r.truth}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>暂无标注</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-4 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function SweepChart({
  curve,
  threshold,
  recommended,
}: {
  curve: SweepPoint[];
  threshold: number;
  recommended: number | null;
}) {
  const W = 660;
  const H = 210;
  const PAD = 30;
  const x = (t: number) => PAD + t * (W - 2 * PAD);
  const y = (v: number) => H - PAD - v * (H - 2 * PAD);

  const line = (key: "coverage" | "accuracy" | "ece") =>
    curve
      .filter((p) => p[key] != null && p.count > 0)
      .map((p) => `${x(p.threshold).toFixed(1)},${y(p[key] as number).toFixed(1)}`)
      .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={PAD} x2={W - PAD} y1={y(v)} y2={y(v)} stroke="rgba(15,23,42,.10)" />
          <text x={PAD - 8} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#475569">
            {v.toFixed(2)}
          </text>
        </g>
      ))}
      {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
        <text key={v} x={x(v)} y={H - PAD + 14} textAnchor="middle" fontSize="9" fill="#475569">
          {v.toFixed(1)}
        </text>
      ))}
      <polyline points={line("coverage")} fill="none" stroke="#4f46e5" strokeWidth="2" />
      <polyline points={line("accuracy")} fill="none" stroke="#059669" strokeWidth="2" />
      <polyline points={line("ece")} fill="none" stroke="#d97706" strokeWidth="1.4" strokeDasharray="4 3" />
      <line x1={x(threshold)} x2={x(threshold)} y1={PAD} y2={H - PAD} stroke="#0891b2" strokeWidth="1.2" strokeDasharray="2 3" />
      <text x={x(threshold) + 4} y={PAD + 10} fontSize="9" fill="#0891b2">
        当前 {threshold.toFixed(2)}
      </text>
      {recommended != null && (
        <>
          <line x1={x(recommended)} x2={x(recommended)} y1={PAD} y2={H - PAD} stroke="#059669" strokeWidth="1.2" />
          <text x={x(recommended) + 4} y={H - PAD - 6} fontSize="9" fill="#059669">
            建议 {recommended.toFixed(2)}
          </text>
        </>
      )}
    </svg>
  );
}
