import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { Blueprint, QuestionSpec } from "../lib/types";
import { typeColor, typeLabel } from "../lib/format";
import { QuestionEditor } from "../components/QuestionEditor";
import { Empty, ErrorBox, Panel, SectionTitle, Spinner } from "../components/ui";

export default function Blueprints() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Blueprint[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [domain, setDomain] = useState<string>("全部");
  const [kw, setKw] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = () => {
    setLoading(true);
    api
      .blueprints()
      .then((r) => {
        setItems(r.items);
        setDomains(r.domains);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  const filtered = useMemo(
    () =>
      items.filter(
        (b) =>
          (domain === "全部" || b.domain === domain) &&
          (!kw || (b.name + b.description + (b.tags || []).join("")).toLowerCase().includes(kw.toLowerCase()))
      ),
    [items, domain, kw]
  );

  const grouped = useMemo(() => {
    const g: Record<string, Blueprint[]> = {};
    for (const b of filtered) (g[b.domain] ||= []).push(b);
    return g;
  }, [filtered]);

  return (
    <div className="space-y-5">
      <Panel className="panel-pad">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <SectionTitle>决策蓝图库</SectionTitle>
            <p className="text-[13px] leading-relaxed text-slate-400">
              蓝图是<strong className="text-slate-200">可复用的决策资产</strong>：一个领域的判断被预先拆成
              类型化问题、门控阈值与样例状态。选一张蓝图，就能在工作台里立即决策，或丢进批量管道跑十万条。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input w-[190px]"
              placeholder="搜索蓝图"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
            <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
              {creating ? "收起编辑器" : "+ 新建蓝图"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {["全部", ...domains].map((d) => (
            <button
              key={d}
              className={`btn btn-sm ${domain === d ? "btn-primary" : ""}`}
              onClick={() => setDomain(d)}
            >
              {d}
            </button>
          ))}
        </div>

        {creating && <Creator onDone={() => { setCreating(false); reload(); }} onError={setError} />}
      </Panel>

      <ErrorBox>{error}</ErrorBox>

      {loading ? (
        <Spinner label="载入蓝图" />
      ) : filtered.length === 0 ? (
        <Empty>没有匹配的蓝图</Empty>
      ) : (
        Object.entries(grouped).map(([dom, list]) => (
          <div key={dom}>
            <SectionTitle>
              {dom} · {list.length}
            </SectionTitle>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((b) => {
                return (
                  <Panel key={b.id} hover className="flex flex-col p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="text-[14px] font-medium text-slate-50">{b.name}</div>
                      {b.builtin ? (
                        <span className="chip">内置</span>
                      ) : (
                        <span className="chip chip-accent">自定义</span>
                      )}
                    </div>
                    <p className="mb-3 line-clamp-3 text-[12px] leading-relaxed text-slate-500">{b.description}</p>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {Object.entries(b.questions || {}).map(([k, q]) => (
                        <span key={k} className={`chip ${typeColor[q.type] ?? ""}`}>
                          <span className="font-mono">{k}</span>
                          <span className="text-slate-500">· {typeLabel[q.type]}</span>
                        </span>
                      ))}
                    </div>
                    <div className="mt-auto flex items-center gap-2">
                      <button className="btn btn-sm btn-primary" onClick={() => navigate(`/workbench/${b.id}`)}>
                        单条决策
                      </button>
                      <button className="btn btn-sm" onClick={() => navigate(`/batch/${b.id}`)}>
                        批量跑
                      </button>
                      {!b.builtin && (
                        <button
                          className="btn btn-sm btn-danger ml-auto"
                          onClick={() => {
                            if (confirm(`删除蓝图「${b.name}」？`))
                              api.deleteBlueprint(b.id).then(reload).catch((e) => setError(String(e.message || e)));
                          }}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </Panel>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Creator({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("自定义");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<Record<string, QuestionSpec>>({
    判断结论: {
      type: "choice",
      instructions: "这条内容应该归到哪一类？",
      criteria: { 甲类: "第一类的判据描述", 乙类: "第二类的判据描述" },
    },
  });

  const submit = async () => {
    try {
      await api.createBlueprint({ name, domain, description, questions, policy: { threshold: 0.6 } });
      onDone();
    } catch (e: any) {
      onError(String(e.message || e));
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-accent/20 bg-accent/[0.04] p-4">
      <SectionTitle>新建蓝图</SectionTitle>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <input className="input" placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="领域" value={domain} onChange={(e) => setDomain(e.target.value)} />
        <input
          className="input"
          placeholder="一句话说明这个决策"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <QuestionEditor questions={questions} onChange={setQuestions} />
      <div className="mt-3 flex gap-2">
        <button className="btn btn-primary" onClick={submit} disabled={!name}>
          保存蓝图
        </button>
        <button className="btn" onClick={onDone}>
          取消
        </button>
      </div>
    </div>
  );
}
