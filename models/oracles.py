"""Lectura de los CSV de Oracle's Elixir (solo para experimentos; ver pipeline/fetch_oracles.py).

Cada partida (game) ocupa 12 filas: 2 de equipo (position = "team") y 10 de jugadores.
Se arma un game con el mismo formato que usa models.elo.run_elo, más las filas crudas de
equipos y jugadores para calcular variables.
"""
import csv
import json
from pathlib import Path

ROLES = ("top", "jng", "mid", "bot", "sup")

# Liga (código de Oracle's Elixir) → región, igual que LEAGUE_REGIONS en pipeline/history.py.
# None = torneo entre regiones. Las ligas que no están acá (academias, ERLs) se descartan.
OE_LEAGUE_REGIONS: dict[str, str | None] = {
    "LCK": "KR", "LPL": "CN", "LEC": "EU",
    "LCS": "NA", "LTA N": "NA", "CBLOL": "BR", "LTA S": "BR", "LLA": "LAT",
    "LCP": "APAC", "PCS": "APAC", "VCS": "VN", "LJL": "JP",
    "LTA": None, "FST": None, "MSI": None, "EWC": None, "WLDs": None,
}


def parse_rows(rows: list[dict]) -> list[dict]:
    """Filas del CSV → games en orden cronológico. Descarta partidas incompletas."""
    by_game: dict[str, list[dict]] = {}
    for r in rows:
        if r.get("league") in OE_LEAGUE_REGIONS:
            by_game.setdefault(r["gameid"], []).append(r)

    games = []
    for gameid, group in by_game.items():
        teams = {r["side"].lower(): r for r in group if r["position"] == "team"}
        if set(teams) != {"blue", "red"} or teams["blue"].get("result") not in ("0", "1"):
            continue
        if not teams["blue"].get("teamname") or not teams["red"].get("teamname"):
            continue
        players: dict[str, dict] = {"blue": {}, "red": {}}
        for r in group:
            if r["position"] in ROLES and r["side"].lower() in players:
                players[r["side"].lower()][r["position"]] = r
        first = teams["blue"]
        games.append({
            "date": first["date"], "match_id": gameid, "game": int(first.get("game") or 1),
            "page": first["league"], "region": OE_LEAGUE_REGIONS[first["league"]],
            "blue": teams["blue"]["teamname"], "red": teams["red"]["teamname"],
            "winner": "blue" if teams["blue"]["result"] == "1" else "red",
            "teams": teams, "players": players,
        })
    games.sort(key=lambda g: (g["date"], g["game"]))
    _assign_series(games)
    return games


def _assign_series(games: list[dict]) -> None:
    """Oracle's Elixir no trae id de serie: un game 2, 3... se suma a la última serie abierta
    entre esos dos equipos en esa liga. Un game 1 abre una serie nueva."""
    open_series: dict[tuple, str] = {}
    for g in games:
        pair = (g["page"], frozenset((g["blue"], g["red"])))
        if g["game"] > 1 and pair in open_series:
            g["match_id"] = open_series[pair]
        open_series[pair] = g["match_id"]


def load_season(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as f:
        return parse_rows(list(csv.DictReader(f)))


# Columnas que necesita la forma por rol: el extracto que usa el sitio guarda solo estas
EXTRACT_COLUMNS = ("gameid", "league", "date", "game", "side", "position", "teamname", "playername", "result",
                   "golddiffat15", "xpdiffat15", "csdiffat15", "kills", "deaths", "assists", "teamkills",
                   "damageshare", "earnedgoldshare")


def write_extract(path: Path, rows: list[dict], fetched_at: str) -> None:
    """Guarda las filas de las ligas principales con las columnas necesarias, en formato compacto
    (encabezado + listas) para que el archivo commiteado pese pocos MB."""
    kept = [[r.get(c, "") for c in EXTRACT_COLUMNS] for r in rows if r.get("league") in OE_LEAGUE_REGIONS]
    payload = {"fetched_at": fetched_at, "columns": list(EXTRACT_COLUMNS), "rows": kept}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def read_extract(path: Path) -> tuple[list[dict], str]:
    """(games, fecha de descarga) a partir del extracto."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = [dict(zip(payload["columns"], values)) for values in payload["rows"]]
    return parse_rows(rows), payload["fetched_at"]
