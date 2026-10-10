import pytest

from models.elo import Params, run_elo, series_probability, team_regions, win_probability


def game(blue, red, winner="blue", region="KR", match_id="m", date="2026-01-01 10:00:00"):
    return {"date": date, "match_id": match_id, "game": 1, "page": "p", "region": region,
            "blue": blue, "red": red, "winner": winner}


def test_equal_ratings_give_even_odds():
    assert win_probability(1500, 1500) == 0.5


def test_100_points_is_about_64_percent():
    assert win_probability(1600, 1500) == pytest.approx(0.640, abs=0.001)


def test_probabilities_are_complementary():
    assert win_probability(1620, 1480) + win_probability(1480, 1620) == pytest.approx(1.0)


def test_bo1_series_equals_game_probability():
    assert series_probability(0.57, 1) == pytest.approx(0.57)


def test_bo3_and_bo5_amplify_the_favorite():
    assert series_probability(0.57, 3) == pytest.approx(0.6043, abs=1e-4)
    assert series_probability(0.57, 5) == pytest.approx(0.6295, abs=1e-4)


def test_even_game_gives_even_series():
    for best_of in (1, 3, 5):
        assert series_probability(0.5, best_of) == pytest.approx(0.5)


def test_series_probability_rejects_even_formats():
    with pytest.raises(ValueError):
        series_probability(0.6, 2)


def test_winner_gains_what_loser_loses():
    run = run_elo([game("A", "B")], Params(k=20), {})
    assert run.ratings["A"] == pytest.approx(1510)
    assert run.ratings["B"] == pytest.approx(1490)


def test_upset_moves_ratings_more_than_expected_win():
    regions = {"A": "KR", "B": "NA"}
    params = Params(k=20, region_offsets={"KR": 100})
    expected = run_elo([game("A", "B", winner="blue")], params, regions)
    upset = run_elo([game("A", "B", winner="red")], params, regions)
    gain_when_expected = expected.ratings["A"] - 1600
    loss_when_upset = 1600 - upset.ratings["A"]
    assert loss_when_upset > gain_when_expected > 0


def test_region_offset_sets_initial_rating():
    run = run_elo([game("A", "B")], Params(k=0, region_offsets={"KR": 80}), {"A": "KR", "B": "NA"})
    assert run.ratings == {"A": 1580, "B": 1500}


def test_records_keep_the_probability_from_before_the_game():
    run = run_elo([game("A", "B"), game("A", "B")], Params(k=20), {})
    assert run.records[0]["p_blue"] == 0.5
    assert run.records[1]["p_blue"] > 0.5
    assert run.games_played == {"A": 2, "B": 2}


def test_team_region_is_the_league_where_it_played_most():
    games = [game("A", "B", region="KR"), game("A", "C", region="KR"),
             game("A", "D", region=None), game("A", "E", region="NA")]
    regions = team_regions(games)
    assert regions["A"] == "KR"
    assert regions["E"] == "NA"
    assert "D" not in regions  # solo jugó un torneo internacional


def test_records_keep_the_ratings_after_the_game():
    run = run_elo([game("A", "B")], Params(k=20), {})
    assert run.records[0]["rating_blue"] == pytest.approx(1510)
    assert run.records[0]["rating_red"] == pytest.approx(1490)
