"""Downloads the task materials onto a stand and lays them out outside the repository.

The manuals (manufacturers' PDFs) and the mock services' data must not be in the public repository, so a stand
gets them at deployment from the link given in the task materials. The link is read from the environment
(MATERIALS_URL), never from code. Only the standard library is used.

    MATERIALS_URL=<link from the task materials> backend/.venv/bin/python scripts/fetch_materials.py --write-env --index

Environment:
    MATERIALS_URL     the archive with the task materials (zip), required
    MATERIALS_DIR     where to put it, outside the repository (default: ../private-materials next to the repo)
    MATERIALS_SHA256  optional: the archive's checksum, to refuse a damaged or substituted file

Options:
    --write-env  put KNOWLEDGE_BASE_PATH and VEHICLE_CATALOG_PATH into backend/.env (made from .env.example if missing)
    --index      build the manuals' search index afterwards (python -m app.rag.indexer; OCR of scans takes a while)
    --force      download again even if this link was already fetched
"""
import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"


def fail(message: str) -> None:
    sys.exit(f"fetch_materials: {message}")


def download(url: str, dest: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "digital-mechanic-materials"})
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(request, timeout=60) as response, tmp.open("wb") as out:
        total, done, shown = int(response.headers.get("Content-Length") or 0), 0, -1
        while chunk := response.read(1 << 20):
            out.write(chunk)
            done += len(chunk)
            mb = done >> 20
            if mb // 10 != shown:
                shown = mb // 10
                print(f"  {mb} MB" + (f" of {total >> 20} MB" if total else ""), flush=True)
    tmp.replace(dest)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def member_name(info: zipfile.ZipInfo) -> str:
    """Archives made without the UTF-8 flag carry Cyrillic names in a DOS code page."""
    if info.flag_bits & 0x800:
        return info.filename
    raw = info.filename.encode("cp437")
    for codec in ("utf-8", "cp866"):
        try:
            return raw.decode(codec)
        except UnicodeDecodeError:
            continue
    return info.filename


def extract(archive: Path, target: Path) -> None:
    """Unpacks, refusing any entry that would land outside the target folder."""
    target = target.resolve()
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            path = (target / member_name(info)).resolve()
            if target not in path.parents and path != target:
                fail(f"refusing an archive entry outside the target folder: {info.filename}")
            if info.is_dir():
                path.mkdir(parents=True, exist_ok=True)
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, path.open("wb") as dst:
                shutil.copyfileobj(src, dst)


def knowledge_base(folder: Path) -> Path:
    """The folder with the manuals: the one holding the most PDFs."""
    counts: dict[Path, int] = {}
    for pdf in folder.rglob("*.pdf"):
        counts[pdf.parent] = counts.get(pdf.parent, 0) + 1
    if not counts:
        fail("no PDF manuals in the archive")
    return max(counts, key=counts.get)


def mock_services(folder: Path) -> Path:
    """Unpacks the mock services' archive found inside and returns their folder (mock_ml, mock_toir, data/)."""
    for inner in folder.rglob("*.zip"):
        if "mock" in inner.name.lower():
            extract(inner, folder / "mock")
    for vehicles in folder.rglob("data/vehicles.json"):
        if (vehicles.parent.parent / "mock_ml").is_dir():
            return vehicles.parent.parent
    fail("no mock services (mock_ml with data/vehicles.json) in the archive")


def write_env(updates: dict[str, str]) -> Path:
    env = BACKEND / ".env"
    if not env.exists():
        shutil.copyfile(BACKEND / ".env.example", env)
    lines, seen = env.read_text(encoding="utf-8").splitlines(), set()
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if key in updates:
            lines[i] = f"{key}={updates[key]}"
            seen.add(key)
    lines += [f"{k}={v}" for k, v in updates.items() if k not in seen]
    env.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return env


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--write-env", action="store_true")
    parser.add_argument("--index", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    url = os.environ.get("MATERIALS_URL", "").strip()
    if not url:
        fail("set MATERIALS_URL to the link from the task materials")
    folder = Path(os.environ.get("MATERIALS_DIR") or ROOT.parent / "private-materials").expanduser().resolve()
    if folder == ROOT or ROOT in folder.parents:
        fail(f"MATERIALS_DIR must be outside the repository: {folder}")
    folder.mkdir(parents=True, exist_ok=True)

    # The link itself may carry a token: it is never printed or stored, only its hash.
    marker, link_id = folder / ".source", hashlib.sha256(url.encode()).hexdigest()
    archive = folder / "materials.zip"
    if args.force or not marker.exists() or marker.read_text().strip() != link_id:
        print(f"Downloading the task materials from {urllib.parse.urlsplit(url).hostname or 'a local file'} …")
        download(url, archive)
        expected = os.environ.get("MATERIALS_SHA256", "").strip().lower()
        if expected and sha256(archive) != expected:
            archive.unlink()
            fail("checksum does not match MATERIALS_SHA256: the archive was not kept")
        print("Unpacking …")
        extract(archive, folder)
        archive.unlink()
        marker.write_text(link_id)
    else:
        print("These materials are already here (use --force to fetch again).")

    kb, mock = knowledge_base(folder), mock_services(folder)
    vehicles = mock / "data" / "vehicles.json"
    print(f"\nManuals (KNOWLEDGE_BASE_PATH): {kb}  ({len(list(kb.glob('*.pdf')))} PDF)")
    print(f"Vehicles (VEHICLE_CATALOG_PATH): {vehicles}")
    if args.write_env:
        print(f"Written to {write_env({'KNOWLEDGE_BASE_PATH': str(kb), 'VEHICLE_CATALOG_PATH': str(vehicles)})}")
    else:
        print("Put these two paths into backend/.env (or run with --write-env).")
    print("\nMock services (in their own terminals):")
    print(f"  cd {mock} && {sys.executable} -m uvicorn mock_ml.app:app --port 8001")
    print(f"  cd {mock} && {sys.executable} -m uvicorn mock_toir.app:app --port 8002")

    if args.index:
        print("\nBuilding the search index (scanned pages go through OCR, this takes a while) …")
        env = {**os.environ, "KNOWLEDGE_BASE_PATH": str(kb)}
        subprocess.run([sys.executable, "-m", "app.rag.indexer"], cwd=BACKEND, env=env, check=True)


if __name__ == "__main__":
    main()
