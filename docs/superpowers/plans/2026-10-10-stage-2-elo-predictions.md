# Etapa 2 — Elo y predicciones: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calcular un Elo por partida con el historial de 2026, congelar predicciones antes de cada partido de Worlds y mostrarlas en el sitio (tarjetas + sección Predicciones), con K y ajustes regionales elegidos por backtest.

**Architecture:** `pipeline.fetch_history` baja una sola vez los games de las ligas e internacionales de 2024–2026 a `data/raw/`; `pipeline.fetch` suma cada hora los games y la lista de inscriptos de Worlds 2026. `models/` tiene funciones puras (Elo, métricas, backtest, predicciones). `pipeline.build` corre el Elo, valida, congela predicciones nuevas en `data/predictions.jsonl` (solo con `--freeze`, que usa el cron) y exporta `elo.json` + la predicción dentro de `schedule.json`. El frontend solo lee esos JSON.

**Tech Stack:** Python 3.12 (stdlib + requests; pytest), notebook Jupyter con pandas + matplotlib (solo exploración), Vite + TypeScript sin framework, vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-worlds-companion-design.md` (§4 contrato, §5 modelo, §6 frontend, §7 errores, §10 orden). Convenciones: `CLAUDE.md`.

## Global Constraints

- Python 3.12. El pipeline no suma dependencias (solo `requests`, `pytest`). pandas/matplotlib/jupyter solo en `requirements-notebooks.txt`.
- Código, nombres y commits en inglés; comentarios en español; textos de la interfaz en español.
- Fechas en UTC ISO 8601. Partidos sin hora confirmada: "a confirmar", nunca una hora inventada.
- Elo por game: `P(A) = 1 / (1 + 10^((R_B − R_A) / 400))`. Serie Bo3/Bo5 por binomial.
- Cada predicción se guarda antes del partido en `data/predictions.jsonl` con `created_at` y `model_version`. Las líneas pasadas nunca se editan ni se borran; si el modelo cambia, sube `model_version`.
- Mostrar siempre probabilidades (ej. 64%), no solo un ganador. La página indica que los Bo1 tienen alta varianza.
- Métricas: precisión, Brier score y calibración por tramos (50–60%, 60–70%, 70%+). La precisión mostrada usa solo predicciones congeladas.
- Validación que falla el build: probabilidad fuera de [0,1], equipo de Worlds sin historial (nombra el alias que falta).
- Colores solo con variables CSS de `:root`; nunca información solo con color (✓/✗ con texto); animaciones con `var(--ease)` y desactivadas con `prefers-reduced-motion`.
- El frontend nunca llama APIs externas.
- Commits chicos con Conventional Commits.

## Review Focus

1. **Equipo de Worlds con otro nombre en el historial** (renombre, nombre con paréntesis como `LYON (2024 American Team)`): el build tiene que fallar nombrando al equipo y sugiriendo `data/teams.csv`, no predecir con el rating inicial. → `test_build_fails_when_a_worlds_team_has_no_history` (Task 6).
2. **Leaguepedia corrige un cruce después de congelar** (equipo mal cargado y luego arreglado): el cruce corregido recibe una predicción nueva y la vieja no se muestra ni se cuenta. → `test_corrected_pairing_gets_a_new_prediction` y `test_attach_ignores_frozen_prediction_for_other_teams` (Task 5).
3. **El cron corre tarde y el partido ya empezó o terminó sin predicción congelada**: no se inventa una predicción retroactiva y ese partido no entra en los aciertos. → `test_skips_undecided_started_and_finished_matches` y `test_evaluate_scores_only_finished_matches_with_frozen_predictions` (Task 5).
4. **Probabilidades extremas** (Elo da 99,7%): nunca mostrar "100%" ni "0%". → test `never shows certainty` de `formatPercent` (Task 7).
5. **Builds repetidos cada hora**: no duplican líneas en `predictions.jsonl`. → `test_build_with_freeze_is_idempotent` (Task 6). Además, las consultas usan `order_by` determinístico para que el orden de filas no genere commits de datos vacíos.

Desvíos conscientes del spec (para que el revisor no los marque como olvidos):
- El backtest optimiza el Brier en **todos los games entre regiones distintas** de la temporada (First Stand, MSI, EWC, Worlds), no solo Worlds: Worlds tiene apenas 41 series por año.
- `elo.json` no incluye todavía la historia de rating por partido (llega en la etapa 3 con las páginas de equipo).
- `data/teams.csv` solo tiene `alias,canonical`; la región se deduce sola (la liga donde el equipo jugó más games).
- La sección Predicciones suma una sub-vista **Ranking**; el gráfico de calibración se dibuja con barras CSS (Chart.js llega en la etapa 3).

---

## File Structure

```
models/__init__.py            paquete
models/elo.py                 probabilidad, serie, regiones, run_elo, PARAMS/BACKTEST/MODEL_VERSION, CLI de ranking
models/metrics.py             brier, accuracy, calibración, summarize
models/backtest.py            games entre regiones, objetivo, búsqueda por coordenadas, series de Worlds
models/predictions.py         crear, congelar (append-only), adjuntar al calendario, evaluar
pipeline/history.py           torneos que entran, regiones por liga, normalización de games, alias, carga por temporada
pipeline/fetch_history.py     descarga única del historial 2024–2026
pipeline/leaguepedia.py       + in_clause()
pipeline/fetch.py             + games y inscriptos de Worlds 2026 cada hora
pipeline/schedule.py          + clave "prediction"
pipeline/validate.py          + validate_ratings, validate_predictions
pipeline/build.py             + Elo, predicciones, elo.json, --freeze
notebooks/backtest.ipynb      backtest explicado (con salidas guardadas)
requirements-notebooks.txt    jupyter, pandas, matplotlib
data/predictions.jsonl        predicciones congeladas (empieza vacío)
tests/test_elo.py, test_metrics.py, test_history.py, test_fetch_history.py, test_backtest.py, test_predictions.py
web/src/types.ts, data.ts, format.ts, predictions.ts, main.ts, styles.css, index.html
web/src/views/matchCard.ts, today.ts, predictions.ts
.github/workflows/update.yml  build --freeze + commit de predicciones
```

---

### Task 1: Núcleo del Elo y métricas

**Files:**
- Create: `models/__init__.py`, `models/elo.py`, `models/metrics.py`
- Test: `tests/test_elo.py`, `tests/test_metrics.py`

**Interfaces:**
- Produces:
  - `models.elo.Params(k: float, region_offsets: dict[str, float] = {})` (dataclass frozen)
  - `models.elo.MODEL_VERSION: str`, `PARAMS: Params`, `BACKTEST: dict`
  - `win_probability(rating_a: float, rating_b: float) -> float`
  - `series_probability(p_game: float, best_of: int) -> float`
  - `team_regions(games: list[dict]) -> dict[str, str]`
  - `run_elo(games: list[dict], params: Params, regions: dict[str, str]) -> EloRun` con `EloRun.ratings: dict[str, float]`, `EloRun.games_played: Counter`, `EloRun.records: list[dict]` (cada game + `p_blue`, `blue_won`)
  - Un **game** es `{"date", "match_id", "game", "page", "region", "blue", "red", "winner": "blue"|"red"}` (lo produce `pipeline.history.normalize_games`, Task 2).
  - `models.metrics.brier_score(probs, outcomes) -> float | None`, `accuracy(...) -> float | None`, `calibration(...) -> list[dict]`, `summarize(...) -> {"n", "correct", "accuracy", "brier", "calibration"}`

- [ ] **Step 1: Tests del Elo** — `tests/test_elo.py`

```python
import pytest

from models.elo import Params, run_elo, series_probability, team_regions, win_probability


def game(blue, red, winner="blue", region="KR", match_id="m", date="2026-01-01 10:00:00"):
    return {"date": date, "match_id": match_id, "game": 1, "page": "p", "region": region,
            "blue": blue, "red": red, "winner": winner}


def test_equal_ratings_give_even_odds():
    assert win_probability(1500, 1500) == 0.5


def test_100_points_is_about_64_percent():
    assert win_probability(1600, 1500) == pytest.approx(0.640, abs=0.001)


def test_probabilities_are_complementary():
    assert win_probability(1620, 1480) + win_probability(1480, 1620) == pytest.approx(1.0)


def test_bo1_series_equals_game_probability():
    assert series_probability(0.57, 1) == pytest.approx(0.57)


def test_bo3_and_bo5_amplify_the_favorite():
    assert series_probability(0.57, 3) == pytest.approx(0.6043, abs=1e-4)
    assert series_probability(0.57, 5) == pytest.approx(0.6295, abs=1e-4)


def test_even_game_gives_even_series():
    for best_of in (1, 3, 5):
        assert series_probability(0.5, best_of) == pytest.approx(0.5)


def test_series_probability_rejects_even_formats():
    with pytest.raises(ValueError):
        series_probability(0.6, 2)


def test_winner_gains_what_loser_loses():
    run = run_elo([game("A", "B")], Params(k=20), {})
    assert run.ratings["A"] == pytest.approx(1510)
    assert run.ratings["B"] == pytest.approx(1490)


def test_upset_moves_ratings_more_than_expected_win():
    regions = {"A": "KR", "B": "NA"}
    params = Params(k=20, region_offsets={"KR": 100})
    expected = run_elo([game("A", "B", winner="blue")], params, regions)
    upset = run_elo([game("A", "B", winner="red")], params, regions)
    gain_when_expected = expected.ratings["A"] - 1600
    loss_when_upset = 1600 - upset.ratings["A"]
    assert loss_when_upset > gain_when_expected > 0


def test_region_offset_sets_initial_rating():
    run = run_elo([game("A", "B")], Params(k=0, region_offsets={"KR": 80}), {"A": "KR", "B": "NA"})
    assert run.ratings == {"A": 1580, "B": 1500}


def test_records_keep_the_probability_from_before_the_game():
    run = run_elo([game("A", "B"), game("A", "B")], Params(k=20), {})
    assert run.records[0]["p_blue"] == 0.5
    assert run.records[1]["p_blue"] > 0.5
    assert run.games_played == {"A": 2, "B": 2}


def test_team_region_is_the_league_where_it_played_most():
    games = [game("A", "B", region="KR"), game("A", "C", region="KR"),
             game("A", "D", region=None), game("A", "E", region="NA")]
    regions = team_regions(games)
    assert regions["A"] == "KR"
    assert regions["E"] == "NA"
    assert "D" not in regions  # solo jugó un torneo internacional
```

- [ ] **Step 2: Tests de métricas** — `tests/test_metrics.py`

```python
import pytest

from models.metrics import accuracy, brier_score, calibration, summarize


def test_brier_perfect_and_coin():
    assert brier_score([1.0, 0.0], [1.0, 0.0]) == 0
    assert brier_score([0.5, 0.5], [1.0, 0.0]) == 0.25


def test_brier_and_accuracy_of_nothing_is_none():
    assert brier_score([], []) is None
    assert accuracy([], []) is None


def test_accuracy_counts_the_favorite():
    assert accuracy([0.7, 0.3, 0.6], [1.0, 0.0, 0.0]) == pytest.approx(2 / 3)


def test_calibration_groups_by_favorite_probability():
    rows = {r["label"]: r for r in calibration([0.55, 0.35, 0.8, 0.9], [1.0, 1.0, 1.0, 0.0])}
    assert rows["50–60%"]["n"] == 1 and rows["50–60%"]["observed"] == 1.0
    # 0.35 para el equipo 1 = el equipo 2 es favorito con 65%; ganó el 1, así que el favorito perdió
    assert rows["60–70%"]["n"] == 1 and rows["60–70%"]["observed"] == 0.0
    assert rows["70%+"]["n"] == 2
    assert rows["70%+"]["predicted"] == pytest.approx(0.85)
    assert rows["70%+"]["observed"] == 0.5


def test_calibration_empty_bucket_has_no_averages():
    assert calibration([0.55], [1.0])[2] == {"label": "70%+", "n": 0, "predicted": None, "observed": None}


def test_summarize():
    s = summarize([0.7, 0.4], [1.0, 1.0])
    assert s["n"] == 2 and s["correct"] == 1 and s["accuracy"] == 0.5
    assert s["brier"] == pytest.approx((0.09 + 0.36) / 2)
    assert len(s["calibration"]) == 3
```

- [ ] **Step 3: Correr y ver que fallan**

Run: `.venv/Scripts/python -m pytest tests/test_elo.py tests/test_metrics.py -q`
Expected: FAIL con `ModuleNotFoundError: No module named 'models'`

- [ ] **Step 4: `models/__init__.py`**

```python
"""Modelos de predicción de Worlds Companion."""
```

- [ ] **Step 5: `models/elo.py`**

```python
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


# Valores provisorios: la Task 4 los reemplaza por los que elige notebooks/backtest.ipynb
MODEL_VERSION = "elo-1"
PARAMS = Params(k=20.0, region_offsets={})
BACKTEST: dict = {}


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
```

- [ ] **Step 6: `models/metrics.py`**

```python
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
```

- [ ] **Step 7: Correr los tests**

Run: `.venv/Scripts/python -m pytest -q`
Expected: todos PASS (los 35 anteriores + los nuevos).

- [ ] **Step 8: Commit**

```bash
git add models tests/test_elo.py tests/test_metrics.py
git commit -m "feat: add game-level Elo, series probability and evaluation metrics"
```

---

### Task 2: Historial — selección de torneos, normalización y descargas

**Files:**
- Create: `pipeline/history.py`, `pipeline/fetch_history.py`
- Modify: `pipeline/leaguepedia.py` (agregar `in_clause`), `pipeline/fetch.py` (games + inscriptos de Worlds; `teams_where` usa `in_clause`)
- Test: `tests/test_history.py`, `tests/test_fetch_history.py`, `tests/test_fetch.py` (agregar)

**Interfaces:**
- Consumes: formato de game de Task 1.
- Produces:
  - `pipeline.leaguepedia.in_clause(field: str, values: list[str]) -> str`
  - `pipeline.history.CURRENT_YEAR = 2026`, `GAME_FIELDS`, `TOURNAMENT_FIELDS`, `LEAGUE_REGIONS: dict[str, str | None]`
  - `worlds_prefix(year) -> str`, `history_files(raw_dir, year) -> (tournaments_path, games_path)`
  - `select_tournaments(rows) -> list[dict]`, `page_regions(tournaments) -> dict[str, str | None]`
  - `normalize_games(rows, regions, aliases=None) -> list[dict]`
  - `load_aliases(path) -> dict[str, str]`, `load_season_games(raw_dir, year, aliases=None) -> list[dict]`
  - Archivos: `data/raw/history_{year}_tournaments.json`, `history_{year}_games.json`, `worlds_{2024,2025}_matches.json`, `worlds_2026_games.json`, `worlds_2026_rosters.json`
  - `pipeline.fetch.roster_teams(rosters) -> list[str]`

- [ ] **Step 1: Tests de historial** — `tests/test_history.py`

```python
import json

from pipeline.history import load_aliases, load_season_games, normalize_games, page_regions, select_tournaments


def tournament(page, league, level="Primary", qualifier="0"):
    return {"OverviewPage": page, "League": league, "Region": "", "TournamentLevel": level,
            "IsQualifier": qualifier, "Year": "2026"}


def test_select_keeps_main_leagues_and_worlds_qualifiers():
    rows = [
        tournament("LCK/2026 Season/Cup", "LoL Champions Korea"),
        tournament("2026 Season World Championship/Play-In", "World Championship", qualifier="1"),
        tournament("LCP/2026 Season/Promotion", "League of Legends Championship Pacific", qualifier="1"),
        tournament("LPL/2026 Season/Grand Finals/Showmatch", "Tencent LoL Pro League", level="Showmatch"),
        tournament("2026 LoL KeSPA Cup", "KeSPA Cup"),
        tournament("PCS/2026 Season/Spring Season", "Pacific Championship Series", level="Secondary"),
    ]
    assert [t["OverviewPage"] for t in select_tournaments(rows)] == [
        "LCK/2026 Season/Cup", "2026 Season World Championship/Play-In"]


def test_page_regions_marks_international_as_none():
    regions = page_regions([tournament("LCK/2026 Season/Cup", "LoL Champions Korea"),
                            tournament("2026 First Stand", "First Stand")])
    assert regions == {"LCK/2026 Season/Cup": "KR", "2026 First Stand": None}


SG = {"GameId": "g1", "MatchId": "m1", "OverviewPage": "LCK/2026 Season/Cup", "Team1": "T1",
      "Team2": "Gen.G", "Winner": "2", "DateTimeUTC": "2026-01-14 08:00:00", "GameInMatch": "1"}


def test_normalize_uses_team1_as_blue_side():
    [g] = normalize_games([SG], {"LCK/2026 Season/Cup": "KR"})
    assert g == {"date": "2026-01-14 08:00:00", "match_id": "m1", "game": 1, "page": "LCK/2026 Season/Cup",
                 "region": "KR", "blue": "T1", "red": "Gen.G", "winner": "red"}


def test_normalize_skips_games_without_result_and_sorts_by_date():
    rows = [{**SG, "MatchId": "m2", "DateTimeUTC": "2026-01-15 08:00:00"}, SG, {**SG, "MatchId": "m3", "Winner": ""}]
    games = normalize_games(rows, {})
    assert [g["match_id"] for g in games] == ["m1", "m2"]
    assert games[0]["region"] is None  # página desconocida = internacional


def test_normalize_orders_games_inside_a_series():
    rows = [{**SG, "GameInMatch": "2"}, {**SG, "GameInMatch": "1"}]
    assert [g["game"] for g in normalize_games(rows, {})] == [1, 2]


def test_aliases_merge_team_names(tmp_path):
    path = tmp_path / "teams.csv"
    path.write_text("alias,canonical\nT1 Esports,T1\n", encoding="utf-8")
    [g] = normalize_games([{**SG, "Team1": "T1 Esports"}], {}, load_aliases(path))
    assert g["blue"] == "T1"


def test_missing_aliases_file_means_no_aliases(tmp_path):
    assert load_aliases(tmp_path / "missing.csv") == {}


def write_rows(path, rows):
    path.write_text(json.dumps({"fetched_at": "2026-10-10T00:00:00Z", "rows": rows}), encoding="utf-8")


def test_load_season_adds_worlds_games_for_the_current_year(tmp_path):
    write_rows(tmp_path / "history_2026_tournaments.json", [tournament("LCK/2026 Season/Cup", "LoL Champions Korea")])
    write_rows(tmp_path / "history_2026_games.json", [SG])
    worlds = {**SG, "MatchId": "w1", "OverviewPage": "2026 Season World Championship/Main Event",
              "DateTimeUTC": "2026-10-23 08:00:00"}
    write_rows(tmp_path / "worlds_2026_games.json", [worlds])
    games = load_season_games(tmp_path, 2026)
    assert [(g["match_id"], g["region"]) for g in games] == [("m1", "KR"), ("w1", None)]
```

- [ ] **Step 2: Tests de descarga** — `tests/test_fetch_history.py` y agregado en `tests/test_fetch.py`

`tests/test_fetch_history.py`:

```python
from pipeline.fetch_history import pages_to_fetch
from pipeline.leaguepedia import in_clause


def test_current_year_skips_worlds_pages():
    tournaments = [{"OverviewPage": "LCK/2026 Season/Cup"},
                   {"OverviewPage": "2026 Season World Championship/Play-In"}]
    assert pages_to_fetch(tournaments, 2026) == ["LCK/2026 Season/Cup"]
    assert len(pages_to_fetch(tournaments, 2025)) == 2


def test_in_clause_escapes_quotes():
    assert in_clause("League", ["LCK", 'A "B"']) == 'League IN ("LCK","A \\"B\\"")'
```

Agregar al final de `tests/test_fetch.py`:

```python
def test_roster_teams_skips_tbd_and_dedupes():
    rosters = [{"Team": "T1"}, {"Team": "TBD"}, {"Team": "T1"}, {"Team": "G2 Esports"}, {"Team": ""}]
    assert fetch.roster_teams(rosters) == ["G2 Esports", "T1"]
```

- [ ] **Step 3: Correr y ver que fallan**

Run: `.venv/Scripts/python -m pytest tests/test_history.py tests/test_fetch_history.py tests/test_fetch.py -q`
Expected: FAIL (`No module named 'pipeline.history'`, `cannot import name 'in_clause'`, `no attribute 'roster_teams'`).

- [ ] **Step 4: `in_clause` en `pipeline/leaguepedia.py`** (agregar al final)

```python
def in_clause(field: str, values: list[str]) -> str:
    """Cláusula WHERE de Cargo 'Campo IN ("a","b")' con las comillas escapadas."""
    quoted = ",".join('"' + v.replace('"', '\\"') + '"' for v in values)
    return f"{field} IN ({quoted})"
```

En `pipeline/fetch.py`, reemplazar el cuerpo de `teams_where` por:

```python
def teams_where(names: list[str]) -> str:
    """Cláusula WHERE de Cargo con los nombres entre comillas (escapadas)."""
    return leaguepedia.in_clause("Name", names)
```

- [ ] **Step 5: `pipeline/history.py`**

```python
"""Historial de partidas para el Elo: qué torneos entran y cómo se leen las filas de Leaguepedia."""
import csv
import json
from pathlib import Path

CURRENT_YEAR = 2026

# En ScoreboardGames, Team1 es siempre el lado azul. Se renombran campos para evitar espacios en las claves.
GAME_FIELDS = "GameId,MatchId,OverviewPage,Team1,Team2,Winner,DateTime_UTC=DateTimeUTC,N_GameInMatch=GameInMatch"
TOURNAMENT_FIELDS = "OverviewPage,League,Region,TournamentLevel,IsQualifier,Year"

# Liga (campo League de Leaguepedia) → región. None = torneo entre regiones.
LEAGUE_REGIONS: dict[str, str | None] = {
    "LoL Champions Korea": "KR",
    "Tencent LoL Pro League": "CN",
    "LoL EMEA Championship": "EU",
    "League of Legends Championship Series": "NA",
    "League of Legends Championship of The Americas North": "NA",
    "Circuit Brazilian League of Legends": "BR",
    "League of Legends Championship of The Americas South": "BR",
    "Liga Latinoamerica": "LAT",
    "League of Legends Championship Pacific": "APAC",
    "Pacific Championship Series": "APAC",
    "Vietnam Championship Series": "VN",
    "LoL Japan League": "JP",
    "League of Legends Championship of The Americas": None,
    "First Stand": None,
    "Mid-Season Invitational": None,
    "Esports World Cup": None,
    "World Championship": None,
}

WINNER_SIDES = {"1": "blue", "2": "red"}


def worlds_prefix(year: int) -> str:
    return f"{year} Season World Championship"


def history_files(raw_dir: Path, year: int) -> tuple[Path, Path]:
    return raw_dir / f"history_{year}_tournaments.json", raw_dir / f"history_{year}_games.json"


def select_tournaments(rows: list[dict]) -> list[dict]:
    """Ligas principales e internacionales, sin showmatches, ligas secundarias ni clasificatorios.

    Excepción: los clasificatorios de la liga 'World Championship' (Play-In de Worlds y finales
    regionales) sí entran, porque son partidos oficiales entre equipos de primer nivel.
    """
    keep = []
    for r in rows:
        if r.get("League") not in LEAGUE_REGIONS or r.get("TournamentLevel") != "Primary":
            continue
        if r.get("IsQualifier") == "1" and r["League"] != "World Championship":
            continue
        keep.append(r)
    return keep


def page_regions(tournaments: list[dict]) -> dict[str, str | None]:
    return {t["OverviewPage"]: LEAGUE_REGIONS[t["League"]] for t in tournaments}


def normalize_games(rows: list[dict], regions: dict[str, str | None], aliases: dict[str, str] | None = None) -> list[dict]:
    """Filas de ScoreboardGames → games en orden cronológico (y por número de game dentro de la serie).

    Una página que no está en `regions` se toma como torneo internacional (región None).
    """
    aliases = aliases or {}
    games = []
    for r in rows:
        winner = WINNER_SIDES.get(r.get("Winner") or "")
        if winner is None or not r.get("DateTimeUTC"):
            continue  # game sin resultado cargado todavía
        games.append({
            "date": r["DateTimeUTC"],
            "match_id": r["MatchId"],
            "game": int(r.get("GameInMatch") or 0),
            "page": r["OverviewPage"],
            "region": regions.get(r["OverviewPage"]),
            "blue": aliases.get(r["Team1"], r["Team1"]),
            "red": aliases.get(r["Team2"], r["Team2"]),
            "winner": winner,
        })
    games.sort(key=lambda g: (g["date"], g["match_id"], g["game"]))
    return games


def load_aliases(path: Path) -> dict[str, str]:
    """data/teams.csv (columnas alias,canonical): une a un equipo que aparece con dos nombres."""
    if not path.exists():
        return {}
    with path.open(encoding="utf-8", newline="") as f:
        return {row["alias"].strip(): row["canonical"].strip() for row in csv.DictReader(f)}


def _rows(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["rows"]


def load_season_games(raw_dir: Path, year: int, aliases: dict[str, str] | None = None) -> list[dict]:
    """Games de la temporada en orden. En el año actual se suman los de Worlds (los baja el fetch horario)."""
    tournaments_file, games_file = history_files(raw_dir, year)
    if not games_file.exists():
        raise FileNotFoundError(f"{games_file} is missing: run python -m pipeline.fetch_history")
    rows = _rows(games_file)
    worlds_file = raw_dir / f"worlds_{year}_games.json"
    if year == CURRENT_YEAR and worlds_file.exists():
        rows = rows + _rows(worlds_file)
    return normalize_games(rows, page_regions(_rows(tournaments_file)), aliases)
```

- [ ] **Step 6: `pipeline/fetch_history.py`**

```python
"""Descarga, una sola vez, el historial que necesita el Elo (ligas + internacionales de cada año).

Uso: python -m pipeline.fetch_history           # baja solo los años que falten en data/raw/
     python -m pipeline.fetch_history --force   # vuelve a bajar todo
2024 y 2025 se usan para el backtest. Del año actual no se baja Worlds: lo hace pipeline.fetch cada hora.
"""
import sys

from pipeline import leaguepedia, utc_now_iso
from pipeline.fetch import MATCH_FIELDS, RAW_DIR, write_if_changed
from pipeline.history import (CURRENT_YEAR, GAME_FIELDS, LEAGUE_REGIONS, TOURNAMENT_FIELDS, history_files,
                              select_tournaments, worlds_prefix)

YEARS = (2024, 2025, CURRENT_YEAR)


def pages_to_fetch(tournaments: list[dict], year: int) -> list[str]:
    """Páginas de torneo a bajar. En el año actual se excluye Worlds."""
    pages = [t["OverviewPage"] for t in tournaments]
    if year == CURRENT_YEAR:
        pages = [p for p in pages if not p.startswith(worlds_prefix(year))]
    return sorted(pages)


def fetch_year(session, year: int, now: str) -> None:
    tournaments = leaguepedia.cargo_query(
        session, tables="Tournaments", fields=TOURNAMENT_FIELDS,
        where=f'Year="{year}" AND ' + leaguepedia.in_clause("League", list(LEAGUE_REGIONS)),
        order_by="OverviewPage",
    )
    selected = select_tournaments(tournaments)
    games = leaguepedia.cargo_query(
        session, tables="ScoreboardGames", fields=GAME_FIELDS,
        where=leaguepedia.in_clause("OverviewPage", pages_to_fetch(selected, year)),
        order_by="DateTime_UTC,GameId",
    )
    tournaments_file, games_file = history_files(RAW_DIR, year)
    write_if_changed(tournaments_file, selected, now)
    write_if_changed(games_file, games, now)
    print(f"{year}: {len(selected)} tournaments, {len(games)} games")

    if year != CURRENT_YEAR:
        # El backtest por serie necesita el formato (Bo1/3/5) de cada partido de Worlds
        matches = leaguepedia.cargo_query(
            session, tables="MatchSchedule", fields=MATCH_FIELDS,
            where=f'OverviewPage LIKE "{worlds_prefix(year)}%"', order_by="DateTime_UTC,MatchId",
        )
        write_if_changed(RAW_DIR / f"worlds_{year}_matches.json", matches, now)
        print(f"{year}: {len(matches)} Worlds matches")


def main() -> None:
    force = "--force" in sys.argv
    now = utc_now_iso()
    session = leaguepedia.make_session()
    for year in YEARS:
        if history_files(RAW_DIR, year)[1].exists() and not force:
            print(f"{year}: already downloaded (use --force to download again)")
            continue
        fetch_year(session, year, now)


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: Worlds 2026 cada hora en `pipeline/fetch.py`**

Agregar imports y constantes:

```python
from pipeline.history import GAME_FIELDS

GAMES_FILE = RAW_DIR / "worlds_2026_games.json"
ROSTERS_FILE = RAW_DIR / "worlds_2026_rosters.json"
```

Agregar función:

```python
def roster_teams(rosters: list[dict]) -> list[str]:
    """Equipos inscriptos en Worlds (sin placeholders ni repetidos)."""
    names = {(r.get("Team") or "").strip() for r in rosters}
    return sorted(n for n in names if n and n.lower() not in UNDECIDED_TEAMS)
```

En `main()`, cambiar `order_by="DateTime_UTC"` de MatchSchedule por `order_by="DateTime_UTC,MatchId"` y, después de escribir `MATCHES_FILE`, agregar:

```python
    games = leaguepedia.cargo_query(
        session, tables="ScoreboardGames", fields=GAME_FIELDS,
        where=f'OverviewPage LIKE "{TOURNAMENT_PREFIX}%"', order_by="DateTime_UTC,GameId",
    )
    changed = write_if_changed(GAMES_FILE, games, now)
    print(f"games: {len(games)} ({'updated' if changed else 'unchanged'})")

    rosters = leaguepedia.cargo_query(
        session, tables="TournamentRosters", fields="Team,OverviewPage",
        where=f'OverviewPage LIKE "{TOURNAMENT_PREFIX}%"', order_by="OverviewPage,Team",
    )
    write_if_changed(ROSTERS_FILE, rosters, now)
    print(f"participants: {len(roster_teams(rosters))}")
```

y reemplazar el cálculo de `missing` por (así se bajan las siglas de los inscriptos aunque los cruces sigan en TBD):

```python
    wanted = sorted(set(team_names(matches)) | set(roster_teams(rosters)))
    missing = [n for n in wanted if n not in known]
```

- [ ] **Step 8: Correr los tests**

Run: `.venv/Scripts/python -m pytest -q`
Expected: todos PASS.

- [ ] **Step 9: Commit**

```bash
git add pipeline tests
git commit -m "feat: fetch season history and Worlds games for the Elo"
```

---

### Task 3: Descarga real del historial

**Files:**
- Create (generados): `data/raw/history_{2024,2025,2026}_*.json`, `data/raw/worlds_{2024,2025}_matches.json`, `data/raw/worlds_2026_games.json`, `data/raw/worlds_2026_rosters.json`, `data/raw/worlds_2026_teams.json`

- [ ] **Step 1: Bajar historial y datos de Worlds** (necesita `LEAGUEPEDIA_USER` / `LEAGUEPEDIA_BOT_PASSWORD` en el entorno)

```bash
.venv/Scripts/python -m pipeline.fetch_history
.venv/Scripts/python -m pipeline.fetch
```
Expected: por año `N tournaments, M games` con M en el orden de miles; `participants: 17` o más.

- [ ] **Step 2: Chequear cobertura**

```bash
.venv/Scripts/python - <<'EOF'
import collections
from pathlib import Path
from models.elo import run_elo, team_regions, PARAMS
from pipeline.history import load_season_games
from pipeline.fetch import roster_teams
import json
raw = Path("data/raw")
for year in (2024, 2025, 2026):
    games = load_season_games(raw, year)
    regions = team_regions(games)
    by_page = collections.Counter(g["page"] for g in games)
    cross = sum(1 for g in games if regions.get(g["blue"]) and regions.get(g["red"]) and regions[g["blue"]] != regions[g["red"]])
    print(year, len(games), "games |", cross, "entre regiones |", collections.Counter(regions.values()))
    print("   internacionales:", {p: n for p, n in by_page.items() if any(w in p for w in ("First Stand", "Mid-Season", "Esports World Cup", "World Championship"))})
games = load_season_games(raw, 2026)
played = run_elo(games, PARAMS, team_regions(games)).games_played
rosters = json.loads((raw / "worlds_2026_rosters.json").read_text(encoding="utf-8"))["rows"]
for team in roster_teams(rosters):
    print(f"{team:<36} {played.get(team, 0)} games")
EOF
```
Expected: cada temporada con First Stand/MSI/EWC/Worlds presentes (MSI y EWC con decenas de games); todos los inscriptos de Worlds 2026 con ≥ 10 games. Si un inscripto tiene 0–9 games, buscar su nombre en el historial (`grep` en `history_2026_games.json`) y crear `data/teams.csv` con `alias,canonical` (alias = nombre en la tabla con menos games, canonical = el otro); volver a correr.

- [ ] **Step 3: Ranking provisorio** (con K=20 y sin ajustes, solo para ver que los números tengan sentido)

Run: `.venv/Scripts/python -m models.elo`
Expected: los equipos fuertes de LCK/LPL arriba; nadie con ratings absurdos (fuera de 1200–1900).

- [ ] **Step 4: Commit de datos**

```bash
git add data/raw   # y data/teams.csv si hubo que crearlo en el Step 2
git commit -m "data: add 2024-2026 match history and Worlds 2026 participants"
```

---

### Task 4: Backtest (notebook) y parámetros finales

**Files:**
- Create: `models/backtest.py`, `tests/test_backtest.py`, `notebooks/backtest.ipynb`, `requirements-notebooks.txt`
- Modify: `models/elo.py` (`PARAMS`, `BACKTEST`)

**Interfaces:**
- Consumes: `run_elo`, `team_regions`, `series_probability`, `Params` (Task 1); `brier_score`, `summarize` (Task 1); `load_season_games` (Task 2).
- Produces:
  - `models.backtest.K_GRID`, `OFFSET_GRID`, `TUNED_REGIONS`
  - `cross_region_records(records, regions) -> list[dict]`
  - `objective(seasons: list[tuple[list[dict], dict[str, str]]], params: Params) -> float`
  - `tune(seasons, start=Params(k=20.0), max_sweeps=5) -> tuple[Params, float]`
  - `worlds_series(records, schedule_rows) -> tuple[list[float], list[float]]`
  - `models.elo.BACKTEST` con claves exactas: `calibration_year`, `validation_year`, `validation_games`, `validation_brier`, `baseline_brier`, `worlds_series`, `worlds_accuracy`, `worlds_brier`

- [ ] **Step 1: Tests** — `tests/test_backtest.py`

```python
import pytest

from models.backtest import cross_region_records, objective, tune, worlds_series
from models.elo import Params, team_regions


def make_season():
    """Dos equipos coreanos y dos norteamericanos parejos en su liga; en los cruces, KR siempre gana."""
    games, minute = [], 0

    def add(blue, red, winner, region):
        nonlocal minute
        minute += 1
        games.append({"date": f"2026-01-01 {minute // 60:02d}:{minute % 60:02d}:00", "match_id": f"m{minute}",
                      "game": 1, "page": "p", "region": region, "blue": blue, "red": red, "winner": winner})

    for _ in range(6):
        add("K1", "K2", "blue", "KR"); add("K2", "K1", "blue", "KR")
        add("N1", "N2", "blue", "NA"); add("N2", "N1", "blue", "NA")
    for _ in range(4):
        add("K1", "N1", "blue", None); add("N2", "K2", "red", None)
    return games, team_regions(games)


def test_cross_region_records_keeps_only_games_between_regions():
    games, regions = make_season()
    assert len(cross_region_records(games, regions)) == 8


def test_tune_learns_that_the_stronger_region_starts_higher():
    season = make_season()
    params, score = tune([season])
    assert params.region_offsets.get("KR", 0) > params.region_offsets.get("NA", 0)
    assert score < objective([season], Params(k=20.0))


def test_worlds_series_uses_first_game_probability_from_team1_view():
    records = [{"match_id": "m1", "blue": "B", "red": "A", "p_blue": 0.4},
               {"match_id": "m1", "blue": "A", "red": "B", "p_blue": 0.9}]
    rows = [{"MatchId": "m1", "Team1": "A", "Team2": "B", "Winner": "1", "BestOf": "1"},
            {"MatchId": "m2", "Team1": "A", "Team2": "B", "Winner": "", "BestOf": "3"}]
    probs, outcomes = worlds_series(records, rows)
    assert probs == [pytest.approx(0.6)]
    assert outcomes == [1.0]
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `.venv/Scripts/python -m pytest tests/test_backtest.py -q`
Expected: FAIL `No module named 'models.backtest'`

- [ ] **Step 3: `models/backtest.py`**

```python
"""Backtest del Elo: elegir K y los ajustes por región según qué tan bien predijo temporadas pasadas."""
from models.elo import Params, run_elo, series_probability
from models.metrics import brier_score

K_GRID = (10, 15, 20, 25, 30, 40, 50)
OFFSET_GRID = (-100, -50, 0, 50, 100, 150, 200, 250, 300)
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
```

- [ ] **Step 4: Tests en verde y commit**

Run: `.venv/Scripts/python -m pytest -q` → todos PASS.

```bash
git add models/backtest.py tests/test_backtest.py
git commit -m "feat: add Elo backtest helpers with coordinate-descent tuning"
```

- [ ] **Step 5: Dependencias del notebook**

Crear `requirements-notebooks.txt` con `-r requirements.txt` y `jupyter`, `pandas`, `matplotlib`; instalar y fijar versiones:

```bash
printf -- "-r requirements.txt\njupyter\npandas\nmatplotlib\n" > requirements-notebooks.txt
.venv/Scripts/python -m pip install -r requirements-notebooks.txt
.venv/Scripts/python -m pip freeze | grep -iE "^(jupyter|pandas|matplotlib)=="
```
Reescribir `requirements-notebooks.txt` con las versiones exactas que imprimió `pip freeze` (`jupyter==X`, `pandas==Y`, `matplotlib==Z`).

- [ ] **Step 6: Crear `notebooks/backtest.ipynb`** con estas celdas (en orden; md = markdown). Armarlo con `nbformat` desde un script en el scratchpad (no se commitea el script).

1. md:
```markdown
# Backtest del Elo

**Objetivo:** elegir K (cuánto se mueve el rating después de cada game) y el ajuste inicial de cada región.

**Método:** se corre el Elo sobre temporadas pasadas "como si fueran en vivo": la probabilidad de cada game se calcula antes de conocer su resultado.
- **Calibración:** temporada 2024 (ligas + First Stand/MSI/EWC/Worlds).
- **Validación:** temporada 2025, que el modelo no vio al elegir los valores.
- **Métrica:** Brier score en games entre equipos de regiones distintas (los únicos que ponen a prueba el ajuste regional). Tirar una moneda da 0.25.

⚠️ **Muestra chica:** hay pocos cientos de games entre regiones por año. Diferencias de Brier de 0.001–0.002 pueden ser ruido; por eso hay pocos parámetros (K + 4 regiones) y se valida en un año aparte.
```
2. code:
```python
import json
import sys
from pathlib import Path

ROOT = Path.cwd() if (Path.cwd() / "models").exists() else Path.cwd().parent
sys.path.insert(0, str(ROOT))

import matplotlib.pyplot as plt
import pandas as pd

from models.backtest import K_GRID, cross_region_records, objective, tune, worlds_series
from models.elo import Params, run_elo, team_regions
from models.metrics import summarize
from pipeline.history import load_season_games

RAW = ROOT / "data" / "raw"
seasons = {}
for year in (2024, 2025):
    games = load_season_games(RAW, year)
    seasons[year] = (games, team_regions(games))
```
3. md: `## Tamaño de la muestra`
4. code:
```python
rows = []
for year, (games, regions) in seasons.items():
    run = run_elo(games, Params(k=20.0), regions)
    rows.append({"año": year, "games": len(games), "equipos con región": len(regions),
                 "games entre regiones": len(cross_region_records(run.records, regions))})
pd.DataFrame(rows)
```
5. md: `## Línea de base\nDos referencias: tirar una moneda (0.25) y un Elo sin ajuste regional (todos arrancan en 1500, K = 20). Si el modelo calibrado no le gana a la segunda, el ajuste regional no está aportando.`
6. code:
```python
base = Params(k=20.0)
for year in (2024, 2025):
    print(f"{year}: moneda 0.2500 | Elo sin ajuste regional {objective([seasons[year]], base):.4f}")
```
7. md: `## ¿Qué K conviene?\nK alto reacciona rápido pero se deja llevar por la suerte; K bajo es estable pero lento. Curva sin ajuste regional, sobre 2024:`
8. code:
```python
scores = [objective([seasons[2024]], Params(k=float(k))) for k in K_GRID]
plt.plot(K_GRID, scores, marker="o")
plt.xlabel("K"); plt.ylabel("Brier (2024, entre regiones)")
plt.title("Brier según K"); plt.grid(alpha=.3); plt.show()
```
9. md: `## Calibrar con 2024\nBúsqueda por coordenadas: se ajusta un parámetro por vez probando su grilla, se repite hasta que nada mejora.`
10. code:
```python
tuned_2024, score_2024 = tune([seasons[2024]])
print(tuned_2024, f"Brier 2024 = {score_2024:.4f}")
```
11. md: `## Validar en 2025 (datos no vistos)\nSi el Brier de 2025 empeora mucho respecto de 2024, los valores se ajustaron al ruido de 2024 (sobreajuste).`
12. code:
```python
val_tuned = objective([seasons[2025]], tuned_2024)
val_base = objective([seasons[2025]], base)
print(f"2025: moneda 0.2500 | sin ajuste {val_base:.4f} | calibrado con 2024 {val_tuned:.4f}")
```
13. md: `## Series de Worlds 2025\nLo que importa para el sitio: probabilidad de ganar la serie, calculada antes de cada serie.`
14. code:
```python
games25, regions25 = seasons[2025]
run25 = run_elo(games25, tuned_2024, regions25)
matches25 = json.loads((RAW / "worlds_2025_matches.json").read_text(encoding="utf-8"))["rows"]
probs, outcomes = worlds_series(run25.records, matches25)
worlds = summarize(probs, outcomes)
print(f"Series: {worlds['n']} | aciertos {worlds['correct']} ({worlds['accuracy']:.0%}) | Brier {worlds['brier']:.4f}")
pd.DataFrame(worlds["calibration"])
```
15. md: `## Gráfico de calibración (games entre regiones, 2025)\nCada punto es un tramo de probabilidad: si el modelo está bien calibrado, cae sobre la diagonal. El tamaño indica cuántos games hay en el tramo.`
16. code:
```python
cross = cross_region_records(run25.records, regions25)
df = pd.DataFrame({"p": [r["p_blue"] for r in cross], "won": [r["blue_won"] for r in cross]})
df["tramo"] = pd.cut(df["p"], bins=[0, .2, .4, .6, .8, 1])
cal = df.groupby("tramo", observed=True).agg(predicho=("p", "mean"), real=("won", "mean"), n=("p", "size"))
plt.plot([0, 1], [0, 1], ls="--", color="gray", label="calibración perfecta")
plt.scatter(cal["predicho"], cal["real"], s=cal["n"] * 3, label="tramos")
plt.xlabel("Probabilidad predicha (lado azul)"); plt.ylabel("Frecuencia real")
plt.legend(); plt.grid(alpha=.3); plt.show()
cal
```
17. md: `## Valores finales\nCon la validación hecha, se recalibra con 2024 + 2025 juntos (más datos = valores más estables). La estimación honesta del error es la de la validación de arriba, no la de este ajuste.`
18. code:
```python
final, final_score = tune([seasons[2024], seasons[2025]])
backtest = {
    "calibration_year": 2024, "validation_year": 2025,
    "validation_games": len(cross), "validation_brier": round(val_tuned, 4), "baseline_brier": round(val_base, 4),
    "worlds_series": worlds["n"], "worlds_accuracy": worlds["accuracy"], "worlds_brier": worlds["brier"],
}
print("PARAMS =", final)
print("BACKTEST =", backtest)
```
19. md: `## Conclusiones` + 3–5 viñetas escritas después de ver los resultados (qué K salió, qué orden de regiones, cuánto mejora contra la línea de base, si hubo señales de sobreajuste, limitaciones).

- [ ] **Step 7: Ejecutar el notebook guardando las salidas**

Run: `.venv/Scripts/python -m jupyter nbconvert --to notebook --execute --inplace notebooks/backtest.ipynb`
Expected: termina sin errores; las celdas tienen salidas (tablas y gráficos). Escribir la celda 19 con lo observado y volver a ejecutar.

- [ ] **Step 8: Copiar los valores a `models/elo.py`**

Reemplazar el bloque provisorio por los valores impresos en la celda 18, por ejemplo (los números reales salen del notebook):

```python
# Elegidos con notebooks/backtest.ipynb: calibrado con 2024, validado con 2025, ajuste final con ambos
MODEL_VERSION = "elo-1"
PARAMS = Params(k=<K de la celda 18>, region_offsets={"KR": <...>, "CN": <...>, "EU": <...>, "NA": <...>})
BACKTEST = {<dict impreso en la celda 18>}
```

Run: `.venv/Scripts/python -m pytest -q && .venv/Scripts/python -m models.elo`
Expected: tests PASS; ranking con los valores nuevos.

- [ ] **Step 9: Checkpoint con el usuario (modo aprendizaje)**

Explicarle en el chat, en español: qué K salió y qué significa, el orden de los ajustes regionales, Brier de validación contra moneda y contra "sin ajuste", la calibración, y las advertencias (muestra chica, sobreajuste, supuesto de independencia de la binomial). Seguir con la Task 5 sin esperar, salvo que pida cambios.

- [ ] **Step 10: Commit**

```bash
git add requirements-notebooks.txt notebooks/backtest.ipynb models/elo.py
git commit -m "feat: tune Elo parameters with a 2024/2025 backtest"
```

---

### Task 5: Predicciones congeladas

**Files:**
- Create: `models/predictions.py`, `tests/test_predictions.py`

**Interfaces:**
- Consumes: `MODEL_VERSION`, `win_probability`, `series_probability` (Task 1); `summarize` (Task 1). Partido con la forma de `schedule.json` (incluye `"prediction"`).
- Produces:
  - `make_predictions(schedule, ratings, now_iso, aliases=None) -> list[dict]` — cada una: `match_id, team1, team2, best_of, p_team1_game, p_team1_series, created_at, model_version`
  - `read_frozen(path) -> list[dict]`
  - `freeze(path, predictions, frozen) -> list[dict]` (las nuevas)
  - `attach_predictions(schedule, frozen, current) -> list[dict]` — `prediction = {p_team1_game, p_team1_series, model_version, frozen: bool} | None`
  - `evaluate(schedule, frozen) -> dict` (forma de `summarize`)

- [ ] **Step 1: Tests** — `tests/test_predictions.py`

```python
import json

import pytest

from models.elo import MODEL_VERSION
from models.predictions import attach_predictions, evaluate, freeze, make_predictions, read_frozen

NOW = "2026-10-15T10:00:00Z"
RATINGS = {"T1": 1600.0, "G2 Esports": 1500.0, "Fnatic": 1450.0}


def match(mid="m1", status="upcoming", start="2026-10-15T18:00:00Z", t1="T1", t2="G2 Esports", bo=3, winner=None):
    def team(name):
        return {"name": name, "short": name} if name else None
    return {"id": mid, "phase": "swiss", "round": "Round 1", "best_of": bo, "start_utc": start,
            "date": "2026-10-15", "team1": team(t1), "team2": team(t2), "score": None,
            "winner": winner, "status": status, "prediction": None}


def test_predicts_upcoming_matches_with_both_teams():
    [p] = make_predictions([match()], RATINGS, NOW)
    assert p["match_id"] == "m1" and p["team1"] == "T1" and p["team2"] == "G2 Esports"
    assert p["model_version"] == MODEL_VERSION and p["created_at"] == NOW and p["best_of"] == 3
    assert p["p_team1_game"] == pytest.approx(0.64, abs=0.001)
    assert p["p_team1_series"] > p["p_team1_game"]


def test_skips_undecided_started_and_finished_matches():
    matches = [match("a", t2=None), match("b", start="2026-10-15T09:00:00Z"),
               match("c", status="live"), match("d", status="finished", winner="team1")]
    assert make_predictions(matches, RATINGS, NOW) == []


def test_unconfirmed_time_still_gets_a_prediction():
    assert len(make_predictions([match(start=None)], RATINGS, NOW)) == 1


def test_aliases_are_used_to_find_ratings():
    [p] = make_predictions([match(t1="T1 Esports")], RATINGS, NOW, aliases={"T1 Esports": "T1"})
    assert p["team1"] == "T1 Esports"
    assert p["p_team1_game"] == pytest.approx(0.64, abs=0.001)


def test_freeze_appends_only_new_predictions(tmp_path):
    path = tmp_path / "predictions.jsonl"
    first = make_predictions([match()], RATINGS, NOW)
    assert len(freeze(path, first, [])) == 1
    later = make_predictions([match()], {**RATINGS, "T1": 1400.0}, "2026-10-15T11:00:00Z")
    assert freeze(path, later, read_frozen(path)) == []
    assert read_frozen(path) == first  # la predicción original no cambió


def test_freeze_never_rewrites_existing_lines(tmp_path):
    path = tmp_path / "predictions.jsonl"
    old = {**make_predictions([match("m0")], RATINGS, NOW)[0], "model_version": "elo-0"}
    path.write_text(json.dumps(old) + "\n", encoding="utf-8")
    freeze(path, make_predictions([match()], RATINGS, NOW), read_frozen(path))
    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2 and json.loads(lines[0]) == old


def test_corrected_pairing_gets_a_new_prediction(tmp_path):
    path = tmp_path / "predictions.jsonl"
    freeze(path, make_predictions([match(t2="G2 Esports")], RATINGS, NOW), [])
    fixed = make_predictions([match(t2="Fnatic")], RATINGS, NOW)
    assert len(freeze(path, fixed, read_frozen(path))) == 1


def test_attach_prefers_frozen_prediction():
    frozen = make_predictions([match()], RATINGS, NOW)
    current = make_predictions([match()], {**RATINGS, "T1": 1400.0}, NOW)
    [m] = attach_predictions([match()], frozen, current)
    assert m["prediction"] == {"p_team1_game": frozen[0]["p_team1_game"],
                               "p_team1_series": frozen[0]["p_team1_series"],
                               "model_version": MODEL_VERSION, "frozen": True}


def test_attach_falls_back_to_current_and_ignores_other_versions():
    old = [{**make_predictions([match()], RATINGS, NOW)[0], "model_version": "elo-0"}]
    [m] = attach_predictions([match()], old, make_predictions([match()], RATINGS, NOW))
    assert m["prediction"]["frozen"] is False


def test_attach_ignores_frozen_prediction_for_other_teams():
    frozen = make_predictions([match(t2="G2 Esports")], RATINGS, NOW)
    [m] = attach_predictions([match(t2="Fnatic")], frozen, [])
    assert m["prediction"] is None


def test_attach_leaves_unpredicted_matches_empty():
    [m] = attach_predictions([match(t2=None)], [], [])
    assert m["prediction"] is None


def test_finished_match_keeps_its_frozen_prediction():
    frozen = make_predictions([match()], RATINGS, NOW)
    [m] = attach_predictions([match(status="finished", winner="team1")], frozen, [])
    assert m["prediction"]["frozen"] is True


def test_evaluate_scores_only_finished_matches_with_frozen_predictions():
    frozen = make_predictions([match("a"), match("b")], RATINGS, NOW)
    schedule = [match("a", status="finished", winner="team1"), match("b"),
                match("c", status="finished", winner="team2")]
    result = evaluate(schedule, frozen)
    assert result["n"] == 1 and result["correct"] == 1
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `.venv/Scripts/python -m pytest tests/test_predictions.py -q`
Expected: FAIL `No module named 'models.predictions'`

- [ ] **Step 3: `models/predictions.py`**

```python
"""Predicciones congeladas: se guardan antes de cada partido y nunca se editan.

data/predictions.jsonl tiene una predicción por línea. Solo se agregan líneas al final.
Una predicción se identifica por (partido, versión del modelo, equipo 1, equipo 2): si Leaguepedia
corrige un cruce, el cruce nuevo recibe su propia predicción y la vieja deja de usarse.
"""
import json
from pathlib import Path

from models.elo import MODEL_VERSION, series_probability, win_probability
from models.metrics import summarize


def _key(match_id: str, version: str, team1: str, team2: str) -> tuple:
    return (match_id, version, team1, team2)


def _prediction_key(p: dict) -> tuple:
    return _key(p["match_id"], p["model_version"], p["team1"], p["team2"])


def _match_key(m: dict) -> tuple | None:
    if not m["team1"] or not m["team2"]:
        return None
    return _key(m["id"], MODEL_VERSION, m["team1"]["name"], m["team2"]["name"])


def make_predictions(schedule: list[dict], ratings: dict[str, float], now_iso: str,
                     aliases: dict[str, str] | None = None) -> list[dict]:
    """Predicción actual para cada partido que no empezó y tiene los dos equipos definidos."""
    aliases = aliases or {}
    predictions = []
    for m in schedule:
        if m["status"] != "upcoming" or not m["team1"] or not m["team2"]:
            continue
        if m["start_utc"] and m["start_utc"] <= now_iso:
            continue  # ya tendría que haber empezado: no se predice después de la hora
        t1, t2 = m["team1"]["name"], m["team2"]["name"]
        p_game = win_probability(ratings[aliases.get(t1, t1)], ratings[aliases.get(t2, t2)])
        predictions.append({
            "match_id": m["id"], "team1": t1, "team2": t2, "best_of": m["best_of"],
            "p_team1_game": round(p_game, 4),
            "p_team1_series": round(series_probability(p_game, m["best_of"]), 4),
            "created_at": now_iso, "model_version": MODEL_VERSION,
        })
    return predictions


def read_frozen(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def freeze(path: Path, predictions: list[dict], frozen: list[dict]) -> list[dict]:
    """Agrega al final del archivo las predicciones que todavía no estaban congeladas y las devuelve.

    El archivo se abre en modo 'a' (append): las líneas existentes nunca se tocan.
    """
    done = {_prediction_key(p) for p in frozen}
    new = [p for p in predictions if _prediction_key(p) not in done]
    if new:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            for p in new:
                f.write(json.dumps(p, ensure_ascii=False) + "\n")
    return new


def _first_by_key(predictions: list[dict]) -> dict[tuple, dict]:
    by_key: dict[tuple, dict] = {}
    for p in predictions:
        by_key.setdefault(_prediction_key(p), p)  # si hubiera repetidas, vale la primera
    return by_key


def attach_predictions(schedule: list[dict], frozen: list[dict], current: list[dict]) -> list[dict]:
    """Agrega 'prediction' a cada partido: la congelada si existe; si no, la actual (sin congelar)."""
    frozen_by, current_by = _first_by_key(frozen), _first_by_key(current)
    result = []
    for m in schedule:
        key = _match_key(m)
        p, is_frozen = (frozen_by[key], True) if key in frozen_by else (current_by.get(key), False)
        public = None
        if p is not None:
            public = {"p_team1_game": p["p_team1_game"], "p_team1_series": p["p_team1_series"],
                      "model_version": p["model_version"], "frozen": is_frozen}
        result.append({**m, "prediction": public})
    return result


def evaluate(schedule: list[dict], frozen: list[dict]) -> dict:
    """Aciertos del modelo: solo partidos terminados con predicción congelada de esta versión."""
    frozen_by = _first_by_key(frozen)
    probs, outcomes = [], []
    for m in schedule:
        if m["status"] != "finished" or m["winner"] not in ("team1", "team2"):
            continue
        p = frozen_by.get(_match_key(m))
        if p is None:
            continue
        probs.append(p["p_team1_series"])
        outcomes.append(1.0 if m["winner"] == "team1" else 0.0)
    return summarize(probs, outcomes)
```

- [ ] **Step 4: Tests en verde**

Run: `.venv/Scripts/python -m pytest -q` → todos PASS.

- [ ] **Step 5: Commit**

```bash
git add models/predictions.py tests/test_predictions.py
git commit -m "feat: add append-only frozen predictions and evaluation"
```

---

### Task 6: Integración en el build

**Files:**
- Modify: `pipeline/schedule.py` (clave `prediction`), `pipeline/validate.py`, `pipeline/build.py`
- Create: `data/predictions.jsonl` (vacío)
- Test: `tests/test_build.py`, `tests/test_validate.py`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces:
  - `schedule.json`: cada partido con `"prediction": {p_team1_game, p_team1_series, model_version, frozen} | null`
  - `elo.json`: `{model_version, updated_at, params: {k, region_offsets}, backtest: BACKTEST, teams: [{name, short, region, rating, games}] (orden desc), accuracy: {n, correct, accuracy, brier, calibration: [{label, n, predicted, observed}]}}`
  - `build(raw_dir, out_dir, now, predictions_file=PREDICTIONS_FILE, aliases_file=ALIASES_FILE, freeze_predictions=False)`
  - CLI: `python -m pipeline.build [--freeze]`
  - `validate_ratings(teams, games_played, aliases) -> list[str]`, `validate_predictions(matches) -> list[str]`

- [ ] **Step 1: Clave nueva en `pipeline/schedule.py`**

Agregar `"prediction"` a `MATCH_KEYS` y en `to_match` la línea `"prediction": None,  # la agrega el build con el Elo`.

En `tests/test_validate.py`, agregar `"prediction": None,` al dict `base` de `match()`, y al final:

```python
from collections import Counter

from pipeline.validate import validate_predictions, validate_ratings


def test_teams_without_enough_history_are_errors():
    errors = validate_ratings(["T1", "LYON"], Counter({"T1": 40, "LYON": 3}), {})
    assert errors == ["LYON: only 3 games in 2026 history (different name? add an alias to data/teams.csv)"]


def test_aliases_are_followed_when_counting_history():
    assert validate_ratings(["T1 Esports"], Counter({"T1": 40}), {"T1 Esports": "T1"}) == []


def test_probabilities_must_be_between_0_and_1():
    bad = match(prediction={"p_team1_game": 1.2, "p_team1_series": 0.5, "model_version": "elo-1", "frozen": False})
    assert validate_predictions([match(), bad]) == ["m1: p_team1_game out of range: 1.2"]
```

(mover los imports nuevos arriba del archivo junto al existente).

- [ ] **Step 2: `pipeline/validate.py`** (agregar)

```python
from collections import Counter

from pipeline.history import CURRENT_YEAR

# Menos games que esto en la temporada casi seguro es un nombre distinto entre tablas de Leaguepedia
MIN_GAMES = 10


def validate_ratings(teams: list[str], games_played: Counter, aliases: dict[str, str]) -> list[str]:
    """Cada equipo de Worlds tiene que tener historial; si no, su predicción saldría del rating inicial."""
    errors = []
    for team in teams:
        n = games_played.get(aliases.get(team, team), 0)
        if n < MIN_GAMES:
            errors.append(f"{team}: only {n} games in {CURRENT_YEAR} history "
                          "(different name? add an alias to data/teams.csv)")
    return errors


def validate_predictions(matches: list[dict]) -> list[str]:
    errors = []
    for m in matches:
        p = m.get("prediction")
        if p is None:
            continue
        for key in ("p_team1_game", "p_team1_series"):
            if not 0.0 <= p[key] <= 1.0:
                errors.append(f"{m['id']}: {key} out of range: {p[key]}")
    return errors
```

- [ ] **Step 3: Tests del build** — reemplazar `tests/test_build.py`

```python
import json

import pytest

from pipeline.build import build
from pipeline.schedule import MATCH_KEYS

NOW = "2026-10-15T11:00:00Z"


def write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


ROW = {
    "MatchId": "m1", "OverviewPage": "2026 Season World Championship/Play-In", "Tab": "Round 1",
    "Round": "1", "Phase": "", "BestOf": "3", "Team1": "T1", "Team2": "G2 Esports",
    "Team1Score": "", "Team2Score": "", "Winner": "", "DateTimeUTC": "2026-10-15 18:00:00",
    "HasTime": "1", "IsNullified": "",
}


def write_raw(raw, rows=(ROW,), history_teams=("T1", "G2 Esports"), rosters=()):
    stamp = "2026-10-15T10:00:00Z"
    write(raw / "worlds_2026_matches.json", {"fetched_at": stamp, "rows": list(rows)})
    write(raw / "worlds_2026_rosters.json", {"fetched_at": stamp, "rows": [{"Team": t, "OverviewPage": "x"} for t in rosters]})
    write(raw / "history_2026_tournaments.json", {"fetched_at": stamp, "rows": [
        {"OverviewPage": "LCK/2026 Season/Cup", "League": "LoL Champions Korea", "Region": "Korea",
         "TournamentLevel": "Primary", "IsQualifier": "0", "Year": "2026"}]})
    games = [{"GameId": f"g{i}", "MatchId": f"h{i}", "OverviewPage": "LCK/2026 Season/Cup",
              "Team1": history_teams[0], "Team2": history_teams[1], "Winner": "1" if i % 3 else "2",
              "DateTimeUTC": f"2026-02-{i + 1:02d} 08:00:00", "GameInMatch": "1"} for i in range(12)]
    write(raw / "history_2026_games.json", {"fetched_at": stamp, "rows": games})


def run(tmp_path, freeze=False):
    build(tmp_path / "raw", tmp_path / "out", NOW, predictions_file=tmp_path / "predictions.jsonl",
          aliases_file=tmp_path / "teams.csv", freeze_predictions=freeze)
    read = lambda name: json.loads((tmp_path / "out" / name).read_text(encoding="utf-8"))
    return read("schedule.json"), read("meta.json"), read("elo.json")


def test_build_writes_contract_files(tmp_path):
    write_raw(tmp_path / "raw")
    write(tmp_path / "raw" / "worlds_2026_teams.json", {"fetched_at": "x", "rows": [{"Name": "G2 Esports", "Short": "G2"}]})
    schedule, meta, elo = run(tmp_path)
    [m] = schedule["matches"]
    assert set(m) == MATCH_KEYS
    assert m["team2"]["short"] == "G2"
    assert m["prediction"]["frozen"] is False and 0 < m["prediction"]["p_team1_series"] < 1
    assert meta == {"updated_at": NOW, "source_fetched_at": "2026-10-15T10:00:00Z", "match_count": 1}
    assert set(elo) == {"model_version", "updated_at", "params", "backtest", "teams", "accuracy"}
    ratings = [t["rating"] for t in elo["teams"]]
    assert {t["name"] for t in elo["teams"]} == {"T1", "G2 Esports"}
    assert ratings == sorted(ratings, reverse=True)
    assert elo["teams"][0]["region"] == "KR" and elo["accuracy"]["n"] == 0


def test_build_without_freeze_does_not_write_predictions(tmp_path):
    write_raw(tmp_path / "raw")
    run(tmp_path)
    assert not (tmp_path / "predictions.jsonl").exists()


def test_build_with_freeze_is_idempotent(tmp_path):
    write_raw(tmp_path / "raw")
    schedule, _, _ = run(tmp_path, freeze=True)
    run(tmp_path, freeze=True)
    assert schedule["matches"][0]["prediction"]["frozen"] is True
    assert len((tmp_path / "predictions.jsonl").read_text(encoding="utf-8").splitlines()) == 1


def test_build_lists_participants_before_pairings_are_known(tmp_path):
    tbd = {**ROW, "Team1": "TBD", "Team2": "TBD"}
    write_raw(tmp_path / "raw", rows=[tbd], rosters=["T1", "G2 Esports", "TBD"])
    schedule, _, elo = run(tmp_path)
    assert schedule["matches"][0]["prediction"] is None
    assert {t["name"] for t in elo["teams"]} == {"T1", "G2 Esports"}


def test_build_fails_when_a_worlds_team_has_no_history(tmp_path):
    write_raw(tmp_path / "raw", history_teams=("T1", "Gen.G"))
    with pytest.raises(ValueError, match="G2 Esports: only 0 games"):
        run(tmp_path)
    assert not (tmp_path / "out" / "schedule.json").exists()


def test_build_refuses_invalid_data_and_writes_nothing(tmp_path):
    write_raw(tmp_path / "raw", rows=[])
    with pytest.raises(ValueError, match="schedule is empty"):
        run(tmp_path)
    assert not (tmp_path / "out" / "schedule.json").exists()
```

- [ ] **Step 4: Correr y ver que fallan**

Run: `.venv/Scripts/python -m pytest tests/test_build.py tests/test_validate.py -q`
Expected: FAIL (firma de `build` y funciones de validación nuevas).

- [ ] **Step 5: `pipeline/build.py`** (reemplazar completo)

```python
"""Genera los JSON del sitio a partir de data/raw/.

Uso: python -m pipeline.build            # genera los JSON (no toca data/predictions.jsonl)
     python -m pipeline.build --freeze   # además congela las predicciones nuevas (lo usa el cron)
"""
import json
import sys
from pathlib import Path

from models.elo import BACKTEST, MODEL_VERSION, PARAMS, run_elo, team_regions
from models.predictions import attach_predictions, evaluate, freeze, make_predictions, read_frozen
from pipeline import utc_now_iso
from pipeline.history import CURRENT_YEAR, load_aliases, load_season_games
from pipeline.schedule import UNDECIDED_TEAMS, build_schedule
from pipeline.validate import validate_predictions, validate_ratings, validate_schedule

RAW_DIR = Path("data/raw")
OUT_DIR = Path("web/public/data")
PREDICTIONS_FILE = Path("data/predictions.jsonl")
ALIASES_FILE = Path("data/teams.csv")


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _rows_if_exists(path: Path) -> list[dict]:
    return _read(path)["rows"] if path.exists() else []


def _write(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def participants(schedule: list[dict], rosters: list[dict]) -> list[str]:
    """Equipos de Worlds: los inscriptos más los que ya aparecen en el calendario."""
    names = {(r.get("Team") or "").strip() for r in rosters}
    names |= {m[side]["name"] for m in schedule for side in ("team1", "team2") if m[side]}
    return sorted(n for n in names if n and n.lower() not in UNDECIDED_TEAMS)


def elo_payload(teams, run, regions, shorts, aliases, accuracy, now) -> dict:
    rated = []
    for name in teams:
        canonical = aliases.get(name, name)
        rated.append({"name": name, "short": shorts.get(name) or name, "region": regions.get(canonical),
                      "rating": round(run.ratings[canonical], 1), "games": run.games_played[canonical]})
    rated.sort(key=lambda t: -t["rating"])
    return {
        "model_version": MODEL_VERSION,
        "updated_at": now,
        "params": {"k": PARAMS.k, "region_offsets": PARAMS.region_offsets},
        "backtest": BACKTEST,
        "teams": rated,
        "accuracy": accuracy,
    }


def build(raw_dir: Path, out_dir: Path, now: str, predictions_file: Path = PREDICTIONS_FILE,
          aliases_file: Path = ALIASES_FILE, freeze_predictions: bool = False) -> None:
    matches_raw = _read(raw_dir / "worlds_2026_matches.json")
    shorts = {t["Name"]: t.get("Short") or t["Name"] for t in _rows_if_exists(raw_dir / "worlds_2026_teams.json")}
    schedule = build_schedule(matches_raw["rows"], shorts)

    # Elo con toda la temporada (ligas + internacionales + lo que va de Worlds)
    aliases = load_aliases(aliases_file)
    games = load_season_games(raw_dir, CURRENT_YEAR, aliases)
    regions = team_regions(games)
    run = run_elo(games, PARAMS, regions)
    teams = participants(schedule, _rows_if_exists(raw_dir / "worlds_2026_rosters.json"))

    # Todo se valida antes de escribir nada (ni JSON ni predicciones congeladas)
    errors = validate_schedule(schedule) + validate_ratings(teams, run.games_played, aliases)
    current = [] if errors else make_predictions(schedule, run.ratings, now, aliases)
    errors += validate_predictions(attach_predictions(schedule, [], current))
    if errors:
        raise ValueError("validation failed:\n- " + "\n- ".join(errors))

    frozen = read_frozen(predictions_file)
    if freeze_predictions:
        frozen += freeze(predictions_file, current, frozen)
    schedule = attach_predictions(schedule, frozen, current)

    out_dir.mkdir(parents=True, exist_ok=True)
    _write(out_dir / "schedule.json", {"matches": schedule})
    _write(out_dir / "meta.json", {
        "updated_at": now,
        "source_fetched_at": matches_raw["fetched_at"],
        "match_count": len(schedule),
    })
    _write(out_dir / "elo.json", elo_payload(teams, run, regions, shorts, aliases, evaluate(schedule, frozen), now))


def main() -> None:
    try:
        build(RAW_DIR, OUT_DIR, utc_now_iso(), freeze_predictions="--freeze" in sys.argv)
    except ValueError as error:
        sys.exit(str(error))
    print(f"wrote {OUT_DIR}/schedule.json, meta.json and elo.json")


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Archivo de predicciones vacío** (para que el cron lo pueda `git add` desde el primer día)

```bash
: > data/predictions.jsonl
```

- [ ] **Step 7: Tests y build real**

```bash
.venv/Scripts/python -m pytest -q
.venv/Scripts/python -m pipeline.build
.venv/Scripts/python -c "import json; e=json.load(open('web/public/data/elo.json', encoding='utf-8')); print(e['params']); [print(t) for t in e['teams']]"
```
Expected: tests PASS; build escribe los tres JSON; `elo.json` lista a los inscriptos ordenados por rating; `data/predictions.jsonl` sigue vacío.

- [ ] **Step 8: Commit**

```bash
git add pipeline tests data/predictions.jsonl
git commit -m "feat: export Elo ratings and predictions from the build"
```

---

### Task 7: Frontend — predicción en las tarjetas y sección Predicciones

**Files:**
- Modify: `web/src/types.ts`, `web/src/data.ts`, `web/src/format.ts`, `web/src/format.test.ts`, `web/src/schedule.test.ts`, `web/src/main.ts`, `web/src/views/matchCard.ts`, `web/src/views/today.ts`, `web/src/styles.css`, `web/index.html`
- Create: `web/src/predictions.ts`, `web/src/predictions.test.ts`, `web/src/views/predictions.ts`

**Interfaces:**
- Consumes: `schedule.json` (`prediction`) y `elo.json` de Task 6.
- Produces: `formatPercent(p: number): string`; `favorite(m): Side | null`; `verdict(m): 'hit' | 'miss' | null`; `upcomingPredicted(matches): Match[]`; `predictionBlock(m): string`; `renderPredictions(el, data, tz)`; ruta `#/predicciones`.

- [ ] **Step 1: Tipos** — en `web/src/types.ts`, agregar `prediction: Prediction | null;` al final de `Match` y:

```ts
export interface Prediction {
  p_team1_game: number;
  p_team1_series: number;
  model_version: string;
  frozen: boolean; // true = guardada antes del partido (cuenta para los aciertos)
}

export interface RatedTeam {
  name: string;
  short: string;
  region: string | null;
  rating: number;
  games: number;
}

export interface CalibrationBucket {
  label: string;
  n: number;
  predicted: number | null;
  observed: number | null;
}

export interface Accuracy {
  n: number;
  correct: number;
  accuracy: number | null;
  brier: number | null;
  calibration: CalibrationBucket[];
}

export interface Backtest {
  calibration_year: number;
  validation_year: number;
  validation_games: number;
  validation_brier: number;
  baseline_brier: number;
  worlds_series: number;
  worlds_accuracy: number;
  worlds_brier: number;
}

export interface Elo {
  model_version: string;
  updated_at: string;
  params: { k: number; region_offsets: Record<string, number> };
  backtest: Backtest;
  teams: RatedTeam[];
  accuracy: Accuracy;
}
```

En `web/src/schedule.test.ts`, agregar `prediction: null,` al objeto base de `match()`.

- [ ] **Step 2: Tests** — agregar a `web/src/format.test.ts` (sumar `formatPercent` al import de `./format`):

```ts
describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatPercent(0.6407)).toBe('64%');
    expect(formatPercent(0.5)).toBe('50%');
  });
  it('never shows certainty', () => {
    expect(formatPercent(0.999)).toBe('99%');
    expect(formatPercent(0.002)).toBe('1%');
  });
});
```

Crear `web/src/predictions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { favorite, upcomingPredicted, verdict } from './predictions';
import type { Match, Prediction } from './types';

const pred = (p: number, frozen = true): Prediction => ({ p_team1_game: p, p_team1_series: p, model_version: 'elo-1', frozen });

function match(overrides: Partial<Match>): Match {
  return {
    id: 'm', phase: 'swiss', round: 'Round 1', best_of: 1,
    start_utc: '2026-10-24T17:00:00Z', date: '2026-10-24',
    team1: { name: 'T1', short: 'T1' }, team2: { name: 'G2 Esports', short: 'G2' },
    score: null, winner: null, status: 'upcoming', prediction: null,
    ...overrides,
  };
}

describe('favorite', () => {
  it('is the side with 50% or more', () => {
    expect(favorite(match({ prediction: pred(0.64) }))).toBe('team1');
    expect(favorite(match({ prediction: pred(0.36) }))).toBe('team2');
    expect(favorite(match({ prediction: pred(0.5) }))).toBe('team1');
    expect(favorite(match({}))).toBeNull();
  });
});

describe('verdict', () => {
  it('compares the favorite with the winner', () => {
    expect(verdict(match({ status: 'finished', winner: 'team1', prediction: pred(0.7) }))).toBe('hit');
    expect(verdict(match({ status: 'finished', winner: 'team2', prediction: pred(0.7) }))).toBe('miss');
  });
  it('ignores unfinished matches and predictions that were not frozen', () => {
    expect(verdict(match({ prediction: pred(0.7) }))).toBeNull();
    expect(verdict(match({ status: 'finished', winner: 'team1', prediction: pred(0.7, false) }))).toBeNull();
  });
});

describe('upcomingPredicted', () => {
  it('keeps upcoming matches that have a prediction', () => {
    const list = upcomingPredicted([
      match({ id: 'a', prediction: pred(0.6) }),
      match({ id: 'b' }),
      match({ id: 'c', status: 'finished', winner: 'team1', prediction: pred(0.6) }),
    ]);
    expect(list.map((m) => m.id)).toEqual(['a']);
  });
});
```

Run: `cd web && npx vitest run` → FAIL (`formatPercent` y `./predictions` no existen).

- [ ] **Step 3: Lógica pura**

En `web/src/format.ts`:

```ts
// Probabilidad como porcentaje entero. Nunca 0% ni 100%: el modelo nunca está seguro
export function formatPercent(p: number): string {
  return `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`;
}
```

`web/src/predictions.ts`:

```ts
import type { Match } from './types';

export type Side = 'team1' | 'team2';

// Favorito de la serie según el modelo (con 50% exacto, el equipo 1, igual que en Python)
export function favorite(m: Match): Side | null {
  if (!m.prediction) return null;
  return m.prediction.p_team1_series >= 0.5 ? 'team1' : 'team2';
}

// ¿Acertó el modelo? Solo cuenta si la predicción se guardó antes del partido
export function verdict(m: Match): 'hit' | 'miss' | null {
  if (m.status !== 'finished' || !m.winner || !m.prediction?.frozen) return null;
  return favorite(m) === m.winner ? 'hit' : 'miss';
}

// Próximos partidos con predicción, en el orden del calendario
export function upcomingPredicted(matches: Match[]): Match[] {
  return matches.filter((m) => m.status === 'upcoming' && m.prediction !== null);
}
```

Run: `cd web && npx vitest run` → PASS.

- [ ] **Step 4: Datos** — `web/src/data.ts`: agregar `elo: Elo` a `SiteData` (importar `Elo`) y en `loadData`:

```ts
export async function loadData(): Promise<SiteData> {
  const [schedule, meta, elo] = await Promise.all([
    getJson<Schedule>('schedule.json'),
    getJson<Meta>('meta.json'),
    getJson<Elo>('elo.json'),
  ]);
  return { schedule, meta, elo };
}
```

- [ ] **Step 5: Barra de probabilidad** — en `web/src/views/matchCard.ts` (importar `formatPercent` de `../format` y `favorite, verdict` de `../predictions`):

```ts
// Probabilidad de ganar la serie + si el modelo acertó (con texto, no solo color)
export function predictionBlock(m: Match): string {
  const p = m.prediction;
  if (!p || !m.team1 || !m.team2) return '';
  const fav = favorite(m);
  const p1 = formatPercent(p.p_team1_series);
  const p2 = formatPercent(1 - p.p_team1_series);
  const v = verdict(m);
  const verdictHtml = v === 'hit'
    ? '<span class="verdict hit">✓ El modelo acertó</span>'
    : v === 'miss' ? '<span class="verdict miss">✗ El modelo falló</span>' : '';
  const label = `Probabilidad de ganar la serie: ${escapeHtml(m.team1.short)} ${p1}, ${escapeHtml(m.team2.short)} ${p2}`;
  return `
    <div class="pred" role="img" aria-label="${label}">
      <span class="pct${fav === 'team1' ? ' fav' : ''}">${p1}</span>
      <span class="bar" aria-hidden="true"><i style="width:${(p.p_team1_series * 100).toFixed(1)}%"></i></span>
      <span class="pct${fav === 'team2' ? ' fav' : ''}">${p2}</span>
    </div>${verdictHtml}`;
}
```

En `matchCard`, insertar `${predictionBlock(m)}` justo después del `<div class="teams">…</div>`. En `web/src/views/today.ts`, importar `predictionBlock` de `./matchCard` e insertarlo en `featureCard` después del `<div class="teams">…</div>`.

- [ ] **Step 6: Vista** — `web/src/views/predictions.ts`

```ts
import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { upcomingPredicted } from '../predictions';
import type { CalibrationBucket, Elo } from '../types';
import { matchCard } from './matchCard';

type Tab = 'proximos' | 'ranking' | 'como' | 'aciertos';
const TABS: [Tab, string][] = [['proximos', 'Próximos'], ['ranking', 'Ranking'], ['como', 'Cómo funciona'], ['aciertos', 'Aciertos']];

// La sub-vista se recuerda mientras la página esté abierta
let current: Tab = 'proximos';

const BO1_NOTE = '<p class="note">Los Bo1 tienen alta varianza: una sola partida decide la serie, así que un favorito al 65% pierde una de cada tres. Mirá el porcentaje, no solo quién es el favorito.</p>';

const pct = (x: number) => `${Math.round(x * 100)}%`;

function empty(title: string, detail: string): string {
  return `<div class="state"><b>${title}</b><span>${detail}</span></div>`;
}

function upcoming(data: SiteData, tz: string): string {
  const list = upcomingPredicted(data.schedule.matches);
  const body = list.length
    ? `<div class="grid g3">${list.map((m) => matchCard(m, tz)).join('')}</div>`
    : empty('Todavía no hay cruces definidos', 'Las predicciones aparecen cuando Leaguepedia confirma qué equipos juegan cada partido. Mientras tanto, mirá el ranking.');
  return `${BO1_NOTE}${body}`;
}

function ranking(elo: Elo): string {
  if (!elo.teams.length) return empty('Sin equipos todavía', 'El ranking aparece cuando se conozcan los clasificados.');
  const rows = elo.teams.map((t, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td class="team"><b>${escapeHtml(t.short)}</b><span class="muted">${escapeHtml(t.name)}</span></td>
      <td>${escapeHtml(t.region ?? '—')}</td>
      <td class="num">${Math.round(t.rating)}</td>
      <td class="num">${t.games}</td>
    </tr>`).join('');
  return `
    <p class="muted">Rating Elo de los clasificados, calculado con todas las partidas de 2026 (ligas e internacionales). 100 puntos de diferencia ≈ 64% de ganar una partida.</p>
    <div class="table-wrap"><table class="rank">
      <thead><tr><th class="num">#</th><th>Equipo</th><th>Región</th><th class="num">Elo</th><th class="num">Partidas</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function howItWorks(elo: Elo): string {
  const offsets = Object.entries(elo.params.region_offsets)
    .filter(([, v]) => v !== 0)
    .map(([region, v]) => `${escapeHtml(region)} ${v > 0 ? '+' : ''}${v}`)
    .join(' · ') || 'sin ajustes';
  const b = elo.backtest;
  return `
    <div class="prose stack">
      <h2>Elo por partida</h2>
      <p>Cada equipo tiene un rating. La diferencia entre dos ratings se convierte en probabilidad de ganar una partida: con 100 puntos de diferencia, el favorito gana el 64% de las veces. Después de cada partida el ganador suma puntos y el perdedor resta los mismos; una sorpresa mueve más los ratings que un resultado esperado.</p>
      <h2>De partida a serie</h2>
      <p>Para un Bo3 o un Bo5 se suman todas las formas de llegar primero a 2 o 3 victorias. Con 57% por partida, el favorito gana el 60% de los Bo3 y el 63% de los Bo5: cuantas más partidas, menos pesa la suerte. Supone que cada partida es independiente de la anterior, lo que es solo una aproximación.</p>
      <h2>Regiones</h2>
      <p>Las ligas casi no se cruzan entre sí, así que cada equipo arranca la temporada con un ajuste según su región (${offsets}) y los torneos internacionales de 2026 corrigen el resto. K = ${elo.params.k}: cuánto se mueve el rating después de cada partida.</p>
      <h2>¿Funciona?</h2>
      <p>Los valores se eligieron con la temporada ${b.calibration_year} y se probaron en ${b.validation_year}, que el modelo no había visto. En ${b.validation_games} partidas entre regiones distintas, el Brier score fue ${b.validation_brier.toFixed(3)} (tirar una moneda da 0.250; el Elo sin ajuste regional, ${b.baseline_brier.toFixed(3)}). En las ${b.worlds_series} series de Worlds ${b.validation_year} acertó el ${pct(b.worlds_accuracy)}.</p>
      <h2>Reglas</h2>
      <p>Cada predicción se guarda antes del partido y nunca se edita. Si el modelo cambia, cambia su versión (actual: ${escapeHtml(elo.model_version)}) y los aciertos se cuentan por separado.</p>
      ${BO1_NOTE}
    </div>`;
}

function calibrationRow(c: CalibrationBucket): string {
  if (!c.n || c.predicted === null || c.observed === null) {
    return `<div class="calib-row"><span class="label">Favorito con ${c.label} · sin partidos</span></div>`;
  }
  return `
    <div class="calib-row">
      <span class="label">Favorito con ${c.label} · ${c.n} ${c.n === 1 ? 'partido' : 'partidos'}</span>
      <div class="calib-line"><span>Predicho</span><span class="bar gold" aria-hidden="true"><i style="width:${(c.predicted * 100).toFixed(1)}%"></i></span><b>${pct(c.predicted)}</b></div>
      <div class="calib-line"><span>Real</span><span class="bar" aria-hidden="true"><i style="width:${(c.observed * 100).toFixed(1)}%"></i></span><b>${pct(c.observed)}</b></div>
    </div>`;
}

function hits(elo: Elo): string {
  const a = elo.accuracy;
  if (!a.n || a.accuracy === null || a.brier === null) {
    return empty('Todavía no hay partidos evaluados', 'Cada predicción se evalúa cuando termina su partido. Solo cuentan las que se guardaron antes de empezar.');
  }
  return `
    <div class="kpis">
      <div class="bezel"><div class="core kpi"><span class="label">Aciertos</span><b>${a.correct}/${a.n}</b><span class="muted">${pct(a.accuracy)}</span></div></div>
      <div class="bezel"><div class="core kpi"><span class="label">Brier score</span><b>${a.brier.toFixed(3)}</b><span class="muted">0 es perfecto · moneda = 0.250</span></div></div>
    </div>
    <h2>Calibración</h2>
    <p class="muted">Si el modelo está bien calibrado, los favoritos al 60–70% ganan entre el 60 y el 70% de las veces. Con pocos partidos estos números saltan mucho.</p>
    <div class="calib">${a.calibration.map(calibrationRow).join('')}</div>`;
}

export function renderPredictions(el: HTMLElement, data: SiteData, tz: string): () => void {
  const body = current === 'proximos' ? upcoming(data, tz)
    : current === 'ranking' ? ranking(data.elo)
    : current === 'como' ? howItWorks(data.elo)
    : hits(data.elo);
  const buttons = TABS.map(
    ([id, label]) => `<button type="button" data-sub="${id}" aria-pressed="${id === current}">${label}</button>`,
  ).join('');

  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Modelo ${escapeHtml(data.elo.model_version)}</span>
      <h1>Predicciones</h1>
      <div class="seg" role="group" aria-label="Secciones de predicciones">${buttons}</div>
    </section>
    <section class="stack">${body}</section>`;

  el.querySelector('.seg')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-sub]');
    if (!button) return;
    current = button.dataset.sub as Tab;
    renderPredictions(el, data, tz);
    el.querySelector<HTMLButtonElement>(`button[data-sub="${current}"]`)?.focus();
  });
  return () => {};
}
```

- [ ] **Step 7: Ruta y navegación**

`web/src/main.ts`: importar `renderPredictions` y cambiar el tipo y las rutas:

```ts
type View = (el: HTMLElement, data: SiteData, tz: string) => () => void;

const ROUTES: Record<string, View> = {
  '#/': (el, data, tz) => renderToday(el, data.schedule.matches, tz),
  '#/calendario': (el, data, tz) => renderCalendar(el, data.schedule.matches, tz),
  '#/predicciones': renderPredictions,
};
```

y en `render`: `cleanup = ROUTES[currentHash()](view, data, tz);` (quitar el import de `Match` si queda sin uso).

`web/index.html`: en `<nav class="tabs">` agregar `<a class="tab" href="#/predicciones" data-tab="#/predicciones">Predicciones</a>`; en `.bottombar` agregar:

```html
      <a href="#/predicciones" data-tab="#/predicciones">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20v-7M12 20V5M19 20v-10"/></svg>Predicciones
      </a>
```

- [ ] **Step 8: Estilos** — en `web/src/styles.css`, cambiar `.bottombar` a `grid-template-columns: repeat(3, 1fr);` y agregar al final:

```css
/* Predicción: probabilidad de ganar la serie */
.pred { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; font: 500 13px/1 var(--f-data); font-variant-numeric: tabular-nums; color: var(--fg2); }
.pred .fav { color: var(--gold); font-weight: 700; }
.bar { display: block; height: 6px; background: var(--sunken); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--cyan); transform-origin: left; animation: grow .7s var(--ease); }
.bar.gold i { background: var(--gold); }
@keyframes grow { from { transform: scaleX(0); } }
.verdict { font: 600 12px/1 var(--f-data); letter-spacing: .06em; text-transform: uppercase; }
.verdict.hit { color: var(--win); }
.verdict.miss { color: var(--loss); }
.note { margin: 0; border-left: 2px solid var(--gold); padding: 10px 14px; background: var(--gold-soft); font-size: 14px; }
.prose h2 { margin: 8px 0 0; }
.prose p { margin: 0; max-width: 70ch; }

/* Ranking */
.table-wrap { overflow-x: auto; }
.rank { width: 100%; border-collapse: collapse; font-size: 14px; }
.rank th { text-align: left; font: 500 10.5px/1.3 var(--f-data); letter-spacing: .16em; text-transform: uppercase; color: var(--fg2); padding: 8px; border-bottom: 1px solid var(--line); }
.rank td { padding: 10px 8px; border-bottom: 1px solid var(--line); }
.rank .num { font-family: var(--f-data); font-variant-numeric: tabular-nums; text-align: right; }
.rank .team b { font: 700 1.05rem/1 var(--f-display); text-transform: uppercase; letter-spacing: .04em; margin-right: 8px; }

/* Aciertos y calibración */
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.kpi { display: grid; gap: 6px; }
.kpi b { font: 700 2rem/1 var(--f-data); font-variant-numeric: tabular-nums; }
.calib { display: grid; gap: 16px; }
.calib-row { display: grid; gap: 6px; }
.calib-line { display: grid; grid-template-columns: 64px 1fr 44px; gap: 10px; align-items: center; font: 12px var(--f-data); color: var(--fg2); }
.calib-line b { color: var(--fg); text-align: right; font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  .bar i { animation: none; }
}
```

- [ ] **Step 9: Verificar**

```bash
cd web && npx vitest run && npm run build
```
Expected: tests PASS; `tsc` sin errores; build OK. Con `npm run dev`, abrir `#/predicciones` (Ranking con los inscriptos, Cómo funciona con los números del backtest, Aciertos vacío) y ver que Hoy/Calendario no cambian mientras los cruces sigan en TBD.

- [ ] **Step 10: Commit**

```bash
git add web
git commit -m "feat: show series probabilities and add Predictions section"
```

---

### Task 8: Cron, deploy y verificación

**Files:**
- Modify: `.github/workflows/update.yml`

- [ ] **Step 1: Congelar en el cron y commitear predicciones** — en `update.yml`:

```yaml
      - name: Build site data and freeze new predictions (fails on invalid data, so nothing is deployed)
        run: python -m pipeline.build --freeze

      - name: Commit raw data and frozen predictions if they changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/raw data/predictions.jsonl
          git diff --cached --quiet || (git commit -m "data: update Worlds 2026 data and frozen predictions" && git push)
```

- [ ] **Step 2: Tests completos**

```bash
.venv/Scripts/python -m pytest -q
cd web && npx vitest run && npm run build
```
Expected: todo PASS.

- [ ] **Step 3: Commit, push y deploy**

```bash
git add .github/workflows/update.yml
git commit -m "ci: freeze predictions in the hourly update"
git pull --rebase && git push
```
Esperar a que "CI" y "Update data and deploy" terminen en verde (`gh run list -L 3`).

- [ ] **Step 4: Verificar el sitio publicado**

```bash
curl -s https://matiasarrebillaga.github.io/worlds-companion/data/elo.json | head -c 600
```
Expected: `model_version`, `params` con los valores del backtest y `teams` con los inscriptos. Si los cruces ya están cargados, `data/predictions.jsonl` en `origin/master` tiene una línea por partido con equipos definidos (`git pull` y `wc -l data/predictions.jsonl`).

---

## Self-Review

- **Cobertura del spec, etapa 2:** historial descargado una sola vez ✓ (T2, T3); Elo por game ✓ (T1); serie binomial ✓ (T1); ajuste regional + internacionales ✓ (T1, T2); K y ajustes por backtest 2024/2025 con Brier en notebook, valores en el código y publicados en `elo.json` ✓ (T4, T6); predicciones congeladas append-only con `created_at` y `model_version` ✓ (T5, T6, T8); precisión, Brier y calibración por tramos solo con congeladas ✓ (T5, T7); probabilidades siempre visibles + aviso Bo1 ✓ (T7); validación de probabilidades y equipos sin historial ✓ (T6); predicción en las tarjetas y en Hoy ✓ (T7); ✓/✗ del modelo en últimos resultados ✓ (T7, vía `matchCard`).
- **Fuera de esta etapa:** historia de rating por partido en `elo.json` y gráfico de evolución (etapa 3); Chart.js (etapa 3).
- **Placeholders:** el único valor no fijado de antemano son los números de `PARAMS`/`BACKTEST`, que salen del notebook en T4 Step 8 con un procedimiento concreto.
- **Tipos:** `p_team1_game`/`p_team1_series`/`model_version`/`frozen` iguales en Python (T5) y TS (T7); claves de `BACKTEST` iguales en el notebook (T4), `elo.json` (T6) y `Backtest` (T7); `calibration` con `label/n/predicted/observed` en T1, T6 y T7.
