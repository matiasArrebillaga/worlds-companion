import pytest

from pipeline.meta import champion_stats, draft_slots

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
    assert stats["Aatrox"]["picks"] == 1 and stats["Aatrox"]["first_rotation"] == 0.0
