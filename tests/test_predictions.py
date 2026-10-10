import json

import pytest

from models.elo import MODEL_VERSION
from models.predictions import attach_predictions, evaluate, freeze, make_predictions, read_frozen, ready_to_freeze

NOW = "2026-10-15T10:00:00Z"
RATINGS = {"T1": 1600.0, "G2 Esports": 1500.0, "Fnatic": 1450.0}


def match(mid="m1", status="upcoming", start="2026-10-15T18:00:00Z", t1="T1", t2="G2 Esports", bo=3, winner=None,
          date="2026-10-15"):
    def team(name):
        return {"name": name, "short": name} if name else None
    return {"id": mid, "phase": "swiss", "round": "Round 1", "best_of": bo, "start_utc": start,
            "date": date, "team1": team(t1), "team2": team(t2), "score": None,
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


def test_unconfirmed_time_on_a_past_day_gets_no_prediction():
    assert make_predictions([match(start=None, date="2026-10-14")], RATINGS, NOW) == []


def test_only_matches_starting_soon_are_ready_to_freeze():
    schedule = [match("soon", start="2026-10-15T16:00:00Z"), match("later", start="2026-10-17T18:00:00Z"),
                match("no-time", start=None), match("started", start="2026-10-15T09:00:00Z")]
    assert ready_to_freeze(schedule, NOW) == {"soon"}
