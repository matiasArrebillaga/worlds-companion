"""Dos cambios a CÓMO aprende el Elo, para el experimento de notebooks/experiment_elo_learning.ipynb.

A. Arrastre entre temporadas (carry): cada equipo arranca el año con una parte de lo que terminó por
   encima (o por debajo) del valor inicial de su región el año anterior:
       inicio = 1500 + ajuste_región + carry × (rating_final_anterior − inicio_anterior)
   carry = 0 es el Elo actual (todos arrancan de cero); carry = 1 no olvida nada.
B. Fuerza de región compartida (pool): en un game entre regiones distintas, además de los dos equipos
   se mueve un "rating de región" que comparten todos los equipos de esa región:
       rating efectivo = rating del equipo + rating de su región
       cambio de región = pool × cambio del equipo
   pool = 0 es el Elo actual (solo se mueven los dos equipos que jugaron).

Con carry = 0 y pool = 0 da exactamente lo mismo que models.elo.run_elo (hay un test que lo verifica).
"""
from dataclasses import dataclass, field

from models.elo import BASE_RATING, EloRun, win_probability


@dataclass(frozen=True)
class LearningParams:
    k: float
    region_offsets: dict[str, float] = field(default_factory=dict)
    carry: float = 0.0
    pool: float = 0.0


@dataclass
class LearningRun(EloRun):
    # Cuánto terminó cada equipo por encima del valor con el que arrancan los de su región:
    # es lo que se arrastra al año siguiente
    final_deviation: dict[str, float] = field(default_factory=dict)


def run_season(games: list[dict], params: LearningParams, regions: dict[str, str],
               prior: dict[str, float] | None = None) -> LearningRun:
    """Recorre una temporada en orden. `prior` = final_deviation de la temporada anterior (o None)."""
    from collections import Counter

    prior = prior or {}
    ratings: dict[str, float] = {}
    region_rating: dict[str, float] = {}
    played: Counter = Counter()
    records: list[dict] = []

    def start(team: str) -> float:
        # Valor inicial de los equipos de su región (el mismo que usa el Elo actual)
        return BASE_RATING + params.region_offsets.get(regions.get(team), 0.0)

    def effective(team: str) -> float:
        return ratings[team] + region_rating.get(regions.get(team), 0.0)

    for g in games:
        blue, red = g["blue"], g["red"]
        for team in (blue, red):
            if team not in ratings:
                ratings[team] = start(team) + params.carry * prior.get(team, 0.0)
        p_blue = win_probability(effective(blue), effective(red))
        blue_won = 1.0 if g["winner"] == "blue" else 0.0
        change = params.k * (blue_won - p_blue)
        ratings[blue] += change
        ratings[red] -= change
        # B: solo en games entre dos regiones conocidas y distintas
        region_blue, region_red = regions.get(blue), regions.get(red)
        if params.pool and region_blue and region_red and region_blue != region_red:
            region_rating[region_blue] = region_rating.get(region_blue, 0.0) + params.pool * change
            region_rating[region_red] = region_rating.get(region_red, 0.0) - params.pool * change
        played[blue] += 1
        played[red] += 1
        records.append({**g, "p_blue": p_blue, "blue_won": blue_won,
                        "rating_blue": effective(blue), "rating_red": effective(red)})

    final = {team: effective(team) for team in ratings}
    deviation = {team: final[team] - start(team) for team in ratings}
    return LearningRun(final, played, records, deviation)


def run_chain(seasons: list[tuple[list[dict], dict[str, str]]], params: LearningParams) -> list[LearningRun]:
    """Corre varias temporadas seguidas; cada una arranca con el arrastre de la anterior.
    La primera arranca sin historia (no hay año previo en los datos)."""
    runs: list[LearningRun] = []
    prior = None
    for games, regions in seasons:
        run = run_season(games, params, regions, prior)
        runs.append(run)
        prior = run.final_deviation
    return runs
