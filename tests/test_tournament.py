import random
from collections import Counter

from models import tournament as t


def match(match_id, team1=None, team2=None, winner=None, best_of=5, phase="play-in", round_="Round 1"):
    status = "finished" if winner else "upcoming"
    return {"id": match_id, "phase": phase, "round": round_, "best_of": best_of, "start_utc": None,
            "team1": {"name": team1} if team1 else None, "team2": {"name": team2} if team2 else None,
            "winner": winner, "status": status, "score": [3, 1] if winner == "team1" else [1, 3] if winner else None}


def strength_model(strength: dict[str, float]):
    """Modelo de prueba: gana el más fuerte con una chance que crece con la diferencia."""
    return t.series_model(lambda a, b: strength[a] / (strength[a] + strength[b]))


PLAYIN = [
    match("W/Play-In_Round 1_1", "A", "B"),
    match("W/Play-In_Round 1_2", "C", "D"),
    match("W/Play-In_Round 2_1"), match("W/Play-In_Round 1_3"), match("W/Play-In_Round 2_2"), match("W/Play-In_Round 3_1"),
]


def test_chalk_bracket_advances_favorites_through_double_elimination():
    prob = strength_model({"A": 4, "B": 1, "C": 2, "D": 3})
    rows = {r["label"]: r for r in t.chalk_bracket(t._by_key(PLAYIN, t.PLAYIN_PREFIX), t.PLAYIN_BRACKET, t.PLAYIN_LABELS, prob)}
    # Semis: A y D; final de ganadores A-D; perdedores B-C; final de perdedores D-C; gran final A-D
    assert (rows["Final de ganadores"]["team1"], rows["Final de ganadores"]["team2"]) == ("A", "D")
    assert (rows["Partido de perdedores"]["team1"], rows["Partido de perdedores"]["team2"]) == ("B", "C")
    assert (rows["Final de perdedores"]["team1"], rows["Final de perdedores"]["team2"]) == ("D", "C")
    assert rows["Gran final"]["team1"] == "A" and rows["Gran final"]["pick"] == "team1"
    assert rows["Semi 1"]["status"] == "scheduled" and rows["Gran final"]["status"] == "projected"


def test_real_results_override_the_favorite():
    prob = strength_model({"A": 4, "B": 1, "C": 2, "D": 3})
    played = [match("W/Play-In_Round 1_1", "A", "B", winner="team2")] + PLAYIN[1:]  # sorpresa: gana B
    rows = {r["label"]: r for r in t.chalk_bracket(t._by_key(played, t.PLAYIN_PREFIX), t.PLAYIN_BRACKET, t.PLAYIN_LABELS, prob)}
    assert rows["Semi 1"]["status"] == "finished" and rows["Semi 1"]["pick"] == "team2"
    assert rows["Final de ganadores"]["team1"] == "B"
    assert rows["Partido de perdedores"]["team1"] == "A"


def test_simulation_counts_add_up_and_a_dominant_team_always_wins():
    main = [f"T{i}" for i in range(15)]
    strength = {name: 1.0 for name in main} | {"A": 1e6, "B": 1.0, "C": 1.0, "D": 1.0}
    counts = t.simulate(PLAYIN, main, strength_model(strength), n=300)
    assert counts["playin"] == Counter({"A": 300})
    assert counts["champion"] == Counter({"A": 300})
    assert sum(counts["swiss_advance"].values()) == 8 * 300
    assert sum(counts["swiss_3_0"].values()) == 2 * 300
    assert sum(counts["swiss_0_3"].values()) == 2 * 300


def test_swiss_has_no_rematches_and_everyone_ends_at_three():
    teams = [f"T{i}" for i in range(16)]
    rng = random.Random(1)
    prob = strength_model({name: 1.0 for name in teams})
    games = []

    def decide(a, b, best_of):
        games.append(frozenset((a, b)))
        return t.sampler(prob, rng)(a, b, best_of)

    record = t.play_swiss(teams, {}, decide, rng)
    assert all(w == 3 or l == 3 for w, l in record.values())
    assert len(games) == len(set(games))


def test_same_seed_same_result():
    main = [f"T{i}" for i in range(15)]
    prob = strength_model({name: 1.0 + i for i, name in enumerate(main + ["A", "B", "C", "D"])})
    assert t.simulate(PLAYIN, main, prob, n=200) == t.simulate(PLAYIN, main, prob, n=200)


def test_swiss_structure_boxes_hold_the_right_number_of_teams():
    main = [f"T{i}" for i in range(15)]
    prob = strength_model({name: 1.0 + i for i, name in enumerate(main + ["A", "B", "C", "D"])})
    sim = t.payload(PLAYIN, main, prob, short=lambda name: name, n=500)["swiss"]
    expected = {g["record"]: g["expected"] for g in sim["rounds"][2]["groups"]}  # ronda 3
    assert expected == {"2-0": 4, "1-1": 8, "0-2": 4}
    assert sim["rounds"][1]["groups"][0]["best_of"] == 1  # 1-0 se juega al mejor de 1
    assert sim["rounds"][2]["groups"][0]["best_of"] == 3  # 2-0 clasifica: Bo3
    finals = {f["record"]: sum(x["p"] for x in f["teams"]) for f in sim["final"]}
    assert abs(finals["3-0"] - 2) < 0.02 and abs(finals["0-3"] - 2) < 0.02


def test_play_bracket_fills_the_empty_side_when_leaguepedia_puts_the_known_team_as_team2():
    # Leaguepedia ya puso al ganador (B) y al perdedor (A) de la Semi 1 como team2 de sus próximos partidos
    matches = {
        "Round 1_1": match("Round 1_1", "A", "B", winner="team2"),
        "Round 1_2": match("Round 1_2", "C", "D"),
        "Round 2_1": match("Round 2_1", None, "B"),
        "Round 1_3": match("Round 1_3", None, "A"),
    }
    played = t.play_bracket(matches, t.PLAYIN_BRACKET, lambda a, b, bo: a)
    assert {played["Round 2_1"]["team1"], played["Round 2_1"]["team2"]} == {"B", "C"}
    assert {played["Round 1_3"]["team1"], played["Round 1_3"]["team2"]} == {"A", "D"}
