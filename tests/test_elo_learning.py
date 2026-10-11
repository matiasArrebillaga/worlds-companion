import pytest

from models.elo import Params, run_elo, win_probability
from models.elo_learning import LearningParams, run_chain, run_season


def game(blue, red, winner="blue", region="KR"):
    return {"blue": blue, "red": red, "winner": winner, "region": region, "match_id": f"{blue}-{red}"}


REGIONS = {"A": "KR", "B": "KR", "C": "EU", "D": "EU"}
OFFSETS = {"KR": 300.0, "EU": 100.0}


def test_without_carry_and_pool_matches_the_current_elo():
    games = [game("A", "B"), game("A", "C", "red", None), game("D", "B"), game("C", "A", "blue", None)]
    old = run_elo(games, Params(k=20.0, region_offsets=OFFSETS), REGIONS)
    new = run_season(games, LearningParams(k=20.0, region_offsets=OFFSETS), REGIONS)
    assert [r["p_blue"] for r in new.records] == pytest.approx([r["p_blue"] for r in old.records])
    assert new.ratings == pytest.approx(old.ratings)


def test_carry_keeps_part_of_last_season():
    params = LearningParams(k=20.0, region_offsets=OFFSETS, carry=0.5)
    first, second = run_chain([([game("A", "B")], REGIONS), ([game("A", "B")], REGIONS)], params)
    # A le ganó a B con 50%: terminó +10 sobre el inicio de la región; arrastra la mitad
    assert first.final_deviation["A"] == pytest.approx(10.0)
    # Segundo año: A arranca en 1800 + 5 y B en 1800 − 5
    assert second.records[0]["p_blue"] == pytest.approx(win_probability(1805.0, 1795.0))


def test_new_team_starts_at_its_region_value():
    params = LearningParams(k=20.0, region_offsets=OFFSETS, carry=1.0)
    run = run_season([game("A", "B")], params, REGIONS, prior={"Z": 100.0})
    assert run.records[0]["p_blue"] == pytest.approx(0.5)


def test_pool_moves_the_whole_region_only_in_cross_region_games():
    params = LearningParams(k=20.0, region_offsets={}, pool=0.5)
    # Game dentro de KR: no mueve la región, da lo mismo que sin pool
    games = [game("A", "B"), game("B", "D", region=None)]
    without = run_season(games, LearningParams(k=20.0), REGIONS)
    assert run_season(games, params, REGIONS).records[1]["p_blue"] == pytest.approx(without.records[1]["p_blue"])
    # C (EU) le gana a A (KR): toda EU sube y toda KR baja, aunque B y D no hayan jugado
    run = run_season([game("C", "A", region=None), game("B", "D", region=None)], params, REGIONS)
    assert run.records[1]["p_blue"] < 0.5
