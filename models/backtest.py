"""Backtest del Elo: elegir K y los ajustes por región según qué tan bien predijo temporadas pasadas."""
from models.elo import Params, run_elo, series_probability
from models.metrics import brier_score

# Si el mejor valor cae en un borde de la grilla, el óptimo real puede estar más allá: hay que ampliarla
K_GRID = (4, 6, 8, 10, 12, 15, 20, 25, 30, 40)
OFFSET_GRID = tuple(range(-100, 601, 50))
# Regiones con ajuste propio. El resto (BR, APAC, VN, JP, LAT) queda en 0 y sirve de referencia:
# solo importan las diferencias, así que una región tiene que quedar fija.
TUNED_REGIONS = ("KR", "CN", "EU", "NA")


def cross_region_records(records: list[dict], regions: dict[str, str]) -> list[dict]:
    """Games entre equipos de regiones distintas: los únicos que ponen a prueba el ajuste regional."""
    selected = []
    for r in records:
        a, b = regions.get(r["blue"]), regions.get(r["red"])
        if a and b and a != b:
            selected.append(r)
    return selected


def objective(seasons: list[tuple[list[dict], dict[str, str]]], params: Params) -> float:
    """Brier score de los games entre regiones de todas las temporadas juntas.

    Cada temporada corre su propio Elo desde cero; la probabilidad de cada game es la de antes de jugarlo,
    así que el modelo nunca "ve" el resultado que está prediciendo.
    """
    probs, outcomes = [], []
    for games, regions in seasons:
        run = run_elo(games, params, regions)
        for r in cross_region_records(run.records, regions):
            probs.append(r["p_blue"])
            outcomes.append(r["blue_won"])
    return brier_score(probs, outcomes)


def _with(params: Params, name: str, value: float) -> Params:
    if name == "k":
        return Params(k=float(value), region_offsets=params.region_offsets)
    return Params(k=params.k, region_offsets={**params.region_offsets, name: float(value)})


def tune(seasons, start: Params = Params(k=20.0), max_sweeps: int = 5) -> tuple[Params, float]:
    """Búsqueda por coordenadas: para cada parámetro prueba todos los valores de su grilla con los
    demás quietos y se queda con el mejor. Repite hasta que una vuelta entera no mejora nada."""
    best, best_score = start, objective(seasons, start)
    for _ in range(max_sweeps):
        improved = False
        for name in ("k",) + TUNED_REGIONS:
            for value in K_GRID if name == "k" else OFFSET_GRID:
                candidate = _with(best, name, value)
                score = objective(seasons, candidate)
                if score < best_score - 1e-9:
                    best, best_score, improved = candidate, score, True
        if not improved:
            break
    return best, best_score


def worlds_series(records: list[dict], schedule_rows: list[dict]) -> tuple[list[float], list[float]]:
    """Probabilidad de ganar la serie (vista desde el equipo 1) y resultado real, por serie terminada.

    Se usa la probabilidad del primer game: es la que el modelo daba antes de que empezara la serie.
    """
    first: dict[str, dict] = {}
    for r in records:  # vienen en orden cronológico
        first.setdefault(r["match_id"], r)
    probs, outcomes = [], []
    for row in schedule_rows:
        rec = first.get(row["MatchId"])
        if rec is None or row.get("Winner") not in ("1", "2") or not row.get("BestOf"):
            continue
        if row["Team1"] not in (rec["blue"], rec["red"]):
            continue  # nombre distinto entre tablas: mejor no adivinar
        p_game = rec["p_blue"] if rec["blue"] == row["Team1"] else 1.0 - rec["p_blue"]
        probs.append(series_probability(p_game, int(row["BestOf"])))
        outcomes.append(1.0 if row["Winner"] == "1" else 0.0)
    return probs, outcomes
