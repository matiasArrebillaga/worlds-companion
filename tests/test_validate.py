from collections import Counter

from pipeline.validate import validate_predictions, validate_ratings, validate_schedule


def match(**overrides):
    base = {
        "id": "m1", "phase": "swiss", "round": "Round 1", "best_of": 1,
        "start_utc": "2026-10-23T17:00:00Z", "date": "2026-10-23",
        "team1": {"name": "T1", "short": "T1"}, "team2": {"name": "G2 Esports", "short": "G2"},
        "score": None, "winner": None, "status": "upcoming", "prediction": None,
    }
    return {**base, **overrides}


def test_valid_schedule_has_no_errors():
    assert validate_schedule([match(), match(id="m2")]) == []


def test_empty_schedule_is_an_error():
    assert validate_schedule([]) == ["schedule is empty"]


def test_duplicate_ids():
    assert "duplicate match id: m1" in validate_schedule([match(), match()])


def test_missing_keys():
    broken = match()
    del broken["status"]
    assert any("missing keys" in e for e in validate_schedule([broken]))


def test_bad_phase_and_status():
    errors = validate_schedule([match(phase="groups", status="done")])
    assert "m1: invalid phase 'groups'" in errors
    assert "m1: invalid status 'done'" in errors


def test_finished_without_winner():
    assert "m1: finished without winner" in validate_schedule([match(status="finished", score=[1, 0])])


def test_team_cannot_play_itself():
    assert "m1: team plays itself" in validate_schedule([match(team2={"name": "T1", "short": "T1"})])


def test_undecided_teams_are_allowed():
    assert validate_schedule([match(team1=None, team2=None)]) == []


def test_teams_without_enough_history_are_errors():
    errors = validate_ratings(["T1", "LYON"], Counter({"T1": 40, "LYON": 3}), {})
    assert errors == ["LYON: only 3 games in 2026 history (different name? add an alias to data/teams.csv)"]


def test_aliases_are_followed_when_counting_history():
    assert validate_ratings(["T1 Esports"], Counter({"T1": 40}), {"T1 Esports": "T1"}) == []


def test_probabilities_must_be_between_0_and_1():
    bad = match(prediction={"p_team1_game": 1.2, "p_team1_series": 0.5, "model_version": "elo-1", "frozen": False})
    assert validate_predictions([match(), bad]) == ["m1: p_team1_game out of range: 1.2"]


def test_every_team_needs_a_lineup_for_the_player_form():
    from pipeline.validate import validate_lineups
    lineups = {"T1": {"top": "top:Doran"}, "LYON": {"top": "top:Dhokla"}}
    assert validate_lineups(["T1", "LYON (2024 American Team)"], lineups) == []
    [error] = validate_lineups(["T1", "Nobody"], lineups)
    assert "Nobody" in error
