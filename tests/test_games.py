from pipeline.games import build_games, display_name
from pipeline.validate import validate_games

MATCH = "2026 Season World Championship/Main Event_Round 1_1"


def game(n: int, winner: str = "1", **extra) -> dict:
    return {"GameId": f"{MATCH}_{n}", "MatchId": MATCH, "GameInMatch": str(n), "Team1": "T1", "Team2": "G2 Esports",
            "Winner": winner, "Gamelength": "30:12", "Patch": "16.20", "Team1Picks": "Azir,Poppy",
            "Team1Bans": "Yone,,Sion", "Team1Kills": "11", "Team1Gold": "57981", "Team2Kills": "", **extra}


def player(n: int, side: str, role: str, name: str) -> dict:
    return {"GameId": f"{MATCH}_{n}", "Link": name, "Team": "T1", "Side": side, "RoleNumber": role,
            "Champion": "Azir", "Kills": "3", "Deaths": "0", "Assists": "5", "CS": "300", "Gold": "12000",
            "DamageToChampions": "20000"}


def test_build_games_groups_by_match_and_orders_games():
    out = build_games([game(2, winner="2"), game(1)], [])
    assert [g["n"] for g in out[MATCH]] == [1, 2]
    assert [g["winner"] for g in out[MATCH]] == ["blue", "red"]


def test_build_games_parses_draft_and_missing_numbers():
    g = build_games([game(1)], [])[MATCH][0]
    assert g["blue"]["team"] == "T1" and g["red"]["team"] == "G2 Esports"
    assert g["blue"]["picks"] == ["Azir", "Poppy"]
    assert g["blue"]["bans"] == ["Yone", "Sion"]  # el ban vacío (no baneó) no se cuenta
    assert g["blue"]["kills"] == 11
    # Un dato vacío o ausente es faltante, nunca 0
    assert g["red"]["kills"] is None and g["red"]["towers"] is None


def test_build_games_attaches_players_by_side_in_role_order():
    rows = [player(1, "1", "3", "Faker"), player(1, "1", "1", "Doran"), player(1, "2", "2", "Skewmond")]
    g = build_games([game(1)], rows)[MATCH][0]
    assert [p["name"] for p in g["blue"]["players"]] == ["Doran", "Faker"]
    assert [p["name"] for p in g["red"]["players"]] == ["Skewmond"]
    assert g["blue"]["players"][0]["kills"] == 3


def test_build_games_unfinished_game_has_no_winner():
    assert build_games([game(1, winner="")], [])[MATCH][0]["winner"] is None


def test_validate_games_flags_unknown_match_and_repeated_numbers():
    games = build_games([game(1), game(1)], [])
    errors = validate_games(games, set())
    assert any("unknown match" in e for e in errors)
    assert any("repeated game numbers" in e for e in errors)
    assert validate_games(build_games([game(1)], []), {MATCH}) == []


def test_display_name_drops_disambiguation():
    assert display_name("Doran (Choi Hyeon-jun)") == "Doran"
    assert display_name("Faker") == "Faker"
