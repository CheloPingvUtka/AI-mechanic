"""BM25 search over manual fragments, restricted to the manuals of one engine.

A page scores as its best fragment; that fragment is returned as the quotable text.

CLI check from backend/:  python -m app.rag.search "ЯМЗ-236М2" "момент затяжки крышек коренных подшипников"
"""
import json
import math
import sys
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.core.config import settings
from app.rag.indexer import INDEX_FILE
from app.rag.manuals import BY_ID, manuals_for_engine
from app.rag.text import tokenize

K1, B = 1.5, 0.75


@dataclass
class Hit:
    manual_id: str
    manual: str
    pdf_page: int
    score: float
    text: str
    ocr: bool = False  # recognised from a scan: numbers may be misread, check the page image

    @property
    def ref(self) -> str:
        return f"{self.manual_id}:{self.pdf_page}"

    @property
    def short(self) -> str:
        return BY_ID[self.manual_id].short


class PageIndex:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.tf = [Counter(r["tokens"]) for r in rows]
        self.lens = [len(r["tokens"]) for r in rows]
        self.avg_len = sum(self.lens) / max(len(rows), 1)
        df = Counter(t for tf in self.tf for t in tf)
        n = len(rows)
        self.idf = {t: math.log(1 + (n - d + 0.5) / (d + 0.5)) for t, d in df.items()}

    @classmethod
    def load(cls, path: Path) -> "PageIndex":
        if not path.is_file():
            raise FileNotFoundError(f"Индекс не найден: {path}. Запустите python -m app.rag.indexer")
        with path.open(encoding="utf-8") as f:
            return cls([json.loads(line) for line in f])

    def search(self, engine_model: str, query: str, k: int = 5) -> list[Hit]:
        allowed = {m.id for m in manuals_for_engine(engine_model)}
        if not allowed:
            return []
        terms = set(tokenize(query))
        scored = []
        for i, row in enumerate(self.rows):
            if row["manual_id"] not in allowed:
                continue
            tf, norm = self.tf[i], K1 * (1 - B + B * self.lens[i] / self.avg_len)
            s = sum(self.idf[t] * tf[t] * (K1 + 1) / (tf[t] + norm) for t in terms if t in tf)
            if s > 0:
                scored.append((s, row))
        scored.sort(key=lambda x: x[0], reverse=True)
        hits, seen = [], set()
        for s, r in scored:
            key = (r["manual_id"], r["pdf_page"])
            if key in seen:
                continue
            seen.add(key)
            hits.append(Hit(
                r["manual_id"], BY_ID[r["manual_id"]].title, r["pdf_page"], round(s, 2), r["text"],
                r.get("ocr", False),
            ))
            if len(hits) == k:
                break
        return hits


@lru_cache
def get_index() -> PageIndex:
    return PageIndex.load(Path(settings.knowledge_base_path).expanduser() / INDEX_FILE)


if __name__ == "__main__":
    engine, query = sys.argv[1], " ".join(sys.argv[2:])
    for h in get_index().search(engine, query):
        print(f"\n=== {h.manual}, стр. PDF {h.pdf_page} (score {h.score}){' [OCR]' if h.ocr else ''}\n{h.text[:600]}")
