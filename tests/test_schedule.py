from pipeline.schedule import MATCH_KEYS, build_schedule, parse_start, phase_of, status_of

SHORTS = {"T1": "T1", "G2 Esports": "G2", "Gen.G": "GEN"}


def row(**overrides):
    base = {
        "MatchId": "WC2026_R1_1",
        "OverviewPage": "2026 Season World Championship/Main Event",
        "Tab": "Round 1",
        "Round": "1",
        "Phase": "",
        "BestOf": "1",
        "Team1": "T1",
        "Team2": "G2 Esports",
        "Team1Score": "",
        "Team2Score": "",
        "Winner": "",
        "DateTimeUTC": "2026-10-23 17:00:00",
        "HasTime": "1",
        "IsNullified": "",
    }
    return {**base, **overrides}


def test_parse_start_with_time():
    assert parse_start(row()) == ("2026-10-23T17:00:00Z", "2026-10-23")


def test_parse_start_without_confirmed_time_keeps_only_date():
    assert parse_start(row(HasTime="0")) == (None, "2026-10-23")


def test_parse_start_without_date():
    assert parse_start(row(DateTimeUTC="")) == (None, None)


def test_phase_of():
    assert phase_of(row(OverviewPage="2026 Season World Championship/Play-In")) == "play-in"
    assert phase_of(row()) == "swiss"
    assert phase_of(row(Tab="Quarterfinals")) == "knockout"
    assert phase_of(row(Tab="Semifinals")) == "knockout"
    assert phase_of(row(Tab="Finals")) == "knockout"


def test_status_of():
    assert status_of(row()) == "upcoming"
    assert status_of(row(BestOf="3", Team1Score="1", Team2Score="1")) == "live"
    assert status_of(row(Team1Score="1", Team2Score="0", Winner="1")) == "finished"


def test_finished_match_shape():
    [match] = build_schedule([row(Team1Score="1", Team2Score="0", Winner="1")], SHORTS)
    assert set(match) == MATCH_KEYS
    assert match == {
        "id": "WC2026_R1_1",
        "phase": "swiss",
        "round": "Round 1",
        "best_of": 1,
        "start_utc": "2026-10-23T17:00:00Z",
        "date": "2026-10-23",
        "team1": {"name": "T1", "short": "T1"},
        "team2": {"name": "G2 Esports", "short": "G2"},
        "score": [1, 0],
        "winner": "team1",
        "status": "finished",
    }


def test_upcoming_match_has_no_score():
    [match] = build_schedule([row()], SHORTS)
    assert match["score"] is None
    assert match["winner"] is None


def test_tbd_team_becomes_none():
    [match] = build_schedule([row(Tab="Finals", Team2="TBD")], SHORTS)
    assert match["team2"] is None


def test_unknown_short_falls_back_to_name():
    [match] = build_schedule([row(Team2="New Team")], SHORTS)
    assert match["team2"] == {"name": "New Team", "short": "New Team"}


def test_nullified_matches_are_dropped():
    assert build_schedule([row(IsNullified="1")], SHORTS) == []


def test_sorted_by_time_with_unconfirmed_last_within_day():
    rows = [
        row(MatchId="b", DateTimeUTC="2026-10-23 20:00:00"),
        row(MatchId="c", DateTimeUTC="2026-10-23 00:00:00", HasTime="0"),
        row(MatchId="a", DateTimeUTC="2026-10-23 17:00:00"),
    ]
    assert [m["id"] for m in build_schedule(rows, SHORTS)] == ["a", "b", "c"]
