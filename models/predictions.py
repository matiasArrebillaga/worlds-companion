"""Predicciones congeladas: se guardan antes de cada partido y nunca se editan.

data/predictions.jsonl tiene una predicción por línea. Solo se agregan líneas al final.
Una predicción se identifica por (partido, versión del modelo, equipo 1, equipo 2): si Leaguepedia
corrige un cruce, el cruce nuevo recibe su propia predicción y la vieja deja de usarse.
"""
import json
from collections.abc import Callable
from datetime import datetime, timedelta
from math import exp, log
from pathlib import Path

from models.elo import MODEL_VERSION, series_probability, win_probability
from models.metrics import summarize

# Se congela recién cuando falta poco para el partido: así la predicción usa los ratings con los
# resultados más recientes (Leaguepedia publica el cruce antes de cargar los games de la ronda anterior).
FREEZE_WINDOW = timedelta(hours=8)


def _key(match_id: str, version: str, team1: str, team2: str) -> tuple:
    return (match_id, version, team1, team2)


def _prediction_key(p: dict) -> tuple:
    return _key(p["match_id"], p["model_version"], p["team1"], p["team2"])


def _match_key(m: dict) -> tuple | None:
    if not m["team1"] or not m["team2"]:
        return None
    return _key(m["id"], MODEL_VERSION, m["team1"]["name"], m["team2"]["name"])


def make_predictions(schedule: list[dict], ratings: dict[str, float], now_iso: str,
                     aliases: dict[str, str] | None = None,
                     adjust: Callable[[str, str], float] | None = None) -> list[dict]:
    """Predicción actual para cada partido que no empezó y tiene los dos equipos definidos.

    `adjust(team1, team2)` suma a los log-odds del Elo (la forma de los jugadores, ver models/role_form.py).
    """
    aliases = aliases or {}
    predictions = []
    for m in schedule:
        if m["status"] != "upcoming" or not m["team1"] or not m["team2"]:
            continue
        if m["start_utc"] and m["start_utc"] <= now_iso:
            continue  # ya tendría que haber empezado: no se predice después de la hora
        if not m["start_utc"] and (not m["date"] or m["date"] < now_iso[:10]):
            continue  # sin hora confirmada y de un día que ya pasó: puede haberse jugado
        t1, t2 = m["team1"]["name"], m["team2"]["name"]
        p_game = win_probability(ratings[aliases.get(t1, t1)], ratings[aliases.get(t2, t2)])
        if adjust is not None:
            p_game = 1.0 / (1.0 + exp(-(log(p_game / (1.0 - p_game)) + adjust(t1, t2))))
        predictions.append({
            "match_id": m["id"], "team1": t1, "team2": t2, "best_of": m["best_of"],
            "p_team1_game": round(p_game, 4),
            "p_team1_series": round(series_probability(p_game, m["best_of"]), 4),
            "created_at": now_iso, "model_version": MODEL_VERSION,
        })
    return predictions


def _parse(iso: str) -> datetime:
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ")


def ready_to_freeze(schedule: list[dict], now_iso: str) -> set[str]:
    """Ids de los partidos que empiezan dentro de FREEZE_WINDOW. Los que no tienen hora confirmada
    no se congelan: no hay forma de saber si ya empezaron."""
    now = _parse(now_iso)
    return {m["id"] for m in schedule
            if m["start_utc"] and now < _parse(m["start_utc"]) <= now + FREEZE_WINDOW}


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
