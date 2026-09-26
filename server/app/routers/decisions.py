"""决策接口：单条 / 批量 / 数据导入。"""

from __future__ import annotations

import csv
import io
import json
import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from .. import engine as engine_mod
from .. import store
from ..engine import _state_to_text
from ..schemas import BatchRequest, DecideRequest

router = APIRouter(prefix="/api", tags=["decisions"])


def _merge_policy(policy: Dict[str, Any] | None) -> Dict[str, Any]:
    settings = store.get_settings()
    merged: Dict[str, Any] = {
        "threshold": settings.get("threshold", 0.60),
        "auto_act": settings.get("auto_act", True),
        "noul_margin": settings.get("noul_margin", 0.15),
        "act_keys": [],
        "escalate_keys": [],
        "cascade": False,
        "note": "",
    }
    if policy:
        merged.update({k: v for k, v in policy.items() if v is not None})
    return merged


def _temperatures() -> Dict[str, float]:
    raw = store.get_settings().get("temperature", {}) or {}
    return {k: float(v) for k, v in raw.items()}


def _record(result: Dict[str, Any], state: Any, questions: Dict[str, Any], req: Any,
            mode: str, batch_id: str | None = None, ref: str | None = None) -> str:
    routing = result.get("routing", {})
    return store.save_decision(
        {
            "mode": mode,
            "batch_id": batch_id,
            "blueprint_id": getattr(req, "blueprint_id", None),
            "blueprint_name": getattr(req, "blueprint_name", None),
            "domain": getattr(req, "domain", None),
            "state_text": _state_to_text(state)[:4000],
            "state_json": state if isinstance(state, (dict, list)) else None,
            "questions": questions,
            "answers": result["answers"],
            "result": {"usage": result.get("usage"), "model": result.get("model"), "ref": ref},
            "verdict": result.get("verdict"),
            "avg_confidence": result.get("avg_confidence"),
            "min_confidence": result.get("min_confidence"),
            "threshold": result.get("threshold"),
            "elapsed_ms": result.get("elapsed_ms"),
            "usage": result.get("usage"),
            "device": engine_mod.engine.device,
            "script": routing.get("script"),
            "language": routing.get("language"),
            "tags": getattr(req, "tags", []) or [],
        }
    )


@router.post("/decide")
def decide(req: DecideRequest) -> Dict[str, Any]:
    eng = engine_mod.engine
    policy = _merge_policy(req.policy.model_dump() if req.policy else None)
    try:
        result = eng.predict(
            req.state,
            req.questions,
            max_len=req.max_len,
            temperature=_temperatures(),
            policy=policy,
            cascade=bool(policy.get("cascade")),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")
    decision_id = None
    if req.record:
        decision_id = _record(result, req.state, req.questions, req, "single")
    return {**result, "decision_id": decision_id, "policy": policy}


@router.post("/decide/batch")
def decide_batch(req: BatchRequest) -> Dict[str, Any]:
    eng = engine_mod.engine
    if not req.items:
        raise HTTPException(status_code=400, detail="items 为空")
    policy = _merge_policy(req.policy.model_dump() if req.policy else None)
    states = [it.state for it in req.items]
    try:
        results = eng.predict_batch(
            states,
            req.questions,
            batch_size=req.batch_size,
            max_len=req.max_len,
            temperature=_temperatures(),
            policy=policy,
            cascade=bool(policy.get("cascade")),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")

    batch_id = uuid.uuid4().hex[:12]
    rows: List[Dict[str, Any]] = []
    verdicts = {"act": 0, "review": 0, "escalate": 0}
    for it, res in zip(req.items, results):
        decision_id = None
        if req.record:
            decision_id = _record(res, it.state, req.questions, req, "batch", batch_id, it.ref)
        v = res.get("verdict", "review")
        verdicts[v] = verdicts.get(v, 0) + 1
        rows.append(
            {
                "decision_id": decision_id,
                "ref": it.ref,
                "state_text": _state_to_text(it.state)[:600],
                "verdict": v,
                "avg_confidence": res.get("avg_confidence"),
                "min_confidence": res.get("min_confidence"),
                "answers": res["answers"],
                "elapsed_ms": res.get("elapsed_ms"),
                "routing": res.get("routing", {}).get("script"),
            }
        )
    return {
        "batch_id": batch_id,
        "count": len(rows),
        "rows": rows,
        "verdicts": verdicts,
        "policy": policy,
        "questions": req.questions,
    }


class _IngestPayload(Dict[str, Any]):
    pass


@router.post("/ingest/parse")
def ingest_parse(payload: Dict[str, Any]) -> Dict[str, Any]:
    """把 CSV / JSONL / JSON 数组文本解析成批量条目。"""
    fmt = (payload.get("format") or "auto").lower()
    text = payload.get("text") or ""
    text_field = payload.get("text_field")  # CSV 时把整行合并进哪个字段
    items: List[Dict[str, Any]] = []

    if not text.strip():
        return {"items": [], "count": 0, "fields": []}

    if fmt == "auto":
        stripped = text.lstrip()
        if stripped.startswith("[") or stripped.startswith("{"):
            fmt = "json"
        elif "\n" in text and ("," in text.split("\n")[0]):
            fmt = "csv"
        else:
            fmt = "lines"

    try:
        if fmt == "csv":
            reader = csv.DictReader(io.StringIO(text))
            fields = list(reader.fieldnames or [])
            for i, row in enumerate(reader):
                row = {k: (v if v is not None else "") for k, v in row.items()}
                if text_field and text_field in row:
                    items.append({"state": row[text_field], "ref": row.get("id") or f"row-{i+1}"})
                else:
                    items.append({"state": row, "ref": row.get("id") or f"row-{i+1}"})
            return {"items": items, "count": len(items), "fields": fields, "format": "csv"}
        if fmt == "json":
            data = json.loads(text)
            if isinstance(data, dict):
                data = [data]
            for i, row in enumerate(data):
                if isinstance(row, str):
                    items.append({"state": row, "ref": f"item-{i+1}"})
                else:
                    state = row.get("state", row)
                    items.append({"state": state, "ref": row.get("id") or row.get("ref") or f"item-{i+1}"})
            return {"items": items, "count": len(items), "fields": [], "format": "json"}
        # lines
        for i, line in enumerate(text.splitlines()):
            line = line.strip()
            if not line:
                continue
            items.append({"state": line, "ref": f"line-{i+1}"})
        return {"items": items, "count": len(items), "fields": [], "format": "lines"}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"解析失败：{type(exc).__name__}: {exc}")
