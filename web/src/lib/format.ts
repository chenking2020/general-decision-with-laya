export const pct = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : `${(x * 100).toFixed(digits)}%`;

export const num = (x: number | null | undefined, digits = 3) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : Number(x).toFixed(digits);

export const ms = (x: number | null | undefined) =>
  x === null || x === undefined ? "—" : `${Number(x).toFixed(0)} ms`;

export const compact = (n: number | null | undefined) => {
  if (!n) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
};

export const timeAgo = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(t).toLocaleDateString("zh-CN");
};

export const shortTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export const typeLabel: Record<string, string> = {
  choice: "单选",
  score: "等级",
  noul: "是非",
};

export const typeColor: Record<string, string> = {
  choice: "text-cyan-700 border-cyan-500/40 bg-cyan-500/10",
  score: "text-violet-700 border-violet-500/40 bg-violet-500/10",
  noul: "text-emerald-700 border-emerald-500/40 bg-emerald-500/10",
};

/** 决策维度以中文为核心：内部的 true/false 一律显示为“是 / 否”。 */
export const truthLabel = (v: any): string => {
  const s = String(v);
  if (s === "true") return "是";
  if (s === "false") return "否";
  return s;
};

/** 是非问题的取值选项：界面显示中文，提交给后端仍是 true/false。 */
export const boolOptions = [
  { label: "是", value: "true" },
  { label: "否", value: "false" },
];

export const verdictChip: Record<string, string> = {
  act: "chip chip-act",
  review: "chip chip-review",
  escalate: "chip chip-escalate",
};

export const verdictLabel: Record<string, string> = {
  act: "自动执行",
  review: "部分复核",
  escalate: "升级人工",
};

export const stateToText = (s: any): string => {
  if (typeof s === "string") return s;
  if (!s) return "";
  if (Array.isArray(s)) return s.map((x) => String(x)).join("\n");
  return Object.entries(s)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
};

export const parseState = (text: string): any => {
  const t = text.trim();
  if (!t) return "";
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      return text;
    }
  }
  return text;
};
