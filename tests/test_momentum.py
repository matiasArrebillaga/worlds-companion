import pytest

from models.elo import series_probability
from models.momentum import momentum_features, series_probability_momentum


def rec(blue, red, blue_won, date, match_id="m", region="KR", page="LCK", p_blue=0.5):
    return {"blue": blue, "red": red, "blue_won": blue_won, "p_blue": p_blue, "date": date,
            "match_id": match_id, "region": region, "page": page}


def test_first_game_has_no_momentum():
    [row] = momentum_features([rec("A", "B", 1.0, "2025-01-01 10:00:00")])
    assert row == {"d_over": 0.0, "d_trend": 0.0, "d_tourney": 0.0, "x_prev": 0.0}


def test_surprises_count_only_after_the_game():
    games = [rec("A", "B", 1.0, "2025-01-01 10:00:00", "m1", p_blue=0.3),
             rec("A", "C", 1.0, "2025-01-02 10:00:00", "m2")]
    rows = momentum_features(games)
    assert rows[0]["d_over"] == 0.0
    # A ganó con 30%: +0.7 de sorpresa; C no jugó
    assert rows[1]["d_over"] == pytest.approx(0.7)
    assert rows[1]["d_trend"] == pytest.approx(0.7)


def test_trend_forgets_old_games():
    games = [rec("A", "B", 1.0, "2025-01-01 10:00:00", "m1"), rec("A", "C", 1.0, "2025-03-01 10:00:00", "m2")]
    assert momentum_features(games, days=21)[1]["d_trend"] == 0.0


def test_tournament_momentum_only_inside_international_events():
    games = [rec("A", "B", 1.0, "2025-01-01 10:00:00", "m1", region=None, page="MSI"),
             rec("A", "C", 1.0, "2025-01-02 10:00:00", "m2", region=None, page="MSI"),
             rec("A", "D", 1.0, "2025-01-03 10:00:00", "m3", region="KR", page="LCK")]
    rows = momentum_features(games)
    assert rows[1]["d_tourney"] == pytest.approx(0.5)
    assert rows[2]["d_tourney"] == 0.0


def test_previous_game_of_the_series_from_the_blue_side():
    games = [rec("A", "B", 1.0, "2025-01-01 10:00:00", "s1"), rec("B", "A", 1.0, "2025-01-01 11:00:00", "s1"),
             rec("A", "B", 0.0, "2025-01-01 12:00:00", "s1")]
    rows = momentum_features(games)
    assert [r["x_prev"] for r in rows] == [0.0, -1.0, -1.0]  # en el game 2 el azul (B) había perdido el 1


def test_swapping_sides_flips_every_feature():
    history = [rec("A", "B", 1.0, "2025-01-01 10:00:00", "s1", region=None, page="MSI", p_blue=0.4)]
    normal = momentum_features(history + [rec("A", "B", 1.0, "2025-01-01 11:00:00", "s1", region=None, page="MSI")])[1]
    swapped = momentum_features(history + [rec("B", "A", 0.0, "2025-01-01 11:00:00", "s1", region=None, page="MSI")])[1]
    for name, value in normal.items():
        assert swapped[name] == pytest.approx(-value)


def test_series_without_momentum_matches_independent_games():
    from math import log
    p = 0.6
    z = log(p / (1 - p))
    for best_of in (1, 3, 5):
        assert series_probability_momentum(z, 0.0, best_of) == pytest.approx(series_probability(p, best_of))


def test_positive_momentum_pulls_the_series_toward_a_single_game():
    # Con momentum, ganar la primera arrastra las siguientes: el Bo5 se parece más a un Bo1
    # y la ventaja que da jugar más partidas se achica
    from math import exp
    z = 0.4
    first_game = 1 / (1 + exp(-z))
    independent = series_probability_momentum(z, 0.0, 5)
    assert first_game < series_probability_momentum(z, 0.3, 5) < independent
