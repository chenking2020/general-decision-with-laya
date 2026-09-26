"""标定与门控：把「概率」变成「可用的策略」。

Laya 用严格适当评分规则（RLCD）训练，所以概率本身是有统计意义的；但它出厂未标定，
整体偏自信（平均置信 0.75–0.83，而真实准确率低得多）。本模块做三件事：

  1. ``metrics``  —— 在人工反馈样本上算准确率 / MAE / ECE / Brier / 平均置信；
  2. ``sweep``    —— 扫描置信阈值，给出「覆盖率 ↔ 准确率」权衡曲线，让阈值成为
                     一个**可选择的策略**，而不是拍脑袋的常数；
  3. ``fit_temperature`` —— 为每个问题类型拟合一个温度，把 ECE 压下来
                     （官方实测：0.314 → 0.106）。
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence

from .engine import _softmax_rescale  # 概率温度缩放


def _row_truth(row: Dict[str, Any]) -> Optional[str]:
    return str(row.get("truth")) if row.get("truth") is not None else None


def _eval_row(row: Dict[str, Any], temperature: float = 1.0) -> Optional[Dict[str, Any]]:
    """返回 {correct, confidence, p_true, error, brier}，无法评估时返回 None。"""
    qtype = row.get("type")
    probs = {str(k): float(v) for k, v in (row.get("probabilities") or {}).items()}
    truth = _row_truth(row)
    if truth is None:
        return None

    if qtype == "choice":
        if truth not in probs:
            return None
        probs = _softmax_rescale(probs, temperature)
        pred = max(probs.items(), key=lambda kv: kv[1])[0]
        p_true = probs.get(truth, 0.0)
        correct = 1.0 if str(pred) == truth else 0.0
        conf = max(probs.values())
        brier = sum((v - (1.0 if k == truth else 0.0)) ** 2 for k, v in probs.items())
        return {"correct": correct, "confidence": conf, "p_true": p_true, "error": 0.0, "brier": brier}

    if qtype == "noul":
        truth_bool = truth.strip().lower() in {"true", "1", "yes", "y", "t"}
        pair = _softmax_rescale({"false": 1.0 - float(row.get("prediction") or 0.0),
                                 "true": float(row.get("prediction") or 0.0)}, temperature)
        p = pair["true"]
        if "true" in probs and "false" in probs:
            pair = _softmax_rescale(probs, temperature)
            p = pair["true"]
        p_true = p if truth_bool else 1.0 - p
        correct = 1.0 if (p >= 0.5) == truth_bool else 0.0
        conf = max(p, 1.0 - p)
        brier = (p - (1.0 if truth_bool else 0.0)) ** 2 + ((1.0 - p) - (0.0 if truth_bool else 1.0)) ** 2
        return {"correct": correct, "confidence": conf, "p_true": p_true, "error": 0.0, "brier": brier}

    if qtype == "score":
        try:
            truth_level = int(float(truth))
        except ValueError:
            return None
        probs = _softmax_rescale(probs, temperature)
        if not probs:
            return None
        expected = sum(int(k) * v for k, v in probs.items())
        pred_level = max(probs.items(), key=lambda kv: kv[1])[0]
        conf = max(probs.values())
        p_true = probs.get(str(truth_level), 0.0)
        correct = 1.0 if int(pred_level) == truth_level else 0.0
        return {
            "correct": correct,
            "confidence": conf,
            "p_true": p_true,
            "error": abs(expected - truth_level),
            "brier": sum((v - (1.0 if int(k) == truth_level else 0.0)) ** 2 for k, v in probs.items()),
        }
    return None


def ece(pairs: Sequence[tuple], bins: int = 10) -> float:
    """期望校准误差：按置信度分箱，|平均置信 - 平均正确率| 的加权平均。"""
    if not pairs:
        return 0.0
    buckets: List[List[tuple]] = [[] for _ in range(bins)]
    for conf, correct in pairs:
        i = min(bins - 1, max(0, int(float(conf) * bins)))
        buckets[i].append((float(conf), float(correct)))
    total = len(pairs)
    acc = 0.0
    for b in buckets:
        if not b:
            continue
        acc += (len(b) / total) * abs(sum(c for c, _ in b) / len(b) - sum(y for _, y in b) / len(b))
    return acc


def metrics(rows: List[Dict[str, Any]], temperature: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    temperature = temperature or {}
    per_type: Dict[str, List[Dict[str, Any]]] = {}
    samples = 0
    for row in rows:
        t = float(temperature.get(row.get("type"), 1.0) or 1.0)
        ev = _eval_row(row, t)
        if ev is None:
            continue
        samples += 1
        per_type.setdefault(str(row.get("type")), []).append(ev)

    overall_pairs = [(e["confidence"], e["correct"]) for evs in per_type.values() for e in evs]
    out: Dict[str, Any] = {
        "samples": samples,
        "accuracy": _mean([c for _, c in overall_pairs]) if overall_pairs else None,
        "mean_confidence": _mean([c for c, _ in overall_pairs]) if overall_pairs else None,
        "ece": ece(overall_pairs) if overall_pairs else None,
        "brier": None,
        "per_type": {},
    }
    briers = [e["brier"] for evs in per_type.values() for e in evs]
    out["brier"] = _mean(briers) if briers else None

    for qtype, evs in per_type.items():
        entry: Dict[str, Any] = {
            "n": len(evs),
            "accuracy": _mean([e["correct"] for e in evs]),
            "mean_confidence": _mean([e["confidence"] for e in evs]),
            "ece": ece([(e["confidence"], e["correct"]) for e in evs]),
            "brier": _mean([e["brier"] for e in evs]),
        }
        if qtype == "score":
            entry["mae"] = _mean([e["error"] for e in evs])
        out["per_type"][qtype] = entry
    return out


def sweep(rows: List[Dict[str, Any]], temperature: Optional[Dict[str, float]] = None,
          steps: int = 40) -> List[Dict[str, Any]]:
    """阈值扫描：从 0 到 0.98，给出每个阈值下的覆盖率、准确率、ECE、平均置信。"""
    temperature = temperature or {}
    evals: List[Dict[str, Any]] = []
    for row in rows:
        t = float(temperature.get(row.get("type"), 1.0) or 1.0)
        ev = _eval_row(row, t)
        if ev is None:
            continue
        ev["type"] = row.get("type")
        evals.append(ev)
    if not evals:
        return []

    curve = []
    for i in range(steps):
        thr = round(0.02 * i, 4)
        covered = [e for e in evals if e["confidence"] >= thr]
        n = len(covered)
        curve.append(
            {
                "threshold": thr,
                "coverage": n / len(evals) if evals else 0.0,
                "count": n,
                "accuracy": _mean([e["correct"] for e in covered]) if n else None,
                "mean_confidence": _mean([e["confidence"] for e in covered]) if n else None,
                "ece": ece([(e["confidence"], e["correct"]) for e in covered]) if n else None,
            }
        )
    return curve


def _nll(rows: List[Dict[str, Any]], qtype: str, temperature: float) -> float:
    total = 0.0
    n = 0
    for row in rows:
        if row.get("type") != qtype:
            continue
        ev = _eval_row(row, temperature)
        if ev is None:
            continue
        total += -math.log(max(ev["p_true"], 1e-9))
        n += 1
    return total / n if n else float("inf")


def fit_temperature(rows: List[Dict[str, Any]], lo: float = 0.5, hi: float = 5.0) -> Dict[str, Any]:
    """为每个问题类型拟合温度：最小化负对数似然（黄金分割搜索）。

    只有概率没有 logits，但温度缩放对 logits 的常数平移不变，
    因此用 ``log p`` 作为 logits 是等价的。
    """
    out: Dict[str, Any] = {}
    for qtype in ("choice", "score", "noul"):
        subset = [r for r in rows if r.get("type") == qtype]
        usable = [r for r in subset if _eval_row(r, 1.0) is not None]
        if len(usable) < 8:
            out[qtype] = {
                "temperature": 1.0,
                "n": len(usable),
                "fitted": False,
                "note": "样本不足（<8），保持中性温度 1.0",
            }
            continue
        a, b = lo, hi
        gr = (math.sqrt(5) - 1) / 2
        c, d = b - gr * (b - a), a + gr * (b - a)
        fc, fd = _nll(usable, qtype, c), _nll(usable, qtype, d)
        for _ in range(60):
            if fc < fd:
                b, d, fd = d, c, fc
                c = b - gr * (b - a)
                fc = _nll(usable, qtype, c)
            else:
                a, c, fc = c, d, fd
                d = a + gr * (b - a)
                fd = _nll(usable, qtype, d)
            if abs(b - a) < 1e-3:
                break
        best = (a + b) / 2
        before = metrics(usable, {qtype: 1.0})
        after = metrics(usable, {qtype: best})
        out[qtype] = {
            "temperature": round(best, 3),
            "n": len(usable),
            "fitted": True,
            "note": ("样本少于 30 条，温度很容易过拟合；补齐样本后再应用到生产。" if len(usable) < 30 else None),
            "nll_before": round(_nll(usable, qtype, 1.0), 4),
            "nll_after": round(_nll(usable, qtype, best), 4),
            "ece_before": before["ece"],
            "ece_after": after["ece"],
            "brier_before": before["brier"],
            "brier_after": after["brier"],
        }
    return out


def _mean(xs: Sequence[float]) -> Optional[float]:
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 4) if xs else None
