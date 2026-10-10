"""Elo por partida (game) para equipos de LoL.

Uso: python -m models.elo   (corre el Elo sobre la temporada actual y muestra el ranking)
"""
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from math import comb

BASE_RATING = 1500.0
# Escala clásica del Elo: 400 puntos de diferencia = el favorito gana 10 de cada 11
SCALE = 400.0


@dataclass(frozen=True)
class Params:
    k: float
    region_offsets: dict[str, float] = field(default_factory=dict)


# Elegidos con notebooks/backtest.ipynb: calibrado con 2024, validado con 2025, ajuste final con ambos.
# Los ajustes son relativos a las regiones sin ajuste propio (BR, APAC, VN, JP, LAT), que arrancan en 1500.
# elo-2: Elo + forma de los jugadores por rol (models/role_form.py)
MODEL_VERSION = "elo-2"
PARAMS = Params(k=10.0, region_offsets={"KR": 300.0, "CN": 200.0, "EU": 100.0, "NA": 100.0})
BACKTEST = {
    "calibration_year": 2024, "validation_year": 2025,
    "validation_games": 217, "validation_brier": 0.2216, "baseline_brier": 0.2349,
    "worlds_series": 41, "worlds_accuracy": 0.7073, "worlds_brier": 0.1871,
}


def win_probability(rating_a: float, rating_b: float) -> float:
    """Probabilidad de que A le gane un game a B."""
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / SCALE))


def series_probability(p_game: float, best_of: int) -> float:
    """Probabilidad de ganar la serie si cada game se gana con p_game (games independientes).

    Para ganar un Bo5 hay que llegar a 3 victorias: 3-0, 3-1 o 3-2.
    Ganar 3-j significa que el último game es victoria y que en los anteriores hubo
    exactamente j derrotas, que pueden caer en comb(2 + j, j) órdenes distintos.
    """
    if best_of < 1 or best_of % 2 == 0:
        raise ValueError(f"best_of must be odd and positive, got {best_of}")
    needed = best_of // 2 + 1
    q = 1.0 - p_game
    return sum(comb(needed - 1 + j, j) * p_game**needed * q**j for j in range(needed))


def team_regions(games: list[dict]) -> dict[str, str]:
    """Región de cada equipo: la de la liga donde jugó más games (los internacionales no cuentan)."""
    counts: dict[str, Counter] = defaultdict(Counter)
    for g in games:
        if g["region"] is None:
            continue
        for team in (g["blue"], g["red"]):
            counts[team][g["region"]] += 1
    return {team: c.most_common(1)[0][0] for team, c in counts.items()}


@dataclass
class EloRun:
    ratings: dict[str, float]
    games_played: Counter
    # Una fila por game con la probabilidad que daba el modelo ANTES de jugarlo
    records: list[dict]


def run_elo(games: list[dict], params: Params, regions: dict[str, str]) -> EloRun:
    """Recorre los games en orden y actualiza los ratings después de cada uno.

    Cada equipo arranca en 1500 + el ajuste de su región. Después de cada game:
    rating += K × (resultado − probabilidad esperada). Lo que gana uno lo pierde el otro.
    """
    ratings: dict[str, float] = {}
    played: Counter = Counter()
    records: list[dict] = []
    for g in games:
        blue, red = g["blue"], g["red"]
        for team in (blue, red):
            if team not in ratings:
                ratings[team] = BASE_RATING + params.region_offsets.get(regions.get(team), 0.0)
        p_blue = win_probability(ratings[blue], ratings[red])
        blue_won = 1.0 if g["winner"] == "blue" else 0.0
        change = params.k * (blue_won - p_blue)
        ratings[blue] += change
        ratings[red] -= change
        played[blue] += 1
        played[red] += 1
        records.append({**g, "p_blue": p_blue, "blue_won": blue_won})
    return EloRun(ratings, played, records)


def main() -> None:
    # Import local: pipeline importa models, así se evita un import circular
    from pathlib import Path

    from pipeline.history import CURRENT_YEAR, load_aliases, load_season_games

    games = load_season_games(Path("data/raw"), CURRENT_YEAR, load_aliases(Path("data/teams.csv")))
    regions = team_regions(games)
    run = run_elo(games, PARAMS, regions)
    top = sorted(run.ratings.items(), key=lambda item: -item[1])[:25]
    print(f"{MODEL_VERSION} · K={PARAMS.k} · offsets={PARAMS.region_offsets} · {len(games)} games")
    for i, (team, rating) in enumerate(top, 1):
        print(f"{i:>2}. {team:<36} {regions.get(team, '-'):<5} {rating:7.1f}  ({run.games_played[team]} games)")


if __name__ == "__main__":
    main()
