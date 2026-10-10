import pytest

from models.calibration import fit_temperature, scale_probability


def test_temperature_one_changes_nothing():
    assert scale_probability(0.8, 1.0) == pytest.approx(0.8)


def test_temperature_below_one_moves_toward_even():
    assert 0.5 < scale_probability(0.8, 0.5) < 0.8
    assert 0.2 < scale_probability(0.2, 0.5) < 0.5


def test_fit_temperature_shrinks_an_overconfident_model():
    # El modelo dice 90% pero el favorito gana solo el 70%: hay que acercar al 50%
    probs = [0.9] * 10
    outcomes = [1.0] * 7 + [0.0] * 3
    assert fit_temperature(probs, outcomes) < 1.0
