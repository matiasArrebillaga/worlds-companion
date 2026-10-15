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


def validate_stats(teams: list[dict], players: list[dict]) -> list[str]:
    """Ids únicos y referencias válidas entre teams.json y players.json (los links del sitio dependen de esto)."""
    errors = []
    team_ids = [t["id"] for t in teams]
    player_ids = [p["id"] for p in players]
    for kind, ids in (("team", team_ids), ("player", player_ids)):
        for value, n in Counter(ids).items():
            if n > 1:
                errors.append(f"duplicate {kind} id {value}")
    known_teams, known_players = set(team_ids), set(player_ids)
    for p in players:
        if p["team_id"] not in known_teams:
            errors.append(f"player {p['id']}: unknown team {p['team_id']}")
    for t in teams:
        for pid in t["roster"]:
            if pid not in known_players:
                errors.append(f"team {t['id']}: roster has unknown player {pid}")
    return errors


def validate_meta(champions: dict[str, list[dict]]) -> list[str]:
    """Un campeón por muestra y porcentajes entre 0 y 1."""
    errors = []
    for sample, rows in champions.items():
        for name, n in Counter(r["champion"] for r in rows).items():
            if n > 1:
                errors.append(f"{sample}: duplicate champion {name}")
        for r in rows:
            for key in ("presence", "pick_rate", "ban_rate", "winrate", "winrate_adj", "winrate_low", "winrate_high",
                        "first_rotation", "kp", "guide_presence"):
                value = r.get(key)
                if value is not None and not 0.0 <= value <= 1.0:
                    errors.append(f"{sample}: {r['champion']} {key} out of range: {value}")
    return errors


# Cuántos equipos tiene que haber en cada resultado: la suma de las chances da exactamente eso
TOURNAMENT_TOTALS = {("playin", "p_win"): 1, ("swiss", "p_advance"): 8, ("swiss", "p_3_0"): 2,
                     ("swiss", "p_0_3"): 2, ("knockout", "p_semis"): 4, ("knockout", "p_final"): 2,
                     ("knockout", "p_champion"): 1}
TOTAL_TOLERANCE = 0.01  # por el redondeo a 4 decimales de cada equipo


def validate_tournament(sim: dict) -> list[str]:
    """Chances entre 0 y 1, sin equipos repetidos, y que cada resultado sume la cantidad de equipos que corresponde."""
    errors = []
    for (stage, key), total in TOURNAMENT_TOTALS.items():
        rows = sim[stage]["teams"]
        if not rows:
            continue
        for name, n in Counter(r["name"] for r in rows).items():
            if n > 1:
                errors.append(f"tournament {stage}: duplicate team {name}")
        for r in rows:
            if not 0.0 <= r[key] <= 1.0:
                errors.append(f"tournament {stage}: {r['name']} {key} out of range: {r[key]}")
        if abs(sum(r[key] for r in rows) - total) > TOTAL_TOLERANCE:
            errors.append(f"tournament {stage}: {key} adds up to {sum(r[key] for r in rows):.3f}, expected {total}")
    return errors


def validate_games(games: dict[str, list[dict]], match_ids: set[str]) -> list[str]:
    """Partidas de cada serie: que la serie exista, sin números de partida repetidos y como mucho 5 por lado."""
    errors: list[str] = []
    for mid, rows in games.items():
        if mid not in match_ids:
            errors.append(f"games: unknown match {mid}")
        numbers = [g["n"] for g in rows]
        if len(numbers) != len(set(numbers)):
            errors.append(f"games: {mid} has repeated game numbers {numbers}")
        for g in rows:
            for side in ("blue", "red"):
                if len(g[side]["players"]) > 5:
                    errors.append(f"games: {mid} game {g['n']} {side} has {len(g[side]['players'])} players")
    return errors
