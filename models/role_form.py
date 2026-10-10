"""Ajuste por forma de los jugadores (modelo elo-2).

La probabilidad de ganar un game es la del Elo corregida por la forma de cada rol:
    log-odds = log-odds del Elo + Σ peso_rol × (forma_rol_A − forma_rol_B) / escala_rol
El Elo entra con peso fijo 1: los pesos solo dicen cuánto agrega la forma encima del Elo.
Elegido con notebooks/experiment_variables.ipynb; los pesos se ajustan con:

    python -m models.role_form   (necesita los CSV de 2024 y 2025: python -m pipeline.fetch_oracles --history)
"""
import json
import re
from pathlib import Path

MODEL_FILE = Path(__file__).with_name("role_form.json")


def load_model(path: Path = MODEL_FILE) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def norms_of(model: dict) -> dict[tuple[str, str], tuple[float, float]]:
    """Promedios y desvíos por rol guardados en el modelo, en el formato de models.features."""
    return {(role, metric): tuple(v) for role, metrics in model["norms"].items() for metric, v in metrics.items()}


def resolve_team(name: str, lineups: dict) -> str | None:
    """Nombre de Leaguepedia → nombre en Oracle's Elixir. Leaguepedia a veces agrega una aclaración
    entre paréntesis ('LYON (2024 American Team)'); Oracle's Elixir no."""
    if name in lineups:
        return name
    plain = re.sub(r"\s*\(.*\)$", "", name)
    return plain if plain in lineups else None


def adjustment(team1: str, team2: str, lineups: dict, forms: dict[str, float], model: dict) -> float:
    """Cuánto se mueven los log-odds de que team1 le gane un game a team2 por la forma de sus jugadores.

    Un jugador sin historial cuenta como promedio (0). Es antisimétrico: dar vuelta los equipos
    da el mismo número con el signo cambiado.
    """
    up1, up2 = lineups[team1], lineups[team2]
    total = 0.0
    for role, weight in model["weights"].items():
        f1 = forms.get(up1.get(role, ""), 0.0)
        f2 = forms.get(up2.get(role, ""), 0.0)
        total += weight * (f1 - f2) / model["scales"][role]
    return total


def fit(records_by_year: list[list[dict]], norms, lam: float = 0.001) -> tuple[dict, dict]:
    """Regresión logística con el Elo como offset (peso fijo 1) y penalización L2 sobre los roles.

    Las variables se dividen por su desvío pero no se centran: así una diferencia de 0 sigue
    valiendo 0 y el ajuste es antisimétrico. El término independiente (ventaja del lado azul) se
    ajusta pero no se usa en el sitio, porque antes de la serie no se sabe qué lado le toca a cada uno.
    """
    import numpy as np
    from scipy.optimize import minimize

    from models.features import ROLE_FEATURES, build_dataset

    rows = [row for records in records_by_year for row in build_dataset(records, norms)]
    X = np.array([[r[c] for c in ROLE_FEATURES] for r in rows])
    scales = X.std(axis=0)
    Z = X / scales
    offset = np.array([r["elo_logit"] for r in rows])
    y = np.array([r["blue_won"] for r in rows])

    def loss(w):
        z = offset + w[0] + Z @ w[1:]
        return np.mean(np.logaddexp(0, z) - y * z) + lam * np.sum(w[1:] ** 2)

    w = minimize(loss, np.zeros(len(ROLE_FEATURES) + 1), method="BFGS").x
    roles = [c.removeprefix("d_") for c in ROLE_FEATURES]
    weights = {role: round(float(v), 4) for role, v in zip(roles, w[1:])}
    return weights, {role: round(float(s), 4) for role, s in zip(roles, scales)}


def main() -> None:
    from models.elo import PARAMS, run_elo, team_regions
    from models.features import fit_norms, lineups, player_forms
    from models.metrics import brier_score
    from models.oracles import load_season
    from pipeline.fetch_oracles import OE_DIR

    seasons = {y: load_season(OE_DIR / f"{y}.csv") for y in (2024, 2025, 2026)}
    runs = {y: run_elo(g, PARAMS, team_regions(g)) for y, g in seasons.items()}
    norms = fit_norms(seasons[2024] + seasons[2025])
    weights, scales = fit([runs[2024].records, runs[2025].records], norms)
    model = {
        "trained_on": [2024, 2025],
        "weights": weights, "scales": scales,
        "norms": {},
    }
    for (role, metric), (mu, sd) in sorted(norms.items()):
        if role != "team":
            model["norms"].setdefault(role, {})[metric] = [round(mu, 6), round(sd, 6)]

    # Prueba con un torneo que el ajuste no vio: MSI 2026, recorriendo la temporada en orden
    from math import exp, log
    msi_elo, msi_roles, outcomes = [], [], []
    games_2026 = runs[2026].records
    for i, r in enumerate(games_2026):
        if r["page"] != "MSI":
            continue
        before = games_2026[:i]
        forms, ups = player_forms(before, norms), lineups(before)
        ups[r["blue"]] = lineups([r])[r["blue"]]  # la alineación real de ese game
        ups[r["red"]] = lineups([r])[r["red"]]
        p = r["p_blue"]
        z = log(p / (1 - p)) + adjustment(r["blue"], r["red"], ups, forms, model)
        msi_elo.append(p)
        msi_roles.append(1 / (1 + exp(-z)))
        outcomes.append(r["blue_won"])
    model["test"] = {"tournament": "MSI 2026", "games": len(outcomes),
                     "brier_elo": round(brier_score(msi_elo, outcomes), 4),
                     "brier_model": round(brier_score(msi_roles, outcomes), 4)}
    MODEL_FILE.write_text(json.dumps(model, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: model[k] for k in ("weights", "scales", "test")}, indent=1))


if __name__ == "__main__":
    main()
