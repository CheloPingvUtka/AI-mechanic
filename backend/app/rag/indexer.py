"""Builds the page index from the manuals PDFs.

Run from backend/:  python -m app.rag.indexer
Writes KNOWLEDGE_BASE_PATH/index/chunks.jsonl: overlapping text fragments, each tagged with
its PDF page. Never commit it: it contains text extracted from copyrighted manuals.
"""
import json
import os
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pypdfium2 as pdfium

from app.core.config import settings
from app.rag.manuals import MANUALS
from app.rag.text import tokenize

INDEX_FILE = "index/chunks.jsonl"
CHUNK_CHARS = 600
# Table-of-contents line: dot leaders + page number, numbered CAPS heading, or short line ending in a number.
_TOC_LINE = re.compile(
    r"(\.{4,}|…{2,})\s*\d+\s*$|^\s*\d+(\.\d+)*\s+[А-ЯЁA-Z][А-ЯЁA-Z ,()«»/-]{6,}$|^[^\n]{3,80}\s\d{1,3}\s*$"
)


def clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub("￾\n?", "", text)  # pdfium marks soft hyphens at line breaks with U+FFFE
    text = re.sub(r"(?<=[а-яё])-\n(?=[а-яё])", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text.strip()


def is_toc(text: str) -> bool:
    """Contents/index pages list every topic, so BM25 loves them, but they are not evidence."""
    lines = [line for line in text.split("\n") if line.strip()]
    hits = sum(1 for line in lines if _TOC_LINE.search(line))
    return hits >= 8 and hits / len(lines) > 0.4


def chunk(text: str, size: int = CHUNK_CHARS) -> list[str]:
    """Line-aligned windows of ~size chars, each overlapping the previous one by about half."""
    lines, out, start = text.split("\n"), [], 0
    while start < len(lines):
        end, n = start, 0
        while end < len(lines) and n < size:
            n += len(lines[end]) + 1
            end += 1
        out.append("\n".join(lines[start:end]))
        if end >= len(lines):
            break
        start = max(start + 1, (start + end) // 2)
    return out


def render_pgm(page, dpi: int = 300) -> bytes:
    bitmap = page.render(scale=dpi / 72, grayscale=True)
    buf, w, stride = bytes(bitmap.buffer), bitmap.width, bitmap.stride
    rows = b"".join(buf[y * stride : y * stride + w] for y in range(bitmap.height))
    return b"P5 %d %d 255\n" % (w, bitmap.height) + rows


def ocr(image: bytes) -> str:
    cmd = ["tesseract", "stdin", "stdout", "-l", "rus"]
    if settings.tessdata_dir:
        cmd += ["--tessdata-dir", settings.tessdata_dir]
    env = {**os.environ, "OMP_THREAD_LIMIT": "1"}  # we parallelise across pages instead
    return subprocess.run(cmd, input=image, capture_output=True, check=True, env=env).stdout.decode("utf-8")


def write_chunks(f, manual_id: str, page: int, text: str, from_ocr: bool = False) -> None:
    for part in chunk(text):
        row = {"manual_id": manual_id, "pdf_page": page, "text": part, "tokens": tokenize(part)}
        if from_ocr:
            row["ocr"] = True
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def index_manual(f, m, pdf_path: Path, pool) -> str:
    pdf = pdfium.PdfDocument(pdf_path)
    try:
        no_text, toc = [], 0
        for i in range(len(pdf)):
            text = clean(pdf[i].get_textpage().get_text_range())
            if len(text) < 50:  # drawing, or a scan without a text layer
                no_text.append(i + 1)
            elif is_toc(text):
                toc += 1
            else:
                write_chunks(f, m.id, i + 1, text)
        scanned = 0
        if pool and no_text:
            for k in range(0, len(no_text), 4):  # render a few pages at a time: 300 dpi bitmaps are ~9 MB
                batch = no_text[k : k + 4]
                images = [render_pgm(pdf[p - 1]) for p in batch]
                for page, raw in zip(batch, pool.map(ocr, images)):
                    text = clean(raw)
                    if len(re.findall("[а-яёА-ЯЁ]", text)) >= 150:  # drawings OCR into a few stray letters
                        scanned += 1
                        write_chunks(f, m.id, page, text, from_ocr=True)
        return f"{m.id}: {len(pdf)} стр., без текстового слоя {len(no_text)} (из них OCR {scanned}), оглавление {toc}"
    finally:
        pdf.close()


def build(kb_path: Path) -> Path:
    missing = [m.file for m in MANUALS if not (kb_path / m.file).is_file()]
    if missing:
        raise FileNotFoundError(f"Нет PDF в {kb_path}: {', '.join(missing)}")
    if not shutil.which("tesseract"):
        print("tesseract не найден: страницы-сканы пропускаются (нужен tesseract с языком rus)")
    out = kb_path / INDEX_FILE
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f, ThreadPoolExecutor(4) as pool:
        for m in MANUALS:
            print(index_manual(f, m, kb_path / m.file, pool if shutil.which("tesseract") else None))
    return out


if __name__ == "__main__":
    print("Индекс:", build(Path(settings.knowledge_base_path).expanduser()))
