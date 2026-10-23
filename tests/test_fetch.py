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


def test_fetch_tournament_filters_by_exact_pages(tmp_path, monkeypatch):
    # "Split 1" y "Split 1 Playoffs" son páginas hermanas: un prefijo las mezclaría
    from pipeline import leaguepedia
    monkeypatch.setattr(fetch, "RAW_DIR", tmp_path)
    queries = []
    monkeypatch.setattr(leaguepedia, "cargo_query", lambda session, **kw: queries.append(kw) or [])
    split = {"id": "lpl-2027-split-1", "league": "lpl", "pages": ["LPL/2027 Season/Split 1"], "start": "2027-01-14"}
    monkeypatch.setattr(fetch.lolesports, "fetch_games", lambda *args, **kwargs: [])
    fetch.fetch_tournament(None, split, "2027-01-14T00:00:00Z", full=True)
    pages_queries = [q for q in queries if q["tables"] != "Teams"]
    assert {q["tables"] for q in pages_queries} == {
        "MatchSchedule", "ScoreboardGames", "ScoreboardPlayers", "MatchScheduleGame", "TournamentRosters"}
    for q in pages_queries:
        assert q["where"] == 'OverviewPage IN ("LPL/2027 Season/Split 1")'
        assert "LIKE" not in q["where"]


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


def test_discover_survives_a_network_error(tmp_path, monkeypatch):
    import requests
    from pipeline import leaguepedia
    monkeypatch.setattr(fetch, "RAW_DIR", tmp_path)
    def boom(*args, **kwargs):
        raise requests.ConnectionError("no network")
    monkeypatch.setattr(leaguepedia, "cargo_query", boom)
    fetch.discover(None, "2026-12-01T00:00:00Z")


def test_main_keeps_going_when_one_tournament_fails(monkeypatch):
    import requests
    from pipeline import assets, leaguepedia, seasons
    monkeypatch.setattr(leaguepedia, "make_session", lambda: None)
    monkeypatch.setattr(fetch, "discover", lambda session, now: None)
    known = [{"id": "a", "start": "2000-01-01", "end": "2100-01-01"},
             {"id": "b", "start": "2000-01-01", "end": "2100-01-01"}]
    monkeypatch.setattr(seasons, "known_tournaments", lambda raw_dir, today: known)
    done = []
    def fake_fetch(session, tournament, now, full):
        if tournament["id"] == "a":
            raise requests.ConnectionError("down")
        done.append(tournament["id"])
    monkeypatch.setattr(fetch, "fetch_tournament", fake_fetch)
    monkeypatch.setattr(assets, "main", lambda session: done.append("assets"))
    fetch.main()
    assert done == ["b", "assets"]
