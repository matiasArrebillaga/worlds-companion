"""Agregados del meta (campeones, draft, lados, ritmo, regiones) para champions.json y meta.json.

Fuente: games de Oracle's Elixir (models.oracles.parse_rows). Dos muestras: las partidas de Worlds y,
mientras Worlds tenga pocas, las de las ligas en el parche anterior como guía.
"""
from collections import defaultdict

WORLDS_PATCH = "16.20"
GUIDE_PATCH = "16.18"     # parche anterior presente en los datos (no hay partidas en 16.19)
GUIDE_UNTIL_GAMES = 10    # con esta cantidad de partidas de Worlds, la guía deja de publicarse
FIRST_ROTATION = 6        # picks 1 a 6 (B1 R1 R2 B2 B3 R3): la primera rotación del draft
# Posición global de cada pick del equipo en el draft (pick1 del azul es el primero de todos)
PICK_SLOTS = {"blue": (1, 4, 5, 8, 9), "red": (2, 3, 6, 7, 10)}


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
