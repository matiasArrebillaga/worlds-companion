"""Métricas para evaluar probabilidades.

Todas reciben listas paralelas: probabilidad de que gane el equipo 1 (o el lado azul)
y resultado real (1.0 = ganó, 0.0 = perdió).
"""

CALIBRATION_BUCKETS = (("50–60%", 0.5, 0.6), ("60–70%", 0.6, 0.7), ("70%+", 0.7, 1.01))


def brier_score(probs: list[float], outcomes: list[float]) -> float | None:
    """Error cuadrático medio entre probabilidad y resultado. 0 es perfecto; decir siempre 50% da 0.25."""
    if not probs:
        return None
    return sum((p - o) ** 2 for p, o in zip(probs, outcomes)) / len(probs)


def _favorite(p: float, outcome: float) -> tuple[float, float]:
    """(probabilidad del favorito, 1.0 si el favorito ganó). Con 50% exacto, el favorito es el equipo 1."""
    return (p, outcome) if p >= 0.5 else (1.0 - p, 1.0 - outcome)


def accuracy(probs: list[float], outcomes: list[float]) -> float | None:
    """Fracción de partidos en los que ganó el favorito del modelo."""
    if not probs:
        return None
    return sum(_favorite(p, o)[1] for p, o in zip(probs, outcomes)) / len(probs)


def calibration(probs: list[float], outcomes: list[float]) -> list[dict]:
    """Agrupa por la probabilidad del favorito. En cada tramo: cuántos partidos, qué probabilidad
    daba el modelo en promedio (predicted) y con qué frecuencia ganó de verdad el favorito (observed)."""
    favorites = [_favorite(p, o) for p, o in zip(probs, outcomes)]
    rows = []
    for label, low, high in CALIBRATION_BUCKETS:
        inside = [(fp, won) for fp, won in favorites if low <= fp < high]
        n = len(inside)
        rows.append({
            "label": label,
            "n": n,
            "predicted": round(sum(fp for fp, _ in inside) / n, 4) if n else None,
            "observed": round(sum(won for _, won in inside) / n, 4) if n else None,
        })
    return rows


def summarize(probs: list[float], outcomes: list[float]) -> dict:
    """Resumen listo para exportar (números redondeados a 4 decimales)."""
    acc = accuracy(probs, outcomes)
    brier = brier_score(probs, outcomes)
    return {
        "n": len(probs),
        "correct": int(sum(_favorite(p, o)[1] for p, o in zip(probs, outcomes))),
        "accuracy": round(acc, 4) if acc is not None else None,
        "brier": round(brier, 4) if brier is not None else None,
        "calibration": calibration(probs, outcomes),
    }


def log_loss(probs: list[float], outcomes: list[float]) -> float | None:
    """Pérdida logarítmica: castiga mucho más que el Brier equivocarse con mucha confianza. Moneda = 0.693."""
    from math import log
    if not probs:
        return None
    eps = 1e-9
    return -sum(o * log(max(p, eps)) + (1 - o) * log(max(1 - p, eps)) for p, o in zip(probs, outcomes)) / len(probs)


def bootstrap_brier_diff(probs_a: list[float], probs_b: list[float], outcomes: list[float],
                         clusters: list[str], reps: int = 2000, seed: int = 0) -> dict:
    """Diferencia de Brier (A − B; negativo = A es mejor) con intervalo de confianza del 95%.

    Bootstrap por grupos: se sortean series enteras con reposición, porque los games de una misma
    serie no son independientes (mismos equipos, mismo día). Si el intervalo no incluye el 0,
    la diferencia difícilmente sea suerte.
    """
    import random
    # Por cada serie: suma de (error² de A − error² de B) y cantidad de games
    groups: dict[str, list[float]] = {}
    for pa, pb, o, c in zip(probs_a, probs_b, outcomes, clusters):
        total, n = groups.get(c, [0.0, 0])
        groups[c] = [total + (pa - o) ** 2 - (pb - o) ** 2, n + 1]
    sums = list(groups.values())
    rng = random.Random(seed)
    diffs = []
    for _ in range(reps):
        sample = [sums[rng.randrange(len(sums))] for _ in sums]
        diffs.append(sum(s for s, _ in sample) / sum(n for _, n in sample))
    diffs.sort()
    point = sum(s for s, _ in sums) / sum(n for _, n in sums)
    return {"diff": round(point, 6), "low": round(diffs[int(0.025 * reps)], 6),
            "high": round(diffs[int(0.975 * reps) - 1], 6)}
