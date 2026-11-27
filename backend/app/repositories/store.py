"""SQLite store (stdlib): repair sessions, service book with photos, tickets, disputes journal.

One file in DATA_DIR (outside Git). The app keeps working objects in memory and writes them through
here, so a restart or another device can pick a repair up where it was left.
"""
import base64
import json
import sqlite3
import threading
import time
from pathlib import Path

from app.core.config import settings

SCHEMA = """
create table if not exists works(
  id text primary key, vehicle_id text not null, session_id text, lang text, status text not null,
  created_at real not null, updated_at real not null, data text not null);
create table if not exists book(
  id integer primary key autoincrement, vehicle_id text not null, work_id text, session_id text,
  created_at real not null, kind text not null, title text not null, text text not null, data text);
create table if not exists photos(
  id integer primary key autoincrement, vehicle_id text not null, entry_id integer, work_id text,
  created_at real not null, file text not null);
create table if not exists disputes(
  id integer primary key autoincrement, vehicle_id text, work_id text, created_at real not null,
  kind text not null, detail text not null, data text, resolved integer not null default 0);
create index if not exists book_vehicle on book(vehicle_id, created_at);
create index if not exists works_vehicle on works(vehicle_id, status);
"""
BOOK_KINDS = ("diagnosis", "recheck", "fault", "defect", "repair", "recommendation", "ticket", "note")
DISPUTE_KINDS = ("unverified_numbers", "ticket_rejected", "low_confidence", "fuel_mismatch",
                 "contradiction", "photo_mismatch")

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def data_dir() -> Path:
    path = Path(settings.data_dir).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path


def db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(data_dir() / "app.db", check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(SCHEMA)
    return _conn


def reset() -> None:
    """Forget the connection (tests point DATA_DIR elsewhere)."""
    global _conn
    if _conn is not None:
        _conn.close()
    _conn = None


def _exec(sql: str, args: tuple = ()) -> sqlite3.Cursor:
    with _lock:
        cur = db().execute(sql, args)
        db().commit()
        return cur


def _rows(sql: str, args: tuple = ()) -> list[dict]:
    with _lock:
        return [dict(r) for r in db().execute(sql, args).fetchall()]


# --- repair sessions -------------------------------------------------------------------------------

def save_work(work_id: str, vehicle_id: str, session_id: str | None, lang: str, status: str, data: dict) -> None:
    now = time.time()
    _exec("""insert into works(id, vehicle_id, session_id, lang, status, created_at, updated_at, data)
             values(?,?,?,?,?,?,?,?)
             on conflict(id) do update set session_id=excluded.session_id, lang=excluded.lang,
               status=excluded.status, updated_at=excluded.updated_at, data=excluded.data""",
          (work_id, vehicle_id, session_id, lang, status, now, now, json.dumps(data, ensure_ascii=False, default=str)))


def load_work(work_id: str) -> dict | None:
    rows = _rows("select * from works where id=?", (work_id,))
    if not rows:
        return None
    row = rows[0]
    row["data"] = json.loads(row["data"])
    return row


def update_work_data(work_id: str, **fields) -> None:
    """Merge top-level keys into a saved session's data (e.g. progress)."""
    row = load_work(work_id)
    if row is None:
        raise LookupError(f"Нет работы {work_id}")
    status = fields.pop("status", None) or row["status"]
    row["data"].update(fields)
    save_work(work_id, row["vehicle_id"], row["session_id"], row["lang"], status, row["data"])


def set_work_status(work_id: str, status: str) -> None:
    _exec("update works set status=?, updated_at=? where id=?", (status, time.time(), work_id))


def list_works(vehicle_id: str | None = None, status: str | None = None) -> list[dict]:
    sql, args = "select id, vehicle_id, session_id, lang, status, created_at, updated_at, data from works where 1=1", []
    if vehicle_id:
        sql += " and vehicle_id=?"
        args.append(vehicle_id)
    if status:
        sql += " and status=?"
        args.append(status)
    out = []
    for row in _rows(sql + " order by updated_at desc", tuple(args)):
        data = json.loads(row.pop("data"))
        plan = data.get("plan") or {}
        progress = data.get("progress") or {}
        done = sum(1 for s in plan.get("steps", []) if (progress.get("steps") or {}).get(str(s["id"]), {}).get("done"))
        row.update(diagnosis=data.get("diagnosis"), steps_total=len(plan.get("steps", [])), steps_done=done,
                   stage=progress.get("stage"))
        out.append(row)
    return out


# --- service book ----------------------------------------------------------------------------------

def add_entry(vehicle_id: str, kind: str, title: str, text: str = "", data: dict | None = None,
              work_id: str | None = None, session_id: str | None = None) -> int:
    if kind not in BOOK_KINDS:
        raise ValueError(f"kind: {kind}")
    cur = _exec("insert into book(vehicle_id, work_id, session_id, created_at, kind, title, text, data) "
                "values(?,?,?,?,?,?,?,?)",
                (vehicle_id, work_id, session_id, time.time(), kind, title, text,
                 json.dumps(data, ensure_ascii=False, default=str) if data is not None else None))
    return cur.lastrowid


def has_entry(vehicle_id: str, kind: str, session_id: str) -> bool:
    return bool(_rows("select 1 from book where vehicle_id=? and kind=? and session_id=? limit 1",
                      (vehicle_id, kind, session_id)))


def entries(vehicle_id: str, kind: str | None = None) -> list[dict]:
    sql, args = "select * from book where vehicle_id=?", [vehicle_id]
    if kind:
        sql += " and kind=?"
        args.append(kind)
    rows = _rows(sql + " order by created_at desc, id desc", tuple(args))
    photos = photos_by_entry(vehicle_id)
    for row in rows:
        row["data"] = json.loads(row["data"]) if row["data"] else None
        row["photos"] = photos.get(row["id"], [])
    return rows


def tickets(vehicle_id: str | None = None) -> list[dict]:
    sql, args = "select data from book where kind='ticket'", ()
    if vehicle_id:
        sql, args = sql + " and vehicle_id=?", (vehicle_id,)
    return [json.loads(r["data"]) for r in _rows(sql + " order by created_at, id", args)]


# --- photos ----------------------------------------------------------------------------------------

def add_photo(vehicle_id: str, data_url: str, entry_id: int | None = None, work_id: str | None = None) -> int:
    header, _, b64 = data_url.partition(",")
    ext = "png" if "image/png" in header else "webp" if "image/webp" in header else "jpg"
    raw = base64.b64decode(b64)
    cur = _exec("insert into photos(vehicle_id, entry_id, work_id, created_at, file) values(?,?,?,?,?)",
                (vehicle_id, entry_id, work_id, time.time(), ""))
    name = f"{cur.lastrowid}.{ext}"
    folder = data_dir() / "photos"
    folder.mkdir(exist_ok=True)
    (folder / name).write_bytes(raw)
    _exec("update photos set file=? where id=?", (name, cur.lastrowid))
    return cur.lastrowid


def photo_file(photo_id: int) -> Path | None:
    rows = _rows("select file from photos where id=?", (photo_id,))
    return data_dir() / "photos" / rows[0]["file"] if rows and rows[0]["file"] else None


def photos_by_entry(vehicle_id: str) -> dict[int, list[int]]:
    out: dict[int, list[int]] = {}
    for row in _rows("select id, entry_id from photos where vehicle_id=? and entry_id is not null order by id",
                     (vehicle_id,)):
        out.setdefault(row["entry_id"], []).append(row["id"])
    return out


# --- disputes journal ------------------------------------------------------------------------------

def add_dispute(kind: str, detail: str, vehicle_id: str | None = None, work_id: str | None = None,
                data: dict | None = None) -> int:
    if kind not in DISPUTE_KINDS:
        raise ValueError(f"kind: {kind}")
    cur = _exec("insert into disputes(vehicle_id, work_id, created_at, kind, detail, data) values(?,?,?,?,?,?)",
                (vehicle_id, work_id, time.time(), kind, detail,
                 json.dumps(data, ensure_ascii=False, default=str) if data is not None else None))
    return cur.lastrowid


def has_dispute(kind: str, vehicle_id: str, detail: str) -> bool:
    return bool(_rows("select 1 from disputes where kind=? and vehicle_id=? and detail=? limit 1",
                      (kind, vehicle_id, detail)))


def disputes(resolved: bool | None = None, vehicle_id: str | None = None) -> list[dict]:
    sql, args = "select * from disputes where 1=1", []
    if resolved is not None:
        sql += " and resolved=?"
        args.append(int(resolved))
    if vehicle_id:
        sql += " and vehicle_id=?"
        args.append(vehicle_id)
    rows = _rows(sql + " order by created_at desc, id desc", tuple(args))
    for row in rows:
        row["data"] = json.loads(row["data"]) if row["data"] else None
        row["resolved"] = bool(row["resolved"])
    return rows


def resolve_dispute(dispute_id: int, resolved: bool = True) -> None:
    if _exec("update disputes set resolved=? where id=?", (int(resolved), dispute_id)).rowcount == 0:
        raise LookupError(f"Нет записи {dispute_id}")
