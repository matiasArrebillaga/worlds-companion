import pytest

from models.metrics import accuracy, brier_score, calibration, summarize


def test_brier_perfect_and_coin():
    assert brier_score([1.0, 0.0], [1.0, 0.0]) == 0
    assert brier_score([0.5, 0.5], [1.0, 0.0]) == 0.25


def test_brier_and_accuracy_of_nothing_is_none():
    assert brier_score([], []) is None
    assert accuracy([], []) is None


def test_accuracy_counts_the_favorite():
    assert accuracy([0.7, 0.3, 0.6], [1.0, 0.0, 0.0]) == pytest.approx(2 / 3)


def test_calibration_groups_by_favorite_probability():
    rows = {r["label"]: r for r in calibration([0.55, 0.35, 0.8, 0.9], [1.0, 1.0, 1.0, 0.0])}
    assert rows["50–60%"]["n"] == 1 and rows["50–60%"]["observed"] == 1.0
    # 0.35 para el equipo 1 = el equipo 2 es favorito con 65%; ganó el 1, así que el favorito perdió
    assert rows["60–70%"]["n"] == 1 and rows["60–70%"]["observed"] == 0.0
    assert rows["70%+"]["n"] == 2
    assert rows["70%+"]["predicted"] == pytest.approx(0.85)
    assert rows["70%+"]["observed"] == 0.5


def test_calibration_empty_bucket_has_no_averages():
    assert calibration([0.55], [1.0])[2] == {"label": "70%+", "n": 0, "predicted": None, "observed": None}


def test_summarize():
    s = summarize([0.7, 0.4], [1.0, 1.0])
    assert s["n"] == 2 and s["correct"] == 1 and s["accuracy"] == 0.5
    assert s["brier"] == pytest.approx((0.09 + 0.36) / 2)
    assert len(s["calibration"]) == 3


def test_log_loss_of_a_coin_is_log_two():
    from math import log

    from models.metrics import log_loss
    assert log_loss([0.5, 0.5], [1.0, 0.0]) == pytest.approx(log(2))


def test_bootstrap_with_identical_models_gives_zero_interval():
    from models.metrics import bootstrap_brier_diff
    probs = [0.6, 0.7, 0.4, 0.55]
    result = bootstrap_brier_diff(probs, probs, [1.0, 0.0, 0.0, 1.0], ["a", "a", "b", "c"], reps=200)
    assert result == {"diff": 0.0, "low": 0.0, "high": 0.0}


def test_bootstrap_detects_a_clearly_better_model():
    from models.metrics import bootstrap_brier_diff
    outcomes = [1.0, 0.0] * 50
    good = [0.9, 0.1] * 50
    coin = [0.5] * 100
    clusters = [str(i // 2) for i in range(100)]
    result = bootstrap_brier_diff(good, coin, outcomes, clusters, reps=200)
    # diff = Brier(a) − Brier(b): negativo = el primero es mejor
    assert result["high"] < 0
