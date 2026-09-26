import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { LedgerRow, LedgerStats } from "../lib/types";
import { ms, pct, shortTime, typeColor, typeLabel, verdictChip, verdictLabel } from "../lib/format";
import { AnswerCard } from "../components/AnswerCard";
import { Empty, ErrorBox, Panel, SectionTitle, Spinner } from "../components/ui";

export default function Ledger() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [stats, setStats] = useState<LedgerStats | null>(null);
  const [verdict, setVerdict] = useState("");
  const [kw, setKw] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([api.ledger({ limit: 200, verdict: verdict || undefined, q: kw || undefined }), api.ledgerStats()])
      .then(([r, s]) => {
        setRows(r.items);
        setStats(s);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [verdict, kw]);

  useEffect(() => {
    const t = setTimeout(reload, kw ? 300 : 0);
    return () => clearTimeout(t);
  }, [reload, kw]);

  const onTruth = async (id: string, key: string, truth: string) => {
    try {
      await api.feedback(id, key, truth);
      reload();
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  return (
    <div className="space-y-4">
      <Panel className="panel-pad">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <SectionTitle>决策账本</SectionTitle>
            <p className="text-[13px] leading-relaxed text-slate-400">
              每一次决策的完整留痕：状态、问题集、概率分布、语言路由、耗时与裁决。
              给答案打上真值，就自动成为标定样本——这是让概率变得可信的唯一途径。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-[180px]" placeholder="搜索状态 / 蓝图" value={kw} onChange={(e) => setKw(e.target.value)} />
            <select className="select w-[140px] py-1.5 text-[12px]" value={verdict} onChange={(e) => setVerdict(e.target.value)}>
              <option value="">全部裁决</option>
              <option value="act">自动执行</option>
              <option value="review">部分复核</option>
              <option value="escalate">升级人工</option>
            </select>
            {rows.length > 0 && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  if (confirm("清空整个决策账本？该操作不可恢复。")) api.clearLedger().then(reload);
                }}
              >
                清空
              </button>
            )}
          </div>
        </div>
        {stats && (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[
              ["总决策", stats.total],
              ["平均置信", pct(stats.avg_confidence)],
              ["平均最低置信", pct(stats.avg_min_confidence)],
              ["人工反馈", stats.feedback_count],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl border border-ink-600 bg-ink-800 px-3 py-2">
                <div className="text-[11px] text-slate-500">{k}</div>
                <div className="num mt-1 text-[18px] text-slate-100">{v}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <ErrorBox>{error}</ErrorBox>

      {loading ? (
        <Spinner label="读取账本" />
      ) : rows.length === 0 ? (
        <Panel className="panel-pad">
          <Empty>账本为空。去工作台跑第一条决策，或到批量页导入一批数据。</Empty>
        </Panel>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const open = expanded === r.id;
            return (
              <Panel key={r.id} className="overflow-hidden">
                <button
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-800"
                  onClick={() => setExpanded(open ? null : r.id)}
                >
                  <span className="num w-[92px] shrink-0 text-[11.5px] text-slate-600">{shortTime(r.created_at)}</span>
                  <span className="w-[160px] shrink-0 truncate text-[13px] text-slate-200">
                    {r.blueprint_name || "自定义决策"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-500">{r.state_text?.slice(0, 140)}</span>
                  <span className="chip">{r.script || "—"}</span>
                  <span className={verdictChip[r.verdict ?? "review"]}>{verdictLabel[r.verdict ?? "review"]}</span>
                  <span className="num w-[64px] text-right text-[12px] text-slate-400">{pct(r.avg_confidence)}</span>
                  <span className="num w-[64px] text-right text-[11.5px] text-slate-600">{ms(r.elapsed_ms)}</span>
                  {Object.keys(r.feedback ?? {}).length > 0 && <span className="chip chip-act">已标注</span>}
                </button>
                {open && (
                  <div className="border-t border-ink-600 bg-ink-800 px-4 py-4">
                    <div className="mb-4 grid gap-4 lg:grid-cols-2">
                      <div>
                        <SectionTitle>状态</SectionTitle>
                        <pre className="scroll-thin max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-600 bg-ink-800 p-3 text-[11.5px] leading-relaxed text-slate-400">
                          {r.state_text}
                        </pre>
                      </div>
                      <div>
                        <SectionTitle>问题集</SectionTitle>
                        <div className="space-y-1.5">
                          {Object.entries(r.questions || {}).map(([k, q]) => (
                            <div key={k} className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[12px] text-slate-200">{k}</span>
                                <span className={`chip ${typeColor[q.type] ?? ""}`}>{typeLabel[q.type]}</span>
                              </div>
                              <div className="mt-1 text-[11.5px] text-slate-500">{q.instructions}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {Object.values(r.answers || {}).map((a) => (
                        <AnswerCard
                          key={a.key}
                          answer={a}
                          truth={(r.feedback ?? {})[a.key]}
                          onTruth={(t) => onTruth(r.id, a.key, t)}
                        />
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11.5px] text-slate-600">
                      <span>账本 ID：{r.id}</span>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => {
                          api.deleteDecision(r.id).then(reload);
                        }}
                      >
                        删除这条
                      </button>
                    </div>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
