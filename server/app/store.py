"""轻量持久化层：SQLite（决策账本 / 反馈 / 自定义蓝图 / 设置）。

不引入 ORM，保持零额外依赖、单文件可拷贝。
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .blueprints_data import BUILTIN_BLUEPRINTS
from .config import DB_PATH


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS decisions (
                id             TEXT PRIMARY KEY,
                created_at     TEXT NOT NULL,
                mode           TEXT NOT NULL,
                batch_id       TEXT,
                blueprint_id   TEXT,
                blueprint_name TEXT,
                domain         TEXT,
                state_text     TEXT,
                state_json     TEXT,
                questions_json TEXT NOT NULL,
                answers_json   TEXT NOT NULL,
                result_json    TEXT,
                verdict        TEXT,
                avg_confidence REAL,
                min_confidence REAL,
                threshold      REAL,
                elapsed_ms     REAL,
                usage_json     TEXT,
                device         TEXT,
                script         TEXT,
                language       TEXT,
                tags           TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_decisions_batch ON decisions(batch_id);

            CREATE TABLE IF NOT EXISTS feedback (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                decision_id  TEXT NOT NULL,
                question_key TEXT NOT NULL,
                truth        TEXT NOT NULL,
                created_at   TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_feedback_decision ON feedback(decision_id);

            CREATE TABLE IF NOT EXISTS blueprints (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                domain        TEXT,
                description   TEXT,
                questions     TEXT NOT NULL,
                state_hint    TEXT,
                sample_states TEXT,
                policy        TEXT,
                tags          TEXT,
                builtin       INTEGER DEFAULT 0,
                created_at    TEXT,
                updated_at    TEXT
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )


# ─────────────────────────────── decisions ───────────────────────────────


def save_decision(row: Dict[str, Any]) -> str:
    rid = row.get("id") or uuid.uuid4().hex[:16]
    with connect() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO decisions
               (id, created_at, mode, batch_id, blueprint_id, blueprint_name, domain,
                state_text, state_json, questions_json, answers_json, result_json,
                verdict, avg_confidence, min_confidence, threshold, elapsed_ms,
                usage_json, device, script, language, tags)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                rid,
                row.get("created_at") or _now(),
                row.get("mode", "single"),
                row.get("batch_id"),
                row.get("blueprint_id"),
                row.get("blueprint_name"),
                row.get("domain"),
                row.get("state_text", ""),
                json.dumps(row.get("state_json"), ensure_ascii=False)
                if row.get("state_json") is not None
                else None,
                json.dumps(row.get("questions", {}), ensure_ascii=False),
                json.dumps(row.get("answers", {}), ensure_ascii=False),
                json.dumps(row.get("result", {}), ensure_ascii=False)
                if row.get("result") is not None
                else None,
                row.get("verdict"),
                row.get("avg_confidence"),
                row.get("min_confidence"),
                row.get("threshold"),
                row.get("elapsed_ms"),
                json.dumps(row.get("usage", {}), ensure_ascii=False),
                row.get("device"),
                row.get("script"),
                row.get("language"),
                json.dumps(row.get("tags", []), ensure_ascii=False),
            ),
        )
    return rid


def _row_to_decision(r: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": r["id"],
        "created_at": r["created_at"],
        "mode": r["mode"],
        "batch_id": r["batch_id"],
        "blueprint_id": r["blueprint_id"],
        "blueprint_name": r["blueprint_name"],
        "domain": r["domain"],
        "state_text": r["state_text"],
        "state_json": _j(r["state_json"]),
        "questions": _j(r["questions_json"], {}),
        "answers": _j(r["answers_json"], {}),
        "result": _j(r["result_json"]),
        "verdict": r["verdict"],
        "avg_confidence": r["avg_confidence"],
        "min_confidence": r["min_confidence"],
        "threshold": r["threshold"],
        "elapsed_ms": r["elapsed_ms"],
        "usage": _j(r["usage_json"], {}),
        "device": r["device"],
        "script": r["script"],
        "language": r["language"],
        "tags": _j(r["tags"], []),
    }


def _j(s: Optional[str], default: Any = None) -> Any:
    if not s:
        return default
    try:
        return json.loads(s)
    except Exception:
        return default


def list_decisions(
    limit: int = 100,
    offset: int = 0,
    blueprint_id: Optional[str] = None,
    verdict: Optional[str] = None,
    batch_id: Optional[str] = None,
    q: Optional[str] = None,
) -> List[Dict[str, Any]]:
    where, args = [], []
    if blueprint_id:
        where.append("blueprint_id = ?")
        args.append(blueprint_id)
    if verdict:
        where.append("verdict = ?")
        args.append(verdict)
    if batch_id:
        where.append("batch_id = ?")
        args.append(batch_id)
    if q:
        where.append("(state_text LIKE ? OR blueprint_name LIKE ?)")
        args += [f"%{q}%", f"%{q}%"]
    sql = "SELECT * FROM decisions"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    with connect() as conn:
        return [_row_to_decision(r) for r in conn.execute(sql, args)]


def get_decision(decision_id: str) -> Optional[Dict[str, Any]]:
    with connect() as conn:
        r = conn.execute("SELECT * FROM decisions WHERE id = ?", (decision_id,)).fetchone()
    return _row_to_decision(r) if r else None


def delete_decision(decision_id: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM decisions WHERE id = ?", (decision_id,))
        conn.execute("DELETE FROM feedback WHERE decision_id = ?", (decision_id,))


def clear_decisions() -> None:
    with connect() as conn:
        conn.execute("DELETE FROM decisions")
        conn.execute("DELETE FROM feedback")


def decision_stats() -> Dict[str, Any]:
    with connect() as conn:
        total = conn.execute("SELECT COUNT(*) c FROM decisions").fetchone()["c"]
        by_verdict = {
            r["verdict"]: r["c"]
            for r in conn.execute(
                "SELECT COALESCE(verdict,'unknown') verdict, COUNT(*) c FROM decisions GROUP BY verdict"
            )
        }
        agg = conn.execute(
            "SELECT AVG(avg_confidence) ac, AVG(min_confidence) mc, AVG(elapsed_ms) ms FROM decisions"
        ).fetchone()
        by_domain = [
            {"domain": r["domain"] or "未分类", "count": r["c"]}
            for r in conn.execute(
                "SELECT domain, COUNT(*) c FROM decisions GROUP BY domain ORDER BY c DESC LIMIT 12"
            )
        ]
        recent = [
            {"created_at": r["created_at"], "count": r["c"]}
            for r in conn.execute(
                "SELECT substr(created_at,1,10) created_at, COUNT(*) c FROM decisions GROUP BY substr(created_at,1,10) ORDER BY created_at DESC LIMIT 14"
            )
        ]
        conf_buckets = [0.0] * 10
        for r in conn.execute("SELECT avg_confidence c FROM decisions WHERE avg_confidence IS NOT NULL"):
            i = min(9, max(0, int((r["c"] or 0) * 10)))
            conf_buckets[i] += 1
        langs = [
            {"script": r["script"] or "unknown", "count": r["c"]}
            for r in conn.execute(
                "SELECT script, COUNT(*) c FROM decisions GROUP BY script ORDER BY c DESC LIMIT 8"
            )
        ]
        feedback_n = conn.execute("SELECT COUNT(*) c FROM feedback").fetchone()["c"]
    return {
        "total": total,
        "by_verdict": by_verdict,
        "avg_confidence": agg["ac"],
        "avg_min_confidence": agg["mc"],
        "avg_elapsed_ms": agg["ms"],
        "by_domain": by_domain,
        "by_day": list(reversed(recent)),
        "confidence_histogram": conf_buckets,
        "by_script": langs,
        "feedback_count": feedback_n,
    }


# ─────────────────────────────── feedback ───────────────────────────────


def set_feedback(decision_id: str, question_key: str, truth: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM feedback WHERE decision_id=? AND question_key=?", (decision_id, question_key))
        conn.execute(
            "INSERT INTO feedback (decision_id, question_key, truth, created_at) VALUES (?,?,?,?)",
            (decision_id, question_key, truth, _now()),
        )


def delete_feedback(decision_id: str, question_key: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM feedback WHERE decision_id=? AND question_key=?", (decision_id, question_key))


def get_feedback(decision_id: str) -> Dict[str, str]:
    with connect() as conn:
        return {
            r["question_key"]: r["truth"]
            for r in conn.execute("SELECT question_key, truth FROM feedback WHERE decision_id=?", (decision_id,))
        }


def labelled_rows(limit: int = 5000) -> List[Dict[str, Any]]:
    """把人工反馈与当时的预测拼接成标定样本。"""
    out: List[Dict[str, Any]] = []
    with connect() as conn:
        rows = conn.execute(
            """SELECT d.id, d.created_at, d.blueprint_id, d.blueprint_name, d.answers_json,
                      d.questions_json, d.state_text, f.question_key, f.truth
               FROM feedback f JOIN decisions d ON d.id = f.decision_id
               ORDER BY f.id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    for r in rows:
        answers = _j(r["answers_json"], {}) or {}
        questions = _j(r["questions_json"], {}) or {}
        key = r["question_key"]
        ans = answers.get(key)
        spec = questions.get(key, {})
        if not ans:
            continue
        out.append(
            {
                "decision_id": r["id"],
                "created_at": r["created_at"],
                "blueprint_id": r["blueprint_id"],
                "blueprint_name": r["blueprint_name"],
                "question_key": key,
                "type": ans.get("type") or spec.get("type"),
                "prediction": ans.get("value"),
                "confidence": ans.get("answer_confidence"),
                "probabilities": ans.get("probabilities_raw") or {},
                "truth": r["truth"],
                "state_text": (r["state_text"] or "")[:400],
            }
        )
    return out


# ─────────────────────────────── blueprints ───────────────────────────────


def list_blueprints() -> List[Dict[str, Any]]:
    custom = []
    with connect() as conn:
        for r in conn.execute("SELECT * FROM blueprints ORDER BY created_at DESC"):
            custom.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "domain": r["domain"],
                    "description": r["description"],
                    "questions": _j(r["questions"], {}),
                    "state_hint": _j(r["state_hint"], {}),
                    "sample_states": _j(r["sample_states"], []),
                    "policy": _j(r["policy"], {}),
                    "tags": _j(r["tags"], []),
                    "builtin": bool(r["builtin"]),
                    "created_at": r["created_at"],
                    "updated_at": r["updated_at"],
                }
            )
    return [*BUILTIN_BLUEPRINTS, *custom]


def get_blueprint(bp_id: str) -> Optional[Dict[str, Any]]:
    for bp in list_blueprints():
        if bp["id"] == bp_id:
            return bp
    return None


def save_blueprint(bp: Dict[str, Any]) -> str:
    bid = bp.get("id") or uuid.uuid4().hex[:10]
    now = _now()
    with connect() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO blueprints
               (id, name, domain, description, questions, state_hint, sample_states, policy, tags, builtin, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                bid,
                bp["name"],
                bp.get("domain", "通用"),
                bp.get("description", ""),
                json.dumps(bp.get("questions", {}), ensure_ascii=False),
                json.dumps(bp.get("state_hint", {}), ensure_ascii=False),
                json.dumps(bp.get("sample_states", []), ensure_ascii=False),
                json.dumps(bp.get("policy", {}), ensure_ascii=False),
                json.dumps(bp.get("tags", []), ensure_ascii=False),
                int(bool(bp.get("builtin"))),
                bp.get("created_at") or now,
                now,
            ),
        )
    return bid


def delete_blueprint(bp_id: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM blueprints WHERE id=?", (bp_id,))


# ─────────────────────────────── settings ───────────────────────────────

DEFAULT_SETTINGS: Dict[str, Any] = {
    "threshold": 0.60,
    "temperature": {"choice": 1.0, "score": 1.0, "noul": 1.0},
    "auto_act": True,
    "noul_margin": 0.15,
}


def get_settings() -> Dict[str, Any]:
    raw = {}
    with connect() as conn:
        for r in conn.execute("SELECT key, value FROM settings"):
            raw[r["key"]] = _j(r["value"])
    merged = {**DEFAULT_SETTINGS, **raw}
    if isinstance(merged.get("temperature"), dict):
        merged["temperature"] = {**DEFAULT_SETTINGS["temperature"], **merged["temperature"]}
    return merged


def put_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    current = get_settings()
    current.update(patch)
    with connect() as conn:
        for k, v in current.items():
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)",
                (k, json.dumps(v, ensure_ascii=False)),
            )
    return current
