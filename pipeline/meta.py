"""Agregados del meta (campeones, draft, lados, ritmo, regiones) para champions.json y meta.json.

Fuente: games de Oracle's Elixir (models.oracles.parse_rows). Dos muestras: las partidas de Worlds y,
mientras Worlds tenga pocas, las de las ligas en el parche anterior como guía.
"""
from collections import defaultdict
from statistics import median
from typing import Callable

from models.elo import team_regions
from pipeline.stats import _is_worlds

WORLDS_PATCH = "16.20"
GUIDE_PATCH = "16.18"     # parche anterior presente en los datos (no hay partidas en 16.19)
GUIDE_UNTIL_GAMES = 10    # con esta cantidad de partidas de Worlds, la guía deja de publicarse
FIRST_ROTATION = 6        # picks 1 a 6 (B1 R1 R2 B2 B3 R3): la primera rotación del draft
# Posición global de cada pick del equipo en el draft (pick1 del azul es el primero de todos)
PICK_SLOTS = {"blue": (1, 4, 5, 8, 9), "red": (2, 3, 6, 7, 10)}

PhaseFn = Callable[[str], str] | None


def draft_slots(game: dict) -> tuple[list[tuple[int, str]], list[tuple[int, str]]]:
    """(picks con su posición global 1-10, bans con su fase 1-2). Los vacíos se ignoran."""
    picks, bans = [], []
    for side in ("blue", "red"):
        row = game["teams"][side]
        for i, slot in enumerate(PICK_SLOTS[side], start=1):
            if row.get(f"pick{i}"):
                picks.append((slot, row[f"pick{i}"]))
        for i in range(1, 6):
            if row.get(f"ban{i}"):
                bans.append((1 if i <= 3 else 2, row[f"ban{i}"]))  # bans 1-3: primera fase
    return picks, bans


def _rate(part: int, total: int) -> float | None:
    return round(part / total, 4) if total else None


def champion_stats(games: list[dict]) -> list[dict]:
    """Por campeón: picks, bans, presencia = (picks + bans) / partidas, winrate y prioridad de draft.

    Presencia mide cuánto le importa el campeón al meta: uno baneado siempre tiene 0 picks y 100% de presencia.
    Los picks salen del campeón de cada jugador (siempre está); el orden del draft, de pick1-5 (puede faltar).
    """
    count = defaultdict(lambda: {"picks": 0, "bans": 0, "wins": 0, "first": 0})
    for g in games:
        for side in ("blue", "red"):
            for row in g["players"][side].values():
                champ = row.get("champion")
                if champ:
                    count[champ]["picks"] += 1
                    count[champ]["wins"] += g["winner"] == side
        picks, bans = draft_slots(g)
        for _, champ in bans:
            count[champ]["bans"] += 1
        # Primera rotación: pickeado entre los 6 primeros o baneado en la primera fase (una vez por partida)
        early = {c for slot, c in picks if slot <= FIRST_ROTATION} | {c for phase, c in bans if phase == 1}
        for champ in early:
            count[champ]["first"] += 1
    n = len(games)
    rows = [{"champion": champ, "games": n, "picks": c["picks"], "bans": c["bans"],
             "presence": _rate(c["picks"] + c["bans"], n), "wins": c["wins"],
             "winrate": _rate(c["wins"], c["picks"]), "first_rotation": _rate(c["first"], n)}
            for champ, c in count.items()]
    return sorted(rows, key=lambda r: (-r["presence"], r["champion"]))


def phase_of(date: str, schedule: list[dict]) -> str:
    """Fase de una partida de Worlds según el calendario (Oracle's Elixir no la trae)."""
    starts: dict[str, str] = {}
    for m in schedule:
        if m["date"]:
            starts[m["phase"]] = min(starts.get(m["phase"], m["date"]), m["date"])
    day = date[:10]
    if "knockout" in starts and day >= starts["knockout"]:
        return "knockout"
    if "swiss" in starts and day >= starts["swiss"]:
        return "swiss"
    return "play-in"


def _split_by_phase(games: list[dict], phase_fn: PhaseFn, summarize) -> dict:
    by_phase: dict[str, list[dict]] = defaultdict(list)
    if phase_fn:
        for g in games:
            by_phase[phase_fn(g["date"])].append(g)
    return {"total": summarize(games), "by_phase": {p: summarize(gs) for p, gs in by_phase.items()}}


def _sides(games: list[dict]) -> dict:
    wins = sum(g["winner"] == "blue" for g in games)
    blue = _rate(wins, len(games))
    return {"games": len(games), "blue_wins": wins, "blue_winrate": blue,
            "red_winrate": None if blue is None else round(1 - blue, 4)}


def side_stats(games: list[dict], phase_fn: PhaseFn = None) -> dict:
    """Winrate de cada lado, total y por fase. Ojo: en Bo3/Bo5 el perdedor elige lado (confusión)."""
    return _split_by_phase(games, phase_fn, _sides)


def _num(value) -> float | None:
    return float(value) if value not in (None, "") else None


def _pace(games: list[dict]) -> dict:
    minutes, kills, kill_minutes = [], 0.0, 0.0
    for g in games:
        seconds = _num(g["teams"]["blue"].get("gamelength"))
        if seconds is None:
            continue  # sin duración no hay ritmo; se ignora, no cuenta como 0
        minutes.append(seconds / 60)
        k = [_num(g["teams"][s].get("kills")) for s in ("blue", "red")]
        if None not in k:
            kills += sum(k)
            kill_minutes += seconds / 60
    return {"games": len(games), "median_minutes": round(median(minutes), 1) if minutes else None,
            # Ratio de totales (kills totales / minutos totales), no promedio de ratios
            "kills_per_min": round(kills / kill_minutes, 4) if kill_minutes else None}


def pace_stats(games: list[dict], phase_fn: PhaseFn = None) -> dict:
    """Duración mediana (una partida eterna no la mueve, al promedio sí) y kills por minuto."""
    return _split_by_phase(games, phase_fn, _pace)


def region_stats(games: list[dict], regions: dict[str, str]) -> list[dict]:
    """Winrate de cada región solo contra otras regiones: en un LCK vs LCK la región gana siempre el 50%."""
    count = defaultdict(lambda: [0, 0])  # región -> [partidas, victorias]
    for g in games:
        rb, rr = regions.get(g["blue"]), regions.get(g["red"])
        if rb is None or rr is None or rb == rr:
            continue
        for side, region in (("blue", rb), ("red", rr)):
            count[region][0] += 1
            count[region][1] += g["winner"] == side
    rows = [{"region": r, "games": n, "wins": w, "winrate": _rate(w, n)} for r, (n, w) in count.items()]
    return sorted(rows, key=lambda r: (-r["winrate"], r["region"]))


def build_meta(oe_games: list[dict], schedule: list[dict], worlds_start: str | None) -> dict:
    """Todo lo que publican champions.json y meta.json, por muestra ("worlds" y, si hace falta, "guide")."""
    regions = team_regions(oe_games)
    worlds = [g for g in oe_games if _is_worlds(g, worlds_start)]
    samples = {"worlds": worlds}
    if len(worlds) < GUIDE_UNTIL_GAMES:
        samples["guide"] = [g for g in oe_games if g["teams"]["blue"].get("patch") == GUIDE_PATCH]
    phase = lambda date: phase_of(date, schedule)
    return {
        "worlds_patch": WORLDS_PATCH,
        "guide_patch": GUIDE_PATCH if "guide" in samples else None,
        "worlds_games": len(worlds),
        "champions": {name: champion_stats(gs) for name, gs in samples.items()},
        "samples": {name: {
            "games": len(gs),
            # La guía son ligas: sus fases no son las de Worlds, así que solo el total
            "sides": side_stats(gs, phase if name == "worlds" else None),
            "pace": pace_stats(gs, phase if name == "worlds" else None),
            "regions": region_stats(gs, regions),
        } for name, gs in samples.items()},
    }
