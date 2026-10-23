from pathlib import Path

from pipeline import seasons


def row(page, league, start="2027-01-14", end="2027-02-22", playoffs="0", level="Primary", qualifier="0",
        year="2027", name=None):
    return {"Name": name or page, "OverviewPage": page, "League": league, "Year": year, "DateStart": start,
            "Date": end, "IsPlayoffs": playoffs, "TournamentLevel": level, "IsQualifier": qualifier}


def test_slug_lowercases_and_joins_with_dashes():
    assert seasons.slug("LCK/2027 Season/Rounds 1-2") == "lck-2027-season-rounds-1-2"
    assert seasons.slug("  LEC  Versus ") == "lec-versus"


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
        ("lck-2027-season-rounds-1-2", "lck", False), ("lck-2027-season-playoffs", "lck", True)]
    assert out[0]["pages"] == ["LCK/2027 Season/Rounds 1-2"]


def test_group_merges_the_pages_of_an_international_event():
    out = seasons.group_tournaments([
        row("2027 Season World Championship/Main Event", "World Championship", "2027-10-20", "2027-11-08"),
        row("2027 Season World Championship/Play-In", "World Championship", "2027-10-10", "2027-10-15"),
    ])
    [worlds] = out
    assert worlds["id"] == "worlds-2027" and worlds["league"] == "worlds"
    assert worlds["pages"] == ["2027 Season World Championship/Main Event", "2027 Season World Championship/Play-In"]
    assert (worlds["start"], worlds["end"]) == ("2027-10-10", "2027-11-08")


def test_group_drops_untracked_secondary_and_qualifiers():
    out = seasons.group_tournaments([
        row("LCK CL/2027", "LoL Champions Korea", level="Secondary"),
        row("LEC/2027 Qualifier", "LoL EMEA Championship", qualifier="1"),
        row("VCS/2027", "Vietnam Championship Series"),
    ])
    assert out == []


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
    assert seasons.WORLDS_2026["pages"] == ["2026 Season World Championship"]
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
