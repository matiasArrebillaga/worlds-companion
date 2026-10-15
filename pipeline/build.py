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
from models.predictions import (attach_predictions, evaluate, freeze, game_probability, make_predictions, read_frozen,
                                ready_to_freeze)
from models import tournament
from pipeline import utc_now_iso
from pipeline.assets import DDRAGON_FILE, champion_icons, logo_url
from pipeline import lolesports
from pipeline.games import build_games
from pipeline.history import CURRENT_YEAR, load_aliases, load_season_games
from pipeline.meta import build_meta
from pipeline.schedule import UNDECIDED_TEAMS, build_schedule, short_name
from pipeline.stats import build_team_and_player_stats, elo_history, series_list
from pipeline.validate import (validate_games, validate_lineups, validate_meta, validate_predictions, validate_ratings,
                               validate_schedule, validate_stats, validate_tournament)

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


def main_event_teams(rosters: list[dict]) -> list[str]:
    """Clasificados directo a la suiza (el del Play-In figura como TBD hasta que se define)."""
    names = {(r.get("Team") or "").strip() for r in rosters if r.get("OverviewPage", "").endswith("/Main Event")}
    return sorted(n for n in names if n and n.lower() not in UNDECIDED_TEAMS)


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
                      "logo": logo_url(name), "rating": round(run.ratings[canonical], 1), "games": run.games_played[canonical]})
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
    rosters = _rows_if_exists(raw_dir / "worlds_2026_rosters.json")
    teams = participants(schedule, rosters)

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
    # Estadísticas de equipos y jugadores (Oracle's Elixir) + historia del Elo y series (Leaguepedia)
    teams_payload, players_payload, meta_stats = [], [], None
    if not errors:
        oe_names = {t: resolve_team(t, ups) for t in teams}
        # Primer día de Worlds según el calendario: antes de eso no hay período "Worlds 2026"
        worlds_start = min((m["date"] for m in schedule if m["date"]), default=None)
        team_stats_by_name, players_payload = build_team_and_player_stats(oe_games, oe_names, shorts, worlds_start,
                                                                          forms)
        for name in teams:
            canonical = aliases.get(name, name)
            teams_payload.append({
                **{k: team_stats_by_name[name][k] for k in ("id", "roster", "season", "worlds", "vs_worlds")},
                "name": name, "short": short_name(name, shorts), "region": regions.get(canonical),
                "logo": logo_url(name), "rating": round(run.ratings[canonical], 1),
                "elo_history": elo_history(run.records, canonical),
                "series": series_list(run.records, canonical),
            })
        teams_payload.sort(key=lambda t: -t["rating"])
        errors += validate_stats(teams_payload, players_payload)
        # Meta (campeones, lados, ritmo, regiones) con las partidas de Worlds y la guía del parche anterior
        meta_stats = build_meta(oe_games, schedule, worlds_start)
        errors += validate_meta(meta_stats["champions"])
    current = [] if errors else make_predictions(schedule, run.ratings, now, aliases, adjust)
    errors += validate_predictions(attach_predictions(schedule, [], current))
    # Torneo completo para los pick'ems: se recalcula con cada build (no son predicciones congeladas)
    bracket_sim = {}
    if not errors:
        series = tournament.series_model(lambda a, b: game_probability(a, b, run.ratings, aliases, adjust))
        bracket_sim = tournament.payload(schedule, main_event_teams(rosters), series, lambda n: short_name(n, shorts))
        errors += validate_tournament(bracket_sim)
    # Detalle de cada partida jugada (draft, objetivos y jugadores) para la pestaña Partidas
    # Leaguepedia manda; lolesports completa las partidas que Leaguepedia todavía no cargó
    lp_games = _rows_if_exists(raw_dir / "worlds_2026_games.json")
    lp_players = _rows_if_exists(raw_dir / "worlds_2026_game_players.json")
    champion_names = {v: k for k, v in _read(raw_dir / "ddragon_champions.json")["ids"].items()}         if (raw_dir / "ddragon_champions.json").exists() else {}
    live_games, live_players = lolesports.to_leaguepedia_rows(
        _rows_if_exists(raw_dir / "lolesports_2026_games.json"), matches_raw["rows"],
        _rows_if_exists(raw_dir / "worlds_2026_schedule_games.json"),
        _rows_if_exists(raw_dir / "worlds_2026_teams.json"), champion_names)
    known = {g["GameId"] for g in lp_games}
    live_games = [g for g in live_games if g["GameId"] not in known]
    live_ids = {g["GameId"] for g in live_games}
    games_detail = build_games(lp_games + live_games, lp_players + [p for p in live_players if p["GameId"] in live_ids])
    errors += validate_games(games_detail, {m["id"] for m in schedule})
    if errors:
        raise ValueError("validation failed:\n- " + "\n- ".join(errors))

    frozen = read_frozen(predictions_file)
    if freeze_predictions:
        ready = ready_to_freeze(schedule, now)
        frozen += freeze(predictions_file, [p for p in current if p["match_id"] in ready], frozen)
    schedule = attach_predictions(schedule, frozen, current)

    out_dir.mkdir(parents=True, exist_ok=True)
    _write(out_dir / "schedule.json", {"matches": schedule})
    patches = {"worlds_patch": meta_stats["worlds_patch"], "guide_patch": meta_stats["guide_patch"]}
    _write(out_dir / "meta.json", {
        "updated_at": now,
        "source_fetched_at": matches_raw["fetched_at"],
        "match_count": len(schedule),
        **patches,
        "worlds_games": meta_stats["worlds_games"],
        "samples": meta_stats["samples"],
    })
    _write(out_dir / "champions.json", {"updated_at": now, **patches, "prior_picks": meta_stats["prior_picks"],
                                        "samples": meta_stats["champions"], "analysis": meta_stats["analysis"],
                                        # Íconos de Data Dragon: el sitio arma la URL con base + id
                                        "icons": champion_icons(raw_dir / DDRAGON_FILE.name)})
    _write(out_dir / "elo.json", elo_payload(teams, run, regions, shorts, aliases, evaluate(schedule, frozen), now,
                                                role_model, oe_fetched_at))
    _write(out_dir / "teams.json", {"updated_at": now, "stats_fetched_at": oe_fetched_at, "teams": teams_payload})
    _write(out_dir / "players.json", {"players": players_payload})
    _write(out_dir / "tournament.json", {"updated_at": now, "model_version": MODEL_VERSION, **bracket_sim})
    _write(out_dir / "games.json", {"updated_at": now, "matches": games_detail})


def main() -> None:
    try:
        build(RAW_DIR, OUT_DIR, utc_now_iso(), freeze_predictions="--freeze" in sys.argv)
    except ValueError as error:
        sys.exit(str(error))
    print(f"wrote {OUT_DIR}/schedule.json, meta.json, elo.json, teams.json, players.json, champions.json, tournament.json and games.json")


if __name__ == "__main__":
    main()
