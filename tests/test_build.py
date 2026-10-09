import json

import pytest

from pipeline.build import build
from pipeline.schedule import MATCH_KEYS


def write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


ROW = {
    "MatchId": "m1", "OverviewPage": "2026 Season World Championship/Play-In", "Tab": "Round 1",
    "Round": "1", "Phase": "", "BestOf": "3", "Team1": "T1", "Team2": "G2 Esports",
    "Team1Score": "", "Team2Score": "", "Winner": "", "DateTimeUTC": "2026-10-15 18:00:00",
    "HasTime": "1", "IsNullified": "",
}


def test_build_writes_contract_files(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "out"
    write(raw / "worlds_2026_matches.json", {"fetched_at": "2026-10-15T10:00:00Z", "rows": [ROW]})
    write(raw / "worlds_2026_teams.json", {"fetched_at": "2026-10-15T10:00:00Z", "rows": [{"Name": "G2 Esports", "Short": "G2"}]})

    build(raw, out, "2026-10-15T11:00:00Z")

    schedule = json.loads((out / "schedule.json").read_text(encoding="utf-8"))
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    assert set(schedule) == {"matches"}
    assert set(schedule["matches"][0]) == MATCH_KEYS
    assert schedule["matches"][0]["team2"]["short"] == "G2"
    assert meta == {"updated_at": "2026-10-15T11:00:00Z", "source_fetched_at": "2026-10-15T10:00:00Z", "match_count": 1}


def test_build_works_without_teams_file(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "out"
    write(raw / "worlds_2026_matches.json", {"fetched_at": "2026-10-15T10:00:00Z", "rows": [ROW]})
    build(raw, out, "2026-10-15T11:00:00Z")
    assert (out / "schedule.json").exists()


def test_build_refuses_invalid_data_and_writes_nothing(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "out"
    write(raw / "worlds_2026_matches.json", {"fetched_at": "2026-10-15T10:00:00Z", "rows": []})
    with pytest.raises(ValueError, match="schedule is empty"):
        build(raw, out, "2026-10-15T11:00:00Z")
    assert not (out / "schedule.json").exists()
