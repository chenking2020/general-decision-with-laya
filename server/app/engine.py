"""Laya 多语言决策引擎封装。

职责：
  1. 懒加载本地 checkpoint（``weights/laya-multilingual``），进程内单例；
  2. 把 laya 的原始输出规范化成前端可直接渲染的结构（含概率分布、置信度、门控裁决）；
  3. 提供脚本 / 语言分析（路由洞察），不做任何前向传播；
  4. 应用运行时温度（标定结果）与门控策略。

关于温度：checkpoint 出厂未标定（temperature = [1.0, 1.0, 1.0]），系统整体偏自信。
这里不改模型权重，而是在概率上做温度缩放：``p_i' = softmax(log p_i / T)``，
因为我们只有概率、没有 logits，而温度缩放对 logits 的常数平移不变，故该式与直接缩放等价。
"""

from __future__ import annotations

import math
import os
import threading
import time
from typing import Any, Dict, List, Optional, Union

os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from .config import (  # noqa: E402
    CHECKPOINT_NAME,
    CHECKPOINT_REPO,
    DEVICE,
    ENCODER_DIR,
    MAX_LEN,
    RL_CONFIG_PATH,
    WEIGHTS_DIR,
)

State = Union[str, Dict[str, Any], List[Any]]

# noul 的中文选项：laya 默认渲染成英文
# ``false: no, the statement does not hold`` / ``true: yes, the statement holds``，
# 而我们的指令是中文——选项与指令语言错配会让是非题退化。
# 中文基准（14 条）实测：英文默认标签 7/14（≈随机，ECE 0.437），
# 换成中文「否 / 是」选项后 10/14，ECE 降到 0.332。
# 选项顺序仍然是 [false, true]，P(是) 取第二个，语义不变。
NOUL_LABELS_ZH: Dict[str, str] = {"false": "否", "true": "是"}
NOUL_CRITERIA_ZH: Dict[str, str] = {
    "false": "否，所述情况不成立",
    "true": "是，所述情况成立",
}


def _prepare_questions(questions: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """把中文决策维度补成模型读得懂的样子（目前只补 noul 的中文选项）。"""
    out: Dict[str, Dict[str, Any]] = {}
    for key, spec in (questions or {}).items():
        s = dict(spec or {})
        if str(s.get("type") or "").lower() == "noul":
            crit = s.get("criteria") if isinstance(s.get("criteria"), dict) else {}
            s["criteria"] = {
                "false": crit.get("false") or crit.get(False) or NOUL_CRITERIA_ZH["false"],
                "true": crit.get("true") or crit.get(True) or NOUL_CRITERIA_ZH["true"],
            }
            if not s.get("labels"):
                s["labels"] = dict(NOUL_LABELS_ZH)
        out[key] = s
    return out


def _softmax_rescale(probs: Dict[str, float], temperature: float) -> Dict[str, float]:
    if not probs or temperature is None or abs(temperature - 1.0) < 1e-6:
        return dict(probs)
    t = max(0.05, float(temperature))
    # 数值稳定：以 log p 为 logits（常数平移不影响 softmax）
    logs = {k: math.log(max(v, 1e-12)) for k, v in probs.items()}
    m = max(logs.values())
    exps = {k: math.exp((v - m) / t) for k, v in logs.items()}
    s = sum(exps.values()) or 1.0
    return {k: v / s for k, v in exps.items()}


class Engine:
    _instance: Optional["Engine"] = None
    _instance_lock = threading.Lock()

    def __init__(self) -> None:
        self.status: str = "idle"  # idle | loading | ready | error
        self.error: Optional[str] = None
        self.agent: Any = None
        self.device: Optional[str] = None
        self.load_seconds: Optional[float] = None
        self.loaded_at: Optional[float] = None
        self.cfg: Dict[str, Any] = {}
        self.calls: int = 0
        self.questions_answered: int = 0
        self.total_ms: float = 0.0
        self._lock = threading.Lock()
        # 推理串行化：MPS / CUDA 上对同一模型并发前向并不安全，
        # 而且单条只要 ~30ms，排队几乎不损失吞吐。
        self._infer_lock = threading.RLock()

    # ─────────────────────────── 单例 ───────────────────────────

    @classmethod
    def get(cls) -> "Engine":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = Engine()
            return cls._instance

    # ─────────────────────────── 加载 ───────────────────────────

    def _pick_device(self) -> str:
        if DEVICE != "auto":
            return DEVICE
        try:
            import torch

            if torch.cuda.is_available():
                return "cuda"
            if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                return "mps"
        except Exception:  # pragma: no cover
            pass
        return "cpu"

    def load(self) -> None:
        with self._lock:
            if self.status == "ready":
                return
            self.status = "loading"
            self.error = None
            t0 = time.time()
            try:
                import laya

                device = self._pick_device()
                self.agent = laya.load(str(WEIGHTS_DIR), device=device)
                self.device = str(getattr(self.agent, "device", device))
                self.cfg = dict(getattr(self.agent, "cfg", {}) or {})
                self.status = "ready"
                self.load_seconds = round(time.time() - t0, 2)
                self.loaded_at = time.time()
            except Exception as exc:  # pragma: no cover
                self.status = "error"
                self.error = f"{type(exc).__name__}: {exc}"
                raise

    def ensure(self) -> None:
        if self.status != "ready":
            self.load()

    # ─────────────────────── 语言 / 脚本分析 ───────────────────────

    def analyse(self, state: State) -> Dict[str, Any]:
        text = _state_to_text(state)
        info: Dict[str, Any] = {"text_chars": len(text)}
        try:
            import laya

            det = laya.detect_language(state) or {}
            info.update(
                {
                    "script": det.get("script"),
                    "script_profile": det.get("script_profile", {}),
                    "language": det.get("language"),
                    "is_english": bool(det.get("is_english")),
                    "undecided": bool(det.get("language_undecided")),
                    "non_latin_fraction": det.get("non_latin_fraction", 0.0),
                }
            )
        except Exception as exc:
            info["error"] = str(exc)
        info["checkpoint"] = CHECKPOINT_NAME
        info["advice"] = _routing_advice(info)
        return info

    # ─────────────────────────── 推理 ───────────────────────────

    def predict(
        self,
        state: State,
        questions: Dict[str, Dict[str, Any]],
        *,
        max_len: Optional[int] = None,
        temperature: Optional[Dict[str, float]] = None,
        policy: Optional[Dict[str, Any]] = None,
        cascade: bool = False,
    ) -> Dict[str, Any]:
        # 级联模式：按问题顺序逐个决策，并把已经得出的结论写回状态，
        # 让后面的原子读得到前面的判断。默认是关闭的——见 _predict_cascade 的说明。
        if cascade and len(questions) > 1:
            return self._predict_cascade(
                state, questions, max_len=max_len, temperature=temperature, policy=policy
            )
        self.ensure()
        t0 = time.time()
        with self._infer_lock:
            result = self.agent.predict(state, _prepare_questions(questions), max_len=max_len or MAX_LEN)
        elapsed = (time.time() - t0) * 1000.0
        with self._lock:
            self.calls += 1
            self.questions_answered += len(questions)
            self.total_ms += elapsed
        return self._shape(result, questions, temperature, policy, elapsed, state)

    def _predict_cascade(
        self,
        state: State,
        questions: Dict[str, Dict[str, Any]],
        *,
        max_len: Optional[int],
        temperature: Optional[Dict[str, float]],
        policy: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """级联推理：每个决策原子单独前向，结论以中文写回状态后交给下一个原子。

        默认架构是**扁平并行**的：所有问题共享同一份 state 编码、彼此看不见对方的答案，
        交换顺序后结果完全一致（已验证）。这对互不相关的维度是对的——快、可解释、可复现。

        但有些问题天生有依赖：先判断「是否疑似钓鱼」，再判断「它用的哪种手法」。
        级联把上游结论追加到 state（字符串追加一段；字典加一个「已判定」字段），
        因此后面的原子读得到前面的答案。实测：同一封钓鱼邮件，独立问「手法」0.72，
        注入「疑似钓鱼=是」后升到 0.90。

        代价：串行、延迟 × 问题数、且前面的错误会顺着链条传播下去。
        """
        t0 = time.time()
        answers: Dict[str, Any] = {}
        done: List[tuple] = []
        usage_in = usage_out = 0
        model = CHECKPOINT_NAME
        cur: State = state
        for key, spec in questions.items():
            res = self.predict(cur, {key: spec}, max_len=max_len, temperature=temperature, policy=policy)
            ans = (res.get("answers") or {}).get(key)
            if ans:
                answers[key] = ans
                done.append((key, _answer_text(ans), ans.get("answer_confidence", 0.0)))
                cur = _state_with_conclusions(state, done)
            usage = res.get("usage") or {}
            usage_in += int(usage.get("input_tokens") or 0)
            usage_out += int(usage.get("output_tokens") or 0)
            model = res.get("model") or model
        confs = [a["answer_confidence"] for a in answers.values()]
        elapsed = (time.time() - t0) * 1000.0
        with self._lock:
            self.calls += 1
            self.questions_answered += len(questions)
            self.total_ms += elapsed
        return {
            "answers": answers,
            "usage": {"input_tokens": usage_in, "output_tokens": usage_out},
            "model": model,
            "elapsed_ms": round(elapsed, 2),
            "verdict": _verdict(answers),
            "avg_confidence": round(sum(confs) / len(confs), 4) if confs else None,
            "min_confidence": round(min(confs), 4) if confs else None,
            "threshold": float((policy or {}).get("threshold", 0.60)),
            "cascade": True,
            "routing": self.analyse(state),
        }

    def predict_batch(
        self,
        states: List[State],
        questions: Dict[str, Dict[str, Any]],
        *,
        batch_size: int = 16,
        max_len: Optional[int] = None,
        temperature: Optional[Dict[str, float]] = None,
        policy: Optional[Dict[str, Any]] = None,
        cascade: bool = False,
    ) -> List[Dict[str, Any]]:
        if cascade and len(questions) > 1:
            # 每条 state 独立串成一条链，链之间互不影响
            return [
                self.predict(
                    st, questions, max_len=max_len, temperature=temperature, policy=policy, cascade=True
                )
                for st in states
            ]
        self.ensure()
        t0 = time.time()
        with self._infer_lock:
            raw = self.agent.predict_batch(
                states, _prepare_questions(questions), batch_size=batch_size or 16, max_len=max_len or MAX_LEN
            )
        elapsed = (time.time() - t0) * 1000.0
        with self._lock:
            self.calls += 1
            self.questions_answered += len(questions) * len(states)
            self.total_ms += elapsed
        share = elapsed / max(1, len(states))
        return [
            self._shape(r, questions, temperature, policy, share, st) for r, st in zip(raw, states)
        ]

    # ─────────────────────── 结果规范化与门控 ───────────────────────

    def _shape(
        self,
        result: Dict[str, Any],
        questions: Dict[str, Dict[str, Any]],
        temperature: Optional[Dict[str, float]],
        policy: Optional[Dict[str, Any]],
        elapsed_ms: float,
        state: State,
    ) -> Dict[str, Any]:
        temperature = temperature or {}
        policy = policy or {}
        threshold = float(policy.get("threshold", 0.60))
        noul_margin = float(policy.get("noul_margin", 0.15))
        auto_act = bool(policy.get("auto_act", True))
        act_keys = set(policy.get("act_keys") or [])
        escalate_keys = set(policy.get("escalate_keys") or [])

        raw_answers = (result or {}).get("answers", {}) or {}
        answers: Dict[str, Any] = {}
        confs: List[float] = []

        for key, spec in questions.items():
            raw = raw_answers.get(key)
            if not raw:
                continue
            qtype = raw.get("type") or spec.get("type")
            temp = float(temperature.get(qtype, 1.0) or 1.0)
            item: Dict[str, Any] = {
                "key": key,
                "type": qtype,
                "instructions": spec.get("instructions", ""),
                "temperature": temp,
            }

            if qtype == "choice":
                probs = _softmax_rescale(dict(raw.get("probabilities") or {}), temp)
                best = max(probs.items(), key=lambda kv: kv[1])
                item.update(
                    {
                        "value": best[0],
                        "display": best[0],
                        "probabilities": _sorted_probs(probs, best[0]),
                        "probabilities_raw": probs,
                    }
                )
                conf = float(probs.get(best[0], 0.0))
            elif qtype == "score":
                probs = _softmax_rescale({str(k): v for k, v in (raw.get("probabilities") or {}).items()}, temp)
                legend = {str(k): v for k, v in (raw.get("legend") or {}).items()}
                best_level = max(probs.items(), key=lambda kv: kv[1])[0] if probs else None
                expected = sum(int(k) * v for k, v in probs.items()) if probs else 0.0
                item.update(
                    {
                        "value": round(float(expected), 4),
                        "level": int(best_level) if best_level is not None else None,
                        "display": legend.get(str(best_level), best_level),
                        "legend": legend,
                        "probabilities": _sorted_probs(probs, best_level),
                        "probabilities_raw": probs,
                    }
                )
                conf = float(probs.get(best_level, 0.0)) if best_level is not None else 0.0
            else:  # noul
                p = float(raw.get("noul", 0.0))
                pair = _softmax_rescale({"false": 1.0 - p, "true": p}, temp)
                p = pair["true"]
                item.update(
                    {
                        "value": round(p, 6),
                        "boolean": p >= 0.5,
                        "display": "true" if p >= 0.5 else "false",
                        "probabilities": [
                            {"label": "true", "p": p, "is_answer": p >= 0.5},
                            {"label": "false", "p": 1.0 - p, "is_answer": p < 0.5},
                        ],
                        "probabilities_raw": pair,
                    }
                )
                conf = max(p, 1.0 - p)

            # 集中度（1 - 归一化熵），与 answer_confidence 一起展示
            item["confidence"] = round(_concentration(item["probabilities_raw"]), 4)
            item["answer_confidence"] = round(conf, 4)
            item["action"] = raw.get("action", {})
            item["gate"] = _gate(
                key=key,
                qtype=qtype,
                conf=conf,
                threshold=threshold,
                noul_margin=noul_margin,
                auto_act=auto_act,
                act_keys=act_keys,
                escalate_keys=escalate_keys,
                value=item.get("value"),
            )
            answers[key] = item
            confs.append(conf)

        return {
            "answers": answers,
            "usage": (result or {}).get("usage", {}),
            "model": (result or {}).get("model", CHECKPOINT_NAME),
            "elapsed_ms": round(elapsed_ms, 2),
            "verdict": _verdict(answers),
            "avg_confidence": round(sum(confs) / len(confs), 4) if confs else None,
            "min_confidence": round(min(confs), 4) if confs else None,
            "threshold": threshold,
            "routing": self.analyse(state),
        }

    # ─────────────────────────── 元信息 ───────────────────────────

    def info(self) -> Dict[str, Any]:
        cfg = self.cfg or {}
        params = None
        try:
            params = _count_params(WEIGHTS_DIR)
        except Exception:
            params = None
        return {
            "status": self.status,
            "error": self.error,
            "checkpoint": CHECKPOINT_NAME,
            "repo": CHECKPOINT_REPO,
            "weights_dir": str(WEIGHTS_DIR),
            "encoder": cfg.get("encoder") or _read_encoder_name(),
            "device": self.device or self._pick_device(),
            "dtype": str(getattr(self.agent, "dtype", "")) if self.agent else None,
            "max_len": cfg.get("max_len", MAX_LEN),
            "head_max_len": cfg.get("head_max_len", 256),
            "context_limit": 8192,
            "parameters": params,
            "temperature_raw": getattr(self.agent, "temperature_raw", [1.0, 1.0, 1.0])
            if self.agent
            else [1.0, 1.0, 1.0],
            "load_seconds": self.load_seconds,
            "calls": self.calls,
            "questions_answered": self.questions_answered,
            "avg_elapsed_ms": round(self.total_ms / self.calls, 2) if self.calls else None,
            "config": cfg,
        }


# ─────────────────────────────── helpers ───────────────────────────────


def _verdict(answers: Dict[str, Any]) -> str:
    if not answers:
        return "act"
    gates = [a["gate"]["decision"] for a in answers.values()]
    if all(g == "escalate" for g in gates):
        return "escalate"
    if any(g == "escalate" for g in gates):
        return "review"
    return "act"


def _answer_text(ans: Dict[str, Any]) -> str:
    """把答案写成中文结论文本，供级联时注入下一个原子的状态。"""
    if ans.get("type") == "noul":
        return "是" if ans.get("boolean") else "否"
    display = ans.get("display")
    return str(display if display not in (None, "") else ans.get("value"))


def _state_with_conclusions(state: State, done: List[tuple]) -> State:
    """把已得结论追加到状态里（字符串加一段，字典加一个「已判定」字段）。"""
    text = "；".join(f"{k}={v}" for k, v, _ in done)
    if isinstance(state, str):
        return f"{state}\n【已判定】{text}"
    if isinstance(state, dict):
        merged = dict(state)
        merged["已判定"] = text
        return merged
    if isinstance(state, list):
        return list(state) + [f"【已判定】{text}"]
    return f"{state}\n【已判定】{text}"


def _sorted_probs(probs: Dict[str, float], answer: Optional[str]) -> List[Dict[str, Any]]:
    items = sorted(probs.items(), key=lambda kv: kv[1], reverse=True)
    return [
        {"label": k, "p": round(float(v), 6), "is_answer": k == answer}
        for k, v in items
    ]


def _concentration(probs: Dict[str, float]) -> float:
    vals = [max(v, 1e-12) for v in probs.values()]
    if not vals:
        return 0.0
    n = len(vals)
    if n <= 1:
        return 1.0
    h = -sum(v * math.log(v) for v in vals)
    hn = h / math.log(n)
    return max(0.0, min(1.0, 1.0 - hn))


def _gate(
    *,
    key: str,
    qtype: str,
    conf: float,
    threshold: float,
    noul_margin: float,
    auto_act: bool,
    act_keys: set,
    escalate_keys: set,
    value: Any,
) -> Dict[str, Any]:
    reasons: List[str] = []
    if key in escalate_keys:
        reasons.append("策略指定该问题必须人工复核")
    elif act_keys and key not in act_keys:
        reasons.append("策略未把该问题列入自动执行白名单")
    if qtype == "noul" and conf < 0.5 + noul_margin:
        reasons.append(f"是非命题概率接近中点（P={value:.2f}），证据不足")
    if conf < threshold:
        reasons.append(f"置信度 {conf:.2f} 低于阈值 {threshold:.2f}")
    if not auto_act and not reasons:
        reasons.append("全局关闭了自动执行")

    decision = "escalate" if reasons else "act"
    return {
        "decision": decision,
        "reason": "；".join(reasons) if reasons else "置信度达到阈值，可自动执行",
        "threshold": threshold,
        "confidence": round(conf, 4),
    }


def _state_to_text(state: State) -> str:
    if isinstance(state, str):
        return state
    if isinstance(state, dict):
        return "\n".join(f"{k}: {v}" for k, v in state.items())
    if isinstance(state, list):
        return "\n".join(str(x) for x in state)
    return str(state)


def _routing_advice(info: Dict[str, Any]) -> str:
    script = info.get("script")
    if script and script != "latin":
        return f"检测到 {script} 文字，本部署的多语言检查点可读；英文检查点在此类文字上会塌缩且仍保持高置信。"
    if info.get("is_english"):
        return "纯英文短文本：官方建议在英文检查点上更强，但本部署仅加载多语言检查点（0.619 vs 0.684）。"
    if info.get("undecided"):
        return "拉丁字母但无法判定语言：默认走了多语言检查点，这是安全的一侧。"
    return "拉丁字母、非英文：多语言检查点为正确选择。"


def _read_encoder_name() -> Optional[str]:
    try:
        import json

        with open(ENCODER_DIR / "config.json", "r", encoding="utf-8") as fh:
            return json.load(fh).get("architectures", [None])[0]
    except Exception:
        return None


def _count_params(weights_dir) -> Optional[int]:
    try:
        from safetensors import safe_open

        total = 0
        with safe_open(str(weights_dir / "model.safetensors"), framework="pt") as f:
            for k in f.keys():
                shape = f.get_slice(k).get_shape()
                n = 1
                for d in shape:
                    n *= d
                total += n
        return total
    except Exception:
        return None


def rl_config() -> Dict[str, Any]:
    try:
        import json

        with open(RL_CONFIG_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


engine = Engine.get()
