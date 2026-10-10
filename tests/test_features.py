import pytest

from models.features import build_dataset, fit_norms
from models.oracles import ROLES, parse_rows


def team_row(gameid, side, team, result, **stats):
    base = {"gameid": gameid, "league": "LCK", "date": "2025-01-01 10:00:00", "game": "1", "side": side,
            "position": "team", "teamname": team, "playername": "", "result": str(result),
            "killsat15": "3", "firstblood": "1", "gamelength": "1800", "firstdragon": "1",
            "firsttower": "1", "firstherald": "1"}
    return {**base, **{k: str(v) for k, v in stats.items()}}


def player_row(gameid, side, team, role, name, result, **stats):
    base = {"gameid": gameid, "league": "LCK", "date": "2025-01-01 10:00:00", "game": "1", "side": side,
            "position": role, "teamname": team, "playername": name, "result": str(result),
            "golddiffat15": "0", "xpdiffat15": "0", "csdiffat15": "0", "kills": "2", "deaths": "2",
            "assists": "4", "teamkills": "10", "damageshare": "0.2", "earnedgoldshare": "0.2"}
    return {**base, **{k: str(v) for k, v in stats.items()}}


def game_rows(gameid, blue, red, blue_won, date, blue_stats=None, red_stats=None, blue_player=None, red_player=None):
    """Una partida completa: 2 filas de equipo + 10 de jugadores (nombres 'equipo-rol')."""
    rows = []
    for side, team, won, stats, pstats in (("Blue", blue, blue_won, blue_stats, blue_player),
                                          ("Red", red, 1 - blue_won, red_stats, red_player)):
        rows.append(team_row(gameid, side, team, won, date=date, **(stats or {})))
        for role in ROLES:
            rows.append(player_row(gameid, side, team, role, f"{team}-{role}", won, date=date, **(pstats or {})))
    return rows


def records(rows):
    """Como los de run_elo: cada game con p_blue y blue_won (acá p_blue fijo, no importa para las variables)."""
    return [{**g, "p_blue": 0.5, "blue_won": 1.0 if g["winner"] == "blue" else 0.0} for g in parse_rows(rows)]


def sample_rows():
    return (game_rows("g1", "A", "B", 1, "2025-01-01 10:00:00", blue_stats={"killsat15": 8, "gamelength": 1500},
                      blue_player={"golddiffat15": 900})
            + game_rows("g2", "C", "B", 0, "2025-01-02 10:00:00")
            + game_rows("g3", "A", "B", 1, "2025-01-03 10:00:00"))


def test_parse_rows_builds_games_with_both_sides():
    [g] = parse_rows(game_rows("g1", "A", "B", 0, "2025-01-01 10:00:00"))
    assert (g["blue"], g["red"], g["winner"], g["region"]) == ("A", "B", "red", "KR")
    assert set(g["players"]["blue"]) == set(ROLES)


def test_parse_rows_groups_games_of_the_same_series():
    rows = (game_rows("g1", "A", "B", 1, "2025-01-01 10:00:00")
            + [{**r, "game": "2"} for r in game_rows("g2", "B", "A", 1, "2025-01-01 11:00:00")]
            + game_rows("g3", "A", "B", 1, "2025-01-05 10:00:00"))
    ids = [g["match_id"] for g in parse_rows(rows)]
    assert ids[0] == ids[1] != ids[2]


def test_first_game_of_a_team_has_neutral_features():
    rows = sample_rows()
    first = build_dataset(records(rows), fit_norms(parse_rows(rows)))[0]
    assert all(first[name] == 0 for name in first if name.startswith(("d_", "x_")))


def test_features_only_use_previous_games():
    rows = sample_rows()
    norms = fit_norms(parse_rows(rows))
    original = build_dataset(records(rows), norms)
    # Cambiar todo lo que pasó en g3 no puede cambiar las variables de g3
    changed_rows = [{**r, "killsat15": "20", "golddiffat15": "-3000"} if r["gameid"] == "g3" else r for r in rows]
    changed = build_dataset(records(changed_rows), norms)
    assert original[2] == changed[2]
    assert original[2]["d_aggr"] > 0  # A fue más agresivo que B en g1
    assert original[2]["d_top"] > 0   # el top de A ganó la línea en g1


def test_swapping_sides_flips_every_feature():
    rows = sample_rows()
    norms = fit_norms(parse_rows(rows))
    swap = {"Blue": "Red", "Red": "Blue"}
    last_swapped = [{**r, "side": swap[r["side"]], "result": r["result"]} for r in rows if r["gameid"] == "g3"]
    normal = build_dataset(records(rows), norms)[2]
    swapped = build_dataset(records([r for r in rows if r["gameid"] != "g3"] + last_swapped), norms)[2]
    for name in normal:
        if name.startswith(("d_", "x_")):
            assert swapped[name] == pytest.approx(-normal[name]), name


def test_unknown_player_counts_as_average():
    rows = sample_rows()
    renamed = [{**r, "playername": "rookie"} if r["gameid"] == "g3" and r["teamname"] == "A" and r["position"] == "top"
               else r for r in rows]
    row = build_dataset(records(renamed), fit_norms(parse_rows(renamed)))[2]
    # El top de A es nuevo (0) y el de B tiene historial de dos derrotas de línea en promedio: d_top = −forma de B
    assert row["d_top"] == pytest.approx(-row["form_red_top"])
