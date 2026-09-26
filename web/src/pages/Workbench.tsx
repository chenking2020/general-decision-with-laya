import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useMeta } from "../lib/MetaContext";
import type { Blueprint, DecideResult, QuestionSpec } from "../lib/types";
import { parseState, pct, stateToText } from "../lib/format";
import { AnswerCard, VerdictBanner } from "../components/AnswerCard";
import { QuestionEditor } from "../components/QuestionEditor";
import { Empty, ErrorBox, Panel, SectionTitle, Slider, Spinner, Toggle } from "../components/ui";

/** 决策维度（问题、选项、等级）一律用中文表达；多语言只作用于被决策的原始数据。 */
const DEFAULT_QUESTIONS: Record<string, QuestionSpec> = {
  归属团队: {
    type: "choice",
    instructions: "这条消息应该归属哪个团队？",
    criteria: {
      财务: "发票、支付、扣款、退款",
      技术: "崩溃、报错、接口失败",
      销售: "报价、套餐、合同",
    },
  },
  紧急度: {
    type: "score",
    instructions: "这件事有多紧急？",
    criteria: ["没有时间压力，纯咨询", "本周内需要处理", "正在阻塞对方的工作"],
  },
  要求退款: {
    type: "noul",
    instructions: "对方是否明确要求退款？",
  },
};

const DEFAULT_STATE = {
  subject: "三月份的账单被扣了两次",
  body: "你好，我们三月份被重复扣款，请今天把多扣的部分退回来，否则我们会取消套餐。",
};

export default function Workbench() {
  const { bpId } = useParams();
  const navigate = useNavigate();
  const { meta } = useMeta();

  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [bp, setBp] = useState<Blueprint | null>(null);
  const [questions, setQuestions] = useState<Record<string, QuestionSpec>>(DEFAULT_QUESTIONS);
  const [stateText, setStateText] = useState(JSON.stringify(DEFAULT_STATE, null, 2));
  const [threshold, setThreshold] = useState(0.6);
  const [autoAct, setAutoAct] = useState(true);
  const [cascade, setCascade] = useState(false);
  const [maxLen, setMaxLen] = useState(1024);
  const [result, setResult] = useState<DecideResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routing, setRouting] = useState<any>(null);
  const [truths, setTruths] = useState<Record<string, string>>({});
  const [showRaw, setShowRaw] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const timer = useRef<any>(null);

  // 载入蓝图列表
  useEffect(() => {
    api
      .blueprints()
      .then((r) => setBlueprints(r.items))
      .catch(() => {});
    api
      .settings()
      .then((s) => {
        setThreshold(s.threshold);
        setAutoAct(s.auto_act);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!bpId) return;
    api
      .blueprint(bpId)
      .then((b) => applyBlueprint(b))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpId]);

  const applyBlueprint = (b: Blueprint) => {
    setBp(b);
    setQuestions(b.questions);
    if (b.state_hint && Object.keys(b.state_hint).length) {
      setStateText(
        typeof b.state_hint === "object"
          ? JSON.stringify(b.state_hint, null, 2)
          : String(b.state_hint)
      );
    }
    if (b.policy?.threshold != null) setThreshold(b.policy.threshold);
    if (b.policy?.auto_act != null) setAutoAct(b.policy.auto_act);
    if (b.policy?.cascade != null) setCascade(b.policy.cascade);
    setResult(null);
    setTruths({});
  };

  // 状态变化时做脚本/语言分析（不走前向）
  const analyse = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api
        .route(parseState(text))
        .then(setRouting)
        .catch(() => setRouting(null));
    }, 350);
  }, []);

  useEffect(() => {
    analyse(stateText);
  }, [stateText, analyse]);

  const run = async () => {
    setLoading(true);
    setError(null);
    setSavedMsg(null);
    try {
      const res = await api.decide({
        state: parseState(stateText),
        questions,
        policy: { threshold, auto_act: autoAct, noul_margin: 0.15, cascade },
        max_len: maxLen,
        blueprint_id: bp?.id,
        blueprint_name: bp?.name,
        domain: bp?.domain,
        tags: bp?.tags ?? [],
      });
      setResult(res);
      setTruths({});
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  const onTruth = async (key: string, truth: string) => {
    if (!result?.decision_id) return;
    if (!truth) {
      setTruths((t) => ({ ...t, [key]: "" }));
      return;
    }
    try {
      const r = await api.feedback(result.decision_id, key, truth);
      setTruths(r.feedback);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  const saveAsBlueprint = async () => {
    const name = window.prompt("蓝图名称", bp ? `${bp.name}（副本）` : "我的决策蓝图");
    if (!name) return;
    try {
      const created = await api.createBlueprint({
        name,
        domain: bp?.domain ?? "自定义",
        description: bp?.description ?? "在工作台中创建的决策蓝图",
        questions,
        state_hint: (typeof parseState(stateText) === "object" ? parseState(stateText) : { body: stateText }) as any,
        policy: { threshold, auto_act: autoAct, cascade },
        tags: bp?.tags ?? [],
      });
      setSavedMsg(`已保存为蓝图「${created.name}」`);
      navigate("/blueprints");
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  const questionCount = Object.keys(questions).length;
  const ready = meta?.status === "ready";

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      {/* 左：输入 */}
      <div className="space-y-4 xl:col-span-5">
        <Panel className="panel-pad">
          <SectionTitle
            right={
              <select
                className="select w-[210px] py-1 text-[12px]"
                value={bp?.id ?? ""}
                onChange={(e) => {
                  const b = blueprints.find((x) => x.id === e.target.value);
                  if (b) applyBlueprint(b);
                  else {
                    setBp(null);
                    setQuestions(DEFAULT_QUESTIONS);
                  }
                }}
              >
                <option value="">— 使用内置示例问题 —</option>
                {blueprints.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.domain} · {b.name}
                  </option>
                ))}
              </select>
            }
          >
            决策蓝图
          </SectionTitle>
          {bp ? (
            <div>
              <div className="text-[13.5px] font-medium text-slate-50">{bp.name}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{bp.description}</p>
              {bp.policy?.note && (
                <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11.5px] text-amber-700/90">
                  {bp.policy.note}
                </div>
              )}
              {bp.sample_states?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="text-[11.5px] text-slate-600">样例：</span>
                  {bp.sample_states.map((s, i) => (
                    <button
                      key={i}
                      className="btn btn-sm"
                      onClick={() =>
                        setStateText(
                          typeof s.state === "object" ? JSON.stringify(s.state, null, 2) : String(s.state)
                        )
                      }
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12px] leading-relaxed text-slate-500">
              选择一张蓝图即可载入该领域的成熟问题集，也可以直接在下面自行编写决策原子。
            </p>
          )}
        </Panel>

        <Panel className="panel-pad">
          <SectionTitle
            right={
              <span className="flex items-center gap-2 text-[11.5px] text-slate-500">
                {routing?.script && <span className="chip chip-accent">{routing.script}</span>}
                {stateToText(parseState(stateText)).length} 字
              </span>
            }
          >
            状态（State）
          </SectionTitle>
          <textarea
            className="textarea"
            value={stateText}
            onChange={(e) => setStateText(e.target.value)}
            spellCheck={false}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11.5px] text-slate-600">
              支持纯文本或 JSON 对象；长文档请把最大长度调到 4096 / 8192。
            </span>
            <select
              className="select w-[120px] py-1 text-[12px]"
              value={maxLen}
              onChange={(e) => setMaxLen(Number(e.target.value))}
            >
              {[1024, 2048, 4096, 8192].map((n) => (
                <option key={n} value={n}>
                  {n} tokens
                </option>
              ))}
            </select>
          </div>
          {routing?.advice && (
            <div className="mt-2 text-[11.5px] leading-relaxed text-slate-500">{routing.advice}</div>
          )}
        </Panel>

        <Panel className="panel-pad">
          <SectionTitle right={<span className="text-[11.5px] text-slate-600">{questionCount} 个决策原子</span>}>
            类型化问题（Questions）
          </SectionTitle>
          <QuestionEditor questions={questions} onChange={setQuestions} />
        </Panel>

        <Panel className="panel-pad">
          <SectionTitle>门控策略</SectionTitle>
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between text-[12px]">
              <span className="text-slate-500">置信度阈值</span>
              <span className="num text-accent-soft">{pct(threshold, 0)}</span>
            </div>
            <Slider value={threshold} min={0.3} max={0.95} step={0.01} onChange={setThreshold} />
            <div className="mt-1.5 text-[11.5px] text-slate-600">
              阈值是一个<strong className="text-slate-400">策略</strong>：它决定你愿意接受多少错误、
              换取多少自动化覆盖率，请在标定页用真实数据选，不要拍脑袋。
            </div>
          </div>
          <Toggle checked={autoAct} onChange={setAutoAct} label="允许自动执行（关闭则全部升级人工）" />
          <Toggle
            checked={cascade}
            onChange={setCascade}
            label="级联推理：把每个原子的结论写回状态后，再判下一个原子"
          />
          <div className="-mt-1.5 text-[11.5px] leading-relaxed text-slate-600">
            默认是扁平并行：所有问题共享同一份状态、彼此看不见对方的答案，交换顺序结果不变。
            级联适用于有依赖的链（如「是否疑似钓鱼 → 用的哪种手法」），代价是串行、
            延迟随问题数线性增长，且前面的错误会顺着链条传播。
          </div>
          <div className="mt-4 flex gap-2">
            <button className="btn btn-primary flex-1" onClick={run} disabled={loading || !questionCount}>
              {loading ? <Spinner label="一次前向传播中" /> : "运行决策（⌘/Ctrl + Enter）"}
            </button>
            <button className="btn" onClick={saveAsBlueprint}>
              存为蓝图
            </button>
          </div>
          {!ready && (
            <div className="mt-2 text-[11.5px] text-amber-700/90">
              引擎还在加载权重，首次点击会自动等待加载完成。
            </div>
          )}
          {savedMsg && <div className="mt-2 text-[11.5px] text-emerald-700">{savedMsg}</div>}
        </Panel>
      </div>

      {/* 右：结果 */}
      <div className="space-y-4 xl:col-span-7">
        <ErrorBox>{error}</ErrorBox>
        {!result ? (
          <Panel className="panel-pad">
            <Empty
              action={
                <button className="btn btn-primary btn-sm" onClick={run} disabled={loading}>
                  立即运行
                </button>
              }
            >
              还没有结果。填好状态与问题后运行：所有问题会在
              <strong className="text-slate-300"> 同一次前向传播 </strong>
              里一起被回答。
            </Empty>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { t: "choice · 单选", d: "在自定义标签集上 softmax，返回每个选项的概率" },
                { t: "score · 等级", d: "有序量规上的期望等级 + 分布，适合紧急度、严重度" },
                { t: "noul · 是非", d: "只问一个命题，返回校准后的 P(true)，适合风控与护栏" },
              ].map((x) => (
                <div key={x.t} className="rounded-xl border border-ink-600 bg-ink-800 p-3">
                  <div className="num text-[12px] text-accent-soft">{x.t}</div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{x.d}</div>
                </div>
              ))}
            </div>
          </Panel>
        ) : (
          <>
            <VerdictBanner
              verdict={result.verdict}
              avg={result.avg_confidence}
              min={result.min_confidence}
              elapsed={result.elapsed_ms}
              threshold={result.threshold}
              routing={result.routing}
            />

            <div className="grid gap-3 lg:grid-cols-2">
              {Object.values(result.answers).map((a) => (
                <AnswerCard
                  key={a.key}
                  answer={a}
                  truth={truths[a.key]}
                  onTruth={(t) => onTruth(a.key, t)}
                />
              ))}
            </div>

            <Panel className="panel-pad">
              <SectionTitle
                right={
                  <button className="btn btn-sm" onClick={() => setShowRaw((v) => !v)}>
                    {showRaw ? "收起" : "查看原始响应"}
                  </button>
                }
              >
                本次调用的元信息
              </SectionTitle>
              <div className="grid gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-2">
                <MetaRow k="模型" v={result.model} />
                <MetaRow k="耗时" v={`${result.elapsed_ms.toFixed(1)} ms`} />
                <MetaRow k="输入 tokens" v={String(result.usage?.input_tokens ?? 0)} />
                <MetaRow k="输出 tokens" v={String(result.usage?.output_tokens ?? 0)} />
                <MetaRow k="问题数" v={String(Object.keys(result.answers).length)} />
                <MetaRow k="账本 ID" v={result.decision_id ?? "—"} />
              </div>
              {showRaw && (
                <pre className="scroll-thin mt-3 max-h-[360px] overflow-auto rounded-lg border border-ink-600 bg-ink-800 p-3 text-[11.5px] leading-relaxed text-slate-400">
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-600 pb-1">
      <span className="text-slate-500">{k}</span>
      <span className="num truncate text-slate-300">{v}</span>
    </div>
  );
}
