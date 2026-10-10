"""Variables de momentum para notebooks/experiment_momentum.ipynb.

"Sorpresa" de un equipo en un game = resultado − probabilidad que le daba el Elo (positivo = rindió
más de lo esperado). Todas las variables se arman con games anteriores y son antisimétricas.
"""
from collections import defaultdict, deque
from datetime import datetime, timedelta
from functools import lru_cache
from math import exp

WINDOW = 10        # últimas N partidas para la sorpresa acumulada
TREND_DAYS = 21    # ventana de la tendencia del Elo
FEATURES = ("d_over", "d_trend", "d_tourney", "x_prev")


def _parse(date: str) -> datetime:
    return datetime.strptime(date[:19], "%Y-%m-%d %H:%M:%S")


def momentum_features(records: list[dict], window: int = WINDOW, days: int = TREND_DAYS) -> list[dict]:
    """Una fila por game (vista desde el lado azul):

    - d_over: sorpresa acumulada en las últimas `window` partidas (azul − rojo).
    - d_trend: lo mismo pero en los últimos `days` días. Como el Elo cambia K × sorpresa, esto es la
      pendiente del rating medida en tiempo en vez de en partidas.
    - d_tourney: sorpresa acumulada dentro del torneo internacional en curso (0 en partidas de liga).
    - x_prev: +1 si el lado azul ganó el game anterior de la serie, −1 si lo perdió, 0 en el primero.
    """
    recent: dict[str, deque] = defaultdict(lambda: deque(maxlen=window))
    timed: dict[str, deque] = defaultdict(deque)
    tourney: dict[tuple, float] = defaultdict(float)
    previous_winner: dict[str, str] = {}
    rows = []
    for r in records:
        when = _parse(r["date"])
        blue, red = r["blue"], r["red"]

        def trend(team: str) -> float:
            q = timed[team]
            while q and q[0][0] < when - timedelta(days=days):
                q.popleft()  # fuera de la ventana: se olvida
            return sum(x for _, x in q)

        international = r["region"] is None
        prev = previous_winner.get(r["match_id"])
        rows.append({
            "d_over": sum(recent[blue]) - sum(recent[red]),
            "d_trend": trend(blue) - trend(red),
            "d_tourney": tourney[(r["page"], blue)] - tourney[(r["page"], red)] if international else 0.0,
            "x_prev": 0.0 if prev is None else (1.0 if prev == blue else -1.0),
        })

        # Recién ahora se aprende de este game
        surprise = r["blue_won"] - r["p_blue"]
        for team, x in ((blue, surprise), (red, -surprise)):
            recent[team].append(x)
            timed[team].append((when, x))
            if international:
                tourney[(r["page"], team)] += x
        previous_winner[r["match_id"]] = blue if r["blue_won"] else red
    return rows


def series_probability_momentum(z: float, w: float, best_of: int) -> float:
    """Probabilidad de ganar la serie cuando los games NO son independientes.

    z = log-odds de ganar el primer game. Después de ganar un game los log-odds del siguiente
    pasan a z + w y después de perder a z − w. Con w = 0 da lo mismo que series_probability.
    Se recorre el árbol de resultados posibles (como mucho 5 games: es chico).
    """
    needed = best_of // 2 + 1
    sigmoid = lambda x: 1.0 / (1.0 + exp(-x))

    @lru_cache(maxsize=None)
    def win_from(wins: int, losses: int, last: int) -> float:
        if wins == needed:
            return 1.0
        if losses == needed:
            return 0.0
        p = sigmoid(z + w * last)  # last: +1 ganó el anterior, −1 lo perdió, 0 primer game
        return p * win_from(wins + 1, losses, 1) + (1 - p) * win_from(wins, losses + 1, -1)

    return win_from(0, 0, 0)
