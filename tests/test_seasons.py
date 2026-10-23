import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline import seasons


def row(page, league, start="2027-01-14", end="2027-02-22", playoffs="0", level="Primary", qualifier="0",
        year="2027", name=None):
    return {"Name": name or page, "OverviewPage": page, "League": league, "Year": year, "DateStart": start,
            "Date": end, "IsPlayoffs": playoffs, "TournamentLevel": level, "IsQualifier": qualifier}


def test_slug_lowercases_and_joins_with_dashes():
    assert seasons.slug("LCK/2027 Season/Rounds 1-2") == "lck-2027-season-rounds-1-2"
    assert seasons.slug("  LEC  Versus ") == "lec-versus"


def test_league_tournament_id_drops_the_season_word_of_the_year():
    assert seasons.league_tournament_id("LCK/2027 Season/Rounds 1-2") == "lck-2027-rounds-1-2"
    # Solo se quita el "Season" del año, no el del nombre de la etapa
    assert seasons.league_tournament_id("LCK/2026 Season/Season Play-In") == "lck-2026-season-play-in"
    assert seasons.league_tournament_id("LEC/2026 Season/Versus Season") == "lec-2026-versus-season"


def test_tracked_covers_the_four_leagues_and_three_internationals():
    assert set(seasons.TRACKED) == {"lck", "lpl", "lec", "lcs", "fst", "msi", "worlds"}
    assert seasons.TRACKED["lck"]["league"] == "LoL Champions Korea"
    assert seasons.TRACKED["worlds"]["international"] is True and seasons.TRACKED["lec"]["international"] is False


def test_group_keeps_each_league_page_as_its_own_tournament():
    out = seasons.group_tournaments([
        row("LCK/2027 Season/Rounds 1-2", "LoL Champions Korea"),
        row("LCK/2027 Season/Playoffs", "LoL Champions Korea", "2027-03-01", "2027-03-20", playoffs="1"),
    ])
    assert [(t["id"], t["league"], t["is_playoffs"]) for t in out] == [
        ("lck-2027-rounds-1-2", "lck", False), ("lck-2027-playoffs", "lck", True)]
    assert out[0]["pages"] == ["LCK/2027 Season/Rounds 1-2"]


def test_group_merges_the_pages_of_an_international_event():
    out = seasons.group_tournaments([
        row("2027 Season World Championship/Main Event", "World Championship", "2027-10-20", "2027-11-08"),
        row("2027 Season World Championship/Play-In", "World Championship", "2027-10-10", "2027-10-15"),
    ])
    [worlds] = out
    assert worlds["id"] == "worlds-2027" and worlds["league"] == "worlds" and worlds["name"] == "Worlds 2027"
    assert worlds["pages"] == ["2027 Season World Championship/Main Event", "2027 Season World Championship/Play-In"]
    assert (worlds["start"], worlds["end"]) == ("2027-10-10", "2027-11-08")


def test_group_drops_untracked_secondary_and_qualifiers():
    out = seasons.group_tournaments([
        row("LCK CL/2027", "LoL Champions Korea", level="Secondary"),
        row("LEC/2027 Qualifier", "LoL EMEA Championship", qualifier="1"),
        row("VCS/2027", "Vietnam Championship Series"),
    ])
    assert out == []


def test_group_keeps_only_the_worlds_qualifiers_of_the_event_itself():
    out = seasons.group_tournaments([
        # El Play-In figura como clasificatorio, pero es parte de Worlds
        row("2026 Season World Championship/Play-In", "World Championship", "2026-10-15", "2026-10-18",
            qualifier="1", year="2026"),
        # Final regional: League "World Championship", pero no es el evento
        row("LPL/2026 Season/Regional Finals", "World Championship", "2026-09-17", "2026-09-19",
            qualifier="1", year="2026"),
        row("2027 Mid-Season Invitational/Qualifier", "Mid-Season Invitational", qualifier="1"),
    ])
    assert [(t["id"], t["pages"], t["start"]) for t in out] == [
        ("worlds-2026", ["2026 Season World Championship/Play-In"], "2026-10-15")]


def test_international_names_use_the_display_name():
    out = seasons.group_tournaments([row("2027 First Stand", "First Stand"),
                                     row("2027 Mid-Season Invitational", "Mid-Season Invitational", "2027-06-28")])
    assert [t["name"] for t in out] == ["First Stand 2027", "MSI 2027"]


def test_status_by_dates_with_two_days_of_margin():
    t = seasons.group_tournaments([row("LCK/2027 Season/Cup", "LoL Champions Korea", "2027-01-14", "2027-02-22")])[0]
    assert seasons.status(t, "2027-01-11") == "upcoming"
    assert seasons.status(t, "2027-01-12") == "active"
    assert seasons.status(t, "2027-02-24") == "active"
    assert seasons.status(t, "2027-02-25") == "finished"


def test_status_without_dates_is_upcoming():
    t = seasons.group_tournaments([row("LCK/2027 Season/Cup", "LoL Champions Korea", start="", end="")])[0]
    assert t["start"] is None and seasons.status(t, "2027-06-01") == "upcoming"


def test_worlds_2026_constant_and_raw_dir():
    assert seasons.WORLDS_2026["id"] == "worlds-2026"
    assert seasons.WORLDS_2026["pages"] == ["2026 Season World Championship/Main Event",
                                            "2026 Season World Championship/Play-In"]
    assert seasons.tournament_dir(Path("data/raw"), "worlds-2026") == Path("data/raw/worlds-2026")


def test_raw_file_lives_in_the_tournament_folder():
    assert seasons.raw_file(Path("data/raw"), "worlds-2026", "matches") == Path("data/raw/worlds-2026/matches.json")
    assert seasons.raw_file(Path("data/raw"), "worlds-2026", "lolesports") == Path(
        "data/raw/worlds-2026/lolesports_games.json")


def test_no_module_uses_the_old_flat_file_names():
    # Si un módulo sigue leyendo data/raw/worlds_2026_*.json, el cron volvería a crear los archivos viejos
    for module in ("pipeline/fetch.py", "pipeline/build.py", "pipeline/assets.py", "pipeline/history.py"):
        source = Path(module).read_text(encoding="utf-8")
        assert "worlds_2026_" not in source and "lolesports_2026_" not in source, module


def test_write_discovery_always_rewrites_fetched_at(tmp_path):
    path = tmp_path / "tournaments_2027.json"
    seasons.write_discovery(path, [{"a": "1"}], "2026-12-01T00:00:00Z")
    seasons.write_discovery(path, [{"a": "1"}], "2026-12-02T00:00:00Z")
    assert json.loads(path.read_text(encoding="utf-8")) == {"fetched_at": "2026-12-02T00:00:00Z", "rows": [{"a": "1"}]}


def test_write_discovery_keeps_the_previous_rows_when_a_run_comes_back_empty(tmp_path):
    path = tmp_path / "tournaments_2027.json"
    seasons.write_discovery(path, [{"a": "1"}], "2026-12-01T00:00:00Z")
    seasons.write_discovery(path, [], "2026-12-02T00:00:00Z")
    assert json.loads(path.read_text(encoding="utf-8")) == {"fetched_at": "2026-12-02T00:00:00Z", "rows": [{"a": "1"}]}
    # Sin archivo previo, 0 filas se guardan tal cual
    empty = tmp_path / "tournaments_2028.json"
    seasons.write_discovery(empty, [], "2026-12-02T00:00:00Z")
    assert json.loads(empty.read_text(encoding="utf-8"))["rows"] == []


def test_known_tournaments_adds_worlds_2026_and_discovered_years(tmp_path):
    seasons.write_discovery(seasons.discovery_file(tmp_path, 2027),
                            [row("LCK/2027 Season/Cup", "LoL Champions Korea")], "x")
    ids = [t["id"] for t in seasons.known_tournaments(tmp_path, "2026-12-01")]
    assert ids == ["worlds-2026", "lck-2027-cup"]


def test_known_tournaments_without_discovery_is_just_worlds_2026(tmp_path):
    assert [t["id"] for t in seasons.known_tournaments(tmp_path, "2026-10-22")] == ["worlds-2026"]


def write_matches(raw_dir, tid, rows):
    path = seasons.raw_file(raw_dir, tid, "matches")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"fetched_at": "x", "rows": rows}), encoding="utf-8")


def test_has_dated_match_ignores_matches_to_be_confirmed(tmp_path):
    write_matches(tmp_path, "lck-2027-cup", [{"DateTimeUTC": ""}, {"DateTimeUTC": None}])
    assert seasons.has_dated_match(tmp_path, "lck-2027-cup") is False
    write_matches(tmp_path, "lck-2027-cup", [{"DateTimeUTC": "2027-01-14 08:00:00"}])
    assert seasons.has_dated_match(tmp_path, "lck-2027-cup") is True
    assert seasons.has_dated_match(tmp_path, "missing") is False


def test_site_mode_switches_with_the_first_dated_match_outside_worlds_2026(tmp_path):
    write_matches(tmp_path, "worlds-2026", [{"DateTimeUTC": "2026-10-22 08:00:00"}])
    write_matches(tmp_path, "lck-2027-cup", [{"DateTimeUTC": ""}])  # anunciado, sin fecha
    assert seasons.site_mode(tmp_path) == "worlds-2026"
    write_matches(tmp_path, "lck-2027-cup", [{"DateTimeUTC": "2027-01-14 08:00:00"}])
    assert seasons.site_mode(tmp_path) == "season"


def test_site_mode_stays_season_after_the_discovered_years_move_on(tmp_path):
    # En 2028 ya no se lee tournaments_2027.json, pero la carpeta del torneo de 2027 sigue en data/raw/
    write_matches(tmp_path, "lck-2027-cup", [{"DateTimeUTC": "2027-01-14 08:00:00"}])
    assert seasons.index_payload(tmp_path, "2028-01-01", "2028-01-01T00:00:00Z")["mode"] == "season"


def test_index_payload_in_worlds_mode(tmp_path):
    index = seasons.index_payload(tmp_path, "2026-10-22", "2026-10-22T12:00:00Z")
    assert index["mode"] == "worlds-2026" and index["default"] == "worlds-2026"
    assert [t["id"] for t in index["tournaments"]] == ["worlds-2026"]
    assert index["tournaments"][0]["status"] == "active"
    assert {lg["id"] for lg in index["leagues"]} == set(seasons.TRACKED)


NOW = datetime(2027, 1, 14, 12, 0, tzinfo=timezone.utc)


def test_in_match_window_edges():
    assert seasons.in_match_window([NOW - timedelta(hours=6)], NOW) is True
    assert seasons.in_match_window([NOW - timedelta(hours=6, minutes=1)], NOW) is False
    assert seasons.in_match_window([NOW + timedelta(hours=24)], NOW) is True
    assert seasons.in_match_window([NOW + timedelta(hours=24, minutes=1)], NOW) is False
    assert seasons.in_match_window([], NOW) is False


def test_match_times_skips_unconfirmed_times_and_finished_tournaments(tmp_path):
    write_matches(tmp_path, "worlds-2026", [
        {"DateTimeUTC": "2026-10-22 08:00:00", "HasTime": "1"},
        {"DateTimeUTC": "2026-10-23 00:00:00", "HasTime": "0"},  # a confirmar: no cuenta
        {"DateTimeUTC": "", "HasTime": ""},
    ])
    assert seasons.match_times(tmp_path, "2026-10-22") == [datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)]
    assert seasons.match_times(tmp_path, "2026-12-01") == []  # Worlds 2026 ya terminó
