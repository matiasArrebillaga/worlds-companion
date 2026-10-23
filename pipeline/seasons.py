"""Qué ligas e internacionales sigue el sitio, cómo se agrupan en torneos y en qué estado está cada uno.

Un torneo es una página de Leaguepedia (OverviewPage) en las ligas, o el evento completo en los internacionales
(Worlds tiene una página para el Play-In y otra para el Main Event).
"""
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from pipeline import utc_now_iso

# Id de liga → nombre en el campo League de Leaguepedia (los mismos de LEAGUE_REGIONS en pipeline/history.py),
# sigla, región (color del rombito) e id de la API de lolesports
TRACKED: dict[str, dict] = {
    "lck": {"league": "LoL Champions Korea", "short": "LCK", "region": "KR", "international": False,
            "lolesports_id": "98767991310872058"},
    "lpl": {"league": "Tencent LoL Pro League", "short": "LPL", "region": "CN", "international": False,
            "lolesports_id": "98767991314006698"},
    "lec": {"league": "LoL EMEA Championship", "short": "LEC", "region": "EU", "international": False,
            "lolesports_id": "98767991302996019"},
    "lcs": {"league": "League of Legends Championship Series", "short": "LCS", "region": "NA", "international": False,
            "lolesports_id": "98767991299243165"},
    "fst": {"league": "First Stand", "short": "FST", "region": None, "international": True,
            "lolesports_id": "113464388705111224"},
    "msi": {"league": "Mid-Season Invitational", "short": "MSI", "region": None, "international": True,
            "lolesports_id": "98767991325878492"},
    "worlds": {"league": "World Championship", "short": "WORLDS", "region": None, "international": True,
               "lolesports_id": "98767975604431411"},
}
LEAGUE_IDS = {info["league"]: league_id for league_id, info in TRACKED.items()}

# Un torneo está "activo" desde 2 días antes de empezar hasta 2 días después de terminar
# (cubre husos horarios y los resultados que Leaguepedia carga tarde)
ACTIVE_MARGIN = timedelta(days=2)

# Worlds 2026: el torneo que el sitio sigue hoy. Se usa si todavía no hay descubrimiento guardado.
# La página es el prefijo común de Play-In y Main Event (fetch usa LIKE "<página>%")
WORLDS_2026 = {"id": "worlds-2026", "league": "worlds", "name": "Worlds 2026", "year": 2026,
               "pages": ["2026 Season World Championship"], "is_playoffs": False,
               "start": "2026-10-14", "end": "2026-11-15"}


def slug(text: str) -> str:
    """'LCK/2027 Season/Rounds 1-2' → 'lck-2027-season-rounds-1-2'."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _keep(r: dict) -> bool:
    """Solo ligas seguidas, nivel principal y sin clasificatorios (salvo los de Worlds: el Play-In figura así)."""
    league_id = LEAGUE_IDS.get(r.get("League", ""))
    if league_id is None or r.get("TournamentLevel") != "Primary":
        return False
    return r.get("IsQualifier") != "1" or league_id == "worlds"


def group_tournaments(rows: list[dict]) -> list[dict]:
    """Filas de Tournaments → torneos, ordenados por fecha de inicio (los sin fecha al final)."""
    by_id: dict[str, dict] = {}
    for r in rows:
        if not _keep(r):
            continue
        league_id = LEAGUE_IDS[r["League"]]
        year = int(r["Year"])
        international = TRACKED[league_id]["international"]
        # Internacional: un torneo por evento y año. Liga: uno por página.
        tid = f"{league_id}-{year}" if international else slug(r["OverviewPage"])
        start, end = r.get("DateStart") or None, r.get("Date") or None
        t = by_id.setdefault(tid, {
            "id": tid, "league": league_id, "year": year, "pages": [], "is_playoffs": r.get("IsPlayoffs") == "1",
            "name": f"{TRACKED[league_id]['short']} {year}" if international else (r.get("Name") or r["OverviewPage"]),
            "start": start, "end": end,
        })
        if r["OverviewPage"] not in t["pages"]:
            t["pages"].append(r["OverviewPage"])
        # El evento va del primer inicio al último fin de sus páginas
        if start and (t["start"] is None or start < t["start"]):
            t["start"] = start
        if end and (t["end"] is None or end > t["end"]):
            t["end"] = end
    for t in by_id.values():
        t["pages"].sort()
    return sorted(by_id.values(), key=lambda t: (t["start"] is None, t["start"] or "", t["id"]))


def status(tournament: dict, today: str) -> str:
    """'upcoming' | 'active' | 'finished' según las fechas de Leaguepedia (today en YYYY-MM-DD)."""
    if not tournament["start"]:
        return "upcoming"  # anunciado sin fecha todavía
    day = date.fromisoformat(today)
    if day < date.fromisoformat(tournament["start"]) - ACTIVE_MARGIN:
        return "upcoming"
    end = tournament["end"] or tournament["start"]
    return "active" if day <= date.fromisoformat(end) + ACTIVE_MARGIN else "finished"


def tournament_dir(raw_dir: Path, tournament_id: str) -> Path:
    """Carpeta de los datos crudos de un torneo."""
    return raw_dir / tournament_id


# Archivos crudos de cada torneo (dentro de data/raw/<torneo>/), con {fetched_at, rows}
RAW_FILES = {
    "matches": "matches.json",               # MatchSchedule
    "teams": "teams.json",                   # Teams (nombre y sigla)
    "games": "games.json",                   # ScoreboardGames
    "game_players": "game_players.json",     # ScoreboardPlayers
    "rosters": "rosters.json",               # TournamentRosters
    "schedule_games": "schedule_games.json", # MatchScheduleGame (lado y ganador de cada partida)
    "lolesports": "lolesports_games.json",   # stats en vivo de lolesports
}


def raw_file(raw_dir: Path, tournament_id: str, key: str) -> Path:
    return tournament_dir(raw_dir, tournament_id) / RAW_FILES[key]


TOURNAMENT_FIELDS = "Name,OverviewPage,League,Year,DateStart,Date,IsPlayoffs,TournamentLevel,IsQualifier"


def discovery_file(raw_dir: Path, year: int) -> Path:
    return raw_dir / f"tournaments_{year}.json"


def write_discovery(path: Path, rows: list[dict], now: str) -> None:
    """Guarda el descubrimiento siempre, aunque no cambie: el commit diario evita que GitHub apague el cron
    (lo hace en repos públicos tras 60 días sin actividad)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"fetched_at": now, "rows": rows}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def known_tournaments(raw_dir: Path, today: str) -> list[dict]:
    """Worlds 2026 + los torneos descubiertos del año de `today` y del siguiente."""
    year = int(today[:4])
    rows = []
    for y in (year, year + 1):
        path = discovery_file(raw_dir, y)
        if path.exists():
            rows += json.loads(path.read_text(encoding="utf-8"))["rows"]
    found = [t for t in group_tournaments(rows) if t["id"] != WORLDS_2026["id"]]
    # Las páginas de Worlds 2026 descubiertas se agrupan como "worlds-2026": se usa la constante, que ya tiene caché
    return [WORLDS_2026] + found


def has_dated_match(raw_dir: Path, tournament_id: str) -> bool:
    """¿El torneo tiene al menos un partido con fecha cargada? (los "a confirmar" no cuentan)"""
    path = raw_file(raw_dir, tournament_id, "matches")
    if not path.exists():
        return False
    return any(r.get("DateTimeUTC") for r in json.loads(path.read_text(encoding="utf-8"))["rows"])


def site_mode(tournaments: list[dict], raw_dir: Path) -> str:
    """'season' desde que algún torneo de 2027 en adelante tiene un partido con fecha; si no, 'worlds-2026'."""
    started = any(t["year"] >= 2027 and has_dated_match(raw_dir, t["id"]) for t in tournaments)
    return "season" if started else "worlds-2026"


def index_payload(raw_dir: Path, today: str, now: str) -> dict:
    """Contrato de web/public/data/index.json: modo del sitio, ligas y torneos con su estado."""
    tournaments = known_tournaments(raw_dir, today)
    mode = site_mode(tournaments, raw_dir)
    listed = [{"id": t["id"], "league": t["league"], "name": t["name"], "status": status(t, today),
               "is_playoffs": t["is_playoffs"], "start": t["start"], "end": t["end"]} for t in tournaments]
    # Por ahora el sitio abre siempre en Worlds 2026; el Plan 4 elige el torneo por defecto en modo "season"
    return {
        "updated_at": now, "mode": mode, "default": WORLDS_2026["id"],
        "leagues": [{"id": lid, "short": info["short"], "region": info["region"], "international": info["international"]}
                    for lid, info in TRACKED.items()],
        "tournaments": listed,
    }


def match_times(raw_dir: Path, today: str) -> list[datetime]:
    """Horarios confirmados (HasTime=1) de los partidos de los torneos que no terminaron."""
    times = []
    for t in known_tournaments(raw_dir, today):
        path = raw_file(raw_dir, t["id"], "matches")
        if status(t, today) == "finished" or not path.exists():
            continue
        for r in json.loads(path.read_text(encoding="utf-8"))["rows"]:
            if r.get("DateTimeUTC") and r.get("HasTime") == "1":
                times.append(datetime.strptime(r["DateTimeUTC"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc))
    return sorted(times)


def in_match_window(times: list[datetime], now: datetime, before: timedelta = timedelta(hours=6),
                    after: timedelta = timedelta(hours=24)) -> bool:
    """¿Hay un partido que empezó hace menos de 6 h o empieza dentro de 24 h? (la cadena de 30 min sigue)"""
    return any(now - before <= t <= now + after for t in times)


def main() -> None:
    if "--match-window" in sys.argv:
        now_iso = utc_now_iso()
        now = datetime.strptime(now_iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        busy = in_match_window(match_times(Path("data/raw"), now_iso[:10]), now)
        print("match window: yes" if busy else "match window: no")
        sys.exit(0 if busy else 1)


if __name__ == "__main__":
    main()
