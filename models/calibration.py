"""Calibración por temperatura: corrige un modelo que se pasa (o se queda corto) de confiado."""
from math import exp, log

from models.metrics import brier_score

# Valores de T que se prueban: < 1 acerca las probabilidades al 50%, > 1 las aleja
T_GRID = tuple(round(0.5 + i * 0.01, 2) for i in range(101))


def scale_probability(p: float, t: float) -> float:
    """Pasa la probabilidad a log-odds, la multiplica por t y vuelve a probabilidad.

    En el Elo, los log-odds son proporcionales a la diferencia de rating: multiplicar por t
    es lo mismo que achicar (o agrandar) todas las diferencias de rating en esa proporción.
    """
    p = min(max(p, 1e-9), 1 - 1e-9)
    logit = log(p / (1 - p))
    return 1.0 / (1.0 + exp(-t * logit))


def fit_temperature(probs: list[float], outcomes: list[float]) -> float:
    """El T de la grilla con menor Brier score sobre estos datos."""
    return min(T_GRID, key=lambda t: brier_score([scale_probability(p, t) for p in probs], outcomes))
