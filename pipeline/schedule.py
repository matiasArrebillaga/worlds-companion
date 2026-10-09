"""Convierte filas crudas de MatchSchedule (Leaguepedia) al formato de schedule.json."""
from datetime import datetime, timezone

UNDECIDED_TEAM = "TBD"
KNOCKOUT_WORDS = ("quarterfinal", "semifinal", "final")
WINNERS = {"1": "team1", "2": "team2"}

MATCH_KEYS = frozenset({
    "id", "phase", "round", "best_of", "start_utc", "date",
    "team1", "team2", "score", "winner", "status",
})


def parse_start(row: dict) -> tuple[str | None, str | None]:
    """Devuelve (start_utc ISO, fecha 'YYYY-MM-DD').

    Si Leaguepedia marca que la hora no está confirmada (HasTime = "0"),
    se devuelve solo la fecha: nunca se inventa una hora.
    """
    raw = (row.get("DateTimeUTC") or "").strip()
    if not raw:
        return None, None
    moment = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    date = moment.date().isoformat()
    if row.get("HasTime") == "0":
        return None, date
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ"), date


def phase_of(row: dict) -> str:
    if row.get("OverviewPage", "").endswith("Play-In"):
        return "play-in"
    text = f"{row.get('Tab', '')} {row.get('Round', '')}".lower()
    if any(word in text for word in KNOCKOUT_WORDS):
        return "knockout"
    return "swiss"


def _score(value: str | None) -> int:
    return int(value) if value else 0


def status_of(row: dict) -> str:
    if row.get("Winner") in WINNERS:
        return "finished"
    # Serie empezada pero sin ganador: solo pasa en Bo3/Bo5
    if _score(row.get("Team1Score")) + _score(row.get("Team2Score")) > 0:
        return "live"
    return "upcoming"


def _team(name: str | None, shorts: dict[str, str]) -> dict | None:
    if not name or name == UNDECIDED_TEAM:
        return None
    return {"name": name, "short": shorts.get(name) or name}


def to_match(row: dict, shorts: dict[str, str]) -> dict:
    start_utc, date = parse_start(row)
    status = status_of(row)
    score = None if status == "upcoming" else [_score(row.get("Team1Score")), _score(row.get("Team2Score"))]
    return {
        "id": row["MatchId"],
        "phase": phase_of(row),
        "round": (row.get("Tab") or row.get("Round") or "").strip(),
        "best_of": int(row["BestOf"]) if row.get("BestOf") else 1,
        "start_utc": start_utc,
        "date": date,
        "team1": _team(row.get("Team1"), shorts),
        "team2": _team(row.get("Team2"), shorts),
        "score": score,
        "winner": WINNERS.get(row.get("Winner") or ""),
        "status": status,
    }


def _sort_key(match: dict) -> tuple:
    # Primero por día; dentro del día, los que tienen hora antes que los "a confirmar"
    day = match["date"] or "9999-12-31"
    time = match["start_utc"] or "~"
    return (day, time, match["id"])


def build_schedule(rows: list[dict], shorts: dict[str, str]) -> list[dict]:
    matches = [to_match(r, shorts) for r in rows if r.get("IsNullified") != "1"]
    return sorted(matches, key=_sort_key)
