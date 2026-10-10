from pipeline.meta import (GUIDE_LABEL, GUIDE_PATCHES, GUIDE_UNTIL_GAMES, build_meta, champion_stats, draft_slots, pace_stats,
                           phase_of, region_stats, side_stats)

ROLES = ("top", "jng", "mid", "bot", "sup")


def game(blue="A", red="B", winner="blue", date="2026-10-20 10:00:00", page="WLDs", region=None,
         blue_champs=("Aatrox", "Vi", "Azir", "Jinx", "Rell"), red_champs=("Gnar", "Sejuani", "Orianna", "Ezreal", "Nautilus"),
         blue_bans=("Yone", "Kalista", "Rumble", "", ""), red_bans=("Corki", "Taliyah", "Ashe", "Leona", "Poppy"),
         patch="16.20", minutes=30, kills=(10, 5)):
    """Game con el formato de models.oracles.parse_rows (solo los campos que usa pipeline/meta.py)."""
    def team(champs, bans, k):
        row = {"patch": patch, "gamelength": str(minutes * 60) if minutes else "", "kills": str(k)}
        row.update({f"ban{i + 1}": b for i, b in enumerate(bans)})
        row.update({f"pick{i + 1}": c for i, c in enumerate(champs)})
        return row
    return {"date": date, "page": page, "region": region, "blue": blue, "red": red, "winner": winner,
            "teams": {"blue": team(blue_champs, blue_bans, kills[0]), "red": team(red_champs, red_bans, kills[1])},
            "players": {"blue": {r: {"champion": c} for r, c in zip(ROLES, blue_champs)},
                        "red": {r: {"champion": c} for r, c in zip(ROLES, red_champs)}}}


def test_draft_slots_follow_the_side_order():
    picks, bans = draft_slots(game())
    slots = dict((c, s) for s, c in picks)
    assert [slots[c] for c in ("Aatrox", "Vi", "Azir", "Jinx", "Rell")] == [1, 4, 5, 8, 9]
    assert [slots[c] for c in ("Gnar", "Sejuani", "Orianna", "Ezreal", "Nautilus")] == [2, 3, 6, 7, 10]
    # bans 1-3 de cada lado son la primera fase; los vacíos no cuentan
    assert sorted(bans) == sorted([(1, "Yone"), (1, "Kalista"), (1, "Rumble"),
                                   (1, "Corki"), (1, "Taliyah"), (1, "Ashe"), (2, "Leona"), (2, "Poppy")])


def test_presence_counts_a_champion_that_is_only_banned():
    stats = {c["champion"]: c for c in champion_stats([game(), game(winner="red")])}
    yone = stats["Yone"]
    assert (yone["games"], yone["picks"], yone["bans"], yone["presence"]) == (2, 0, 2, 1.0)
    assert yone["winrate"] is None  # sin picks no hay winrate
    assert yone["first_rotation"] == 1.0
    aatrox = stats["Aatrox"]
    assert (aatrox["picks"], aatrox["wins"], aatrox["winrate"]) == (2, 1, 0.5)
    assert stats["Jinx"]["first_rotation"] == 0.0  # pick 8: segunda rotación
    assert stats["Leona"]["first_rotation"] == 0.0  # ban de la segunda fase


def test_champion_stats_sorted_by_presence_and_empty_input():
    rows = champion_stats([game(), game(blue_champs=("Gnar", "Vi", "Azir", "Jinx", "Rell"),
                                        red_champs=("Ksante", "Sejuani", "Orianna", "Ezreal", "Nautilus"))])
    presences = [r["presence"] for r in rows]
    assert presences == sorted(presences, reverse=True)
    assert champion_stats([]) == []


def test_missing_pick_order_still_counts_picks():
    g = game()
    for side in ("blue", "red"):
        for i in range(1, 6):
            g["teams"][side][f"pick{i}"] = ""
    stats = {c["champion"]: c for c in champion_stats([g])}
    # Sin orden de draft la prioridad no se puede medir: es null, no 0
    assert stats["Aatrox"]["picks"] == 1 and stats["Aatrox"]["first_rotation"] is None


def test_games_without_draft_data_do_not_lower_priority_or_presence():
    partial = game(blue_bans=("",) * 5, red_bans=("",) * 5)
    for side in ("blue", "red"):
        for i in range(1, 6):
            partial["teams"][side][f"pick{i}"] = ""
    stats = {c["champion"]: c for c in champion_stats([game(), partial])}
    # Yone: baneado en la única partida con bans -> 100% de presencia y de prioridad, no 50%
    assert stats["Yone"]["presence"] == 1.0 and stats["Yone"]["first_rotation"] == 1.0
    # Aatrox: pickeado en las dos partidas -> presencia 100% (los picks siempre se conocen)
    assert stats["Aatrox"]["presence"] == 1.0 and stats["Aatrox"]["picks"] == 2


SCHEDULE = [{"phase": "play-in", "date": "2026-10-15"}, {"phase": "swiss", "date": "2026-10-20"},
            {"phase": "knockout", "date": "2026-11-01"}, {"phase": "swiss", "date": None}]


def test_phase_of_uses_the_calendar_dates():
    assert phase_of("2026-10-15 18:00:00", SCHEDULE) == "play-in"
    assert phase_of("2026-10-22 09:00:00", SCHEDULE) == "swiss"
    assert phase_of("2026-11-08 09:00:00", SCHEDULE) == "knockout"


def test_side_stats_total_and_by_phase():
    games = [game(winner="blue", date="2026-10-15 10:00:00"), game(winner="red", date="2026-10-21 10:00:00"),
             game(winner="blue", date="2026-10-21 12:00:00")]
    s = side_stats(games, lambda d: phase_of(d, SCHEDULE))
    assert s["total"] == {"games": 3, "blue_wins": 2, "blue_winrate": 0.6667, "red_winrate": 0.3333}
    assert s["by_phase"]["swiss"]["games"] == 2 and "knockout" not in s["by_phase"]
    assert side_stats([])["total"] == {"games": 0, "blue_wins": 0, "blue_winrate": None, "red_winrate": None}


def test_pace_uses_the_median_and_a_ratio_of_totals():
    games = [game(minutes=30, kills=(10, 5)), game(minutes=32, kills=(8, 8)), game(minutes=60, kills=(20, 10))]
    p = pace_stats(games)["total"]
    assert p["median_minutes"] == 32.0  # el partido de 60 no la mueve (el promedio daría 40,7)
    assert p["kills_per_min"] == round(61 / 122, 4)
    assert pace_stats([game(minutes=None)])["total"] == {"games": 1, "median_minutes": None, "kills_per_min": None}


def test_regions_only_count_games_between_different_regions():
    games = [game(blue="A", red="B", winner="blue"), game(blue="A", red="C", winner="red"),
             game(blue="A", red="X", winner="blue")]
    rows = {r["region"]: r for r in region_stats(games, {"A": "KR", "B": "KR", "C": "CN"})}
    assert rows["KR"] == {"region": "KR", "games": 1, "wins": 0, "winrate": 0.0}  # A-B es KR vs KR; X sin región
    assert rows["CN"] == {"region": "CN", "games": 1, "wins": 1, "winrate": 1.0}


def test_build_meta_keeps_the_guide_until_worlds_has_enough_games():
    # La guía junta los últimos parches de las ligas principales (16.17 y 16.18); 16.16 queda afuera
    league = [game(page="LCK", region="KR", patch=GUIDE_PATCHES[0], date="2026-10-05 10:00:00"),
              game(page="VCS", region="VN", patch=GUIDE_PATCHES[1], date="2026-10-06 10:00:00"),
              game(page="LCK", region="KR", patch="16.16", date="2026-10-01 10:00:00")]
    qualifier = [game(date="2026-09-10 10:00:00")]  # "WLDs" antes del torneo: clasificatorio regional
    before = build_meta(league + qualifier, SCHEDULE, "2026-10-15")
    assert before["worlds_games"] == 0 and before["guide_patch"] == GUIDE_LABEL
    assert before["samples"]["guide"]["games"] == 2 and before["samples"]["worlds"]["games"] == 0
    assert set(before["champions"]) == {"worlds", "guide"}

    worlds = [game(date=f"2026-10-{15 + i % 5} 10:00:00") for i in range(GUIDE_UNTIL_GAMES)]
    after = build_meta(league + worlds, SCHEDULE, "2026-10-15")
    assert after["guide_patch"] is None and set(after["samples"]) == {"worlds"}
    assert after["samples"]["worlds"]["games"] == GUIDE_UNTIL_GAMES
