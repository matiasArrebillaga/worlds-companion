"""Descarga el calendario de Worlds 2026 a data/raw/.

Uso: python -m pipeline.fetch
Solo reescribe un archivo si los datos cambiaron, para no ensuciar el historial de git.
"""
import json
from pathlib import Path

from pipeline import assets, leaguepedia, utc_now_iso
from pipeline.history import GAME_FIELDS
from pipeline.schedule import UNDECIDED_TEAMS

RAW_DIR = Path("data/raw")
MATCHES_FILE = RAW_DIR / "worlds_2026_matches.json"
TEAMS_FILE = RAW_DIR / "worlds_2026_teams.json"
GAMES_FILE = RAW_DIR / "worlds_2026_games.json"
ROSTERS_FILE = RAW_DIR / "worlds_2026_rosters.json"
TOURNAMENT_PREFIX = "2026 Season World Championship"

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
    """Equipos inscriptos en Worlds (sin placeholders ni repetidos)."""
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


def main() -> None:
    now = utc_now_iso()
    session = leaguepedia.make_session()

    matches = leaguepedia.cargo_query(
        session,
        tables="MatchSchedule",
        fields=MATCH_FIELDS,
        where=f'OverviewPage LIKE "{TOURNAMENT_PREFIX}%"',
        order_by="DateTime_UTC,MatchId",
    )
    changed = write_if_changed(MATCHES_FILE, matches, now)
    print(f"matches: {len(matches)} ({'updated' if changed else 'unchanged'})")

    games = leaguepedia.cargo_query(
        session, tables="ScoreboardGames", fields=GAME_FIELDS,
        where=f'OverviewPage LIKE "{TOURNAMENT_PREFIX}%"', order_by="DateTime_UTC,GameId",
    )
    changed = write_if_changed(GAMES_FILE, games, now)
    print(f"games: {len(games)} ({'updated' if changed else 'unchanged'})")

    rosters = leaguepedia.cargo_query(
        session, tables="TournamentRosters", fields="Team,OverviewPage",
        where=f'OverviewPage LIKE "{TOURNAMENT_PREFIX}%"', order_by="OverviewPage,Team",
    )
    write_if_changed(ROSTERS_FILE, rosters, now)
    print(f"participants: {len(roster_teams(rosters))}")

    # Solo se piden los equipos que todavía no están en caché
    cached = read_rows(TEAMS_FILE)
    known = {t["Name"] for t in cached}
    # Así se bajan las siglas de los inscriptos aunque los cruces sigan en TBD
    wanted = sorted(set(team_names(matches)) | set(roster_teams(rosters)))
    missing = [n for n in wanted if n not in known]
    if missing:
        fetched = leaguepedia.cargo_query(session, tables="Teams", fields=TEAM_FIELDS, where=teams_where(missing))
        teams = sorted(cached + fetched, key=lambda t: t["Name"])
        write_if_changed(TEAMS_FILE, teams, now)
    print(f"teams: {len(known) + len(missing)} ({len(missing)} new)")

    # Imágenes (logos que falten y versión de Data Dragon). Si falla, los datos ya quedaron guardados
    try:
        assets.main(session)
    except Exception as error:  # noqa: BLE001 — una imagen nunca debe frenar la actualización
        print(f"assets: skipped ({error})")


if __name__ == "__main__":
    main()
