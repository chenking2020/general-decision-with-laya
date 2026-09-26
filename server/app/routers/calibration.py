"""标定与门控接口：指标、阈值扫描、温度拟合。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

from .. import calibration as cal
from .. import store

router = APIRouter(prefix="/api/calibration", tags=["calibration"])


def _rows(blueprint_id: Optional[str] = None, qtype: Optional[str] = None) -> List[Dict[str, Any]]:
    rows = store.labelled_rows()
    if blueprint_id:
        rows = [r for r in rows if r.get("blueprint_id") == blueprint_id]
    if qtype:
        rows = [r for r in rows if r.get("type") == qtype]
    return rows


@router.get("/rows")
def rows(blueprint_id: Optional[str] = None, qtype: Optional[str] = None,
         limit: int = 200) -> Dict[str, Any]:
    data = _rows(blueprint_id, qtype)[:limit]
    return {"items": data, "count": len(data)}


@router.post("/metrics")
def metrics(payload: Dict[str, Any]) -> Dict[str, Any]:
    temperature = payload.get("temperature") or store.get_settings().get("temperature")
    data = _rows(payload.get("blueprint_id"), payload.get("type"))
    return {"metrics": cal.metrics(data, temperature), "n": len(data)}


@router.post("/sweep")
def sweep(payload: Dict[str, Any]) -> Dict[str, Any]:
    temperature = payload.get("temperature") or store.get_settings().get("temperature")
    data = _rows(payload.get("blueprint_id"), payload.get("type"))
    return {
        "curve": cal.sweep(data, temperature, steps=int(payload.get("steps", 40) or 40)),
        "n": len(data),
        "metrics": cal.metrics(data, temperature),
    }


@router.post("/fit")
def fit(payload: Dict[str, Any]) -> Dict[str, Any]:
    data = _rows(payload.get("blueprint_id"), payload.get("type"))
    if not data:
        raise HTTPException(status_code=400, detail="还没有人工反馈样本，先在决策账本里给答案打标")
    return {"fit": cal.fit_temperature(data), "n": len(data), "metrics": cal.metrics(data)}


@router.post("/apply")
def apply_temperature(payload: Dict[str, Any]) -> Dict[str, Any]:
    temps = payload.get("temperature")
    if not isinstance(temps, dict):
        raise HTTPException(status_code=400, detail="temperature 必须是 {choice,score,noul} 映射")
    clean = {}
    for k in ("choice", "score", "noul"):
        if k in temps:
            try:
                clean[k] = float(temps[k])
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{k} 不是数字")
    current = store.get_settings()
    merged = {**current.get("temperature", {}), **clean}
    settings = store.put_settings({"temperature": merged})
    return {"ok": True, "settings": settings}
