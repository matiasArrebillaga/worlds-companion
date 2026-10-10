"""Cliente mínimo para la API Cargo de Leaguepedia (lol.fandom.com)."""
import os
import time

import requests

API_URL = "https://lol.fandom.com/api.php"
USER_AGENT = "WorldsCompanion/0.1 (personal non-commercial project)"
PAGE_SIZE = 500
MAX_ATTEMPTS = 5
BASE_DELAY_S = 10
TIMEOUT_S = 30


class LeaguepediaError(RuntimeError):
    """Error devuelto por la API de Leaguepedia."""


class RateLimited(LeaguepediaError):
    """Leaguepedia pidió esperar (rate limit)."""


def make_session() -> requests.Session:
    """Sesión con User-Agent propio; se loguea si hay credenciales en el entorno."""
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    user = os.environ.get("LEAGUEPEDIA_USER")
    password = os.environ.get("LEAGUEPEDIA_BOT_PASSWORD")
    if user and password:
        login(session, user, password)
    return session


def login(session, user: str, password: str) -> None:
    """Login con bot password (usuario con formato 'Nombre@nombre_del_bot')."""
    token_response = session.get(
        API_URL,
        params={"action": "query", "meta": "tokens", "type": "login", "format": "json"},
        timeout=TIMEOUT_S,
    ).json()
    token = token_response["query"]["tokens"]["logintoken"]
    result = session.post(
        API_URL,
        data={"action": "login", "lgname": user, "lgpassword": password, "lgtoken": token, "format": "json"},
        timeout=TIMEOUT_S,
    ).json()
    if result.get("login", {}).get("result") != "Success":
        raise LeaguepediaError(f"login failed: {result.get('login')}")


def _check(payload: dict) -> dict:
    # Leaguepedia devuelve los errores (incluido el rate limit) dentro de un HTTP 200,
    # así que hay que mirar el cuerpo, no solo el código de estado.
    error = payload.get("error")
    if not error:
        return payload
    if error.get("code") == "ratelimited":
        raise RateLimited(error.get("info", "ratelimited"))
    raise LeaguepediaError(f"{error.get('code')}: {error.get('info')}")


def _get(session, params: dict, sleep) -> dict:
    """GET con reintentos ante rate limit: espera 10 s, 20 s, 40 s, 80 s."""
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = session.get(API_URL, params=params, timeout=TIMEOUT_S)
            response.raise_for_status()
            return _check(response.json())
        except RateLimited:
            if attempt == MAX_ATTEMPTS - 1:
                raise
            sleep(BASE_DELAY_S * 2**attempt)
    raise AssertionError("unreachable")


def cargo_query(session, *, tables: str, fields: str, where: str = "", order_by: str = "", sleep=time.sleep) -> list[dict]:
    """Consulta Cargo completa (recorre todas las páginas). Cada fila es un dict de strings."""
    rows: list[dict] = []
    offset = 0
    while True:
        params = {
            "action": "cargoquery",
            "format": "json",
            "tables": tables,
            "fields": fields,
            "where": where,
            "order_by": order_by,
            "limit": PAGE_SIZE,
            "offset": offset,
        }
        payload = _get(session, params, sleep)
        page = [item["title"] for item in payload.get("cargoquery", [])]
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def in_clause(field: str, values: list[str]) -> str:
    """Cláusula WHERE de Cargo 'Campo IN ("a","b")' con las comillas escapadas."""
    quoted = ",".join('"' + v.replace('"', '\\"') + '"' for v in values)
    return f"{field} IN ({quoted})"
