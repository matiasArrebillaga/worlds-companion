import json

from pipeline import fetch


def test_team_names_skips_tbd_and_blanks_and_dedupes():
    matches = [
        {"Team1": "T1", "Team2": "G2 Esports"},
        {"Team1": "T1", "Team2": "TBD"},
        {"Team1": "", "Team2": "Gen.G"},
        {"Team1": "TBA", "Team2": "tbd"},
    ]
    assert fetch.team_names(matches) == ["G2 Esports", "Gen.G", "T1"]


def test_teams_where_escapes_quotes():
    assert fetch.teams_where(["T1", 'Team "Q"']) == 'Name IN ("T1","Team \\"Q\\"")'


def test_write_if_changed_writes_then_skips_identical(tmp_path):
    path = tmp_path / "raw" / "x.json"
    assert fetch.write_if_changed(path, [{"a": "1"}], "2026-10-15T10:00:00Z") is True
    assert fetch.write_if_changed(path, [{"a": "1"}], "2026-10-15T11:00:00Z") is False
    saved = json.loads(path.read_text(encoding="utf-8"))
    # Si no cambió nada, se conserva la fecha de la descarga original
    assert saved == {"fetched_at": "2026-10-15T10:00:00Z", "rows": [{"a": "1"}]}


def test_write_if_changed_rewrites_on_change(tmp_path):
    path = tmp_path / "x.json"
    fetch.write_if_changed(path, [{"a": "1"}], "2026-10-15T10:00:00Z")
    assert fetch.write_if_changed(path, [{"a": "2"}], "2026-10-15T11:00:00Z") is True
    assert json.loads(path.read_text(encoding="utf-8"))["fetched_at"] == "2026-10-15T11:00:00Z"


def test_read_rows_missing_file_is_empty(tmp_path):
    assert fetch.read_rows(tmp_path / "nope.json") == []
