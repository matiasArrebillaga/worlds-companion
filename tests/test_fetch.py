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


def test_roster_teams_skips_tbd_and_dedupes():
    rosters = [{"Team": "T1"}, {"Team": "TBD"}, {"Team": "T1"}, {"Team": "G2 Esports"}, {"Team": ""}]
    assert fetch.roster_teams(rosters) == ["G2 Esports", "T1"]


def test_pages_where_matches_each_page_as_a_prefix():
    assert fetch.pages_where("OverviewPage", ["2026 Season World Championship"]) == (
        '(OverviewPage LIKE "2026 Season World Championship%")')
    assert fetch.pages_where("MatchId", ["LCK/2027 Season/Cup", 'A "B"']) == (
        '(MatchId LIKE "LCK/2027 Season/Cup%" OR MatchId LIKE "A \\"B\\"%")')


def test_targets_are_active_fully_and_upcoming_only_matches():
    from pipeline import seasons
    known = [dict(seasons.WORLDS_2026),
             {**seasons.WORLDS_2026, "id": "lck-2027-cup", "start": "2027-01-14", "end": "2027-02-22"},
             {**seasons.WORLDS_2026, "id": "old", "start": "2026-01-10", "end": "2026-02-01"}]
    assert fetch.targets(known, "2026-10-22") == [("worlds-2026", True), ("lck-2027-cup", False)]


def test_discover_keeps_the_previous_file_when_leaguepedia_fails(tmp_path, monkeypatch):
    from pipeline import leaguepedia, seasons
    monkeypatch.setattr(fetch, "RAW_DIR", tmp_path)
    seasons.write_discovery(seasons.discovery_file(tmp_path, 2027), [{"kept": "1"}], "old")
    def boom(*args, **kwargs):
        raise leaguepedia.RateLimited("ratelimited")
    monkeypatch.setattr(leaguepedia, "cargo_query", boom)
    fetch.discover(None, "2026-12-01T00:00:00Z")
    saved = json.loads(seasons.discovery_file(tmp_path, 2027).read_text(encoding="utf-8"))
    assert saved == {"fetched_at": "old", "rows": [{"kept": "1"}]}
