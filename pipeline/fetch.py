"""Descarga los torneos activos (y el calendario de los próximos) a data/raw/<torneo>/.

Uso: python -m pipeline.fetch
Solo reescribe un archivo si los datos cambiaron, para no ensuciar el historial de git
(la excepción es el descubrimiento de torneos, que se guarda siempre).
"""
import json
from pathlib import Path

import requests

from pipeline import assets, leaguepedia, lolesports, seasons, utc_now_iso
from pipeline.games import DETAIL_FIELDS, PLAYER_FIELDS
from pipeline.history import GAME_FIELDS
from pipeline.schedule import UNDECIDED_TEAMS
from pipeline.seasons import raw_file

RAW_DIR = Path("data/raw")

# DateTime_UTC se renombra para que la clave no venga con espacios ("DateTime UTC")
MATCH_FIELDS = ",".join([
    "MatchId", "OverviewPage", "Tab", "Round", "Phase", "BestOf",
    "Team1", "Team2", "Team1Score", "Team2Score", "Winner",
    "DateTime_UTC=DateTimeUTC", "HasTime", "IsNullified",
])
TEAM_FIELDS = "Name,Short"


def team_names(matches: list[dict]) -> list[str]:
    """Nombres de equipo únicos y ordenados, sin vacíos ni placeholders ('TBD', 'TBA')."""
    names = {(m.get(key) or "").strip() for m in matches for key in ("Team1", "Team2")}
    return sorted(n for n in names if n and n.lower() not in UNDECIDED_TEAMS)


def teams_where(names: list[str]) -> str:
    """Cláusula WHERE de Cargo con los nombres entre comillas (escapadas)."""
    return leaguepedia.in_clause("Name", names)


def roster_teams(rosters: list[dict]) -> list[str]:
    """Equipos inscriptos en el torneo (sin placeholders ni repetidos)."""
    names = {(r.get("Team") or "").strip() for r in rosters}
    return sorted(n for n in names if n and n.lower() not in UNDECIDED_TEAMS)


def read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))["rows"]


def write_if_changed(path: Path, rows: list[dict], now: str) -> bool:
    """Guarda {fetched_at, rows} solo si las filas cambiaron. Devuelve True si escribió."""
    if path.exists() and read_rows(path) == rows:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"fetched_at": now, "rows": rows}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return True


def pages_where(field: str, pages: list[str]) -> str:
    """'(Campo LIKE "pág1%" OR Campo LIKE "pág2%")': el prefijo cubre las subpáginas (Play-In, Main Event)."""
    quoted = [p.replace('"', '\\"') for p in pages]
    return "(" + " OR ".join(f'{field} LIKE "{p}%"' for p in quoted) + ")"


def targets(known: list[dict], today: str) -> list[tuple[str, bool]]:
    """(id, completo) de cada torneo a bajar: los activos completos; los próximos, solo el calendario
    (para saber cuándo tienen partidos con fecha). Los terminados no se vuelven a bajar."""
    out = []
    for t in known:
        state = seasons.status(t, today)
        if state != "finished":
            out.append((t["id"], state == "active"))
    return out


def fetch_tournament(session, tournament: dict, now: str, full: bool) -> list[str]:
    """Baja un torneo a data/raw/<id>/. Con full=False solo el calendario. Devuelve los equipos que aparecen."""
    tid, pages = tournament["id"], tournament["pages"]
    file = lambda key: raw_file(RAW_DIR, tid, key)  # noqa: E731
    where = pages_where("OverviewPage", pages)

    matches = leaguepedia.cargo_query(session, tables="MatchSchedule", fields=MATCH_FIELDS, where=where,
                                      order_by="DateTime_UTC,MatchId")
    changed = write_if_changed(file("matches"), matches, now)
    print(f"{tid} matches: {len(matches)} ({'updated' if changed else 'unchanged'})")
    if not full:
        return team_names(matches)

    # Además de lo que usa el Elo, el detalle de cada partida (draft y objetivos) para la pestaña Partidas
    games = leaguepedia.cargo_query(session, tables="ScoreboardGames", fields=f"{GAME_FIELDS},{DETAIL_FIELDS}",
                                    where=where, order_by="DateTime_UTC,GameId")
    write_if_changed(file("games"), games, now)
    game_players = leaguepedia.cargo_query(session, tables="ScoreboardPlayers", fields=PLAYER_FIELDS,
                                           where=where, order_by="GameId,Side,Role_Number")
    write_if_changed(file("game_players"), game_players, now)
    print(f"{tid} games: {len(games)}, players: {len(game_players)}")

    # Lado y ganador de cada partida: Leaguepedia los carga enseguida, mucho antes que el scoreboard
    schedule_games = leaguepedia.cargo_query(session, tables="MatchScheduleGame",
                                             fields="GameId,MatchId,Blue,Red,Winner",
                                             where=pages_where("MatchId", pages), order_by="GameId")
    write_if_changed(file("schedule_games"), schedule_games, now)

    # Stats en vivo de lolesports mientras Leaguepedia no cargue el scoreboard. Si falla, queda la caché
    league_id = seasons.TRACKED[tournament["league"]]["lolesports_id"]
    try:
        live = lolesports.fetch_games(requests.Session(), tournament["start"], read_rows(file("lolesports")),
                                      league_id=league_id)
        write_if_changed(file("lolesports"), live, now)
        print(f"{tid} lolesports games: {len(live)}")
    except Exception as error:  # noqa: BLE001 — API sin documentar: nunca debe frenar la actualización
        print(f"{tid} lolesports: skipped ({error})")

    rosters = leaguepedia.cargo_query(session, tables="TournamentRosters", fields="Team,OverviewPage",
                                      where=where, order_by="OverviewPage,Team")
    write_if_changed(file("rosters"), rosters, now)

    # Solo se piden los equipos que todavía no están en caché.
    # Así se bajan las siglas de los inscriptos aunque los cruces sigan en TBD
    cached = read_rows(file("teams"))
    known = {t["Name"] for t in cached}
    wanted = sorted(set(team_names(matches)) | set(roster_teams(rosters)))
    missing = [n for n in wanted if n not in known]
    if missing:
        fetched = leaguepedia.cargo_query(session, tables="Teams", fields=TEAM_FIELDS, where=teams_where(missing))
        write_if_changed(file("teams"), sorted(cached + fetched, key=lambda t: t["Name"]), now)
    print(f"{tid} teams: {len(known) + len(missing)} ({len(missing)} new)")
    return wanted


def discover(session, now: str) -> None:
    """Torneos del año actual y el siguiente en las ligas seguidas. Si falla, queda el descubrimiento anterior."""
    year = int(now[:4])
    leagues = [info["league"] for info in seasons.TRACKED.values()]
    for y in (year, year + 1):
        try:
            rows = leaguepedia.cargo_query(
                session, tables="Tournaments", fields=seasons.TOURNAMENT_FIELDS,
                where=f'Year="{y}" AND ' + leaguepedia.in_clause("League", leagues), order_by="DateStart,OverviewPage")
        except leaguepedia.LeaguepediaError as error:
            print(f"discovery {y}: skipped ({error})")
            continue
        seasons.write_discovery(seasons.discovery_file(RAW_DIR, y), rows, now)
        print(f"discovery {y}: {len(seasons.group_tournaments(rows))} tournaments")


def main() -> None:
    now = utc_now_iso()
    session = leaguepedia.make_session()
    discover(session, now)
    known = {t["id"]: t for t in seasons.known_tournaments(RAW_DIR, now[:10])}
    for tid, full in targets(list(known.values()), now[:10]):
        fetch_tournament(session, known[tid], now, full)

    # Imágenes (logos que falten y versión de Data Dragon). Si falla, los datos ya quedaron guardados
    try:
        assets.main(session)
    except Exception as error:  # noqa: BLE001 — una imagen nunca debe frenar la actualización
        print(f"assets: skipped ({error})")


if __name__ == "__main__":
    main()
