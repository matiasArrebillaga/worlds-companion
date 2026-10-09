"""Genera los JSON del sitio a partir de data/raw/.

Uso: python -m pipeline.build
"""
import json
import sys
from pathlib import Path

from pipeline import utc_now_iso
from pipeline.schedule import build_schedule
from pipeline.validate import validate_schedule

RAW_DIR = Path("data/raw")
OUT_DIR = Path("web/public/data")


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def build(raw_dir: Path, out_dir: Path, now: str) -> None:
    matches_raw = _read(raw_dir / "worlds_2026_matches.json")
    teams_path = raw_dir / "worlds_2026_teams.json"
    teams = _read(teams_path)["rows"] if teams_path.exists() else []
    shorts = {t["Name"]: t.get("Short") or t["Name"] for t in teams}

    schedule = build_schedule(matches_raw["rows"], shorts)
    errors = validate_schedule(schedule)
    if errors:
        raise ValueError("validation failed:\n- " + "\n- ".join(errors))

    out_dir.mkdir(parents=True, exist_ok=True)
    _write(out_dir / "schedule.json", {"matches": schedule})
    _write(out_dir / "meta.json", {
        "updated_at": now,
        "source_fetched_at": matches_raw["fetched_at"],
        "match_count": len(schedule),
    })


def main() -> None:
    try:
        build(RAW_DIR, OUT_DIR, utc_now_iso())
    except ValueError as error:
        sys.exit(str(error))
    print(f"wrote {OUT_DIR}/schedule.json and meta.json")


if __name__ == "__main__":
    main()
