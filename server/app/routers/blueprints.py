"""决策蓝图库：内置 + 自定义，支持增删改与克隆。"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

from .. import store

router = APIRouter(prefix="/api/blueprints", tags=["blueprints"])


@router.get("")
def list_blueprints(domain: Optional[str] = None) -> Dict[str, Any]:
    items = store.list_blueprints()
    domains: List[str] = []
    for bp in items:
        if bp["domain"] not in domains:
            domains.append(bp["domain"])
    if domain:
        items = [bp for bp in items if bp["domain"] == domain]
    return {"items": items, "domains": domains, "count": len(items)}


@router.get("/{bp_id}")
def get_blueprint(bp_id: str) -> Dict[str, Any]:
    bp = store.get_blueprint(bp_id)
    if not bp:
        raise HTTPException(status_code=404, detail="蓝图不存在")
    return bp


@router.post("")
def create_blueprint(payload: Dict[str, Any]) -> Dict[str, Any]:
    name = (payload.get("name") or "").strip()
    questions = payload.get("questions") or {}
    if not name:
        raise HTTPException(status_code=400, detail="缺少 name")
    if not isinstance(questions, dict) or not questions:
        raise HTTPException(status_code=400, detail="至少需要一个类型化问题")
    _validate_questions(questions)
    bp = {
        "id": payload.get("id") or f"custom-{uuid.uuid4().hex[:8]}",
        "name": name,
        "domain": payload.get("domain") or "自定义",
        "description": payload.get("description", ""),
        "questions": questions,
        "state_hint": payload.get("state_hint") or {},
        "sample_states": payload.get("sample_states") or [],
        "policy": payload.get("policy") or {},
        "tags": payload.get("tags") or [],
        "builtin": False,
    }
    store.save_blueprint(bp)
    return bp


@router.put("/{bp_id}")
def update_blueprint(bp_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    existing = store.get_blueprint(bp_id)
    if not existing:
        raise HTTPException(status_code=404, detail="蓝图不存在")
    if existing.get("builtin"):
        # 内置蓝图不允许覆盖，改为保存为用户副本
        new_id = f"{bp_id}-copy-{uuid.uuid4().hex[:4]}"
        payload["id"] = new_id
        payload["builtin"] = False
        payload["name"] = payload.get("name") or f"{existing['name']}（副本）"
        _validate_questions(payload.get("questions") or existing["questions"])
        merged = {**existing, **payload}
        store.save_blueprint(merged)
        return merged
    _validate_questions(payload.get("questions") or existing["questions"])
    merged = {**existing, **payload, "id": bp_id, "builtin": False}
    store.save_blueprint(merged)
    return merged


@router.delete("/{bp_id}")
def delete_blueprint(bp_id: str) -> Dict[str, Any]:
    bp = store.get_blueprint(bp_id)
    if not bp:
        raise HTTPException(status_code=404, detail="蓝图不存在")
    if bp.get("builtin"):
        raise HTTPException(status_code=400, detail="内置蓝图不可删除，可另存为副本后修改")
    store.delete_blueprint(bp_id)
    return {"ok": True}


def _validate_questions(questions: Dict[str, Any]) -> None:
    """把编写问题时的常见坑挡在门外（laya 的实测结论）。"""
    for key, spec in questions.items():
        qtype = spec.get("type")
        if qtype not in ("choice", "score", "noul"):
            raise HTTPException(status_code=400, detail=f"问题 {key} 的类型必须是 choice / score / noul")
        if not spec.get("instructions"):
            raise HTTPException(status_code=400, detail=f"问题 {key} 缺少 instructions")
        criteria = spec.get("criteria")
        if qtype == "choice":
            if not isinstance(criteria, dict) or len(criteria) < 2:
                raise HTTPException(status_code=400, detail=f"choice 问题 {key} 需要至少 2 个带描述的选项")
            if len(criteria) > 20:
                raise HTTPException(
                    status_code=400,
                    detail=f"choice 问题 {key} 有 {len(criteria)} 个选项：超过 20 个会因 token 预算被截断，准确率骤降",
                )
            for label in criteria:
                if str(label).strip().lower() in {"true", "false", "yes", "no"}:
                    raise HTTPException(
                        status_code=400,
                        detail=f"选项 {label} 是真值词：模型会跟着标签走而不是跟着内容走，请改用语义标签或 A/B",
                    )
        elif qtype == "score":
            if not isinstance(criteria, list) or len(criteria) < 2:
                raise HTTPException(status_code=400, detail=f"score 问题 {key} 需要 2-5 个等级描述")
            if len(criteria) > 5:
                raise HTTPException(status_code=400, detail=f"score 问题 {key} 等级过多（>5），这是最弱的原语")
