"""Pipeline de datos de Worlds Companion."""
from datetime import datetime, timezone


def utc_now_iso() -> str:
    """Hora actual en UTC, formato ISO 8601 con Z."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
