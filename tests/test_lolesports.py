from datetime import datetime, timezone

from pipeline import lolesports
from pipeline.games import build_games

MATCH = "2026 Season World Championship/Play-In_Round 1_1"


def side(prefix: str, first_id: int, kills: int) -> tuple[dict, dict]:
    meta = {"participantMetadata": [{"participantId": first_id, "summonerName": f"{prefix} Blaber",
                                     "championId": "LeeSin", "role": "jungle"}]}
    frame = {"totalGold": 50000, "totalKills": kills, "towers": 3, "barons": 1, "dragons": ["cloud", "ocean"],
             "inhibitors": 0, "participants": [{"participantId": first_id, "kills": kills, "deaths": 1, "assists": 2,
                                                "creepScore": 200, "totalGold": 9000}]}
    return meta, frame


def live_game(state: str = "finished") -> dict:
    blue_meta, blue = side("KC", 1, 4)
    red_meta, red = side("C9", 6, 20)
    return {"game_id": "x", "number": 1, "start_time": "2026-10-15T18:00:00Z", "teams": {"blue": "KC", "red": "C9"},
            "patch": "16.20.826.3891", "first_frame_time": "2026-10-15T18:16:00.000Z",
            "metadata": {"blueTeamMetadata": blue_meta, "redTeamMetadata": red_meta},
            "last_frame": {"rfc460Timestamp": "2026-10-15T18:51:06.000Z", "gameState": state,
                           "blueTeam": blue, "redTeam": red}}


MATCHES = [{"MatchId": MATCH, "Team1": "Cloud9", "Team2": "Karmine Corp", "DateTimeUTC": "2026-10-15 18:00:00"},
           {"MatchId": "other", "Team1": "Cloud9", "Team2": "Karmine Corp", "DateTimeUTC": "2026-10-20 18:00:00"}]
TEAMS = [{"Name": "Cloud9", "Short": "C9"}, {"Name": "Karmine Corp", "Short": "KC"}]
WINNERS = [{"GameId": f"{MATCH}_1", "Winner": "2"}]


def test_lolesports_game_becomes_a_leaguepedia_shaped_game():
    games, players = lolesports.to_leaguepedia_rows([live_game()], MATCHES, WINNERS, TEAMS, {"LeeSin": "Lee Sin"})
    g = build_games(games, players)[MATCH][0]
    assert (g["n"], g["winner"], g["length"], g["patch"]) == (1, "red", "35:06", "16.20")
    assert g["blue"]["team"] == "Karmine Corp" and g["red"]["team"] == "Cloud9"
    assert g["blue"]["picks"] == ["Lee Sin"] and g["blue"]["dragons"] == 2 and g["red"]["kills"] == 20
    p = g["red"]["players"][0]
    assert (p["name"], p["role"], p["champion"], p["kills"], p["damage"]) == ("Blaber", 2, "Lee Sin", 20, None)


def test_game_in_progress_has_no_winner_yet():
    games, _ = lolesports.to_leaguepedia_rows([live_game("in_game")], MATCHES, WINNERS, TEAMS, {})
    assert games[0]["Winner"] == ""


def test_window_time_is_past_and_multiple_of_ten_seconds():
    now = datetime(2026, 10, 15, 19, 0, 37, tzinfo=timezone.utc)
    assert lolesports._window_time(now, "2026-10-15T18:16:00.000Z") == "2026-10-15T18:59:30.000Z"
    # Una partida vieja se pide como mucho 3 horas después del primer cuadro
    assert lolesports._window_time(now, "2026-10-10T18:16:04.000Z") == "2026-10-10T21:16:00.000Z"
