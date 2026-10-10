"""Agregados del meta (campeones, draft, lados, ritmo, regiones) para champions.json y meta.json.

Fuente: games de Oracle's Elixir (models.oracles.parse_rows). Dos muestras: las partidas de Worlds y,
mientras Worlds tenga pocas, las de las ligas en los últimos parches como guía.
"""
from collections import defaultdict
from statistics import median, quantiles
from typing import Callable

from models.elo import team_regions
from pipeline.stats import _is_worlds, player_stats, wilson

WORLDS_PATCH = "16.20"
# Guía: los últimos parches que jugaron las ligas principales antes de Worlds (no hay partidas en 16.19;
# en 16.18 solo jugó la VCS, así que solo no alcanza)
GUIDE_PATCHES = ("16.17", "16.18")
GUIDE_LABEL = "16.17–16.18"
GUIDE_UNTIL_GAMES = 10    # con esta cantidad de partidas de Worlds, la guía deja de publicarse
FIRST_ROTATION = 6        # picks 1 a 6 (B1 R1 R2 B2 B3 R3): la primera rotación del draft
# Posición global de cada pick del equipo en el draft (pick1 del azul es el primero de todos)
PICK_SLOTS = {"blue": (1, 4, 5, 8, 9), "red": (2, 3, 6, 7, 10)}
NOISE_MIN_PICKS = 5       # campeones que entran en la medición de ruido de cada muestra
PRIOR_MIN_PICKS = 20      # campeones que entran en la estimación de k (temporada de las ligas)
MAX_PRIOR = 1000          # k cuando no se ve ninguna diferencia real: todo queda en 50%

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
    """Por campeón: picks, bans, presencia, winrate y prioridad de draft.

    Presencia = probabilidad de que el campeón aparezca en una partida (pickeado o baneado). Como en una partida
    un campeón no puede ser las dos cosas, es % de picks + % de bans. Uno baneado siempre: 0 picks, 100%.
    Cada parte usa como denominador solo las partidas donde ese dato existe: Oracle's Elixir a veces publica
    partidas sin bans o sin orden de picks, y contarlas como "no apareció" bajaría los números (un dato faltante
    no es un 0). Los picks salen del campeón de cada jugador (siempre está); el orden, de pick1-5.
    """
    count = defaultdict(lambda: {"picks": 0, "bans": 0, "wins": 0, "first": 0, "roles": defaultdict(int), "entries": []})
    ban_games = draft_games = 0
    for g in games:
        for side in ("blue", "red"):
            for role, row in g["players"][side].items():
                champ = row.get("champion")
                if champ:
                    count[champ]["picks"] += 1
                    count[champ]["wins"] += g["winner"] == side
                    count[champ]["roles"][role] += 1
                    count[champ]["entries"].append((g, side, row))  # para KDA, CS/min, etc., igual que en jugadores
        picks, bans = draft_slots(g)
        ban_games += bool(bans)
        for _, champ in bans:
            count[champ]["bans"] += 1
        if picks:
            # Primera rotación: pickeado entre los 6 primeros o baneado en la primera fase (una vez por partida)
            draft_games += 1
            early = {c for slot, c in picks if slot <= FIRST_ROTATION} | {c for phase, c in bans if phase == 1}
            for champ in early:
                count[champ]["first"] += 1
    n = len(games)
    rows = []
    for champ, c in count.items():
        pick_rate = _rate(c["picks"], n)
        ban_rate = _rate(c["bans"], ban_games) if ban_games else 0.0
        # Muestras distintas (partidas con bans vs. todas) pueden pasarse apenas de 1
        presence = round(min(pick_rate + ban_rate, 1.0), 4) if pick_rate is not None else None
        player = player_stats(c["entries"]) if c["entries"] else {}
        low, high = wilson(c["wins"], c["picks"])
        rows.append({"champion": champ, "games": n, "picks": c["picks"], "bans": c["bans"],
                     "pick_rate": pick_rate, "ban_rate": ban_rate, "presence": presence,
                     "wins": c["wins"], "winrate": _rate(c["wins"], c["picks"]), "winrate_low": low, "winrate_high": high,
                     "first_rotation": _rate(c["first"], draft_games),
                     "kda": player.get("kda"), "cs_min": player.get("cs_min"), "dpm": player.get("dpm"),
                     "kp": player.get("kp"), "roles": dict(c["roles"])})
    return sorted(rows, key=lambda r: (-r["presence"], r["champion"]))


def winrate_noise(rows: list[dict]) -> dict | None:
    """¿Cuánto de la diferencia de % de victorias entre campeones es azar?

    Aunque todos los campeones fueran igual de buenos, se verían diferencias: con n picks, el % de un campeón
    varía por azar con varianza p(1−p)/n (binomial). Se compara la dispersión observada con la que daría el
    puro azar (estimador de momentos, el mismo de los meta-análisis):
      S = Σ n·(p̂ − p̄)²                dispersión observada, ponderada por picks
      azar esperado = (m − 1)·p̄(1−p̄)   lo que valdría S si no hubiera diferencias reales
      varianza real τ² = (S − azar) / (N − Σn²/N)
    p̄ es el % de todos los picks juntos (siempre ~50%: en cada partida ganan 5 picks y pierden 5).
    """
    rows = [r for r in rows if r["picks"]]
    m = len(rows)
    if m < 2:
        return None
    total = sum(r["picks"] for r in rows)
    pooled = sum(r["wins"] for r in rows) / total
    spread = sum(r["picks"] * (r["wins"] / r["picks"] - pooled) ** 2 for r in rows)
    chance = (m - 1) * pooled * (1 - pooled)
    true_var = max(spread - chance, 0.0) / (total - sum(r["picks"] ** 2 for r in rows) / total)
    return {"champions": m, "picks": total,
            "observed_var": round(spread / total, 5), "noise_var": round(chance / total, 5),
            "noise_share": round(min(chance / spread, 1.0), 4) if spread else 1.0,
            "true_var": round(true_var, 5)}


def prior_picks(games: list[dict], min_picks: int = PRIOR_MIN_PICKS) -> int:
    """k del % de victorias ajustado: cuántos picks "imaginarios" al 50% se suman a cada campeón.

    k = p̄(1−p̄) / τ²: si las diferencias reales entre campeones son chicas (τ² chico), hacen falta muchas
    partidas para creerle a un % alejado de 50%, y k es grande. Un campeón con k picks propios pesa lo mismo
    que el 50%. Se estima con la temporada de las ligas (muchas partidas), no con Worlds.
    """
    noise = winrate_noise([r for r in champion_stats(games) if r["picks"] >= min_picks])
    if not noise or noise["true_var"] <= 0:
        return MAX_PRIOR  # sin diferencias reales visibles: todo se encoge a 50%
    return int(min(max(round(0.25 / noise["true_var"]), 1), MAX_PRIOR))


def adjust_winrates(rows: list[dict], k: int) -> list[dict]:
    """% de victorias ajustado (encogimiento bayesiano): (victorias + k/2) / (picks + k).

    Es un promedio entre el dato del campeón y 50%, pesado por cuántas partidas tiene: 3 de 3 queda apenas
    arriba de 50%; 180 de 300 queda cerca de su 60%. Ordenar por este número no premia la suerte.
    """
    for r in rows:
        r["winrate_adj"] = round((r["wins"] + k / 2) / (r["picks"] + k), 4) if r["picks"] else None
    return rows


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
    low, high = wilson(wins, len(games))  # rango del % del azul
    return {"games": len(games), "blue_wins": wins, "blue_winrate": blue,
            "red_winrate": None if blue is None else round(1 - blue, 4), "low": low, "high": high}


def side_stats(games: list[dict], phase_fn: PhaseFn = None) -> dict:
    """Winrate de cada lado: total, por fase y partida 1 vs. el resto.

    Ojo: en Bo3/Bo5 el perdedor elige lado (confusión). En la partida 1 nadie viene de perder, así que es la
    medición más limpia de la ventaja del lado.
    """
    result = _split_by_phase(games, phase_fn, _sides)
    result["by_game"] = {"first": _sides([g for g in games if g.get("game", 1) == 1]),
                         "rest": _sides([g for g in games if g.get("game", 1) > 1])}
    return result


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
    # Cuartiles: entre p25 y p75 está la mitad de las partidas (con una sola partida, los dos son esa)
    q1, _, q3 = quantiles(minutes, n=4, method="inclusive") if len(minutes) > 1 else (minutes or [None]) * 3
    return {"games": len(games), "median_minutes": round(median(minutes), 1) if minutes else None,
            # Ratio de totales (kills totales / minutos totales), no promedio de ratios
            "kills_per_min": round(kills / kill_minutes, 4) if kill_minutes else None,
            "p25_minutes": None if q1 is None else round(q1, 1), "p75_minutes": None if q3 is None else round(q3, 1)}


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
    rows = [{"region": r, "games": n, "wins": w, "winrate": _rate(w, n), **dict(zip(("low", "high"), wilson(w, n)))}
            for r, (n, w) in count.items()]
    return sorted(rows, key=lambda r: (-r["winrate"], r["region"]))


def build_meta(oe_games: list[dict], schedule: list[dict], worlds_start: str | None) -> dict:
    """Todo lo que publican champions.json y meta.json, por muestra ("worlds" y, si hace falta, "guide")."""
    regions = team_regions(oe_games)
    worlds = [g for g in oe_games if _is_worlds(g, worlds_start)]
    guide = [g for g in oe_games if g["teams"]["blue"].get("patch") in GUIDE_PATCHES]
    samples = {"worlds": worlds}
    if len(worlds) < GUIDE_UNTIL_GAMES:
        samples["guide"] = guide
    phase = lambda date: phase_of(date, schedule)
    # k sale de la temporada de las ligas regionales: Worlds solo no alcanza para estimarlo
    k = prior_picks([g for g in oe_games if g["region"] is not None])
    champions = {name: adjust_winrates(champion_stats(gs), k) for name, gs in samples.items()}
    # La guía se sigue calculando (aunque ya no se publique) para ver qué cambió con el parche de Worlds
    guide_presence = {r["champion"]: r["presence"] for r in champion_stats(guide)}
    for r in champions["worlds"]:
        r["guide_presence"] = guide_presence.get(r["champion"], 0.0) if guide else None
    return {
        "worlds_patch": WORLDS_PATCH,
        "guide_patch": GUIDE_LABEL if "guide" in samples else None,
        "worlds_games": len(worlds),
        "prior_picks": k,
        "champions": champions,
        "analysis": {name: winrate_noise([r for r in rows if r["picks"] >= NOISE_MIN_PICKS])
                     for name, rows in champions.items()},
        "samples": {name: {
            "games": len(gs),
            # La guía son ligas: sus fases no son las de Worlds, así que solo el total
            "sides": side_stats(gs, phase if name == "worlds" else None),
            "pace": pace_stats(gs, phase if name == "worlds" else None),
            "regions": region_stats(gs, regions),
        } for name, gs in samples.items()},
    }
