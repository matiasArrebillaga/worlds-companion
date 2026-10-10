import pytest

from models.oracles import parse_rows
from pipeline.stats import build_team_and_player_stats, player_stats, slug, team_stats
from tests.test_features import game_rows


def games(*specs):
    """specs: (gameid, blue, red, blue_won, date, page, extra) → games como los de read_extract."""
    rows = []
    for gameid, blue, red, blue_won, date, page, extra in specs:
        for r in game_rows(gameid, blue, red, blue_won, date, **extra):
            rows.append({**r, "league": page})
    return parse_rows(rows)


TEAM = {"gamelength": "1800", "totalgold": "60000", "firstblood": "1", "firstdragon": "0", "firsttower": "1"}


def test_slug_is_url_safe():
    assert slug("Gen.G") == "gen-g"
    assert slug("Anyone's Legend") == "anyone-s-legend"
    assert slug("Kiin") == "kiin"


def test_team_stats_aggregate_record_sides_and_rates():
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LCK", {"blue_stats": TEAM, "red_stats": TEAM}),
               ("g2", "B", "A", 1, "2026-01-02 10:00:00", "LCK", {"blue_stats": TEAM, "red_stats": {**TEAM, "gamelength": "2400"}}))
    s = team_stats(gs, "A")
    assert (s["games"], s["wins"], s["winrate"]) == (2, 1, 0.5)
    assert s["blue"] == {"games": 1, "wins": 1} and s["red"] == {"games": 1, "wins": 0}
    assert s["avg_minutes"] == 35.0          # (30 + 40) / 2
    assert s["first_blood"] == 1.0 and s["first_dragon"] == 0.0
    assert s["gold_per_min"] == pytest.approx(1714, abs=1)   # 120000 de oro / 70 minutos


def test_team_stats_missing_data_is_null():
    empty = {k: "" for k in TEAM}
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LPL", {"blue_stats": empty, "red_stats": empty}))
    s = team_stats(gs, "A")
    assert s["games"] == 1
    assert s["first_dragon"] is None and s["avg_minutes"] is None and s["gold_per_min"] is None


def test_player_stats_use_totals_not_averages_of_ratios():
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LCK",
                {"blue_stats": TEAM, "blue_player": {"kills": "5", "deaths": "0", "assists": "10", "teamkills": "20",
                                                     "total cs": "300", "damagetochampions": "30000", "champion": "Ahri"}}),
               ("g2", "A", "B", 0, "2026-01-02 10:00:00", "LCK",
                {"blue_stats": TEAM, "blue_player": {"kills": "1", "deaths": "4", "assists": "1", "teamkills": "5",
                                                     "total cs": "240", "damagetochampions": "15000", "champion": "Azir"}}))
    entries = [(g, "blue", g["players"]["blue"]["mid"]) for g in gs]
    s = player_stats(entries)
    assert s["kda"] == 4.25                  # (6 + 11) / 4, no el promedio de 15 y 0.5
    assert s["cs_min"] == 9.0                # 540 CS / 60 minutos
    assert s["dpm"] == 750                   # 45000 / 60
    assert s["kp"] == 0.68                   # 17 / 25
    assert s["champions"] == [{"name": "Ahri", "games": 1, "wins": 1}, {"name": "Azir", "games": 1, "wins": 0}]


def test_player_stats_without_deaths_has_finite_kda():
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LCK",
                {"blue_stats": TEAM, "blue_player": {"kills": "3", "deaths": "0", "assists": "4"}}))
    assert player_stats([(gs[0], "blue", gs[0]["players"]["blue"]["top"])])["kda"] == 7.0


def test_team_without_worlds_games_has_null_worlds():
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LCK", {"blue_stats": TEAM, "red_stats": TEAM}))
    teams, players = build_team_and_player_stats(gs, {"Team A": "A"}, {"Team A": "TA"})
    assert teams["Team A"]["worlds"] is None
    assert teams["Team A"]["season"]["games"] == 1
    assert all(p["worlds"] is None for p in players)


def test_roster_is_the_last_lineup_in_role_order():
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LCK", {}),
               ("g2", "A", "B", 1, "2026-01-02 10:00:00", "WLDs", {}))
    teams, players = build_team_and_player_stats(gs, {"Team A": "A"}, {"Team A": "TA"})
    assert teams["Team A"]["id"] == "team-a"
    assert teams["Team A"]["roster"] == ["a-top", "a-jng", "a-mid", "a-bot", "a-sup"]
    top = next(p for p in players if p["id"] == "a-top")
    assert (top["team_id"], top["role"], top["starter"]) == ("team-a", "top", True)
    assert top["season"]["games"] == 2 and top["worlds"]["games"] == 1
    assert top["history"][0]["date"] == "2026-01-02" and top["history"][0]["worlds"] is True


def test_player_ids_are_unique_even_with_the_same_name():
    rows_a = games(("g1", "A", "C", 1, "2026-01-01 10:00:00", "LCK", {}))
    rows_b = games(("g2", "B", "C", 1, "2026-01-01 11:00:00", "LCK", {}))
    for g in rows_b:
        for role, row in g["players"]["blue"].items():
            row["playername"] = f"A-{role}"   # mismos nombres que los jugadores de A
    _, players = build_team_and_player_stats(rows_a + rows_b, {"Team A": "A", "Team B": "B"},
                                             {"Team A": "TA", "Team B": "TB"})
    ids = [p["id"] for p in players]
    assert len(ids) == len(set(ids)) == 10
