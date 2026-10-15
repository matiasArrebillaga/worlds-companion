"""Detalle de cada partida de Worlds (draft, objetivos y jugadores) para la pestaña Partidas del sitio.

Sale de dos tablas de Leaguepedia que baja pipeline/fetch.py:
- ScoreboardGames: una fila por partida (Team1 = lado azul, Team2 = lado rojo).
- ScoreboardPlayers: una fila por jugador y partida (Side 1 = azul, 2 = rojo).
Leaguepedia carga el scoreboard un rato después de cada partida: una partida puede llegar sin jugadores todavía.
"""
import re

# Campos extra de ScoreboardGames (se suman a los que usa el Elo, en el mismo archivo)
DETAIL_FIELDS = ",".join(
    ["Gamelength", "Patch"]
    + [f"Team{n}{stat}" for n in (1, 2) for stat in
       ("Picks", "Bans", "Gold", "Kills", "Dragons", "Barons", "Towers", "RiftHeralds", "VoidGrubs", "Atakhans")]
)
PLAYER_FIELDS = "GameId,Link,Team,Side,Role_Number=RoleNumber,Champion,Kills,Deaths,Assists,Gold,CS,DamageToChampions"

SIDES = {"1": "blue", "2": "red"}
# Objetivos que se muestran por equipo (clave del JSON → sufijo del campo de Leaguepedia)
OBJECTIVES = {"kills": "Kills", "gold": "Gold", "towers": "Towers", "dragons": "Dragons", "barons": "Barons",
              "heralds": "RiftHeralds", "grubs": "VoidGrubs", "atakhans": "Atakhans"}


def _int(value: str | None) -> int | None:
    """Número entero de Leaguepedia; vacío = dato faltante (None), nunca 0."""
    value = (value or "").strip()
    return int(float(value)) if value else None


def _names(value: str | None) -> list[str]:
    """'Azir,Poppy,,Bard' → ['Azir', 'Poppy', 'Bard'] (los bans vacíos = no baneó)."""
    return [x.strip() for x in (value or "").split(",") if x.strip()]


def display_name(link: str) -> str:
    """Leaguepedia desambigua jugadores con el nombre real: 'Doran (Choi Hyeon-jun)' → 'Doran'."""
    return re.sub(r"\s*\(.*\)$", "", link).strip()


def _player(row: dict) -> dict:
    return {
        "name": display_name(row.get("Link") or ""),
        "role": _int(row.get("RoleNumber")),  # 1 top, 2 jungla, 3 mid, 4 bot, 5 support
        "champion": row.get("Champion") or "",
        "kills": _int(row.get("Kills")),
        "deaths": _int(row.get("Deaths")),
        "assists": _int(row.get("Assists")),
        "cs": _int(row.get("CS")),
        "gold": _int(row.get("Gold")),
        "damage": _int(row.get("DamageToChampions")),
    }


def _side(game: dict, n: int, players: list[dict]) -> dict:
    return {
        "team": game.get(f"Team{n}") or "",
        "picks": _names(game.get(f"Team{n}Picks")),
        "bans": _names(game.get(f"Team{n}Bans")),
        **{key: _int(game.get(f"Team{n}{field}")) for key, field in OBJECTIVES.items()},
        "players": sorted(players, key=lambda p: p["role"] or 9),
    }


def build_games(game_rows: list[dict], player_rows: list[dict]) -> dict[str, list[dict]]:
    """MatchId → partidas de esa serie en orden, con el detalle de cada lado."""
    by_game: dict[tuple[str, str], list[dict]] = {}
    for row in player_rows:
        side = SIDES.get(row.get("Side") or "")
        if side:
            by_game.setdefault((row["GameId"], side), []).append(_player(row))

    out: dict[str, list[dict]] = {}
    for g in game_rows:
        if not g.get("MatchId"):
            continue
        winner = SIDES.get(g.get("Winner") or "")
        out.setdefault(g["MatchId"], []).append({
            "n": _int(g.get("GameInMatch")),
            "length": g.get("Gamelength") or None,  # "30:12"
            "patch": g.get("Patch") or None,
            "winner": winner,  # 'blue' | 'red' | None (todavía sin cargar)
            "blue": _side(g, 1, by_game.get((g["GameId"], "blue"), [])),
            "red": _side(g, 2, by_game.get((g["GameId"], "red"), [])),
        })
    for games in out.values():
        games.sort(key=lambda x: x["n"] or 0)
    return out
