"""Genera los JSON del sitio a partir de data/raw/.

Uso: python -m pipeline.build            # genera los JSON (no toca data/predictions.jsonl)
     python -m pipeline.build --freeze   # además congela las predicciones nuevas (lo usa el cron)
"""
import json
import sys
from pathlib import Path

from models.elo import BACKTEST, MODEL_VERSION, PARAMS, run_elo, team_regions
from models.features import lineups, player_forms
from models.oracles import read_extract
from models.role_form import adjustment, load_model, norms_of, resolve_team
from models.predictions import attach_predictions, evaluate, freeze, make_predictions, read_frozen, ready_to_freeze
from pipeline import utc_now_iso
from pipeline.history import CURRENT_YEAR, load_aliases, load_season_games
from pipeline.schedule import UNDECIDED_TEAMS, build_schedule, short_name
from pipeline.validate import validate_lineups, validate_predictions, validate_ratings, validate_schedule

RAW_DIR = Path("data/raw")
OUT_DIR = Path("web/public/data")
PREDICTIONS_FILE = Path("data/predictions.jsonl")
ALIASES_FILE = Path("data/teams.csv")
OE_EXTRACT = "oracles_2026.json"  # extracto de Oracle's Elixir (pipeline/fetch_oracles.py)


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _rows_if_exists(path: Path) -> list[dict]:
    return _read(path)["rows"] if path.exists() else []


def _write(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def participants(schedule: list[dict], rosters: list[dict]) -> list[str]:
    """Equipos de Worlds: los inscriptos más los que ya aparecen en el calendario."""
    names = {(r.get("Team") or "").strip() for r in rosters}
    names |= {m[side]["name"] for m in schedule for side in ("team1", "team2") if m[side]}
    return sorted(n for n in names if n and n.lower() not in UNDECIDED_TEAMS)


def elo_payload(teams, run, regions, shorts, aliases, accuracy, now, role_model, oe_fetched_at) -> dict:
    rated = []
    for name in teams:
        canonical = aliases.get(name, name)
        rated.append({"name": name, "short": short_name(name, shorts), "region": regions.get(canonical),
                      "rating": round(run.ratings[canonical], 1), "games": run.games_played[canonical]})
    rated.sort(key=lambda t: -t["rating"])
    return {
        "model_version": MODEL_VERSION,
        "updated_at": now,
        "params": {"k": PARAMS.k, "region_offsets": PARAMS.region_offsets, "role_weights": role_model["weights"]},
        "backtest": BACKTEST,
        "role_form": {"fetched_at": oe_fetched_at, "test": role_model["test"]},
        "teams": rated,
        "accuracy": accuracy,
    }


def build(raw_dir: Path, out_dir: Path, now: str, predictions_file: Path = PREDICTIONS_FILE,
          aliases_file: Path = ALIASES_FILE, freeze_predictions: bool = False) -> None:
    matches_raw = _read(raw_dir / "worlds_2026_matches.json")
    shorts = {t["Name"]: t.get("Short") or t["Name"] for t in _rows_if_exists(raw_dir / "worlds_2026_teams.json")}
    schedule = build_schedule(matches_raw["rows"], shorts)

    # Elo con toda la temporada (ligas + internacionales + lo que va de Worlds)
    aliases = load_aliases(aliases_file)
    games = load_season_games(raw_dir, CURRENT_YEAR, aliases)
    regions = team_regions(games)
    run = run_elo(games, PARAMS, regions)
    teams = participants(schedule, _rows_if_exists(raw_dir / "worlds_2026_rosters.json"))

    # Forma de los jugadores con los datos de Oracle's Elixir de la temporada
    role_model = load_model()
    oe_games, oe_fetched_at = read_extract(raw_dir / OE_EXTRACT)
    ups = lineups(oe_games)
    forms = player_forms(oe_games, norms_of(role_model))

    def adjust(team1: str, team2: str) -> float:
        return adjustment(resolve_team(team1, ups), resolve_team(team2, ups), ups, forms, role_model)

    # Todo se valida antes de escribir nada (ni JSON ni predicciones congeladas)
    errors = (validate_schedule(schedule) + validate_ratings(teams, run.games_played, aliases)
              + validate_lineups(teams, ups))
    current = [] if errors else make_predictions(schedule, run.ratings, now, aliases, adjust)
    errors += validate_predictions(attach_predictions(schedule, [], current))
    if errors:
        raise ValueError("validation failed:\n- " + "\n- ".join(errors))

    frozen = read_frozen(predictions_file)
    if freeze_predictions:
        ready = ready_to_freeze(schedule, now)
        frozen += freeze(predictions_file, [p for p in current if p["match_id"] in ready], frozen)
    schedule = attach_predictions(schedule, frozen, current)

    out_dir.mkdir(parents=True, exist_ok=True)
    _write(out_dir / "schedule.json", {"matches": schedule})
    _write(out_dir / "meta.json", {
        "updated_at": now,
        "source_fetched_at": matches_raw["fetched_at"],
        "match_count": len(schedule),
    })
    _write(out_dir / "elo.json", elo_payload(teams, run, regions, shorts, aliases, evaluate(schedule, frozen), now,
                                                role_model, oe_fetched_at))


def main() -> None:
    try:
        build(RAW_DIR, OUT_DIR, utc_now_iso(), freeze_predictions="--freeze" in sys.argv)
    except ValueError as error:
        sys.exit(str(error))
    print(f"wrote {OUT_DIR}/schedule.json, meta.json and elo.json")


if __name__ == "__main__":
    main()
