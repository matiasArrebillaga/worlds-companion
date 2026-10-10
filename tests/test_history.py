import json

from pipeline.history import load_aliases, load_season_games, normalize_games, page_regions, select_tournaments


def tournament(page, league, level="Primary", qualifier="0"):
    return {"OverviewPage": page, "League": league, "Region": "", "TournamentLevel": level,
            "IsQualifier": qualifier, "Year": "2026"}


def test_select_keeps_main_leagues_and_worlds_qualifiers():
    rows = [
        tournament("LCK/2026 Season/Cup", "LoL Champions Korea"),
        tournament("2026 Season World Championship/Play-In", "World Championship", qualifier="1"),
        tournament("LCP/2026 Season/Promotion", "League of Legends Championship Pacific", qualifier="1"),
        tournament("LPL/2026 Season/Grand Finals/Showmatch", "Tencent LoL Pro League", level="Showmatch"),
        tournament("2026 LoL KeSPA Cup", "KeSPA Cup"),
        tournament("PCS/2026 Season/Spring Season", "Pacific Championship Series", level="Secondary"),
    ]
    assert [t["OverviewPage"] for t in select_tournaments(rows)] == [
        "LCK/2026 Season/Cup", "2026 Season World Championship/Play-In"]


def test_page_regions_marks_international_as_none():
    regions = page_regions([tournament("LCK/2026 Season/Cup", "LoL Champions Korea"),
                            tournament("2026 First Stand", "First Stand")])
    assert regions == {"LCK/2026 Season/Cup": "KR", "2026 First Stand": None}


SG = {"GameId": "g1", "MatchId": "m1", "OverviewPage": "LCK/2026 Season/Cup", "Team1": "T1",
      "Team2": "Gen.G", "Winner": "2", "DateTimeUTC": "2026-01-14 08:00:00", "GameInMatch": "1"}


def test_normalize_uses_team1_as_blue_side():
    [g] = normalize_games([SG], {"LCK/2026 Season/Cup": "KR"})
    assert g == {"date": "2026-01-14 08:00:00", "match_id": "m1", "game": 1, "page": "LCK/2026 Season/Cup",
                 "region": "KR", "blue": "T1", "red": "Gen.G", "winner": "red"}


def test_normalize_skips_games_without_result_and_sorts_by_date():
    rows = [{**SG, "MatchId": "m2", "DateTimeUTC": "2026-01-15 08:00:00"}, SG, {**SG, "MatchId": "m3", "Winner": ""}]
    games = normalize_games(rows, {})
    assert [g["match_id"] for g in games] == ["m1", "m2"]
    assert games[0]["region"] is None  # página desconocida = internacional


def test_normalize_orders_games_inside_a_series():
    rows = [{**SG, "GameInMatch": "2"}, {**SG, "GameInMatch": "1"}]
    assert [g["game"] for g in normalize_games(rows, {})] == [1, 2]


def test_aliases_merge_team_names(tmp_path):
    path = tmp_path / "teams.csv"
    path.write_text("alias,canonical\nT1 Esports,T1\n", encoding="utf-8")
    [g] = normalize_games([{**SG, "Team1": "T1 Esports"}], {}, load_aliases(path))
    assert g["blue"] == "T1"


def test_missing_aliases_file_means_no_aliases(tmp_path):
    assert load_aliases(tmp_path / "missing.csv") == {}


def write_rows(path, rows):
    path.write_text(json.dumps({"fetched_at": "2026-10-10T00:00:00Z", "rows": rows}), encoding="utf-8")


def test_load_season_adds_worlds_games_for_the_current_year(tmp_path):
    write_rows(tmp_path / "history_2026_tournaments.json", [tournament("LCK/2026 Season/Cup", "LoL Champions Korea")])
    write_rows(tmp_path / "history_2026_games.json", [SG])
    worlds = {**SG, "MatchId": "w1", "OverviewPage": "2026 Season World Championship/Main Event",
              "DateTimeUTC": "2026-10-23 08:00:00"}
    write_rows(tmp_path / "worlds_2026_games.json", [worlds])
    games = load_season_games(tmp_path, 2026)
    assert [(g["match_id"], g["region"]) for g in games] == [("m1", "KR"), ("w1", None)]
