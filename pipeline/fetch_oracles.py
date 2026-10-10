"""Descarga datos de Oracle's Elixir (stats por partida y por jugador).

Uso: python -m pipeline.fetch_oracles             # extracto liviano de 2026 para el sitio (data/raw/oracles_2026.json)
     python -m pipeline.fetch_oracles --history   # CSV completos 2024–2026 para los notebooks (no se commitean)
     --force: volver a bajar aunque los datos sean recientes

Oracle's Elixir publica un CSV por año en Google Drive y lo actualiza más o menos una vez por día,
así que el extracto se vuelve a bajar recién cuando tiene más de MAX_AGE de antigüedad.
"""
import argparse
import json
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from models.oracles import load_season, write_extract
from pipeline import utc_now_iso

OE_DIR = Path("data/raw/oracles_elixir")
EXTRACT_FILE = Path("data/raw/oracles_2026.json")
# Carpeta pública de Google Drive donde Oracle's Elixir publica un CSV por año
DRIVE_FOLDER = "1gLSw0RLjBbtaNy0dgnGQDAZOHIgCe-HH"
HISTORY_YEARS = (2024, 2025, 2026)
MAX_AGE = timedelta(hours=20)


def is_fresh(path: Path, now_iso: str, max_age: timedelta = MAX_AGE) -> bool:
    """True si el extracto existe y se bajó hace menos de max_age."""
    if not path.exists():
        return False
    fetched_at = json.loads(path.read_text(encoding="utf-8"))["fetched_at"]
    parse = lambda iso: datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ")
    return parse(now_iso) - parse(fetched_at) < max_age


def _download(year: int, target: Path) -> None:
    import gdown
    files = gdown.download_folder(id=DRIVE_FOLDER, skip_download=True, quiet=True)
    [entry] = [f for f in files if f.path.startswith(f"{year}_")]
    gdown.download(id=entry.id, output=str(target), quiet=True)


def fetch_extract(force: bool) -> None:
    now = utc_now_iso()
    if not force and is_fresh(EXTRACT_FILE, now):
        print(f"{EXTRACT_FILE} is recent, skipping")
        return
    import csv
    with tempfile.TemporaryDirectory() as tmp:
        csv_path = Path(tmp) / "2026.csv"
        _download(2026, csv_path)
        with csv_path.open(encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))
    write_extract(EXTRACT_FILE, rows, now)
    print(f"wrote {EXTRACT_FILE}")


def fetch_history(force: bool) -> None:
    OE_DIR.mkdir(parents=True, exist_ok=True)
    for year in HISTORY_YEARS:
        target = OE_DIR / f"{year}.csv"
        if target.exists() and not force:
            print(f"{target} ya existe, se saltea")
            continue
        _download(year, target)
        print(f"{target}: {len(load_season(target))} games")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--history", action="store_true", help="CSV completos para los notebooks")
    parser.add_argument("--force", action="store_true", help="volver a bajar aunque los datos sean recientes")
    args = parser.parse_args()
    fetch_history(args.force) if args.history else fetch_extract(args.force)


if __name__ == "__main__":
    main()
