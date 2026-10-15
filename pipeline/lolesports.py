"""Estadísticas de cada partida de Worlds desde la API no oficial de lolesports (la que usa lolesports.com).

Leaguepedia carga el scoreboard a mano, horas después de cada partida; lolesports lo tiene en vivo (~10 s de atraso).
Mientras Leaguepedia no tenga una partida, la pestaña Partidas usa esta. Lo que lolesports no da:
- bans (llegan con Leaguepedia);
- daño a campeones en números absolutos (solo la proporción), así que queda como dato faltante;
- ganador de cada partida: sale de MatchScheduleGame de Leaguepedia, que se carga enseguida.
Es una API sin documentar: si falla, el build sigue con lo que haya en caché.
"""
from datetime import datetime, timedelta, timezone

import requests

API_URL = "https://esports-api.lolesports.com/persisted/gw"
FEED_URL = "https://feed.lolesports.com/livestats/v1"
# Clave pública que usa el propio sitio de lolesports (no es un secreto)
API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"
WORLDS_LEAGUE_ID = "98767975604431411"
TIMEOUT_S = 30
ROLES = {"top": 1, "jungle": 2, "mid": 3, "bottom": 4, "support": 5}


def _get(session, url: str, **params) -> dict:
    response = session.get(url, params=params, headers={"x-api-key": API_KEY}, timeout=TIMEOUT_S)
    response.raise_for_status()
    return response.json()


def started_matches(session, since: str) -> list[dict]:
    """Series de Worlds desde `since` (ISO) que ya empezaron. La primera página del calendario trae las recientes."""
    events = _get(session, f"{API_URL}/getSchedule", hl="en-US", leagueId=WORLDS_LEAGUE_ID)["data"]["schedule"]["events"]
    return [e for e in events if e["type"] == "match" and e["state"] != "unstarted" and e["startTime"] >= since]


def _window_time(now: datetime, first_frame: str) -> str:
    """startingTime para pedir el final de la partida: el feed devuelve los últimos cuadros si se pide un momento
    posterior al final. Tiene que ser múltiplo de 10 s y estar en el pasado (el feed va ~1 min atrasado)."""
    start = datetime.fromisoformat(first_frame.replace("Z", "+00:00"))
    t = min(now - timedelta(seconds=60), start + timedelta(hours=3))
    t = t.replace(second=t.second // 10 * 10, microsecond=0)
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def fetch_games(session, since: str, cached: list[dict], now: datetime | None = None) -> list[dict]:
    """Último cuadro de cada partida jugada o en curso. Las terminadas que ya están en caché no se vuelven a pedir."""
    now = now or datetime.now(timezone.utc)
    done = {g["game_id"]: g for g in cached if g["last_frame"]["gameState"] == "finished"}
    out = []
    for event in started_matches(session, since):
        match = _get(session, f"{API_URL}/getEventDetails", hl="en-US", id=event["match"]["id"])["data"]["event"]["match"]
        codes = {t["id"]: t["code"] for t in match["teams"]}
        for game in match["games"]:
            if game["state"] not in ("inProgress", "completed"):
                continue
            if game["id"] in done:
                out.append(done[game["id"]])
                continue
            url = f"{FEED_URL}/window/{game['id']}"
            response = session.get(url, timeout=TIMEOUT_S)
            if response.status_code == 204 or not response.content:
                continue  # todavía no hay datos (draft o pantalla de carga)
            first = response.json()
            last = _get(session, url, startingTime=_window_time(now, first["frames"][0]["rfc460Timestamp"]))
            out.append({
                "game_id": game["id"],
                "number": game["number"],
                "start_time": event["startTime"],
                "teams": {t["side"]: codes.get(t["id"], "") for t in game["teams"]},
                "patch": first["gameMetadata"].get("patchVersion"),
                "metadata": first["gameMetadata"],
                "first_frame_time": first["frames"][0]["rfc460Timestamp"],
                "last_frame": last["frames"][-1],
            })
    return out


def _length(first: str, last: str) -> str:
    """Duración aproximada: del primer al último cuadro del feed (incluye pausas)."""
    parse = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))  # noqa: E731
    seconds = int((parse(last) - parse(first)).total_seconds())
    return f"{seconds // 60}:{seconds % 60:02d}"


def _find_match(game: dict, matches: list[dict], shorts: dict[str, str]) -> dict | None:
    """Serie de Leaguepedia con los mismos dos equipos (por sigla) y del mismo día que la de lolesports."""
    codes = {c.upper() for c in game["teams"].values()}
    start = datetime.fromisoformat(game["start_time"].replace("Z", "+00:00"))
    for m in matches:
        if not m.get("DateTimeUTC") or {shorts.get(m.get(k) or "", "").upper() for k in ("Team1", "Team2")} != codes:
            continue
        when = datetime.fromisoformat(m["DateTimeUTC"]).replace(tzinfo=timezone.utc)
        if abs(when - start) < timedelta(hours=18):
            return m
    return None


def to_leaguepedia_rows(games: list[dict], matches: list[dict], schedule_games: list[dict], teams: list[dict],
                        champion_names: dict[str, str]) -> tuple[list[dict], list[dict]]:
    """Convierte las partidas de lolesports a filas con la forma de ScoreboardGames y ScoreboardPlayers de
    Leaguepedia, así pipeline.games las arma igual. champion_names: id de Data Dragon → nombre ('LeeSin' → 'Lee Sin')."""
    shorts = {t["Name"]: t.get("Short") or t["Name"] for t in teams}
    name_of = {short.upper(): name for name, short in shorts.items()}
    winners = {g["GameId"]: g.get("Winner") or "" for g in schedule_games}
    game_rows, player_rows = [], []
    for g in games:
        match = _find_match(g, matches, shorts)
        if not match:
            print(f"lolesports: no Leaguepedia match for {g['teams']} on {g['start_time']}")
            continue
        game_id = f"{match['MatchId']}_{g['number']}"
        frame, meta = g["last_frame"], g["metadata"]
        row = {"GameId": game_id, "MatchId": match["MatchId"], "GameInMatch": str(g["number"]),
               "DateTimeUTC": g["first_frame_time"][:19].replace("T", " "),
               "Winner": winners.get(game_id, "") if frame["gameState"] == "finished" else "",
               "Gamelength": _length(g["first_frame_time"], frame["rfc460Timestamp"]),
               "Patch": ".".join((g.get("patch") or "").split(".")[:2])}
        for n, side in ((1, "blue"), (2, "red")):
            team = frame[f"{side}Team"]
            picks = [p["championId"] for p in meta[f"{side}TeamMetadata"]["participantMetadata"]]
            row |= {f"Team{n}": name_of.get(g["teams"][side].upper(), g["teams"][side]),
                    f"Team{n}Picks": ",".join(champion_names.get(c, c) for c in picks),
                    f"Team{n}Gold": str(team["totalGold"]), f"Team{n}Kills": str(team["totalKills"]),
                    f"Team{n}Towers": str(team["towers"]), f"Team{n}Dragons": str(len(team["dragons"])),
                    f"Team{n}Barons": str(team["barons"])}
            stats = {p["participantId"]: p for p in team["participants"]}
            for p in meta[f"{side}TeamMetadata"]["participantMetadata"]:
                s = stats.get(p["participantId"], {})
                # "C9 Blaber" → "Blaber" (lolesports antepone la sigla del equipo)
                name = p["summonerName"].strip().split(" ", 1)[-1]
                player_rows.append({"GameId": game_id, "Link": name, "Team": row[f"Team{n}"], "Side": str(n),
                                    "RoleNumber": str(ROLES.get(p["role"], "")),
                                    "Champion": champion_names.get(p["championId"], p["championId"]),
                                    "Kills": str(s.get("kills", "")), "Deaths": str(s.get("deaths", "")),
                                    "Assists": str(s.get("assists", "")), "CS": str(s.get("creepScore", "")),
                                    "Gold": str(s.get("totalGold", "")), "DamageToChampions": ""})
        game_rows.append(row)
    return game_rows, player_rows


OE_ROLES = {"1": "top", "2": "jng", "3": "mid", "4": "bot", "5": "sup"}


def to_oe_games(game_rows: list[dict], player_rows: list[dict], oe_name) -> list[dict]:
    """Filas con forma de Leaguepedia (las de lolesports o el scoreboard de Leaguepedia) → games con el formato de
    models.oracles.parse_rows, para que el meta cuente las partidas de Worlds antes de que lleguen a Oracle's Elixir.
    Solo partidas terminadas. Lo que no hay queda vacío (dato faltante): orden de picks y, con lolesports, bans y daño.
    oe_name: nombre de Leaguepedia → nombre en Oracle's Elixir (para que coincidan las regiones de los equipos)."""
    players: dict[tuple[str, str], list[dict]] = {}
    for r in player_rows:
        players.setdefault((r["GameId"], r.get("Side") or ""), []).append(r)
    games = []
    for g in game_rows:
        winner = {"1": "blue", "2": "red"}.get(g.get("Winner") or "")
        minutes, _, seconds = (g.get("Gamelength") or "").partition(":")
        if not winner or not seconds:
            continue
        length = str(int(minutes) * 60 + int(seconds))
        teams, sides = {}, {}
        for n, side in (("1", "blue"), ("2", "red")):
            bans = [b.strip() for b in (g.get(f"Team{n}Bans") or "").split(",")]
            teams[side] = {"teamname": oe_name(g[f"Team{n}"]), "side": side.title(), "position": "team",
                           "result": "1" if winner == side else "0", "gamelength": length,
                           "kills": g.get(f"Team{n}Kills") or "", "patch": g.get("Patch") or "",
                           **{f"ban{i}": b for i, b in enumerate(bans[:5], start=1)}}
            sides[side] = {OE_ROLES[r["RoleNumber"]]: {
                "champion": r.get("Champion") or "", "kills": r.get("Kills") or "", "deaths": r.get("Deaths") or "",
                "assists": r.get("Assists") or "", "teamkills": teams[side]["kills"], "total cs": r.get("CS") or "",
                "damagetochampions": r.get("DamageToChampions") or "", "playername": r.get("Link") or ""}
                for r in players.get((g["GameId"], n), []) if r.get("RoleNumber") in OE_ROLES}
        games.append({"date": g.get("DateTimeUTC") or "", "match_id": g["MatchId"], "game": int(g["GameInMatch"]),
                      "page": "WLDs", "region": None, "blue": teams["blue"]["teamname"], "red": teams["red"]["teamname"],
                      "winner": winner, "teams": teams, "players": sides})
    return games


def missing_from(oe_games: list[dict], extra: list[dict]) -> list[dict]:
    """Las de `extra` que Oracle's Elixir todavía no tiene (mismo día, mismos equipos, mismo número de partida)."""
    key = lambda g: (g["date"][:10], frozenset((g["blue"], g["red"])), g["game"])  # noqa: E731
    known = {key(g) for g in oe_games}
    return [g for g in extra if key(g) not in known]
