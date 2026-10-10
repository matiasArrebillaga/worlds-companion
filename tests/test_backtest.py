import pytest

from models.backtest import cross_region_records, objective, tune, worlds_series
from models.elo import Params, team_regions


def make_season():
    """Dos equipos coreanos y dos norteamericanos parejos en su liga; en los cruces, KR siempre gana."""
    games, minute = [], 0

    def add(blue, red, winner, region):
        nonlocal minute
        minute += 1
        games.append({"date": f"2026-01-01 {minute // 60:02d}:{minute % 60:02d}:00", "match_id": f"m{minute}",
                      "game": 1, "page": "p", "region": region, "blue": blue, "red": red, "winner": winner})

    for _ in range(6):
        add("K1", "K2", "blue", "KR"); add("K2", "K1", "blue", "KR")
        add("N1", "N2", "blue", "NA"); add("N2", "N1", "blue", "NA")
    for _ in range(4):
        add("K1", "N1", "blue", None); add("N2", "K2", "red", None)
    return games, team_regions(games)


def test_cross_region_records_keeps_only_games_between_regions():
    games, regions = make_season()
    assert len(cross_region_records(games, regions)) == 8


def test_tune_learns_that_the_stronger_region_starts_higher():
    season = make_season()
    params, score = tune([season])
    assert params.region_offsets.get("KR", 0) > params.region_offsets.get("NA", 0)
    assert score < objective([season], Params(k=20.0))


def test_worlds_series_uses_first_game_probability_from_team1_view():
    records = [{"match_id": "m1", "blue": "B", "red": "A", "p_blue": 0.4},
               {"match_id": "m1", "blue": "A", "red": "B", "p_blue": 0.9}]
    rows = [{"MatchId": "m1", "Team1": "A", "Team2": "B", "Winner": "1", "BestOf": "1"},
            {"MatchId": "m2", "Team1": "A", "Team2": "B", "Winner": "", "BestOf": "3"}]
    probs, outcomes = worlds_series(records, rows)
    assert probs == [pytest.approx(0.6)]
    assert outcomes == [1.0]
