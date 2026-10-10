"""Chequeos de cordura antes de publicar. Si algo falla, no se publica nada."""
from collections import Counter

from pipeline.history import CURRENT_YEAR
from pipeline.schedule import MATCH_KEYS

VALID_PHASES = {"play-in", "swiss", "knockout"}
VALID_STATUSES = {"upcoming", "live", "finished"}
# Menos games que esto en la temporada casi seguro es un nombre distinto entre tablas de Leaguepedia
MIN_GAMES = 10


def validate_schedule(matches: list[dict]) -> list[str]:
    """Devuelve la lista de errores encontrados (vacía si todo está bien)."""
    if not matches:
        return ["schedule is empty"]
    errors: list[str] = []
    seen: set[str] = set()
    for m in matches:
        missing = MATCH_KEYS - m.keys()
        if missing:
            errors.append(f"{m.get('id', '?')}: missing keys {sorted(missing)}")
            continue
        mid = m["id"]
        if mid in seen:
            errors.append(f"duplicate match id: {mid}")
        seen.add(mid)
        if m["phase"] not in VALID_PHASES:
            errors.append(f"{mid}: invalid phase '{m['phase']}'")
        if m["status"] not in VALID_STATUSES:
            errors.append(f"{mid}: invalid status '{m['status']}'")
        if m["status"] == "finished" and m["winner"] not in ("team1", "team2"):
            errors.append(f"{mid}: finished without winner")
        # Equipos sin definir (None) son válidos; el mismo equipo de los dos lados no
        if m["team1"] and m["team2"] and m["team1"]["name"] == m["team2"]["name"]:
            errors.append(f"{mid}: team plays itself")
    return errors


def validate_ratings(teams: list[str], games_played: Counter, aliases: dict[str, str]) -> list[str]:
    """Cada equipo de Worlds tiene que tener historial; si no, su predicción saldría del rating inicial."""
    errors = []
    for team in teams:
        n = games_played.get(aliases.get(team, team), 0)
        if n < MIN_GAMES:
            errors.append(f"{team}: only {n} games in {CURRENT_YEAR} history "
                          "(different name? add an alias to data/teams.csv)")
    return errors


def validate_lineups(teams: list[str], lineups: dict) -> list[str]:
    """Cada equipo de Worlds tiene que aparecer en Oracle's Elixir; si no, su forma contaría como promedio."""
    from models.role_form import resolve_team
    return [f"{team}: no lineup in Oracle's Elixir data (different team name?)"
            for team in teams if resolve_team(team, lineups) is None]


def validate_predictions(matches: list[dict]) -> list[str]:
    errors = []
    for m in matches:
        p = m.get("prediction")
        if p is None:
            continue
        for key in ("p_team1_game", "p_team1_series"):
            if not 0.0 <= p[key] <= 1.0:
                errors.append(f"{m['id']}: {key} out of range: {p[key]}")
    return errors
