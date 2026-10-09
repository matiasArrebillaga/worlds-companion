from pipeline.validate import validate_schedule


def match(**overrides):
    base = {
        "id": "m1", "phase": "swiss", "round": "Round 1", "best_of": 1,
        "start_utc": "2026-10-23T17:00:00Z", "date": "2026-10-23",
        "team1": {"name": "T1", "short": "T1"}, "team2": {"name": "G2 Esports", "short": "G2"},
        "score": None, "winner": None, "status": "upcoming",
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
