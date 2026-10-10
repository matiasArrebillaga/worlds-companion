"""Historial de partidas para el Elo: qué torneos entran y cómo se leen las filas de Leaguepedia."""
import csv
import json
from pathlib import Path

CURRENT_YEAR = 2026

# En ScoreboardGames, Team1 es siempre el lado azul. Se renombran campos para evitar espacios en las claves.
GAME_FIELDS = "GameId,MatchId,OverviewPage,Team1,Team2,Winner,DateTime_UTC=DateTimeUTC,N_GameInMatch=GameInMatch"
TOURNAMENT_FIELDS = "OverviewPage,League,Region,TournamentLevel,IsQualifier,Year"

# Liga (campo League de Leaguepedia) → región. None = torneo entre regiones.
LEAGUE_REGIONS: dict[str, str | None] = {
    "LoL Champions Korea": "KR",
    "Tencent LoL Pro League": "CN",
    "LoL EMEA Championship": "EU",
    "League of Legends Championship Series": "NA",
    "League of Legends Championship of The Americas North": "NA",
    "Circuit Brazilian League of Legends": "BR",
    "League of Legends Championship of The Americas South": "BR",
    "Liga Latinoamerica": "LAT",
    "League of Legends Championship Pacific": "APAC",
    "Pacific Championship Series": "APAC",
    "Vietnam Championship Series": "VN",
    "LoL Japan League": "JP",
    "League of Legends Championship of The Americas": None,
    "First Stand": None,
    "Mid-Season Invitational": None,
    "Esports World Cup": None,
    "World Championship": None,
}

WINNER_SIDES = {"1": "blue", "2": "red"}


def worlds_prefix(year: int) -> str:
    return f"{year} Season World Championship"


def history_files(raw_dir: Path, year: int) -> tuple[Path, Path]:
    return raw_dir / f"history_{year}_tournaments.json", raw_dir / f"history_{year}_games.json"


def select_tournaments(rows: list[dict]) -> list[dict]:
    """Ligas principales e internacionales, sin showmatches, ligas secundarias ni clasificatorios.

    Excepción: los clasificatorios de la liga 'World Championship' (Play-In de Worlds y finales
    regionales) sí entran, porque son partidos oficiales entre equipos de primer nivel.
    """
    keep = []
    for r in rows:
        if r.get("League") not in LEAGUE_REGIONS or r.get("TournamentLevel") != "Primary":
            continue
        if r.get("IsQualifier") == "1" and r["League"] != "World Championship":
            continue
        keep.append(r)
    return keep


def page_regions(tournaments: list[dict]) -> dict[str, str | None]:
    return {t["OverviewPage"]: LEAGUE_REGIONS[t["League"]] for t in tournaments}


def normalize_games(rows: list[dict], regions: dict[str, str | None], aliases: dict[str, str] | None = None) -> list[dict]:
    """Filas de ScoreboardGames → games en orden cronológico (y por número de game dentro de la serie).

    Una página que no está en `regions` se toma como torneo internacional (región None).
    """
    aliases = aliases or {}
    games = []
    for r in rows:
        winner = WINNER_SIDES.get(r.get("Winner") or "")
        if winner is None or not r.get("DateTimeUTC"):
            continue  # game sin resultado cargado todavía
        games.append({
            "date": r["DateTimeUTC"],
            "match_id": r["MatchId"],
            "game": int(r.get("GameInMatch") or 0),
            "page": r["OverviewPage"],
            "region": regions.get(r["OverviewPage"]),
            "blue": aliases.get(r["Team1"], r["Team1"]),
            "red": aliases.get(r["Team2"], r["Team2"]),
            "winner": winner,
        })
    games.sort(key=lambda g: (g["date"], g["match_id"], g["game"]))
    return games


def load_aliases(path: Path) -> dict[str, str]:
    """data/teams.csv (columnas alias,canonical): une a un equipo que aparece con dos nombres."""
    if not path.exists():
        return {}
    with path.open(encoding="utf-8", newline="") as f:
        return {row["alias"].strip(): row["canonical"].strip() for row in csv.DictReader(f)}


def _rows(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["rows"]


def load_season_games(raw_dir: Path, year: int, aliases: dict[str, str] | None = None) -> list[dict]:
    """Games de la temporada en orden. En el año actual se suman los de Worlds (los baja el fetch horario)."""
    tournaments_file, games_file = history_files(raw_dir, year)
    if not games_file.exists():
        raise FileNotFoundError(f"{games_file} is missing: run python -m pipeline.fetch_history")
    rows = _rows(games_file)
    worlds_file = raw_dir / f"worlds_{year}_games.json"
    if year == CURRENT_YEAR and worlds_file.exists():
        rows = rows + _rows(worlds_file)
    return normalize_games(rows, page_regions(_rows(tournaments_file)), aliases)
