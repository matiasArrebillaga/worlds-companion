"""Estadísticas de equipos y jugadores para teams.json y players.json.

Fuente: games de Oracle's Elixir (models.oracles.read_extract). Los cocientes se calculan sobre
totales (ej. KDA = (K+A totales) / muertes totales), no como promedio de los cocientes de cada partida.
"""
import re
import unicodedata
from collections import Counter

from models.oracles import ROLES

WORLDS_PAGE = "WLDs"   # código de liga de Worlds en Oracle's Elixir
HISTORY_GAMES = 20     # últimas partidas que se guardan por jugador
FIRSTS = {"first_blood": "firstblood", "first_dragon": "firstdragon", "first_tower": "firsttower"}


def slug(name: str) -> str:
    """Nombre → id para la URL ('Gen.G' → 'gen-g')."""
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "x"


def _num(row: dict, key: str) -> float | None:
    value = row.get(key)
    return None if value is None or value == "" else float(value)


def _ratio(num: float, den: float, digits: int) -> float | None:
    """num / den redondeado; None si no hay con qué dividir (dato faltante, no 0)."""
    return round(num / den, digits) if den else None


def team_stats(games: list[dict], team: str) -> dict:
    played = wins = 0
    sides = {"blue": {"games": 0, "wins": 0}, "red": {"games": 0, "wins": 0}}
    minutes = minutes_games = gold = gold_minutes = 0.0
    firsts = {name: [0, 0.0] for name in FIRSTS}  # [partidas con dato, veces que lo consiguió]
    for g in games:
        for side in ("blue", "red"):
            if g[side] != team:
                continue
            row, won = g["teams"][side], g["winner"] == side
            played += 1
            wins += won
            sides[side]["games"] += 1
            sides[side]["wins"] += won
            length = _num(row, "gamelength")
            if length:
                minutes += length / 60
                minutes_games += 1
                total_gold = _num(row, "totalgold")
                if total_gold is not None:
                    gold += total_gold
                    gold_minutes += length / 60
            for name, column in FIRSTS.items():
                value = _num(row, column)
                if value is not None:
                    firsts[name][0] += 1
                    firsts[name][1] += value
    stats = {
        "games": played, "wins": wins, "winrate": _ratio(wins, played, 3),
        "blue": sides["blue"], "red": sides["red"],
        "avg_minutes": _ratio(minutes, minutes_games, 1),
        "gold_per_min": _ratio(gold, gold_minutes, 0),
    }
    for name, (n, got) in firsts.items():
        stats[name] = _ratio(got, n, 3)
    return stats


def player_stats(entries: list[tuple[dict, str, dict]]) -> dict:
    """entries: (game, lado, fila del jugador) de cada partida que jugó."""
    kills = deaths = assists = team_kills = wins = 0
    cs = cs_minutes = damage = damage_minutes = 0.0
    champions: dict[str, list[int]] = {}
    for g, side, row in entries:
        won = g["winner"] == side
        wins += won
        kills += int(_num(row, "kills") or 0)
        deaths += int(_num(row, "deaths") or 0)
        assists += int(_num(row, "assists") or 0)
        team_kills += int(_num(row, "teamkills") or 0)
        minutes = (_num(g["teams"][side], "gamelength") or 0) / 60
        if minutes and _num(row, "total cs") is not None:
            cs += _num(row, "total cs")
            cs_minutes += minutes
        if minutes and _num(row, "damagetochampions") is not None:
            damage += _num(row, "damagetochampions")
            damage_minutes += minutes
        champion = row.get("champion") or ""
        if champion:
            champions.setdefault(champion, [0, 0])
            champions[champion][0] += 1
            champions[champion][1] += won
    return {
        "games": len(entries), "wins": wins, "kills": kills, "deaths": deaths, "assists": assists,
        # max(muertes, 1): un jugador que nunca murió no tiene KDA infinito
        "kda": round((kills + assists) / max(deaths, 1), 2),
        "cs_min": _ratio(cs, cs_minutes, 1),
        "dpm": _ratio(damage, damage_minutes, 0),
        "kp": _ratio(kills + assists, team_kills, 2),
        "champions": [{"name": name, "games": n, "wins": w}
                      for name, (n, w) in sorted(champions.items(), key=lambda kv: (-kv[1][0], kv[0]))],
    }


def _game_line(g: dict, side: str, row: dict) -> dict:
    """Una partida del historial de un jugador."""
    one = player_stats([(g, side, row)])
    other = "red" if side == "blue" else "blue"
    return {"date": g["date"][:10], "opponent": g[other], "champion": row.get("champion") or "",
            "won": g["winner"] == side, "kills": one["kills"], "deaths": one["deaths"], "assists": one["assists"],
            "cs_min": one["cs_min"], "dpm": one["dpm"], "worlds": g["page"] == WORLDS_PAGE}


def build_team_and_player_stats(oe_games: list[dict], oe_names: dict[str, str],
                                shorts: dict[str, str]) -> tuple[dict[str, dict], list[dict]]:
    """Stats de cada equipo de Worlds y de cada jugador que jugó para ellos en 2026.

    oe_names: nombre de Leaguepedia → nombre en Oracle's Elixir. Un jugador que cambió de equipo
    cuenta solo las partidas con su equipo actual.
    """
    worlds = [g for g in oe_games if g["page"] == WORLDS_PAGE]
    teams: dict[str, dict] = {}
    players: list[dict] = []
    used_ids: set[str] = set()
    for lp_name, oe_name in oe_names.items():
        team_id = slug(lp_name)
        # Partidas de cada jugador con este equipo, en orden cronológico
        entries: dict[str, list[tuple[dict, str, dict]]] = {}
        last_lineup: dict[str, str] = {}
        for g in oe_games:
            for side in ("blue", "red"):
                if g[side] != oe_name:
                    continue
                for role in ROLES:
                    row = g["players"][side].get(role)
                    if row and row.get("playername"):
                        entries.setdefault(row["playername"], []).append((g, side, row))
                        last_lineup[role] = row["playername"]
        ids: dict[str, str] = {}
        for name in entries:
            pid = slug(name)
            if pid in used_ids:  # mismo nombre en otro equipo: se agrega el equipo para que sea único
                pid = f"{pid}-{slug(shorts.get(lp_name, lp_name))}"
            used_ids.add(pid)
            ids[name] = pid
        for name, mine in entries.items():
            role = Counter(row["position"] for _, _, row in mine).most_common(1)[0][0]
            in_worlds = [e for e in mine if e[0]["page"] == WORLDS_PAGE]
            players.append({
                "id": ids[name], "name": name, "team_id": team_id, "team": lp_name, "role": role,
                "starter": last_lineup.get(role) == name,
                "season": player_stats(mine),
                "worlds": player_stats(in_worlds) if in_worlds else None,
                "history": [_game_line(*e) for e in reversed(mine[-HISTORY_GAMES:])],
            })
        season = team_stats(oe_games, oe_name)
        worlds_stats = team_stats(worlds, oe_name)
        teams[lp_name] = {
            "id": team_id,
            "roster": [ids[last_lineup[r]] for r in ROLES if r in last_lineup],
            "season": season,
            "worlds": worlds_stats if worlds_stats["games"] else None,
        }
    return teams, players
