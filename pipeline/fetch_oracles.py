"""Descarga los CSV de Oracle's Elixir (stats por partida y jugador). Solo para experimentos.

Requiere `gdown` (requirements-notebooks.txt). Los archivos son pesados y no se commitean.
Uso: python -m pipeline.fetch_oracles [--force]
"""
import argparse
from pathlib import Path

import gdown

OE_DIR = Path("data/raw/oracles_elixir")
# Carpeta pública de Google Drive donde Oracle's Elixir publica un CSV por año
DRIVE_FOLDER = "1gLSw0RLjBbtaNy0dgnGQDAZOHIgCe-HH"
YEARS = (2024, 2025, 2026)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="volver a bajar aunque ya exista")
    args = parser.parse_args()
    OE_DIR.mkdir(parents=True, exist_ok=True)
    files = gdown.download_folder(id=DRIVE_FOLDER, skip_download=True, quiet=True)
    for year in YEARS:
        target = OE_DIR / f"{year}.csv"
        # El archivo del año en curso cambia todos los días; los anteriores ya están cerrados
        if target.exists() and not args.force:
            print(f"{target} ya existe, se saltea")
            continue
        [entry] = [f for f in files if f.path.startswith(f"{year}_")]
        gdown.download(id=entry.id, output=str(target), quiet=False)


if __name__ == "__main__":
    main()
