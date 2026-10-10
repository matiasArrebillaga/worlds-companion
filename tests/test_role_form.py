import pytest

from models.features import fit_norms, lineups, player_forms
from models.oracles import parse_rows, read_extract, write_extract
from models.role_form import adjustment, resolve_team
from tests.test_features import game_rows, records

MODEL = {"weights": {"top": 0.2, "jng": 0.1, "mid": 0.1, "bot": 0.2, "sup": 0.1},
         "scales": {"top": 0.2, "jng": 0.2, "mid": 0.2, "bot": 0.2, "sup": 0.2}}


def two_games():
    return (game_rows("g1", "A", "B", 1, "2025-01-01 10:00:00", blue_player={"golddiffat15": 900})
            + game_rows("g2", "B", "A", 0, "2025-01-02 10:00:00", red_player={"golddiffat15": 900}))


def test_extract_round_trip_keeps_the_games(tmp_path):
    rows = two_games()
    path = tmp_path / "oe.json"
    write_extract(path, rows, "2026-10-10T00:00:00Z")
    games, fetched_at = read_extract(path)
    assert fetched_at == "2026-10-10T00:00:00Z"
    assert [(g["blue"], g["red"], g["winner"]) for g in games] == [(g["blue"], g["red"], g["winner"]) for g in parse_rows(rows)]


def test_lineup_is_the_last_one_played():
    rows = two_games() + [{**r, "playername": "sub"} if r["gameid"] == "g2" and r["teamname"] == "A" and r["position"] == "mid"
                          else r for r in game_rows("g3", "A", "C", 1, "2025-01-03 10:00:00")]
    assert lineups(records(rows))["A"]["mid"] == "mid:A-mid"
    renamed = [{**r, "playername": "sub"} if r["gameid"] == "g3" and r["teamname"] == "A" and r["position"] == "mid" else r
               for r in rows]
    assert lineups(records(renamed))["A"]["mid"] == "mid:sub"


def test_player_forms_reward_winning_lanes():
    rows = two_games()
    forms = player_forms(records(rows), fit_norms(parse_rows(rows)))
    assert forms["top:A-top"] > 0 > forms["top:B-top"]


def test_adjustment_is_zero_for_equal_forms_and_antisymmetric():
    ups = {"A": {r: f"{r}:A" for r in MODEL["weights"]}, "B": {r: f"{r}:B" for r in MODEL["weights"]}}
    forms = {**{f"{r}:A": 0.3 for r in MODEL["weights"]}, **{f"{r}:B": 0.1 for r in MODEL["weights"]}}
    assert adjustment("A", "A", ups, forms, MODEL) == 0
    assert adjustment("A", "B", ups, forms, MODEL) > 0
    assert adjustment("B", "A", ups, forms, MODEL) == pytest.approx(-adjustment("A", "B", ups, forms, MODEL))


def test_resolve_team_drops_leaguepedia_disambiguation():
    ups = {"LYON": {}, "T1": {}}
    assert resolve_team("LYON (2024 American Team)", ups) == "LYON"
    assert resolve_team("T1", ups) == "T1"
    assert resolve_team("Nobody", ups) is None
