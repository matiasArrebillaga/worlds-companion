import json

import pytest

from models.oracles import write_extract
from pipeline.build import build
from pipeline.schedule import MATCH_KEYS

NOW = "2026-10-15T11:00:00Z"


def write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


ROW = {
    "MatchId": "m1", "OverviewPage": "2026 Season World Championship/Play-In", "Tab": "Round 1",
    "Round": "1", "Phase": "", "BestOf": "3", "Team1": "T1", "Team2": "G2 Esports",
    "Team1Score": "", "Team2Score": "", "Winner": "", "DateTimeUTC": "2026-10-15 18:00:00",
    "HasTime": "1", "IsNullified": "",
}


def write_raw(raw, rows=(ROW,), history_teams=("T1", "G2 Esports"), rosters=(), without_lineup=()):
    stamp = "2026-10-15T10:00:00Z"
    write(raw / "worlds_2026_matches.json", {"fetched_at": stamp, "rows": list(rows)})
    write(raw / "worlds_2026_rosters.json", {"fetched_at": stamp, "rows": [{"Team": t, "OverviewPage": "x"} for t in rosters]})
    write(raw / "history_2026_tournaments.json", {"fetched_at": stamp, "rows": [
        {"OverviewPage": "LCK/2026 Season/Cup", "League": "LoL Champions Korea", "Region": "Korea",
         "TournamentLevel": "Primary", "IsQualifier": "0", "Year": "2026"}]})
    games = [{"GameId": f"g{i}", "MatchId": f"h{i}", "OverviewPage": "LCK/2026 Season/Cup",
              "Team1": history_teams[0], "Team2": history_teams[1], "Winner": "1" if i % 3 else "2",
              "DateTimeUTC": f"2026-02-{i + 1:02d} 08:00:00", "GameInMatch": "1"} for i in range(12)]
    write(raw / "history_2026_games.json", {"fetched_at": stamp, "rows": games})
    write_oracles(raw, [t for t in history_teams if t not in without_lineup])


def write_oracles(raw, teams):
    """Extracto de Oracle's Elixir: un game entre cada par de equipos, para que todos tengan alineación."""
    from tests.test_features import game_rows
    rows = []
    for i in range(0, len(teams) - 1, 2):
        rows += game_rows(f"oe{i}", teams[i], teams[i + 1], 1, "2026-02-01 08:00:00")
    write_extract(raw / "oracles_2026.json", rows, "2026-10-15T09:00:00Z")


def run(tmp_path, freeze=False):
    build(tmp_path / "raw", tmp_path / "out", NOW, predictions_file=tmp_path / "predictions.jsonl",
          aliases_file=tmp_path / "teams.csv", freeze_predictions=freeze)
    read = lambda name: json.loads((tmp_path / "out" / name).read_text(encoding="utf-8"))
    return read("schedule.json"), read("meta.json"), read("elo.json")


def test_build_writes_contract_files(tmp_path):
    write_raw(tmp_path / "raw")
    write(tmp_path / "raw" / "worlds_2026_teams.json", {"fetched_at": "x", "rows": [{"Name": "G2 Esports", "Short": "G2"}]})
    schedule, meta, elo = run(tmp_path)
    [m] = schedule["matches"]
    assert set(m) == MATCH_KEYS
    assert m["team2"]["short"] == "G2"
    assert m["prediction"]["frozen"] is False and 0 < m["prediction"]["p_team1_series"] < 1
    assert {k: meta[k] for k in ("updated_at", "source_fetched_at", "match_count")} == {
        "updated_at": NOW, "source_fetched_at": "2026-10-15T10:00:00Z", "match_count": 1}
    assert set(meta) == {"updated_at", "source_fetched_at", "match_count", "worlds_patch", "guide_patch",
                         "worlds_games", "samples"}
    assert meta["worlds_games"] == 0 and meta["guide_patch"] == "16.17–16.18"
    assert set(meta["samples"]["worlds"]) == {"games", "sides", "pace", "regions"}
    champions = json.loads((tmp_path / "out" / "champions.json").read_text(encoding="utf-8"))
    assert set(champions) == {"updated_at", "worlds_patch", "guide_patch", "samples", "prior_picks", "analysis", "icons"}
    assert champions["icons"] is None  # sin caché de Data Dragon en el raw de prueba
    assert set(champions["samples"]) == {"worlds", "guide"}
    assert set(elo) == {"model_version", "updated_at", "params", "backtest", "role_form", "teams", "accuracy"}
    ratings = [t["rating"] for t in elo["teams"]]
    assert {t["name"] for t in elo["teams"]} == {"T1", "G2 Esports"}
    assert ratings == sorted(ratings, reverse=True)
    assert elo["teams"][0]["region"] == "KR" and elo["accuracy"]["n"] == 0


def test_build_without_freeze_does_not_write_predictions(tmp_path):
    write_raw(tmp_path / "raw")
    run(tmp_path)
    assert not (tmp_path / "predictions.jsonl").exists()


def test_build_with_freeze_is_idempotent(tmp_path):
    write_raw(tmp_path / "raw")
    schedule, _, _ = run(tmp_path, freeze=True)
    run(tmp_path, freeze=True)
    assert schedule["matches"][0]["prediction"]["frozen"] is True
    assert len((tmp_path / "predictions.jsonl").read_text(encoding="utf-8").splitlines()) == 1


def test_build_lists_participants_before_pairings_are_known(tmp_path):
    tbd = {**ROW, "Team1": "TBD", "Team2": "TBD"}
    write_raw(tmp_path / "raw", rows=[tbd], rosters=["T1", "G2 Esports", "TBD"])
    schedule, _, elo = run(tmp_path)
    assert schedule["matches"][0]["prediction"] is None
    assert {t["name"] for t in elo["teams"]} == {"T1", "G2 Esports"}


def test_build_fails_when_a_worlds_team_has_no_history(tmp_path):
    write_raw(tmp_path / "raw", history_teams=("T1", "Gen.G"))
    with pytest.raises(ValueError, match="G2 Esports: only 0 games"):
        run(tmp_path)
    assert not (tmp_path / "out" / "schedule.json").exists()


def test_build_refuses_invalid_data_and_writes_nothing(tmp_path):
    write_raw(tmp_path / "raw", rows=[])
    with pytest.raises(ValueError, match="schedule is empty"):
        run(tmp_path)
    assert not (tmp_path / "out" / "schedule.json").exists()


def test_build_does_not_freeze_matches_that_are_days_away(tmp_path):
    far = {**ROW, "DateTimeUTC": "2026-10-18 18:00:00"}
    write_raw(tmp_path / "raw", rows=[far])
    schedule, _, _ = run(tmp_path, freeze=True)
    assert schedule["matches"][0]["prediction"]["frozen"] is False  # se muestra, pero todavía no se congela
    assert not (tmp_path / "predictions.jsonl").exists()


def test_build_uses_the_player_form_model(tmp_path):
    write_raw(tmp_path / "raw")
    _, _, elo = run(tmp_path)
    assert elo["model_version"] == "elo-2"
    assert set(elo["params"]["role_weights"]) == {"top", "jng", "mid", "bot", "sup"}
    assert elo["role_form"]["fetched_at"] == "2026-10-15T09:00:00Z"


def test_build_fails_when_a_team_has_no_lineup(tmp_path):
    write_raw(tmp_path / "raw", without_lineup=("G2 Esports",))
    with pytest.raises(ValueError, match="G2 Esports"):
        run(tmp_path)


def test_build_writes_team_and_player_stats(tmp_path):
    write_raw(tmp_path / "raw")
    run(tmp_path)
    read = lambda name: json.loads((tmp_path / "out" / name).read_text(encoding="utf-8"))
    teams, players = read("teams.json"), read("players.json")
    assert set(teams) == {"updated_at", "stats_fetched_at", "teams"}
    t1 = next(t for t in teams["teams"] if t["name"] == "T1")
    assert set(t1) == {"id", "name", "short", "region", "logo", "rating", "roster", "season", "worlds", "vs_worlds",
                      "elo_history", "series"}
    assert all("form" in p for p in players["players"])
    assert t1["id"] == "t1" and len(t1["elo_history"]) == 12 and t1["series"]
    assert len(t1["roster"]) == 5 and t1["worlds"] is None
    assert {p["team_id"] for p in players["players"]} == {"t1", "g2-esports"}
