import pytest

from pipeline.meta import (GUIDE_LEAGUE, GUIDE_UNTIL_GAMES, MAX_PRIOR, adjust_winrates, build_meta,
                           champion_stats, draft_slots, pace_stats, phase_of, prior_picks, region_stats, side_stats,
                           wilson, winrate_noise)

ROLES = ("top", "jng", "mid", "bot", "sup")


def game(blue="A", red="B", winner="blue", date="2026-10-20 10:00:00", page="WLDs", region=None,
         blue_champs=("Aatrox", "Vi", "Azir", "Jinx", "Rell"), red_champs=("Gnar", "Sejuani", "Orianna", "Ezreal", "Nautilus"),
         blue_bans=("Yone", "Kalista", "Rumble", "", ""), red_bans=("Corki", "Taliyah", "Ashe", "Leona", "Poppy"),
         patch="16.20", minutes=30, kills=(10, 5), number=1):
    """Game con el formato de models.oracles.parse_rows (solo los campos que usa pipeline/meta.py)."""
    def team(champs, bans, k):
        row = {"patch": patch, "gamelength": str(minutes * 60) if minutes else "", "kills": str(k)}
        row.update({f"ban{i + 1}": b for i, b in enumerate(bans)})
        row.update({f"pick{i + 1}": c for i, c in enumerate(champs)})
        return row
    return {"date": date, "game": number, "page": page, "region": region, "blue": blue, "red": red, "winner": winner,
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
    low, high = wilson(2, 3)
    assert s["total"] == {"games": 3, "blue_wins": 2, "blue_winrate": 0.6667, "red_winrate": 0.3333,
                          "low": low, "high": high}
    assert s["by_phase"]["swiss"]["games"] == 2 and "knockout" not in s["by_phase"]
    assert side_stats([])["total"] == {"games": 0, "blue_wins": 0, "blue_winrate": None, "red_winrate": None,
                                       "low": None, "high": None}


def test_pace_uses_the_median_and_a_ratio_of_totals():
    games = [game(minutes=30, kills=(10, 5)), game(minutes=32, kills=(8, 8)), game(minutes=60, kills=(20, 10))]
    p = pace_stats(games)["total"]
    assert p["median_minutes"] == 32.0  # el partido de 60 no la mueve (el promedio daría 40,7)
    assert p["kills_per_min"] == round(61 / 122, 4)
    assert pace_stats([game(minutes=None)])["total"] == {"games": 1, "median_minutes": None, "kills_per_min": None,
                                                         "p25_minutes": None, "p75_minutes": None}


def test_regions_only_count_games_between_different_regions():
    games = [game(blue="A", red="B", winner="blue"), game(blue="A", red="C", winner="red"),
             game(blue="A", red="X", winner="blue")]
    rows = {r["region"]: r for r in region_stats(games, {"A": "KR", "B": "KR", "C": "CN"})}
    # A-B es KR vs KR; X sin región
    assert (rows["KR"]["games"], rows["KR"]["wins"], rows["KR"]["winrate"]) == (1, 0, 0.0)
    assert (rows["CN"]["games"], rows["CN"]["wins"], rows["CN"]["winrate"]) == (1, 1, 1.0)
    assert (rows["CN"]["low"], rows["CN"]["high"]) == wilson(1, 1)


def test_build_meta_keeps_the_guide_until_worlds_has_enough_games():
    # La guía es la Demacia Cup (sin importar el parche); las ligas en el mismo parche quedan afuera
    league = [game(page=GUIDE_LEAGUE, patch="16.18", date="2026-10-05 10:00:00"),
              game(page=GUIDE_LEAGUE, patch="16.18", date="2026-10-06 10:00:00"),
              game(page="LCK", region="KR", patch="16.18", date="2026-10-01 10:00:00")]
    qualifier = [game(date="2026-09-10 10:00:00")]  # "WLDs" antes del torneo: clasificatorio regional
    before = build_meta(league + qualifier, SCHEDULE, "2026-10-15")
    assert before["worlds_games"] == 0 and before["guide_patch"] == "16.18"
    assert before["samples"]["guide"]["games"] == 2 and before["samples"]["worlds"]["games"] == 0
    assert set(before["champions"]) == {"worlds", "guide"}

    worlds = [game(date=f"2026-10-{15 + i % 5} 10:00:00") for i in range(GUIDE_UNTIL_GAMES)]
    after = build_meta(league + worlds, SCHEDULE, "2026-10-15")
    assert after["guide_patch"] is None and set(after["samples"]) == {"worlds"}
    assert after["samples"]["worlds"]["games"] == GUIDE_UNTIL_GAMES


def test_wilson_interval_known_values():
    # 164 de 305 (el lado azul de la guía): 53,8% con un rango que incluye el 50%
    low, high = wilson(164, 305)
    assert low == pytest.approx(0.482, abs=0.001) and high == pytest.approx(0.593, abs=0.001)
    # Con 0 de 3 el rango no baja de 0 (la aproximación normal daría negativo)
    assert wilson(0, 3)[0] == 0.0 and wilson(0, 3)[1] == pytest.approx(0.562, abs=0.001)
    assert wilson(0, 0) == (None, None)


def test_champion_rates_and_player_stats():
    g = game()
    for row in g["players"]["blue"].values():
        row.update({"kills": "2", "deaths": "1", "assists": "4", "teamkills": "10",
                    "total cs": "270", "damagetochampions": "27000"})
    no_bans = game(blue_bans=("",) * 5, red_bans=("",) * 5)
    stats = {c["champion"]: c for c in champion_stats([g, no_bans])}
    aatrox = stats["Aatrox"]
    assert (aatrox["pick_rate"], aatrox["ban_rate"], aatrox["presence"]) == (1.0, 0.0, 1.0)
    # Totales: (2 + 4 de una partida + 0 + 0 de la otra) / (1 + 0) muertes
    assert aatrox["kda"] == 6.0 and aatrox["kp"] == 0.6
    assert aatrox["cs_min"] == 9.0 and aatrox["dpm"] == 900   # solo la partida con dato: 270 / 30 min
    assert stats["Yone"]["ban_rate"] == 1.0 and stats["Yone"]["pick_rate"] == 0.0  # solo cuenta la partida con bans
    assert (aatrox["winrate_low"], aatrox["winrate_high"]) == wilson(2, 2)
    assert aatrox["roles"] == {"top": 2}


def test_flex_champion_counts_each_role():
    other = game(blue_champs=("Vi", "Aatrox", "Azir", "Jinx", "Rell"), red_champs=("Gnar", "Sejuani", "Orianna", "Ezreal", "Nautilus"))
    stats = {c["champion"]: c for c in champion_stats([game(), other])}
    assert stats["Aatrox"]["roles"] == {"top": 1, "jng": 1}


def champ_rows(winrates_and_picks):
    return [{"champion": f"C{i}", "picks": n, "wins": round(w * n)} for i, (w, n) in enumerate(winrates_and_picks)]


def test_winrate_noise_separates_real_spread_from_chance():
    # Todos con 50%: la dispersión observada es 0 y no hay nada "real"
    flat = winrate_noise(champ_rows([(0.5, 40)] * 6))
    assert flat["observed_var"] == 0.0 and flat["noise_share"] == 1.0 and flat["true_var"] == 0.0
    # Diferencias enormes con muchas partidas: casi todo es real
    spread = winrate_noise(champ_rows([(0.2, 400), (0.8, 400), (0.3, 400), (0.7, 400)]))
    assert spread["noise_share"] < 0.05 and spread["true_var"] > 0.04
    assert winrate_noise(champ_rows([(0.5, 40)])) is None   # un solo campeón: no hay dispersión que medir


def test_prior_picks_is_finite_with_real_spread_and_capped_without_it():
    flat = [game(winner="blue" if i % 2 else "red") for i in range(40)]
    assert prior_picks(flat, min_picks=5) == MAX_PRIOR
    # Los campeones del azul ganan siempre: la diferencia es real y k queda chico
    always_blue = [game(winner="blue") for _ in range(40)]
    assert 1 <= prior_picks(always_blue, min_picks=5) < 10


def test_adjusted_winrate_shrinks_toward_half():
    rows = adjust_winrates([{"champion": "A", "picks": 3, "wins": 3}, {"champion": "B", "picks": 300, "wins": 180},
                            {"champion": "C", "picks": 0, "wins": 0}], k=100)
    adj = {r["champion"]: r["winrate_adj"] for r in rows}
    assert adj["A"] == pytest.approx((3 + 50) / 103, abs=1e-4)    # 3 de 3 → apenas arriba de 50%
    assert adj["B"] == pytest.approx((180 + 50) / 400, abs=1e-4)  # 60% con 300 picks → 57,5%
    assert adj["C"] is None


def test_side_stats_split_first_game_from_the_rest():
    games = [game(winner="blue", number=1), game(winner="red", number=2), game(winner="red", number=3)]
    by_game = side_stats(games)["by_game"]
    assert (by_game["first"]["games"], by_game["first"]["blue_wins"]) == (1, 1)
    assert (by_game["rest"]["games"], by_game["rest"]["blue_wins"]) == (2, 0)


def test_pace_quartiles():
    p = pace_stats([game(minutes=m) for m in (25, 30, 35, 40, 45)])["total"]
    assert (p["p25_minutes"], p["p75_minutes"]) == (30.0, 40.0)


def test_build_meta_keeps_guide_presence_after_the_guide_is_hidden():
    league = [game(page=GUIDE_LEAGUE, patch="16.18", date="2026-10-05 10:00:00")]
    worlds = [game(date="2026-10-16 10:00:00", blue_champs=("Ksante", "Vi", "Azir", "Jinx", "Rell"))
              for _ in range(GUIDE_UNTIL_GAMES)]
    meta = build_meta(league + worlds, SCHEDULE, "2026-10-15")
    assert set(meta["champions"]) == {"worlds"}
    rows = {c["champion"]: c for c in meta["champions"]["worlds"]}
    assert rows["Vi"]["guide_presence"] == 1.0       # jugado en la guía
    assert rows["Ksante"]["guide_presence"] == 0.0   # nunca apareció en la guía
    assert rows["Vi"]["winrate_adj"] is not None and meta["prior_picks"] >= 1
    assert set(meta["analysis"]) == {"worlds"}
