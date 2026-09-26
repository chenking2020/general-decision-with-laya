"""平台元信息、引擎状态与设置。"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from .. import engine as engine_mod
from .. import store
from ..config import DEFAULT_THRESHOLD, MAX_LEN, PLATFORM_NAME, PLATFORM_TAGLINE
from ..schemas import State

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/meta")
def meta() -> Dict[str, Any]:
    eng = engine_mod.engine
    info = eng.info()
    info["platform"] = {"name": PLATFORM_NAME, "tagline": PLATFORM_TAGLINE}
    info["settings"] = store.get_settings()
    info["runtime"] = {"max_len": MAX_LEN, "default_threshold": DEFAULT_THRESHOLD}
    return info


@router.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "status": engine_mod.engine.status}


@router.post("/engine/preload")
def preload() -> Dict[str, Any]:
    eng = engine_mod.engine
    try:
        eng.load()
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc))
    return {"status": eng.status, **eng.info()}


@router.post("/route")
def route(payload: Dict[str, Any]) -> Dict[str, Any]:
    """只做脚本 / 语言分析，不跑前向传播（亚毫秒）。"""
    state: State = payload.get("state", "")
    return engine_mod.engine.analyse(state)


@router.get("/settings")
def get_settings() -> Dict[str, Any]:
    return store.get_settings()


@router.put("/settings")
def put_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    allowed = {"threshold", "temperature", "auto_act", "noul_margin"}
    clean = {k: v for k, v in (patch or {}).items() if k in allowed}
    return store.put_settings(clean)
