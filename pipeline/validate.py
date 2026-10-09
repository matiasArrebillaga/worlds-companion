"""Chequeos de cordura antes de publicar. Si algo falla, no se publica nada."""
from pipeline.schedule import MATCH_KEYS

VALID_PHASES = {"play-in", "swiss", "knockout"}
VALID_STATUSES = {"upcoming", "live", "finished"}


def validate_schedule(matches: list[dict]) -> list[str]:
    """Devuelve la lista de errores encontrados (vacía si todo está bien)."""
    if not matches:
        return ["schedule is empty"]
    errors: list[str] = []
    seen: set[str] = set()
    for m in matches:
        missing = MATCH_KEYS - m.keys()
        if missing:
            errors.append(f"{m.get('id', '?')}: missing keys {sorted(missing)}")
            continue
        mid = m["id"]
        if mid in seen:
            errors.append(f"duplicate match id: {mid}")
        seen.add(mid)
        if m["phase"] not in VALID_PHASES:
            errors.append(f"{mid}: invalid phase '{m['phase']}'")
        if m["status"] not in VALID_STATUSES:
            errors.append(f"{mid}: invalid status '{m['status']}'")
        if m["status"] == "finished" and m["winner"] not in ("team1", "team2"):
            errors.append(f"{mid}: finished without winner")
        # Equipos sin definir (None) son válidos; el mismo equipo de los dos lados no
        if m["team1"] and m["team2"] and m["team1"]["name"] == m["team2"]["name"]:
            errors.append(f"{mid}: team plays itself")
    return errors
