# Etapa 1 — Calendario en línea: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sitio en GitHub Pages con el panel "Hoy" y el Calendario (lista por día) de Worlds 2026, alimentado cada hora desde Leaguepedia.

**Architecture:** `python -m pipeline.fetch` descarga el calendario de Leaguepedia a `data/raw/` (solo reescribe si cambió); `python -m pipeline.build` lo transforma, valida y escribe `web/public/data/schedule.json` y `meta.json`. Un frontend Vite + TypeScript sin framework lee solo esos JSON. GitHub Actions corre todo cada hora durante Worlds y despliega a Pages.

**Tech Stack:** Python ≥3.12 (requests, pytest), Vite 5 + TypeScript 5 + Vitest 2, GitHub Actions, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-09-worlds-companion-design.md` (sección 10, etapa 1). Leer también `CLAUDE.md`.

## Global Constraints

- Python: `requires-python >=3.12` (local hay 3.14, CI usa 3.12). Sin pandas en esta etapa (no hace falta).
- Código, nombres y commits en inglés (Conventional Commits). Comentarios en español. Interfaz en español.
- El frontend nunca llama APIs externas; solo lee `web/public/data/*.json`.
- Fechas en UTC ISO 8601 (`2026-10-15T18:00:00Z`). Sin hora confirmada → `start_utc: null`, la UI muestra "a confirmar", nunca una hora inventada.
- Zona horaria: la del navegador; si no se detecta, `America/Argentina/Buenos_Aires`.
- Leaguepedia: el rate limit llega como `{"error":{"code":"ratelimited"}}` dentro de un HTTP 200. Reintentos con backoff exponencial (10 s, 20 s, 40 s, 80 s); al quinto fallo, error.
- Guardar `fetched_at` junto a cada archivo de `data/raw/`. `data/raw/` se commitea; `data/processed/` y `web/public/data/*.json` no.
- Colores solo vía variables CSS en `:root` (paleta del spec, rojo coral `#E8784F`). Nunca información solo con color (V/D con letra).
- Footer en todas las páginas con el aviso legal textual del spec + atribución a Leaguepedia (CC-BY-SA).
- Solo modo oscuro. Respetar `prefers-reduced-motion`.
- Todo texto que venga de datos se inserta escapado (`escapeHtml`).
- Modo aprendizaje (CLAUDE.md): esta etapa no tiene análisis estadístico, así que solo resúmenes breves.

## Review Focus

1. **Partido sin horario confirmado** (`HasTime = "0"` o sin fecha): debe verse "a confirmar" y agruparse bajo su fecha o bajo "Fecha a confirmar", nunca a las 00:00. → tests en Task 3 y Task 6.
2. **Equipos "TBD" en eliminatorias** (cruces sin definir): deben mostrarse como "Por definir" y no romper la validación. → tests en Task 3 y Task 4.
3. **Leaguepedia rechaza el acceso** (rate limit persistente o login inválido): el job falla sin desplegar y el sitio sigue con la última versión buena. → tests en Task 1; workflow en Task 9.
4. **Nombres con comillas o caracteres HTML** (en el `where` de Cargo y en la UI): deben escaparse. → tests en Task 2 y Task 6.
5. **Partidos cerca de medianoche UTC**: un partido a las 02:00 UTC cae el día anterior en Buenos Aires y debe agruparse ahí. → test en Task 6.

---

## File Structure

```
.gitignore
requirements.txt
pyproject.toml                       # solo configuración de pytest
pipeline/__init__.py                 # utc_now_iso()
pipeline/leaguepedia.py              # cliente Cargo: login opcional, rate limit, paginado
pipeline/fetch.py                    # descarga a data/raw/ (python -m pipeline.fetch)
pipeline/schedule.py                 # filas crudas → partidos del contrato
pipeline/validate.py                 # chequeos de cordura de schedule
pipeline/build.py                    # data/raw → web/public/data (python -m pipeline.build)
tests/fixtures/worlds_2026_matches_sample.json   # filas reales grabadas en Task 1
tests/test_leaguepedia.py, test_fetch.py, test_schedule.py, test_validate.py, test_build.py
web/package.json, tsconfig.json, vite.config.ts, index.html
web/src/main.ts                      # arranque, carga de datos, router por hash
web/src/types.ts                     # contrato de datos
web/src/data.ts                      # fetch de los JSON
web/src/html.ts                      # escapeHtml
web/src/format.ts                    # horas, días, "hace X", rondas, cuenta regresiva
web/src/schedule.ts                  # agrupar por día, partido destacado, resultados
web/src/styles.css                   # tokens y componentes (de la guía visual)
web/src/views/matchCard.ts, today.ts, calendar.ts, layout.ts
web/src/*.test.ts                    # vitest
.github/workflows/ci.yml, update.yml
```

---

### Task 1: Cliente de Leaguepedia + verificación de acceso

**Files:**
- Create: `.gitignore`, `requirements.txt`, `pyproject.toml`, `pipeline/__init__.py`, `pipeline/leaguepedia.py`
- Test: `tests/test_leaguepedia.py`
- Create (desde datos reales): `tests/fixtures/worlds_2026_matches_sample.json`

**Interfaces:**
- Produces:
  - `pipeline.utc_now_iso() -> str` (ej. `"2026-10-09T21:03:00Z"`)
  - `pipeline.leaguepedia.make_session() -> requests.Session` (login si existen `LEAGUEPEDIA_USER` y `LEAGUEPEDIA_BOT_PASSWORD`)
  - `pipeline.leaguepedia.cargo_query(session, *, tables: str, fields: str, where: str = "", order_by: str = "", sleep=time.sleep) -> list[dict[str, str]]`
  - `pipeline.leaguepedia.LeaguepediaError`, `RateLimited(LeaguepediaError)`

- [ ] **Step 1: Crear archivos de proyecto**

`.gitignore`:
```gitignore
.venv/
__pycache__/
.pytest_cache/
data/processed/
web/node_modules/
web/dist/
web/public/data/*.json
```

`requirements.txt`:
```
requests==2.32.3
pytest==8.3.3
```

`pyproject.toml`:
```toml
[project]
name = "worlds-companion"
version = "0.1.0"
requires-python = ">=3.12"

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

`pipeline/__init__.py`:
```python
"""Pipeline de datos de Worlds Companion."""
from datetime import datetime, timezone


def utc_now_iso() -> str:
    """Hora actual en UTC, formato ISO 8601 con Z."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
```

Entorno (Git Bash en Windows):
```bash
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
```

- [ ] **Step 2: Escribir los tests que fallan**

`tests/test_leaguepedia.py`:
```python
import pytest

from pipeline import leaguepedia


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


class FakeSession:
    """Sesión falsa: devuelve las respuestas en orden y guarda los parámetros."""

    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append(params)
        return FakeResponse(self.payloads.pop(0))


RATE_LIMITED = {"error": {"code": "ratelimited", "info": "You've exceeded your rate limit."}}


def page(*rows):
    return {"cargoquery": [{"title": row} for row in rows]}


def test_returns_rows_from_title():
    session = FakeSession([page({"Team1": "T1"}, {"Team1": "G2"})])
    rows = leaguepedia.cargo_query(session, tables="MatchSchedule", fields="Team1")
    assert rows == [{"Team1": "T1"}, {"Team1": "G2"}]
    assert session.calls[0]["action"] == "cargoquery"


def test_retries_rate_limit_with_backoff():
    sleeps = []
    session = FakeSession([RATE_LIMITED, RATE_LIMITED, page({"Team1": "T1"})])
    rows = leaguepedia.cargo_query(session, tables="T", fields="F", sleep=sleeps.append)
    assert rows == [{"Team1": "T1"}]
    assert sleeps == [10, 20]


def test_gives_up_after_five_rate_limits():
    sleeps = []
    session = FakeSession([RATE_LIMITED] * 5)
    with pytest.raises(leaguepedia.RateLimited):
        leaguepedia.cargo_query(session, tables="T", fields="F", sleep=sleeps.append)
    assert sleeps == [10, 20, 40, 80]


def test_other_api_errors_fail_immediately():
    session = FakeSession([{"error": {"code": "badquery", "info": "bad"}}])
    with pytest.raises(leaguepedia.LeaguepediaError, match="badquery"):
        leaguepedia.cargo_query(session, tables="T", fields="F", sleep=lambda s: None)


def test_paginates_until_short_page(monkeypatch):
    monkeypatch.setattr(leaguepedia, "PAGE_SIZE", 2)
    session = FakeSession([page({"n": "1"}, {"n": "2"}), page({"n": "3"})])
    rows = leaguepedia.cargo_query(session, tables="T", fields="F")
    assert [r["n"] for r in rows] == ["1", "2", "3"]
    assert [c["offset"] for c in session.calls] == [0, 2]


def test_login_failure_raises(monkeypatch):
    class LoginSession(FakeSession):
        def post(self, url, data=None, timeout=None):
            return FakeResponse({"login": {"result": "Failed", "reason": "wrong password"}})

    session = LoginSession([{"query": {"tokens": {"logintoken": "abc+\\"}}}])
    with pytest.raises(leaguepedia.LeaguepediaError, match="login failed"):
        leaguepedia.login(session, "User@bot", "secret")
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `pytest tests/test_leaguepedia.py -v`
Expected: FAIL con `ModuleNotFoundError` / `AttributeError` (no existe `pipeline.leaguepedia`).

- [ ] **Step 4: Implementar**

`pipeline/leaguepedia.py`:
```python
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
```

- [ ] **Step 5: Correr los tests**

Run: `pytest tests/test_leaguepedia.py -v`
Expected: 6 passed.

- [ ] **Step 6: Verificar acceso real (requiere al usuario)**

Las consultas anónimas devolvieron `ratelimited` de forma sostenida el 2026-10-09. Pedirle al usuario:
1. Crear (o usar) una cuenta de Fandom e iniciar sesión.
2. Ir a `https://lol.fandom.com/wiki/Special:BotPasswords`, crear un bot llamado `worldscompanion` con los permisos "Basic rights" y, si aparece, "High-volume (bot) access".
3. Pasar el usuario (`Nombre@worldscompanion`) y la contraseña generada, o exportarlos él mismo:
   `export LEAGUEPEDIA_USER='Nombre@worldscompanion'` y `export LEAGUEPEDIA_BOT_PASSWORD='...'`

Luego correr:
```bash
mkdir -p tests/fixtures
python - <<'EOF'
import json
from pipeline import leaguepedia
session = leaguepedia.make_session()
rows = leaguepedia.cargo_query(
    session,
    tables="MatchSchedule",
    fields="MatchId,OverviewPage,Tab,Round,Phase,BestOf,Team1,Team2,Team1Score,Team2Score,Winner,DateTime_UTC=DateTimeUTC,HasTime,IsNullified",
    where='OverviewPage LIKE "2026 Season World Championship%"',
    order_by="DateTime_UTC",
)
print(len(rows))
print(sorted({r["OverviewPage"] for r in rows}))
print(sorted({(r["Tab"], r["Round"]) for r in rows}))
json.dump(rows[:40], open("tests/fixtures/worlds_2026_matches_sample.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
EOF
```
Expected: más de 0 filas, sin `RateLimited`. Si sigue fallando con login: **detener el plan** y avisar al usuario (hay que revisar la fuente de datos en el spec).

Anotar en el reporte de la tarea: los valores reales de `OverviewPage`, `Tab`/`Round`, el formato de `DateTimeUTC`, los valores de `Winner`, `HasTime`, `IsNullified` y cómo aparece un equipo sin definir (se espera `"TBD"`). **Si difieren de lo asumido en Task 3, los tests de Task 3 se ajustan a estos datos reales.**

Si Leaguepedia todavía no tiene partidos de Worlds 2026, repetir con `2025 Season World Championship%` para grabar la muestra (mismo formato) y dejarlo anotado.

- [ ] **Step 7: Commit**

```bash
git add .gitignore requirements.txt pyproject.toml pipeline/__init__.py pipeline/leaguepedia.py tests/test_leaguepedia.py tests/fixtures/worlds_2026_matches_sample.json
git commit -m "feat: add Leaguepedia Cargo client with rate-limit retries"
```

---

### Task 2: Descarga a `data/raw/`

**Files:**
- Create: `pipeline/fetch.py`
- Test: `tests/test_fetch.py`

**Interfaces:**
- Consumes: `make_session`, `cargo_query` (Task 1), `utc_now_iso`.
- Produces:
  - Archivos `data/raw/worlds_2026_matches.json` y `data/raw/worlds_2026_teams.json`, ambos `{"fetched_at": str, "rows": list[dict]}`.
  - Filas de partidos con claves: `MatchId, OverviewPage, Tab, Round, Phase, BestOf, Team1, Team2, Team1Score, Team2Score, Winner, DateTimeUTC, HasTime, IsNullified`.
  - Filas de equipos con claves: `Name, Short`.
  - `team_names(matches) -> list[str]`, `teams_where(names) -> str`, `write_if_changed(path, rows, now) -> bool`, `read_rows(path) -> list[dict]`.

- [ ] **Step 1: Tests que fallan**

`tests/test_fetch.py`:
```python
import json

from pipeline import fetch


def test_team_names_skips_tbd_and_blanks_and_dedupes():
    matches = [
        {"Team1": "T1", "Team2": "G2 Esports"},
        {"Team1": "T1", "Team2": "TBD"},
        {"Team1": "", "Team2": "Gen.G"},
    ]
    assert fetch.team_names(matches) == ["G2 Esports", "Gen.G", "T1"]


def test_teams_where_escapes_quotes():
    assert fetch.teams_where(["T1", 'Team "Q"']) == 'Name IN ("T1","Team \\"Q\\"")'


def test_write_if_changed_writes_then_skips_identical(tmp_path):
    path = tmp_path / "raw" / "x.json"
    assert fetch.write_if_changed(path, [{"a": "1"}], "2026-10-15T10:00:00Z") is True
    assert fetch.write_if_changed(path, [{"a": "1"}], "2026-10-15T11:00:00Z") is False
    saved = json.loads(path.read_text(encoding="utf-8"))
    # Si no cambió nada, se conserva la fecha de la descarga original
    assert saved == {"fetched_at": "2026-10-15T10:00:00Z", "rows": [{"a": "1"}]}


def test_write_if_changed_rewrites_on_change(tmp_path):
    path = tmp_path / "x.json"
    fetch.write_if_changed(path, [{"a": "1"}], "2026-10-15T10:00:00Z")
    assert fetch.write_if_changed(path, [{"a": "2"}], "2026-10-15T11:00:00Z") is True
    assert json.loads(path.read_text(encoding="utf-8"))["fetched_at"] == "2026-10-15T11:00:00Z"


def test_read_rows_missing_file_is_empty(tmp_path):
    assert fetch.read_rows(tmp_path / "nope.json") == []
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pytest tests/test_fetch.py -v`
Expected: FAIL (`pipeline.fetch` no existe).

- [ ] **Step 3: Implementar**

`pipeline/fetch.py`:
```python
"""Descarga el calendario de Worlds 2026 a data/raw/.

Uso: python -m pipeline.fetch
Solo reescribe un archivo si los datos cambiaron, para no ensuciar el historial de git.
"""
import json
from pathlib import Path

from pipeline import leaguepedia, utc_now_iso

RAW_DIR = Path("data/raw")
MATCHES_FILE = RAW_DIR / "worlds_2026_matches.json"
TEAMS_FILE = RAW_DIR / "worlds_2026_teams.json"
TOURNAMENT_PREFIX = "2026 Season World Championship"

# DateTime_UTC se renombra para que la clave no venga con espacios ("DateTime UTC")
MATCH_FIELDS = ",".join([
    "MatchId", "OverviewPage", "Tab", "Round", "Phase", "BestOf",
    "Team1", "Team2", "Team1Score", "Team2Score", "Winner",
    "DateTime_UTC=DateTimeUTC", "HasTime", "IsNullified",
])
TEAM_FIELDS = "Name,Short"
UNDECIDED_TEAM = "TBD"


def team_names(matches: list[dict]) -> list[str]:
    """Nombres de equipo únicos y ordenados, sin vacíos ni 'TBD'."""
    names = {m.get(key, "") for m in matches for key in ("Team1", "Team2")}
    return sorted(n for n in names if n and n != UNDECIDED_TEAM)


def teams_where(names: list[str]) -> str:
    """Cláusula WHERE de Cargo con los nombres entre comillas (escapadas)."""
    quoted = ",".join('"' + n.replace('"', '\\"') + '"' for n in names)
    return f"Name IN ({quoted})"


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
        order_by="DateTime_UTC",
    )
    changed = write_if_changed(MATCHES_FILE, matches, now)
    print(f"matches: {len(matches)} ({'updated' if changed else 'unchanged'})")

    # Solo se piden los equipos que todavía no están en caché
    cached = read_rows(TEAMS_FILE)
    known = {t["Name"] for t in cached}
    missing = [n for n in team_names(matches) if n not in known]
    if missing:
        fetched = leaguepedia.cargo_query(session, tables="Teams", fields=TEAM_FIELDS, where=teams_where(missing))
        teams = sorted(cached + fetched, key=lambda t: t["Name"])
        write_if_changed(TEAMS_FILE, teams, now)
    print(f"teams: {len(known) + len(missing)} ({len(missing)} new)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Correr los tests**

Run: `pytest tests/test_fetch.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/fetch.py tests/test_fetch.py
git commit -m "feat: fetch Worlds 2026 schedule and teams into data/raw"
```

---

### Task 3: Transformar filas crudas a partidos

**Files:**
- Create: `pipeline/schedule.py`
- Test: `tests/test_schedule.py`

**Interfaces:**
- Consumes: filas crudas de Task 2 (claves listadas ahí).
- Produces: `build_schedule(rows: list[dict], shorts: dict[str, str]) -> list[dict]`. Cada partido tiene **exactamente** estas claves (contrato con `web/src/types.ts`):
  - `id: str`, `phase: "play-in"|"swiss"|"knockout"`, `round: str` (texto crudo, ej. `"Round 3"`), `best_of: int`
  - `start_utc: str | None` (`"2026-10-15T18:00:00Z"`), `date: str | None` (`"2026-10-15"`)
  - `team1`, `team2`: `{"name": str, "short": str} | None`
  - `score: [int, int] | None`, `winner: "team1"|"team2"|None`, `status: "upcoming"|"live"|"finished"`
- También exporta `MATCH_KEYS: frozenset[str]` con esas claves.

> Los valores asumidos abajo (`"2026 Season World Championship/Play-In"`, `Tab` = `"Round 1"`/`"Quarterfinals"`, `Winner` = `"1"`/`"2"`, `DateTimeUTC` = `"YYYY-MM-DD HH:MM:SS"`, `"TBD"`) deben coincidir con lo anotado en Task 1, Step 6. Si no coinciden, ajustar los tests a los datos reales antes de implementar.

- [ ] **Step 1: Tests que fallan**

`tests/test_schedule.py`:
```python
import json
from pathlib import Path

from pipeline.schedule import MATCH_KEYS, build_schedule, parse_start, phase_of, status_of

SHORTS = {"T1": "T1", "G2 Esports": "G2", "Gen.G": "GEN"}


def row(**overrides):
    base = {
        "MatchId": "WC2026_R1_1",
        "OverviewPage": "2026 Season World Championship/Main Event",
        "Tab": "Round 1",
        "Round": "1",
        "Phase": "",
        "BestOf": "1",
        "Team1": "T1",
        "Team2": "G2 Esports",
        "Team1Score": "",
        "Team2Score": "",
        "Winner": "",
        "DateTimeUTC": "2026-10-23 17:00:00",
        "HasTime": "1",
        "IsNullified": "",
    }
    return {**base, **overrides}


def test_parse_start_with_time():
    assert parse_start(row()) == ("2026-10-23T17:00:00Z", "2026-10-23")


def test_parse_start_without_confirmed_time_keeps_only_date():
    assert parse_start(row(HasTime="0")) == (None, "2026-10-23")


def test_parse_start_without_date():
    assert parse_start(row(DateTimeUTC="")) == (None, None)


def test_phase_of():
    assert phase_of(row(OverviewPage="2026 Season World Championship/Play-In")) == "play-in"
    assert phase_of(row()) == "swiss"
    assert phase_of(row(Tab="Quarterfinals")) == "knockout"
    assert phase_of(row(Tab="Semifinals")) == "knockout"
    assert phase_of(row(Tab="Finals")) == "knockout"


def test_status_of():
    assert status_of(row()) == "upcoming"
    assert status_of(row(BestOf="3", Team1Score="1", Team2Score="1")) == "live"
    assert status_of(row(Team1Score="1", Team2Score="0", Winner="1")) == "finished"


def test_finished_match_shape():
    [match] = build_schedule([row(Team1Score="1", Team2Score="0", Winner="1")], SHORTS)
    assert set(match) == MATCH_KEYS
    assert match == {
        "id": "WC2026_R1_1",
        "phase": "swiss",
        "round": "Round 1",
        "best_of": 1,
        "start_utc": "2026-10-23T17:00:00Z",
        "date": "2026-10-23",
        "team1": {"name": "T1", "short": "T1"},
        "team2": {"name": "G2 Esports", "short": "G2"},
        "score": [1, 0],
        "winner": "team1",
        "status": "finished",
    }


def test_upcoming_match_has_no_score():
    [match] = build_schedule([row()], SHORTS)
    assert match["score"] is None
    assert match["winner"] is None


def test_tbd_team_becomes_none():
    [match] = build_schedule([row(Tab="Finals", Team2="TBD")], SHORTS)
    assert match["team2"] is None


def test_unknown_short_falls_back_to_name():
    [match] = build_schedule([row(Team2="New Team")], SHORTS)
    assert match["team2"] == {"name": "New Team", "short": "New Team"}


def test_nullified_matches_are_dropped():
    assert build_schedule([row(IsNullified="1")], SHORTS) == []


def test_sorted_by_time_with_unconfirmed_last_within_day():
    rows = [
        row(MatchId="b", DateTimeUTC="2026-10-23 20:00:00"),
        row(MatchId="c", DateTimeUTC="2026-10-23 00:00:00", HasTime="0"),
        row(MatchId="a", DateTimeUTC="2026-10-23 17:00:00"),
    ]
    assert [m["id"] for m in build_schedule(rows, SHORTS)] == ["a", "b", "c"]


def test_real_sample_rows_transform():
    # Filas reales grabadas en Task 1: tienen que transformarse sin errores
    sample = json.loads(Path("tests/fixtures/worlds_2026_matches_sample.json").read_text(encoding="utf-8"))
    matches = build_schedule(sample, {})
    assert matches
    assert all(set(m) == MATCH_KEYS for m in matches)
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pytest tests/test_schedule.py -v`
Expected: FAIL (`pipeline.schedule` no existe).

- [ ] **Step 3: Implementar**

`pipeline/schedule.py`:
```python
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
```

- [ ] **Step 4: Correr los tests**

Run: `pytest tests/test_schedule.py -v`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/schedule.py tests/test_schedule.py
git commit -m "feat: transform Leaguepedia rows into schedule matches"
```

---

### Task 4: Validación y build de los JSON del sitio

**Files:**
- Create: `pipeline/validate.py`, `pipeline/build.py`
- Test: `tests/test_validate.py`, `tests/test_build.py`

**Interfaces:**
- Consumes: `build_schedule`, `MATCH_KEYS` (Task 3); archivos crudos de Task 2; `utc_now_iso`.
- Produces:
  - `validate_schedule(matches: list[dict]) -> list[str]` (lista de errores; vacía = OK)
  - `build(raw_dir: Path, out_dir: Path, now: str) -> None` (lanza `ValueError` si la validación falla)
  - `web/public/data/schedule.json`: `{"matches": [Match, ...]}`
  - `web/public/data/meta.json`: `{"updated_at": str, "source_fetched_at": str, "match_count": int}`

- [ ] **Step 1: Tests que fallan**

`tests/test_validate.py`:
```python
from pipeline.validate import validate_schedule


def match(**overrides):
    base = {
        "id": "m1", "phase": "swiss", "round": "Round 1", "best_of": 1,
        "start_utc": "2026-10-23T17:00:00Z", "date": "2026-10-23",
        "team1": {"name": "T1", "short": "T1"}, "team2": {"name": "G2 Esports", "short": "G2"},
        "score": None, "winner": None, "status": "upcoming",
    }
    return {**base, **overrides}


def test_valid_schedule_has_no_errors():
    assert validate_schedule([match(), match(id="m2")]) == []


def test_empty_schedule_is_an_error():
    assert validate_schedule([]) == ["schedule is empty"]


def test_duplicate_ids():
    assert "duplicate match id: m1" in validate_schedule([match(), match()])


def test_missing_keys():
    broken = match()
    del broken["status"]
    assert any("missing keys" in e for e in validate_schedule([broken]))


def test_bad_phase_and_status():
    errors = validate_schedule([match(phase="groups", status="done")])
    assert "m1: invalid phase 'groups'" in errors
    assert "m1: invalid status 'done'" in errors


def test_finished_without_winner():
    assert "m1: finished without winner" in validate_schedule([match(status="finished", score=[1, 0])])


def test_team_cannot_play_itself():
    assert "m1: team plays itself" in validate_schedule([match(team2={"name": "T1", "short": "T1"})])


def test_undecided_teams_are_allowed():
    assert validate_schedule([match(team1=None, team2=None)]) == []
```

`tests/test_build.py`:
```python
import json

import pytest

from pipeline.build import build
from pipeline.schedule import MATCH_KEYS


def write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


ROW = {
    "MatchId": "m1", "OverviewPage": "2026 Season World Championship/Play-In", "Tab": "Round 1",
    "Round": "1", "Phase": "", "BestOf": "3", "Team1": "T1", "Team2": "G2 Esports",
    "Team1Score": "", "Team2Score": "", "Winner": "", "DateTimeUTC": "2026-10-15 18:00:00",
    "HasTime": "1", "IsNullified": "",
}


def test_build_writes_contract_files(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "out"
    write(raw / "worlds_2026_matches.json", {"fetched_at": "2026-10-15T10:00:00Z", "rows": [ROW]})
    write(raw / "worlds_2026_teams.json", {"fetched_at": "2026-10-15T10:00:00Z", "rows": [{"Name": "G2 Esports", "Short": "G2"}]})

    build(raw, out, "2026-10-15T11:00:00Z")

    schedule = json.loads((out / "schedule.json").read_text(encoding="utf-8"))
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    assert set(schedule) == {"matches"}
    assert set(schedule["matches"][0]) == MATCH_KEYS
    assert schedule["matches"][0]["team2"]["short"] == "G2"
    assert meta == {"updated_at": "2026-10-15T11:00:00Z", "source_fetched_at": "2026-10-15T10:00:00Z", "match_count": 1}


def test_build_works_without_teams_file(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "out"
    write(raw / "worlds_2026_matches.json", {"fetched_at": "2026-10-15T10:00:00Z", "rows": [ROW]})
    build(raw, out, "2026-10-15T11:00:00Z")
    assert (out / "schedule.json").exists()


def test_build_refuses_invalid_data_and_writes_nothing(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "out"
    write(raw / "worlds_2026_matches.json", {"fetched_at": "2026-10-15T10:00:00Z", "rows": []})
    with pytest.raises(ValueError, match="schedule is empty"):
        build(raw, out, "2026-10-15T11:00:00Z")
    assert not (out / "schedule.json").exists()
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pytest tests/test_validate.py tests/test_build.py -v`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar**

`pipeline/validate.py`:
```python
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
```

`pipeline/build.py`:
```python
"""Genera los JSON del sitio a partir de data/raw/.

Uso: python -m pipeline.build
"""
import json
import sys
from pathlib import Path

from pipeline import utc_now_iso
from pipeline.schedule import build_schedule
from pipeline.validate import validate_schedule

RAW_DIR = Path("data/raw")
OUT_DIR = Path("web/public/data")


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def build(raw_dir: Path, out_dir: Path, now: str) -> None:
    matches_raw = _read(raw_dir / "worlds_2026_matches.json")
    teams_path = raw_dir / "worlds_2026_teams.json"
    teams = _read(teams_path)["rows"] if teams_path.exists() else []
    shorts = {t["Name"]: t.get("Short") or t["Name"] for t in teams}

    schedule = build_schedule(matches_raw["rows"], shorts)
    errors = validate_schedule(schedule)
    if errors:
        raise ValueError("validation failed:\n- " + "\n- ".join(errors))

    out_dir.mkdir(parents=True, exist_ok=True)
    _write(out_dir / "schedule.json", {"matches": schedule})
    _write(out_dir / "meta.json", {
        "updated_at": now,
        "source_fetched_at": matches_raw["fetched_at"],
        "match_count": len(schedule),
    })


def main() -> None:
    try:
        build(RAW_DIR, OUT_DIR, utc_now_iso())
    except ValueError as error:
        sys.exit(str(error))
    print(f"wrote {OUT_DIR}/schedule.json and meta.json")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Correr toda la suite**

Run: `pytest -v`
Expected: todo pasa (6 + 5 + 12 + 8 + 3 = 34 tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/validate.py pipeline/build.py tests/test_validate.py tests/test_build.py
git commit -m "feat: validate schedule and export site JSON"
```

---

### Task 5: Corrida real del pipeline

**Files:**
- Create (generado): `data/raw/worlds_2026_matches.json`, `data/raw/worlds_2026_teams.json`

- [ ] **Step 1: Correr fetch + build con credenciales**

```bash
python -m pipeline.fetch
python -m pipeline.build
```
Expected: `matches: N (updated)`, `teams: M (M new)`, `wrote web/public/data/schedule.json and meta.json`.

- [ ] **Step 2: Inspeccionar la salida**

```bash
python - <<'EOF'
import json, collections
s = json.load(open("web/public/data/schedule.json", encoding="utf-8"))["matches"]
print(collections.Counter(m["phase"] for m in s))
print(collections.Counter(m["status"] for m in s))
print(sum(m["start_utc"] is None for m in s), "sin hora")
print(sorted({m["round"] for m in s}))
print([m["team1"] for m in s][:5])
EOF
```
Expected: las fases tienen sentido (Play-In ~ partidos del 15–18/10, swiss después, knockout desde el 3/11). Si algo se clasifica mal, corregir `phase_of` con un test nuevo en `tests/test_schedule.py` que reproduzca la fila real, y volver a correr.

- [ ] **Step 3: Commit de los datos crudos**

```bash
git add data/raw
git commit -m "data: initial Worlds 2026 schedule snapshot"
```

---

### Task 6: Proyecto web + lógica pura (formato y calendario)

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/src/vite-env.d.ts`, `web/src/types.ts`, `web/src/html.ts`, `web/src/format.ts`, `web/src/schedule.ts`
- Test: `web/src/html.test.ts`, `web/src/format.test.ts`, `web/src/schedule.test.ts`

**Interfaces:**
- Consumes: contrato de `schedule.json` / `meta.json` (Task 4).
- Produces:
  - `types.ts`: `Phase`, `MatchStatus`, `Team`, `Match`, `Schedule`, `Meta`
  - `html.ts`: `escapeHtml(value: string): string`
  - `format.ts`: `FALLBACK_TZ`, `resolveTimeZone(): string`, `formatTime(startUtc: string | null, tz: string): string`, `formatDateTimeLong(startUtc: string, tz: string): string`, `localDayKey(iso: string, tz: string): string`, `formatDayHeading(dayKey: string): string`, `relativeTime(fromIso: string, now: Date): string`, `isStale(updatedAt: string, now: Date, matchDay: boolean): boolean`, `roundLabel(raw: string): string`, `PHASE_LABELS: Record<Phase, string>`, `countdownParts(ms: number): { h: number; m: number; s: number }`, `pad2(n: number): string`
  - `schedule.ts`: `dayKeyOf(m: Match, tz: string): string | null`, `groupByDay(matches: Match[], tz: string): DayGroup[]` con `DayGroup = { day: string | null; matches: Match[] }`, `featuredMatch(matches: Match[], now: Date): Match | null`, `recentResults(matches: Match[], limit: number): Match[]`

- [ ] **Step 1: Crear el proyecto**

`web/package.json`:
```json
{
  "name": "worlds-companion-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "preview": "vite preview"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vite": "5.4.10",
    "vitest": "2.1.4"
  }
}
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`web/vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Rutas relativas: funciona en GitHub Pages sin saber el nombre del repo
  base: './',
  test: { environment: 'node' },
});
```

`web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

Run: `cd web && npm install` (genera `package-lock.json`).

`web/src/types.ts`:
```ts
// Contrato de datos: debe coincidir con pipeline/schedule.py (MATCH_KEYS) y pipeline/build.py
export type Phase = 'play-in' | 'swiss' | 'knockout';
export type MatchStatus = 'upcoming' | 'live' | 'finished';

export interface Team {
  name: string;
  short: string;
}

export interface Match {
  id: string;
  phase: Phase;
  round: string;
  best_of: number;
  start_utc: string | null;
  date: string | null;
  team1: Team | null;
  team2: Team | null;
  score: [number, number] | null;
  winner: 'team1' | 'team2' | null;
  status: MatchStatus;
}

export interface Schedule {
  matches: Match[];
}

export interface Meta {
  updated_at: string;
  source_fetched_at: string;
  match_count: number;
}
```

- [ ] **Step 2: Tests que fallan**

`web/src/html.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<b>"T1" & 'G2'</b>`)).toBe('&lt;b&gt;&quot;T1&quot; &amp; &#39;G2&#39;&lt;/b&gt;');
  });
});
```

`web/src/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  countdownParts, formatDayHeading, formatTime, isStale, localDayKey, relativeTime, roundLabel,
} from './format';

const BA = 'America/Argentina/Buenos_Aires';

describe('formatTime', () => {
  it('shows local time', () => {
    expect(formatTime('2026-10-24T17:00:00Z', BA)).toBe('14:00');
  });
  it('never invents a time', () => {
    expect(formatTime(null, BA)).toBe('a confirmar');
  });
});

describe('localDayKey', () => {
  it('moves late UTC matches to the previous local day', () => {
    expect(localDayKey('2026-10-24T02:00:00Z', BA)).toBe('2026-10-23');
    expect(localDayKey('2026-10-24T17:00:00Z', BA)).toBe('2026-10-24');
  });
});

describe('formatDayHeading', () => {
  it('formats in Spanish', () => {
    const text = formatDayHeading('2026-10-24');
    expect(text).toContain('24');
    expect(text.toLowerCase()).toContain('octubre');
    expect(text.toLowerCase()).toContain('sábado');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-10-24T18:00:00Z');
  it('handles minutes, hours and days', () => {
    expect(relativeTime('2026-10-24T17:59:40Z', now)).toBe('hace un momento');
    expect(relativeTime('2026-10-24T17:42:00Z', now)).toBe('hace 18 min');
    expect(relativeTime('2026-10-24T15:00:00Z', now)).toBe('hace 3 h');
    expect(relativeTime('2026-10-23T12:00:00Z', now)).toBe('hace 1 día');
    expect(relativeTime('2026-10-21T12:00:00Z', now)).toBe('hace 3 días');
  });
});

describe('isStale', () => {
  const now = new Date('2026-10-24T18:00:00Z');
  it('only warns on match days after 3 hours', () => {
    expect(isStale('2026-10-24T14:00:00Z', now, true)).toBe(true);
    expect(isStale('2026-10-24T16:00:00Z', now, true)).toBe(false);
    expect(isStale('2026-10-24T14:00:00Z', now, false)).toBe(false);
  });
});

describe('roundLabel', () => {
  it('translates known rounds', () => {
    expect(roundLabel('Round 3')).toBe('Ronda 3');
    expect(roundLabel('Quarterfinals')).toBe('Cuartos de final');
    expect(roundLabel('Semifinals')).toBe('Semifinales');
    expect(roundLabel('Finals')).toBe('Final');
    expect(roundLabel('Tiebreaker')).toBe('Tiebreaker');
  });
});

describe('countdownParts', () => {
  it('splits milliseconds and never goes negative', () => {
    expect(countdownParts((2 * 3600 + 14 * 60 + 36) * 1000)).toEqual({ h: 2, m: 14, s: 36 });
    expect(countdownParts(-5000)).toEqual({ h: 0, m: 0, s: 0 });
  });
});
```

`web/src/schedule.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { featuredMatch, groupByDay, recentResults } from './schedule';
import type { Match } from './types';

const BA = 'America/Argentina/Buenos_Aires';

function match(overrides: Partial<Match>): Match {
  return {
    id: 'm', phase: 'swiss', round: 'Round 1', best_of: 1,
    start_utc: '2026-10-24T17:00:00Z', date: '2026-10-24',
    team1: { name: 'T1', short: 'T1' }, team2: { name: 'G2 Esports', short: 'G2' },
    score: null, winner: null, status: 'upcoming',
    ...overrides,
  };
}

describe('groupByDay', () => {
  it('groups by local day and puts undated matches last', () => {
    const groups = groupByDay([
      match({ id: 'late', start_utc: '2026-10-24T02:00:00Z', date: '2026-10-24' }),
      match({ id: 'a', start_utc: '2026-10-24T17:00:00Z' }),
      match({ id: 'tbc', start_utc: null, date: '2026-10-25' }),
      match({ id: 'nodate', start_utc: null, date: null }),
    ], BA);
    expect(groups.map((g) => [g.day, g.matches.map((m) => m.id)])).toEqual([
      ['2026-10-23', ['late']],
      ['2026-10-24', ['a']],
      ['2026-10-25', ['tbc']],
      [null, ['nodate']],
    ]);
  });
});

describe('featuredMatch', () => {
  const now = new Date('2026-10-24T16:00:00Z');
  it('prefers a live series', () => {
    const live = match({ id: 'live', status: 'live', score: [1, 1] });
    expect(featuredMatch([match({ id: 'next' }), live], now)?.id).toBe('live');
  });
  it('otherwise picks the next upcoming match with a time', () => {
    const past = match({ id: 'past', start_utc: '2026-10-24T10:00:00Z' });
    const tbc = match({ id: 'tbc', start_utc: null });
    const next = match({ id: 'next', start_utc: '2026-10-24T17:00:00Z' });
    expect(featuredMatch([past, tbc, next], now)?.id).toBe('next');
  });
  it('returns null when nothing is coming', () => {
    expect(featuredMatch([], now)).toBeNull();
  });
});

describe('recentResults', () => {
  it('returns the latest finished matches first', () => {
    const results = recentResults([
      match({ id: 'old', status: 'finished', winner: 'team1', start_utc: '2026-10-23T17:00:00Z' }),
      match({ id: 'new', status: 'finished', winner: 'team2', start_utc: '2026-10-24T17:00:00Z' }),
      match({ id: 'up' }),
    ], 5);
    expect(results.map((m) => m.id)).toEqual(['new', 'old']);
  });
});
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `cd web && npm test`
Expected: FAIL (módulos `./html`, `./format`, `./schedule` no existen).

- [ ] **Step 4: Implementar**

`web/src/html.ts`:
```ts
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Todo texto que viene de los datos pasa por acá antes de ir a innerHTML
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}
```

`web/src/format.ts`:
```ts
import type { Phase } from './types';

export const FALLBACK_TZ = 'America/Argentina/Buenos_Aires';
const LOCALE = 'es-AR';
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export const PHASE_LABELS: Record<Phase, string> = {
  'play-in': 'Play-In',
  swiss: 'Fase suiza',
  knockout: 'Eliminatorias',
};

const ROUND_NAMES: Record<string, string> = {
  quarterfinals: 'Cuartos de final',
  semifinals: 'Semifinales',
  finals: 'Final',
  final: 'Final',
};

// Zona horaria del navegador; si no se puede detectar, Buenos Aires
export function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}

export function formatTime(startUtc: string | null, tz: string): string {
  if (!startUtc) return 'a confirmar';
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })
    .format(new Date(startUtc));
}

export function formatDateTimeLong(startUtc: string, tz: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZoneName: 'short', timeZone: tz,
  }).format(new Date(startUtc));
}

// "YYYY-MM-DD" del día local (en-CA formatea justo así)
export function localDayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz })
    .format(new Date(iso));
}

// dayKey ya es una fecha de calendario: se formatea al mediodía UTC para que no se corra de día
export function formatDayHeading(dayKey: string): string {
  return new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${dayKey}T12:00:00Z`));
}

export function relativeTime(fromIso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(fromIso).getTime()) / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

export function isStale(updatedAt: string, now: Date, matchDay: boolean): boolean {
  return matchDay && now.getTime() - new Date(updatedAt).getTime() > STALE_AFTER_MS;
}

export function roundLabel(raw: string): string {
  const text = raw.trim();
  const round = /^round\s+(\d+)$/i.exec(text);
  if (round) return `Ronda ${round[1]}`;
  return ROUND_NAMES[text.toLowerCase()] ?? text;
}

export function countdownParts(ms: number): { h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
```

`web/src/schedule.ts`:
```ts
import { localDayKey } from './format';
import type { Match } from './types';

export interface DayGroup {
  day: string | null;
  matches: Match[];
}

// Día local del partido; si no tiene hora confirmada se usa la fecha del calendario
export function dayKeyOf(m: Match, tz: string): string | null {
  return m.start_utc ? localDayKey(m.start_utc, tz) : m.date;
}

export function groupByDay(matches: Match[], tz: string): DayGroup[] {
  const byDay = new Map<string | null, Match[]>();
  for (const m of matches) {
    const key = dayKeyOf(m, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), m]);
  }
  return [...byDay.entries()]
    .map(([day, list]) => ({ day, matches: list }))
    .sort((a, b) => (a.day ?? '9999').localeCompare(b.day ?? '9999'));
}

// Una serie en curso tiene prioridad; si no, el próximo partido con hora confirmada
export function featuredMatch(matches: Match[], now: Date): Match | null {
  const live = matches.find((m) => m.status === 'live');
  if (live) return live;
  return matches.find((m) => m.status === 'upcoming' && m.start_utc !== null && new Date(m.start_utc) >= now) ?? null;
}

export function recentResults(matches: Match[], limit: number): Match[] {
  return matches
    .filter((m) => m.status === 'finished')
    .sort((a, b) => (b.start_utc ?? b.date ?? '').localeCompare(a.start_utc ?? a.date ?? ''))
    .slice(0, limit);
}
```

- [ ] **Step 5: Correr los tests**

Run: `cd web && npm test`
Expected: todos pasan.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts web/src
git commit -m "feat: add web project with date formatting and schedule helpers"
```

---

### Task 7: Estilos, layout y vista "Hoy"

**Files:**
- Create: `web/index.html`, `web/src/styles.css`, `web/src/data.ts`, `web/src/views/layout.ts`, `web/src/views/matchCard.ts`, `web/src/views/today.ts`, `web/src/main.ts`

**Interfaces:**
- Consumes: todo lo de Task 6.
- Produces:
  - `data.ts`: `loadData(): Promise<SiteData>` con `SiteData = { schedule: Schedule; meta: Meta }`
  - `views/layout.ts`: `setActiveTab(hash: string): void`, `renderUpdated(meta: Meta, now: Date, matchDay: boolean): void`
  - `views/matchCard.ts`: `matchCard(m: Match, tz: string): string`
  - `views/today.ts`: `renderToday(el: HTMLElement, matches: Match[], tz: string): () => void` (devuelve función de limpieza)
  - Convención de vistas: `(el, matches, tz) => cleanup`

- [ ] **Step 1: `web/index.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <title>Worlds Companion</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
  </head>
  <body>
    <header class="topbar">
      <a class="wordmark" href="#/" aria-label="Worlds Companion, ir a Hoy"><span class="hexmark" aria-hidden="true"></span>Worlds Companion</a>
      <nav class="tabs" aria-label="Secciones">
        <a class="tab" href="#/calendario" data-tab="#/calendario">Calendario</a>
      </nav>
      <div class="updated" id="updated" aria-live="polite"></div>
    </header>

    <main id="view" class="app"></main>

    <footer class="site-footer">
      <div class="rule" aria-hidden="true"><i></i></div>
      <p>Worlds Companion no está respaldado por Riot Games y no refleja las opiniones de Riot Games ni de nadie involucrado oficialmente en la producción o gestión de League of Legends. League of Legends y Riot Games son marcas registradas de Riot Games, Inc.</p>
      <p>Datos: <a href="https://lol.fandom.com" target="_blank" rel="noopener">Leaguepedia</a> (CC-BY-SA). Proyecto personal sin fines de lucro.</p>
    </footer>

    <nav class="bottombar" aria-label="Secciones">
      <a href="#/" data-tab="#/">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><path d="M12 9l2.6 1.5v3L12 15l-2.6-1.5v-3z"/></svg>Hoy
      </a>
      <a href="#/calendario" data-tab="#/calendario">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>Calendario
      </a>
    </nav>

    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: `web/src/styles.css`** (tokens y componentes de la guía visual, versión "sutil", rojo coral)

```css
:root {
  color-scheme: dark;
  --bg: #0A0E1A;
  --sunken: #070A13;
  --card: #131A2B;
  --raised: #1A2338;
  --line: #24304A;
  --line-ctl: #56658A;
  --fg: #E8ECF4;
  --fg2: #8A95AD;
  --gold: #C8A24A;
  --gold-soft: rgba(200, 162, 74, .13);
  --cyan: #3FC1C9;
  --cyan-soft: rgba(63, 193, 201, .12);
  --win: #4CAF7A;
  --loss: #E0565B;
  --blue: #4A8FE7;
  --blue-soft: rgba(74, 143, 231, .16);
  --red: #E8784F;
  --red-soft: rgba(232, 120, 79, .16);
  --bezel-a: rgba(200, 162, 74, .22);
  --bezel-b: rgba(63, 193, 201, .12);
  --f-display: "Saira Condensed", "Arial Narrow", sans-serif;
  --f-body: "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif;
  --f-data: "JetBrains Mono", ui-monospace, Consolas, monospace;
  --cut: 12px;
  --ease: cubic-bezier(.32, .72, 0, 1);
}

* { box-sizing: border-box; }
html, body { background: var(--bg); color: var(--fg); margin: 0; }
body {
  font-family: var(--f-body);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));
}
body::before {
  content: "";
  position: fixed; inset: 0;
  pointer-events: none;
  opacity: .12;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cpath fill='%2324304A' d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/svg%3E");
  -webkit-mask-image: radial-gradient(ellipse 70% 50% at 50% 0%, #000 0%, transparent 75%);
          mask-image: radial-gradient(ellipse 70% 50% at 50% 0%, #000 0%, transparent 75%);
}
a { color: inherit; }
a:focus-visible, button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }

.app { max-width: 1180px; margin: 0 auto; padding: 24px 16px 48px; display: grid; gap: 40px; position: relative; }

h1, h2, h3 { font-family: var(--f-display); font-weight: 600; text-transform: uppercase; letter-spacing: .02em; margin: 0; text-wrap: balance; }
h1 { font-size: clamp(2rem, 6vw, 3rem); line-height: 1; }
h2 { font-size: 1.3rem; line-height: 1.1; }
.eyebrow { font: 500 11px/1 var(--f-data); letter-spacing: .2em; text-transform: uppercase; color: var(--gold); display: inline-flex; align-items: center; gap: 10px; }
.eyebrow::before { content: ""; width: 7px; height: 7px; background: var(--gold); transform: rotate(45deg); }
.label { font: 500 10.5px/1.3 var(--f-data); letter-spacing: .16em; text-transform: uppercase; color: var(--fg2); }
.muted { color: var(--fg2); }
.stack { display: grid; gap: 14px; align-content: start; }
.grid { display: grid; gap: 16px; }
.g2 { grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); }
.g3 { grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); }

.rule { display: flex; align-items: center; gap: 12px; }
.rule::before, .rule::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, transparent, var(--line) 30%, var(--gold) 100%); }
.rule::after { transform: scaleX(-1); }
.rule i { width: 8px; height: 8px; border: 1px solid var(--gold); transform: rotate(45deg); }

/* Doble bisel: cáscara con degradé tenue + núcleo, ambos con esquina cortada */
.bezel {
  --c: var(--cut);
  padding: 1px;
  background: linear-gradient(135deg, var(--bezel-a), var(--line) 28%, var(--line) 72%, var(--bezel-b));
  clip-path: polygon(var(--c) 0, 100% 0, 100% calc(100% - var(--c)), calc(100% - var(--c)) 100%, 0 100%, 0 var(--c));
}
.bezel.live { background: linear-gradient(135deg, var(--cyan), var(--line) 35%, var(--line) 65%, var(--cyan)); }
.core {
  background: var(--card);
  clip-path: polygon(var(--c) 0, 100% 0, 100% calc(100% - var(--c)), calc(100% - var(--c)) 100%, 0 100%, 0 var(--c));
  box-shadow: inset 0 1px 0 rgba(232, 236, 244, .06);
  padding: 18px;
  height: 100%;
  min-width: 0;
}

/* Barra superior (desktop) */
.topbar {
  position: sticky; top: env(safe-area-inset-top, 0px); z-index: 10;
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  max-width: 1180px; margin: 12px auto 0; padding: 10px 18px;
  background: rgba(19, 26, 43, .82); backdrop-filter: blur(12px);
  border: 1px solid var(--line);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
}
.wordmark { font: 700 18px/1 var(--f-display); letter-spacing: .12em; text-transform: uppercase; text-decoration: none; display: flex; align-items: center; gap: 10px; }
.hexmark { width: 20px; height: 22px; background: var(--gold); clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); display: grid; place-items: center; }
.hexmark::after { content: ""; width: 11px; height: 12px; background: var(--card); clip-path: inherit; }
.tabs { display: flex; gap: 4px; }
.tab { font: 600 14px/1 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--fg2); text-decoration: none; padding: 10px 12px; position: relative; transition: color .3s var(--ease); }
.tab::after { content: ""; position: absolute; left: 12px; right: 12px; bottom: 2px; height: 2px; background: var(--gold); transform: scaleX(0); transform-origin: left; transition: transform .45s var(--ease); }
.tab:hover, .tab[aria-current="page"] { color: var(--fg); }
.tab[aria-current="page"]::after { transform: scaleX(1); }
.updated { display: flex; gap: 8px; align-items: center; font: 12px var(--f-data); color: var(--fg2); }
.updated.stale { color: var(--gold); }

/* Barra inferior (celular) */
.bottombar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
  display: grid; grid-template-columns: repeat(2, 1fr);
  background: var(--card); border-top: 1px solid var(--line);
  padding: 8px 4px calc(10px + env(safe-area-inset-bottom, 0px));
}
.bottombar a { display: grid; justify-items: center; gap: 4px; font: 500 10px/1 var(--f-data); letter-spacing: .04em; text-transform: uppercase; color: var(--fg2); text-decoration: none; }
.bottombar a[aria-current="page"] { color: var(--gold); }
.ico { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
@media (max-width: 859px) { .topbar .tabs { display: none; } .topbar { margin: 0; border-left: 0; border-right: 0; clip-path: none; } }
@media (min-width: 860px) { .bottombar { display: none; } body { padding-bottom: 0; } }

/* Chips y estados */
.pill { font: 600 11px/1 var(--f-data); letter-spacing: .1em; text-transform: uppercase; padding: 6px 9px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); color: var(--fg2); }
.pill.gold { color: var(--gold); background: var(--gold-soft); border-color: transparent; }
.pill.cyan { color: var(--cyan); background: var(--cyan-soft); border-color: transparent; }
.res { font: 700 12px/1 var(--f-data); width: 24px; height: 24px; display: inline-grid; place-items: center; flex: none; }
.res.w { color: var(--bg); background: var(--win); }
.res.l { color: var(--loss); border: 1px solid var(--loss); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--cyan); animation: pulse 2.4s var(--ease) infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(63,193,201,.6); } 70% { box-shadow: 0 0 0 8px rgba(63,193,201,0); } 100% { box-shadow: 0 0 0 0 rgba(63,193,201,0); } }

/* Tarjeta de partido */
.match { display: grid; gap: 14px; }
.match-head { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; align-items: center; }
.teams { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; }
.team { display: flex; gap: 10px; align-items: center; min-width: 0; }
.team.r { justify-content: flex-end; text-align: right; }
.team.lost { opacity: .5; }
.tag { font: 700 1.6rem/1 var(--f-display); text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag.tbd { font-size: 1rem; color: var(--fg2); }
.vs { font: 600 12px/1 var(--f-data); color: var(--fg2); letter-spacing: .14em; }
.score { font: 700 1.8rem/1 var(--f-display); font-variant-numeric: tabular-nums; }
.foot { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font: 12px var(--f-data); color: var(--fg2); }

/* Hoy */
.feature .core { padding: 24px; display: grid; gap: 20px; background:
  radial-gradient(120% 90% at 0% 0%, var(--blue-soft), transparent 55%),
  radial-gradient(120% 90% at 100% 100%, var(--red-soft), transparent 55%), var(--card); }
.feature .tag { font-size: clamp(2.2rem, 8vw, 3.4rem); }
.countdown { display: flex; gap: 18px; justify-content: center; }
.countdown div { display: grid; justify-items: center; }
.countdown b { font: 500 1.6rem/1 var(--f-data); font-variant-numeric: tabular-nums; }
.row { display: grid; grid-template-columns: 54px 1fr auto; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); font-size: 14px; }
.row:first-of-type { border-top: 0; }
.row .t { font: 12px var(--f-data); color: var(--fg2); }
.row .m { font: 600 1.05rem/1.2 var(--f-display); letter-spacing: .04em; text-transform: uppercase; min-width: 0; }
.num { font-family: var(--f-data); font-variant-numeric: tabular-nums; }

/* Calendario */
.seg { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--line-ctl); justify-self: start; }
.seg button { font: 500 12px/1 var(--f-data); letter-spacing: .08em; text-transform: uppercase; color: var(--fg2); background: transparent; border: 0; padding: 10px 12px; cursor: pointer; transition: color .25s var(--ease), background .25s var(--ease); }
.seg button[aria-pressed="true"] { color: var(--bg); background: var(--gold); }
.day { display: grid; gap: 12px; }
.day-title { font: 600 1.1rem/1 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--fg2); }
.day.today .day-title { color: var(--gold); }

/* Estados vacíos, carga y error */
.state { border: 1px dashed var(--line-ctl); padding: 20px; color: var(--fg2); display: grid; gap: 6px; }
.state b { color: var(--fg); font-weight: 600; }
.state.error { border-color: var(--loss); }

.site-footer { max-width: 1180px; margin: 0 auto; padding: 24px 16px 32px; display: grid; gap: 10px; font-size: 12px; color: var(--fg2); }
.site-footer p { margin: 0; max-width: 90ch; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 3: `web/src/data.ts`**

```ts
import type { Meta, Schedule } from './types';

export interface SiteData {
  schedule: Schedule;
  meta: Meta;
}

async function getJson<T>(file: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function loadData(): Promise<SiteData> {
  const [schedule, meta] = await Promise.all([getJson<Schedule>('schedule.json'), getJson<Meta>('meta.json')]);
  return { schedule, meta };
}
```

- [ ] **Step 4: `web/src/views/layout.ts`**

```ts
import { relativeTime, isStale } from '../format';
import { escapeHtml } from '../html';
import type { Meta } from '../types';

// Marca la pestaña activa en la barra superior y en la inferior
export function setActiveTab(hash: string): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-tab]').forEach((link) => {
    if (link.dataset.tab === hash) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

// "Actualizado hace X": siempre visible, en dorado si los datos están atrasados en día de partido
export function renderUpdated(meta: Meta, now: Date, matchDay: boolean): void {
  const el = document.getElementById('updated');
  if (!el) return;
  const stale = isStale(meta.updated_at, now, matchDay);
  el.classList.toggle('stale', stale);
  const text = `Actualizado ${relativeTime(meta.updated_at, now)}`;
  el.innerHTML = stale
    ? `${escapeHtml(text)} · puede estar atrasado`
    : `<span class="dot" aria-hidden="true"></span>${escapeHtml(text)}`;
}
```

- [ ] **Step 5: `web/src/views/matchCard.ts`**

```ts
import { formatTime, PHASE_LABELS, roundLabel } from '../format';
import { escapeHtml } from '../html';
import type { Match } from '../types';

type Side = 'team1' | 'team2';

function result(m: Match, side: Side): string {
  if (!m.winner) return '';
  return m.winner === side
    ? '<span class="res w" title="Victoria">V</span>'
    : '<span class="res l" title="Derrota">D</span>';
}

function teamSide(m: Match, side: Side): string {
  const team = m[side];
  const name = team
    ? `<span class="tag" title="${escapeHtml(team.name)}">${escapeHtml(team.short)}</span>`
    : '<span class="tag tbd">Por definir</span>';
  const lost = m.winner && m.winner !== side ? ' lost' : '';
  const cls = side === 'team2' ? `team r${lost}` : `team${lost}`;
  // El resultado (V/D) va del lado de afuera de cada equipo
  return side === 'team1'
    ? `<div class="${cls}">${result(m, side)}${name}</div>`
    : `<div class="${cls}">${name}${result(m, side)}</div>`;
}

function head(m: Match, time: string): string {
  if (m.status === 'live') return '<span class="pill cyan"><span class="dot" aria-hidden="true"></span>Serie en curso</span>';
  if (m.status === 'finished') return '<span class="pill">Finalizado</span>';
  return `<span class="pill">${escapeHtml(time)}</span>`;
}

export function matchCard(m: Match, tz: string): string {
  const time = formatTime(m.start_utc, tz);
  const middle = m.score ? `<span class="score">${m.score[0]}–${m.score[1]}</span>` : '<span class="vs">VS</span>';
  const footRight = m.status === 'live' ? 'Se actualiza cada hora' : escapeHtml(time);
  return `
    <article class="bezel${m.status === 'live' ? ' live' : ''}">
      <div class="core match">
        <div class="match-head">${head(m, time)}<span class="label">${escapeHtml(roundLabel(m.round))} · Bo${m.best_of}</span></div>
        <div class="teams">${teamSide(m, 'team1')}${middle}${teamSide(m, 'team2')}</div>
        <div class="foot"><span>${PHASE_LABELS[m.phase]}</span><span>${footRight}</span></div>
      </div>
    </article>`;
}
```

- [ ] **Step 6: `web/src/views/today.ts`**

```ts
import { countdownParts, formatDateTimeLong, formatTime, localDayKey, pad2, PHASE_LABELS, roundLabel } from '../format';
import { escapeHtml } from '../html';
import { dayKeyOf, featuredMatch, recentResults } from '../schedule';
import type { Match } from '../types';
import { matchCard } from './matchCard';

function emptyState(title: string, detail: string): string {
  return `<div class="state"><b>${title}</b><span>${detail}</span></div>`;
}

function short(m: Match, side: 'team1' | 'team2'): string {
  return escapeHtml(m[side]?.short ?? 'Por definir');
}

function featureCard(m: Match, tz: string): string {
  const when = m.start_utc ? escapeHtml(formatDateTimeLong(m.start_utc, tz)) : 'Fecha a confirmar';
  const pill = m.status === 'live'
    ? '<span class="pill cyan"><span class="dot" aria-hidden="true"></span>Serie en curso</span>'
    : `<span class="pill gold">Próximo · ${PHASE_LABELS[m.phase]} · ${escapeHtml(roundLabel(m.round))}</span>`;
  const middle = m.score ? `<span class="score">${m.score[0]}–${m.score[1]}</span>` : '<span class="vs">VS</span>';
  return `
    <article class="bezel feature${m.status === 'live' ? ' live' : ''}">
      <div class="core">
        <div class="match-head">${pill}<span class="label">${when}</span></div>
        <div class="teams">
          <div class="team"><span class="tag">${short(m, 'team1')}</span></div>
          ${middle}
          <div class="team r"><span class="tag">${short(m, 'team2')}</span></div>
        </div>
        ${m.status === 'upcoming' ? '<div class="countdown" data-countdown aria-label="Cuenta regresiva"></div>' : ''}
      </div>
    </article>`;
}

function listRow(m: Match, tz: string): string {
  const label = m.status === 'finished' ? 'Final' : m.status === 'live' ? 'En curso' : formatTime(m.start_utc, tz);
  return `<div class="row"><span class="t">${escapeHtml(label)}</span><span class="m">${short(m, 'team1')} vs ${short(m, 'team2')}</span><span class="label">Bo${m.best_of}</span></div>`;
}

export function renderToday(el: HTMLElement, matches: Match[], tz: string): () => void {
  const now = new Date();
  const featured = featuredMatch(matches, now);
  const todayKey = localDayKey(now.toISOString(), tz);
  const today = matches.filter((m) => dayKeyOf(m, tz) === todayKey);
  const recent = recentResults(matches, 4);

  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Hoy</span>
      ${featured ? featureCard(featured, tz) : emptyState('No hay partidos próximos', 'Cuando Leaguepedia publique el calendario, el próximo partido aparece acá.')}
    </section>
    <div class="grid g2">
      <section class="bezel"><div class="core">
        <h2 class="label">Hoy, en tu hora</h2>
        ${today.length ? today.map((m) => listRow(m, tz)).join('') : emptyState('No hay partidos hoy', 'Mirá el calendario completo para ver los próximos días.')}
      </div></section>
      <section class="stack">
        <h2 class="label">Últimos resultados</h2>
        ${recent.length ? recent.map((m) => matchCard(m, tz)).join('') : emptyState('Sin resultados todavía', 'Aparecen acá en cuanto termine el primer partido.')}
      </section>
    </div>`;

  // Cuenta regresiva: solo para un partido próximo con hora confirmada
  const box = el.querySelector<HTMLElement>('[data-countdown]');
  if (!box || !featured?.start_utc) return () => {};
  const start = Date.parse(featured.start_utc);
  const tick = () => {
    const { h, m, s } = countdownParts(start - Date.now());
    box.innerHTML = `<div><b>${pad2(h)}</b><span class="label">h</span></div><div><b>${pad2(m)}</b><span class="label">min</span></div><div><b>${pad2(s)}</b><span class="label">s</span></div>`;
  };
  tick();
  const timer = window.setInterval(tick, 1000);
  return () => window.clearInterval(timer);
}
```

- [ ] **Step 7: `web/src/main.ts`** (Calendario se agrega en Task 8; por ahora toda ruta muestra Hoy)

```ts
import './styles.css';
import { loadData, type SiteData } from './data';
import { localDayKey, resolveTimeZone } from './format';
import { dayKeyOf } from './schedule';
import { renderUpdated, setActiveTab } from './views/layout';
import { renderToday } from './views/today';
import type { Match } from './types';

type View = (el: HTMLElement, matches: Match[], tz: string) => () => void;

const ROUTES: Record<string, View> = {
  '#/': renderToday,
};

const view = document.getElementById('view') as HTMLElement;
const tz = resolveTimeZone();
let cleanup: () => void = () => {};

function route(data: SiteData): void {
  const hash = location.hash in ROUTES ? location.hash : '#/';
  setActiveTab(hash);
  cleanup();
  cleanup = ROUTES[hash](view, data.schedule.matches, tz);
  window.scrollTo(0, 0);
}

function refreshUpdated(data: SiteData): void {
  const now = new Date();
  const todayKey = localDayKey(now.toISOString(), tz);
  const matchDay = data.schedule.matches.some((m) => dayKeyOf(m, tz) === todayKey);
  renderUpdated(data.meta, now, matchDay);
}

async function start(): Promise<void> {
  view.innerHTML = '<div class="state"><b>Cargando partidos…</b></div>';
  let data: SiteData;
  try {
    data = await loadData();
  } catch {
    view.innerHTML = '<div class="state error"><b>No se pudieron cargar los datos</b><span>Revisá tu conexión y recargá la página. Si sigue pasando, el sitio se está actualizando: probá en unos minutos.</span></div>';
    return;
  }
  refreshUpdated(data);
  window.setInterval(() => refreshUpdated(data), 60_000);
  window.addEventListener('hashchange', () => route(data));
  route(data);
}

start();
```

- [ ] **Step 8: Verificar**

Run: `cd web && npm test && npm run build`
Expected: tests pasan; `tsc` sin errores; `dist/` generado.

Con los JSON de Task 5 en `web/public/data/`: `cd web && npm run dev`, abrir la URL que imprime Vite a 390 px y a 1280 px de ancho. Verificar: panel Hoy con partido destacado o estado vacío, cuenta regresiva corriendo, "Actualizado hace X", footer con el aviso legal, barra inferior en celular y barra superior en desktop. Renombrar temporalmente `web/public/data/meta.json` y recargar: tiene que aparecer el mensaje de error, no una pantalla rota. Devolverle el nombre.

- [ ] **Step 9: Commit**

```bash
git add web/index.html web/src
git commit -m "feat: add layout, styles and Today view"
```

---

### Task 8: Vista Calendario

**Files:**
- Create: `web/src/views/calendar.ts`
- Modify: `web/src/main.ts` (agregar la ruta)

**Interfaces:**
- Consumes: `groupByDay`, `formatDayHeading`, `localDayKey`, `PHASE_LABELS`, `matchCard`.
- Produces: `renderCalendar(el: HTMLElement, matches: Match[], tz: string): () => void`

- [ ] **Step 1: Implementar `web/src/views/calendar.ts`**

```ts
import { formatDayHeading, localDayKey, PHASE_LABELS } from '../format';
import { groupByDay } from '../schedule';
import type { Match, Phase } from '../types';
import { matchCard } from './matchCard';

type Filter = Phase | 'all';
const FILTERS: Filter[] = ['all', 'play-in', 'swiss', 'knockout'];

// El filtro se recuerda mientras la página esté abierta
let current: Filter = 'all';

function filterLabel(f: Filter): string {
  return f === 'all' ? 'Todas' : PHASE_LABELS[f];
}

export function renderCalendar(el: HTMLElement, matches: Match[], tz: string): () => void {
  const visible = current === 'all' ? matches : matches.filter((m) => m.phase === current);
  const groups = groupByDay(visible, tz);
  const todayKey = localDayKey(new Date().toISOString(), tz);

  const buttons = FILTERS.map(
    (f) => `<button type="button" data-filter="${f}" aria-pressed="${f === current}">${filterLabel(f)}</button>`,
  ).join('');

  const days = groups.map((g) => `
    <section class="day${g.day === todayKey ? ' today' : ''}" ${g.day === todayKey ? 'id="hoy"' : ''}>
      <h2 class="day-title">${g.day ? formatDayHeading(g.day) : 'Fecha a confirmar'}${g.day === todayKey ? ' · hoy' : ''}</h2>
      <div class="grid g3">${g.matches.map((m) => matchCard(m, tz)).join('')}</div>
    </section>`).join('');

  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Worlds 2026</span>
      <h1>Calendario</h1>
      <p class="muted">Horarios en tu zona horaria. Los partidos sin hora confirmada dicen "a confirmar".</p>
      <div class="seg" role="group" aria-label="Filtrar por fase">${buttons}</div>
    </section>
    ${days || '<div class="state"><b>No hay partidos en esta fase todavía</b><span>Aparecen acá en cuanto Leaguepedia los publique.</span></div>'}`;

  el.querySelector('.seg')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-filter]');
    if (!button) return;
    current = button.dataset.filter as Filter;
    renderCalendar(el, matches, tz);
  });

  // Al entrar, saltar al día de hoy si está en la lista
  el.querySelector('#hoy')?.scrollIntoView({ block: 'start' });
  return () => {};
}
```

- [ ] **Step 2: Registrar la ruta en `web/src/main.ts`**

Agregar el import y la entrada en `ROUTES`:
```ts
import { renderCalendar } from './views/calendar';
```
```ts
const ROUTES: Record<string, View> = {
  '#/': renderToday,
  '#/calendario': renderCalendar,
};
```
Y en `route`, hacer el `scrollTo(0, 0)` **antes** de renderizar para que el salto a "hoy" del calendario no se pise:
```ts
function route(data: SiteData): void {
  const hash = location.hash in ROUTES ? location.hash : '#/';
  setActiveTab(hash);
  cleanup();
  window.scrollTo(0, 0);
  cleanup = ROUTES[hash](view, data.schedule.matches, tz);
}
```

- [ ] **Step 3: Verificar**

Run: `cd web && npm test && npm run build`
Expected: todo pasa.

`npm run dev` → `#/calendario`: partidos agrupados por día en hora local, filtro por fase funcionando, día de hoy en dorado, partidos sin hora con "a confirmar" en su día o bajo "Fecha a confirmar", equipos sin definir como "Por definir", tarjeta "Serie en curso" con borde cian, V/D en finalizados. Pestaña activa marcada en ambas barras.

- [ ] **Step 4: Commit**

```bash
git add web/src/views/calendar.ts web/src/main.ts
git commit -m "feat: add Calendar view with phase filter"
```

---

### Task 9: CI, actualización horaria y deploy

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/update.yml`

- [ ] **Step 1: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements.txt
      - run: pytest
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
        working-directory: web
      - run: npm test
        working-directory: web
      - run: npm run build
        working-directory: web
```

- [ ] **Step 2: `.github/workflows/update.yml`**

```yaml
name: Update data and deploy

on:
  schedule:
    # Cada hora durante Worlds 2026 (15/10 al 14/11; se extiende al 15/11 por husos horarios)
    - cron: "0 * 15-31 10 *"
    - cron: "0 * 1-15 11 *"
  workflow_dispatch:
  push:
    branches: [master]

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: update-and-deploy
  cancel-in-progress: false

jobs:
  update:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements.txt

      - name: Fetch from Leaguepedia
        run: python -m pipeline.fetch
        env:
          LEAGUEPEDIA_USER: ${{ secrets.LEAGUEPEDIA_USER }}
          LEAGUEPEDIA_BOT_PASSWORD: ${{ secrets.LEAGUEPEDIA_BOT_PASSWORD }}

      - name: Build site data (fails on invalid data, so nothing is deployed)
        run: python -m pipeline.build

      - name: Commit raw data if it changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/raw
          git diff --cached --quiet || (git commit -m "data: update Worlds 2026 raw data" && git push)

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
        working-directory: web
      - run: npm run build
        working-directory: web

      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: web/dist
      - id: deploy
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows
git commit -m "ci: add tests workflow and hourly update-and-deploy workflow"
```

- [ ] **Step 4: Publicar en GitHub (requiere al usuario; no hay `gh` CLI)**

Pedirle al usuario:
1. Crear un repo **público** vacío en GitHub (ej. `worlds-companion`), sin README.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → crear `LEAGUEPEDIA_USER` y `LEAGUEPEDIA_BOT_PASSWORD` (los de Task 1).
4. Pasar la URL del repo.

Luego:
```bash
git remote add origin <URL>
git push -u origin master
```

- [ ] **Step 5: Verificar el deploy**

En la pestaña Actions del repo: "CI" en verde y "Update data and deploy" en verde. Abrir la URL de Pages que aparece en el job: Hoy y Calendario cargan con datos reales y "Actualizado hace X" muestra minutos. Correr "Update data and deploy" a mano (Run workflow) y confirmar que, si los datos no cambiaron, **no** se crea un commit nuevo.

---

## Self-Review (hecho al escribir el plan)

- Cobertura del spec, etapa 1: fetch de Worlds ✓ (T2), `schedule.json` + `meta.json` ✓ (T4), validación que bloquea el deploy ✓ (T4, T9), `fetched_at` ✓ (T2), Hoy ✓ (T7), Calendario lista + filtro por fase ✓ (T8), "a confirmar" ✓ (T3, T6), zona horaria con fallback ✓ (T6), estados de carga/vacío/error ✓ (T7, T8), "Actualizado hace X" con advertencia ✓ (T7), footer legal ✓ (T7), cron horario + workflow_dispatch ✓ (T9), commit de `data/raw` ✓ (T9).
- Fuera de esta etapa (planes siguientes): Elo, predicciones y aviso Bo1 (etapa 2); stats, `teams.json`, `players.json`, `data/teams.csv` de alias (etapa 3); Meta, Suiza, Bracket, `regions.ts` (etapa 4).
- Desvío menor del spec: en esta etapa las siglas de equipo salen de la tabla `Teams` de Leaguepedia (cacheada) y un equipo sin sigla usa su nombre completo en vez de fallar la validación. La tabla de alias `data/teams.csv` llega en la etapa 3, cuando se cruce con el historial.
