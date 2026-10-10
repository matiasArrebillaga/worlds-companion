"""Estadísticas de equipos y jugadores para teams.json y players.json.

Fuente: games de Oracle's Elixir (models.oracles.read_extract). Los cocientes se calculan sobre
totales (ej. KDA = (K+A totales) / muertes totales), no como promedio de los cocientes de cada partida.
"""
import re
import unicodedata
from collections import Counter
from math import sqrt

from models.oracles import ROLES

WORLDS_PAGE = "WLDs"   # código de liga de Worlds en Oracle's Elixir (incluye clasificatorios regionales)
HISTORY_GAMES = 20     # últimas partidas que se guardan por jugador
FIRSTS = {"first_blood": "firstblood", "first_dragon": "firstdragon", "first_tower": "firsttower"}
Z95 = 1.96             # intervalos de confianza del 95%


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


def wilson(wins: int, n: int) -> tuple[float | None, float | None]:
    """Intervalo de confianza del 95% de una proporción (Wilson).

    El de libro (p ± 1,96·√(p(1−p)/n)) falla con pocas partidas: con 3 de 3 da [100%, 100%] y con 0 de 3 baja
    de 0. Wilson corre el centro hacia 50% y nunca se sale de [0, 1]. Se lee: "el valor real está acá con 95% de
    confianza".
    """
    if not n:
        return None, None
    p, z2 = wins / n, Z95 ** 2
    den = 1 + z2 / n
    center = (p + z2 / (2 * n)) / den
    half = Z95 * sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / den
    return round(max(center - half, 0.0), 4), round(min(center + half, 1.0), 4)


def team_stats(games: list[dict], team: str) -> dict:
    played = wins = 0
    sides = {"blue": {"games": 0, "wins": 0}, "red": {"games": 0, "wins": 0}}
    minutes = minutes_games = gold = gold_minutes = 0.0
    firsts = {name: [0, 0.0] for name in FIRSTS}  # [partidas con dato, veces que lo consiguió]
    gd15 = gd15_games = 0.0  # diferencia de oro al minuto 15 (a parte de la LPL le falta)
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
            diff = _num(row, "golddiffat15")
            if diff is not None:
                gd15 += diff
                gd15_games += 1
    stats = {
        "games": played, "wins": wins, "winrate": _ratio(wins, played, 3),
        **dict(zip(("winrate_low", "winrate_high"), wilson(wins, played))),
        "blue": sides["blue"], "red": sides["red"],
        "avg_minutes": _ratio(minutes, minutes_games, 1),
        "gold_per_min": _ratio(gold, gold_minutes, 0),
        "gd15": _ratio(gd15, gd15_games, 0),
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


def _is_worlds(g: dict, worlds_start: str | None) -> bool:
    """Partida del Worlds en sí: Oracle's Elixir usa "WLDs" también para clasificatorios regionales
    (ej. el de la LPL en septiembre), así que además tiene que ser desde el primer día del torneo."""
    return g["page"] == WORLDS_PAGE and worlds_start is not None and g["date"][:10] >= worlds_start[:10]


def _game_line(g: dict, side: str, row: dict, worlds_start: str | None) -> dict:
    """Una partida del historial de un jugador."""
    one = player_stats([(g, side, row)])
    other = "red" if side == "blue" else "blue"
    return {"date": g["date"][:10], "opponent": g[other], "champion": row.get("champion") or "",
            "won": g["winner"] == side, "kills": one["kills"], "deaths": one["deaths"], "assists": one["assists"],
            "cs_min": one["cs_min"], "dpm": one["dpm"], "worlds": _is_worlds(g, worlds_start)}


def build_team_and_player_stats(oe_games: list[dict], oe_names: dict[str, str], shorts: dict[str, str],
                                worlds_start: str | None = None,
                                forms: dict[str, float] | None = None) -> tuple[dict[str, dict], list[dict]]:
    """Stats de cada equipo de Worlds y de cada jugador que jugó para ellos en 2026.

    oe_names: nombre de Leaguepedia → nombre en Oracle's Elixir. worlds_start: primer día del torneo
    (sin él, todavía no hay período Worlds). forms: forma del modelo elo-2 ('rol:nombre' → z, de
    models.features.player_forms). Un jugador que cambió de equipo aparece solo en su equipo
    actual (el de su última partida) y cuenta solo las partidas con ese equipo.
    """
    forms = forms or {}
    worlds = [g for g in oe_games if _is_worlds(g, worlds_start)]
    # "vs. Worlds": solo partidas entre dos equipos clasificados. Compara a todos contra la misma vara
    # (un 70% contra la VCS no es un 70% contra la LCK)
    qualified = set(oe_names.values())
    vs_worlds = [g for g in oe_games if g["blue"] in qualified and g["red"] in qualified]
    # Equipo actual de cada jugador (nombre + rol: dos personas distintas con el mismo nombre suelen jugar otro rol)
    current_team: dict[tuple[str, str], str] = {}
    for g in oe_games:
        for side in ("blue", "red"):
            for role, row in g["players"][side].items():
                if row.get("playername"):
                    current_team[(row["playername"], role)] = g[side]
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
                    if row and row.get("playername") and current_team[(row["playername"], role)] == oe_name:
                        entries.setdefault(row["playername"], []).append((g, side, row))
                    if row and row.get("playername"):
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
            in_worlds = [e for e in mine if _is_worlds(e[0], worlds_start)]
            players.append({
                "id": ids[name], "name": name, "team_id": team_id, "team": lp_name, "role": role,
                "starter": last_lineup.get(role) == name,
                "form": round(forms[f"{role}:{name}"], 2) if f"{role}:{name}" in forms else None,
                "season": player_stats(mine),
                "worlds": player_stats(in_worlds) if in_worlds else None,
                "history": [_game_line(*e, worlds_start) for e in reversed(mine[-HISTORY_GAMES:])],
            })
        season = team_stats(oe_games, oe_name)
        worlds_stats = team_stats(worlds, oe_name)
        vs_stats = team_stats(vs_worlds, oe_name)
        teams[lp_name] = {
            "id": team_id,
            # Si un titular de la última partida ya se fue a otro equipo, no figura en el plantel
            "roster": [ids[last_lineup[r]] for r in ROLES if last_lineup.get(r) in ids],
            "season": season,
            "worlds": worlds_stats if worlds_stats["games"] else None,
            "vs_worlds": vs_stats if vs_stats["games"] else None,
        }
    return teams, players


def elo_history(records: list[dict], team: str) -> list[list]:
    """[[fecha, rating después de la partida]] de un equipo, en orden cronológico."""
    history = []
    for r in records:
        for side in ("blue", "red"):
            if r[side] == team:
                history.append([r["date"][:10], round(r[f"rating_{side}"], 1)])
    return history


def series_list(records: list[dict], team: str) -> list[dict]:
    """Series del equipo (una por match_id) con el resultado, de la más nueva a la más vieja."""
    series: dict[str, dict] = {}
    for r in records:
        if team not in (r["blue"], r["red"]):
            continue
        side = "blue" if r["blue"] == team else "red"
        s = series.setdefault(r["match_id"], {"date": r["date"][:10], "opponent": r["red" if side == "blue" else "blue"],
                                              "page": r["page"], "wins": 0, "losses": 0})
        if r["winner"] == side:
            s["wins"] += 1
        else:
            s["losses"] += 1
    return sorted(series.values(), key=lambda s: s["date"], reverse=True)
