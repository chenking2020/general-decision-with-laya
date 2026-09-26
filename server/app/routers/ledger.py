"""决策账本：每一次决策都留痕，可回溯、可标注、可复核。"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException

from .. import store
from ..schemas import FeedbackIn

router = APIRouter(prefix="/api/ledger", tags=["ledger"])


@router.get("")
def list_decisions(
    limit: int = 100,
    offset: int = 0,
    blueprint_id: Optional[str] = None,
    verdict: Optional[str] = None,
    batch_id: Optional[str] = None,
    q: Optional[str] = None,
) -> Dict[str, Any]:
    rows = store.list_decisions(limit=limit, offset=offset, blueprint_id=blueprint_id,
                                verdict=verdict, batch_id=batch_id, q=q)
    for r in rows:
        r["feedback"] = store.get_feedback(r["id"])
    return {"items": rows, "count": len(rows)}


@router.get("/stats")
def stats() -> Dict[str, Any]:
    return store.decision_stats()


@router.get("/{decision_id}")
def get_decision(decision_id: str) -> Dict[str, Any]:
    row = store.get_decision(decision_id)
    if not row:
        raise HTTPException(status_code=404, detail="记录不存在")
    row["feedback"] = store.get_feedback(decision_id)
    return row


@router.delete("/{decision_id}")
def delete_decision(decision_id: str) -> Dict[str, Any]:
    store.delete_decision(decision_id)
    return {"ok": True}


@router.delete("")
def clear() -> Dict[str, Any]:
    store.clear_decisions()
    return {"ok": True}


@router.post("/{decision_id}/feedback")
def set_feedback(decision_id: str, body: FeedbackIn) -> Dict[str, Any]:
    if not store.get_decision(decision_id):
        raise HTTPException(status_code=404, detail="记录不存在")
    store.set_feedback(decision_id, body.question_key, body.truth)
    return {"ok": True, "feedback": store.get_feedback(decision_id)}


@router.delete("/{decision_id}/feedback/{question_key}")
def remove_feedback(decision_id: str, question_key: str) -> Dict[str, Any]:
    store.delete_feedback(decision_id, question_key)
    return {"ok": True, "feedback": store.get_feedback(decision_id)}
