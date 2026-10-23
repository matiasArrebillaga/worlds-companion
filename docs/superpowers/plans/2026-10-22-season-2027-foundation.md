# Temporada 2027 — Plan 1: base por torneo, descubrimiento y cron

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que "torneo" sea un parámetro del pipeline (en vez de Worlds 2026 fijo), que el cron descubra solo los torneos 2027 y corra todo el año, sin ningún cambio visible en el sitio.

**Architecture:** Un módulo nuevo `pipeline/seasons.py` define qué se sigue (ligas e internacionales), agrupa las filas de `Tournaments` de Leaguepedia en torneos y calcula su estado y el modo del sitio. Los datos crudos de cada torneo pasan a `data/raw/<torneo>/`. `pipeline.fetch` recorre los torneos activos; `pipeline.build` sigue construyendo Worlds 2026 y además escribe `index.json` con el modo. Los workflows dejan las fechas fijas de Worlds.

**Tech Stack:** Python 3.12, pytest, requests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-22-season-2027-design.md` (§1, §2 parcial, §5, §6 pasos 1–2)

## Hoja de ruta (planes siguientes)

Este es el plan 1 de 5. Los demás se escriben cuando existe lo que necesitan:

| Plan | Contenido (spec) | Cuándo |
|---|---|---|
| 1 (este) | Base por torneo, descubrimiento, `index.json`, cron todo el año (§1, §5, §6.1–2) | ya |
| 2 | Archivo de Worlds 2026 + prueba y adopción de `elo-3` (§3, §6.3–4) | después de la final (15/11/2026) |
| 3 | Datos multiliga: `ligas/<liga>/`, meta por parche y liga, split en curso, filtro de 2 parches (§2, §6.5); fetch con una consulta por tabla para todos los torneos activos (`OverviewPage IN (...)`) y repartir las filas por torneo (spec §2) | noviembre–diciembre 2026 |
| 4 | Frontend multiliga: selector, Calendario combinado, vistas por liga, Aciertos por liga, `?liga` (§4, §6.6) | diciembre 2026 – principios de enero 2027 (antes de la LCK Cup) |
| 5 | Bracket de playoffs de liga y formatos de First Stand / MSI (§3 Torneo, §6.7) | cuando Riot anuncie los formatos (~febrero 2027) |

## Global Constraints

- Código, nombres y commits en inglés; comentarios en español; claro y comentado antes que compacto.
- Commits chicos con Conventional Commits (`feat:`, `fix:`, `data:`, `docs:`, `test:`), **sin** trailer `Co-Authored-By`.
- Fechas en UTC ISO 8601. Guardar siempre `fetched_at` junto a los datos crudos.
- El rate limit de Leaguepedia llega como error dentro de un HTTP 200 (ya lo maneja `pipeline/leaguepedia.py`).
- `data/raw/` es la caché del cron: no editar a mano (la migración de la Task 2 es la única excepción, con `git mv`).
- El sitio tiene que quedar **idéntico**: los JSON de `web/public/data/` antes y después del plan solo pueden diferir
  en `updated_at`, y se suma `index.json`.
- Después de modificar código: `graphify update .`.

## Review Focus

1. **Cron corriendo durante la migración:** Worlds 2026 está en curso y el cron commitea `data/raw/` cada 30 minutos. Esperado: después del push, la siguiente corrida usa la carpeta nueva y ningún archivo viejo `worlds_2026_*` reaparece. Lo cubre el test de la Task 2 que falla si `fetch.py` todavía referencia nombres viejos, más el paso de verificación de la Task 5.
2. **Descubrimiento que falla o vuelve vacío** (Leaguepedia caída, rate limit agotado): esperado que el fetch siga con Worlds 2026 y con la caché de `tournaments_<año>.json`, sin borrarla. Test en la Task 3.
3. **Torneo sin fechas en Leaguepedia** (`DateStart` vacío, típico de un torneo recién anunciado): esperado que quede en `upcoming`, nunca en `active` ni que rompa. Test en la Task 1.
4. **Partido "a confirmar"** (sin `DateTimeUTC` o con `HasTime=0`) dentro de la ventana del cron: esperado que no cuente como partido con horario. Test en la Task 5.
5. **El modo no vuelve atrás:** si un torneo 2027 aparece con partidos y después Leaguepedia los saca, el modo queda en `season`. Por ahora se calcula de nuevo en cada build; el test de la Task 4 fija que un torneo 2027 con un solo partido con fecha alcanza para pasar a `season`.

---

### Task 1: `pipeline/seasons.py` — qué se sigue, torneos y estados

**Files:**
- Create: `pipeline/seasons.py`
- Test: `tests/test_seasons.py`

**Interfaces:**
- Consumes: nada de otras tasks.
- Produces:
  - `TRACKED: dict[str, dict]` — id de liga → `{"league": str, "short": str, "region": str | None, "international": bool, "lolesports_id": str | None}`.
  - `WORLDS_2026: dict` — torneo de Worlds 2026 con la misma forma que devuelve `group_tournaments`.
  - `slug(text: str) -> str`.
  - `group_tournaments(rows: list[dict]) -> list[dict]` — cada torneo: `{"id", "league", "name", "year", "pages": list[str], "is_playoffs": bool, "start": str | None, "end": str | None}` (fechas `YYYY-MM-DD`).
  - `status(tournament: dict, today: str) -> str` — `"upcoming" | "active" | "finished"`.
  - `tournament_dir(raw_dir: Path, tournament_id: str) -> Path`.

- [ ] **Step 1: Verificar los nombres de campo de Leaguepedia y los ids de lolesports**

Correr en una consola de Python (sin login alcanza para leer):

```python
from pipeline import leaguepedia
s = leaguepedia.make_session()
rows = leaguepedia.cargo_query(s, tables="Tournaments",
    fields="Name,OverviewPage,League,Year,DateStart,Date,IsPlayoffs,TournamentLevel,IsQualifier",
    where='Year="2026" AND League IN ("World Championship","LoL Champions Korea")', order_by="DateStart")
for r in rows: print(r)
```

Expected: filas con `DateStart` y `Date` (fin) como `YYYY-MM-DD` y `IsPlayoffs` `"0"`/`"1"`. Las páginas de Worlds 2026
son `2026 Season World Championship/Play-In` y `2026 Season World Championship/Main Event`. Si un campo se llama
distinto, usar el nombre real en el Step 3 y anotarlo en el commit.

Después, los ids de lolesports:

```python
import requests
from pipeline.lolesports import API_URL, _get
for l in _get(requests.Session(), f"{API_URL}/getLeagues", hl="en-US")["data"]["leagues"]:
    if l["slug"] in ("lck", "lpl", "lec", "lcs", "msi", "worlds", "first_stand"): print(l["slug"], l["id"])
```

Expected (confirmar o corregir en el Step 3): lck `98767991310872058`, lpl `98767991314006698`, lec `98767991302996019`,
lcs `98767991299243165`, msi `98767991325878492`, worlds `98767975604431411`, first_stand `113464388705111224`.

- [ ] **Step 2: Escribir los tests**

```python
# tests/test_seasons.py
from pathlib import Path

from pipeline import seasons


def row(page, league, start="2027-01-14", end="2027-02-22", playoffs="0", level="Primary", qualifier="0",
        year="2027", name=None):
    return {"Name": name or page, "OverviewPage": page, "League": league, "Year": year, "DateStart": start,
            "Date": end, "IsPlayoffs": playoffs, "TournamentLevel": level, "IsQualifier": qualifier}


def test_slug_lowercases_and_joins_with_dashes():
    assert seasons.slug("LCK/2027 Season/Rounds 1-2") == "lck-2027-season-rounds-1-2"
    assert seasons.slug("  LEC  Versus ") == "lec-versus"


def test_tracked_covers_the_four_leagues_and_three_internationals():
    assert set(seasons.TRACKED) == {"lck", "lpl", "lec", "lcs", "fst", "msi", "worlds"}
    assert seasons.TRACKED["lck"]["league"] == "LoL Champions Korea"
    assert seasons.TRACKED["worlds"]["international"] is True and seasons.TRACKED["lec"]["international"] is False


def test_group_keeps_each_league_page_as_its_own_tournament():
    out = seasons.group_tournaments([
        row("LCK/2027 Season/Rounds 1-2", "LoL Champions Korea"),
        row("LCK/2027 Season/Playoffs", "LoL Champions Korea", "2027-03-01", "2027-03-20", playoffs="1"),
    ])
    assert [(t["id"], t["league"], t["is_playoffs"]) for t in out] == [
        ("lck-2027-season-rounds-1-2", "lck", False), ("lck-2027-season-playoffs", "lck", True)]
    assert out[0]["pages"] == ["LCK/2027 Season/Rounds 1-2"]


def test_group_merges_the_pages_of_an_international_event():
    out = seasons.group_tournaments([
        row("2027 Season World Championship/Main Event", "World Championship", "2027-10-20", "2027-11-08"),
        row("2027 Season World Championship/Play-In", "World Championship", "2027-10-10", "2027-10-15"),
    ])
    [worlds] = out
    assert worlds["id"] == "worlds-2027" and worlds["league"] == "worlds"
    assert worlds["pages"] == ["2027 Season World Championship/Main Event", "2027 Season World Championship/Play-In"]
    assert (worlds["start"], worlds["end"]) == ("2027-10-10", "2027-11-08")


def test_group_drops_untracked_secondary_and_qualifiers():
    out = seasons.group_tournaments([
        row("LCK CL/2027", "LoL Champions Korea", level="Secondary"),
        row("LEC/2027 Qualifier", "LoL EMEA Championship", qualifier="1"),
        row("VCS/2027", "Vietnam Championship Series"),
    ])
    assert out == []


def test_status_by_dates_with_two_days_of_margin():
    t = seasons.group_tournaments([row("LCK/2027 Season/Cup", "LoL Champions Korea", "2027-01-14", "2027-02-22")])[0]
    assert seasons.status(t, "2027-01-11") == "upcoming"
    assert seasons.status(t, "2027-01-12") == "active"
    assert seasons.status(t, "2027-02-24") == "active"
    assert seasons.status(t, "2027-02-25") == "finished"


def test_status_without_dates_is_upcoming():
    t = seasons.group_tournaments([row("LCK/2027 Season/Cup", "LoL Champions Korea", start="", end="")])[0]
    assert t["start"] is None and seasons.status(t, "2027-06-01") == "upcoming"


def test_worlds_2026_constant_and_raw_dir():
    assert seasons.WORLDS_2026["id"] == "worlds-2026"
    assert seasons.WORLDS_2026["pages"] == ["2026 Season World Championship"]
    assert seasons.tournament_dir(Path("data/raw"), "worlds-2026") == Path("data/raw/worlds-2026")
```

- [ ] **Step 3: Correr los tests y ver que fallan**

Run: `pytest tests/test_seasons.py -v`
Expected: FAIL con `ImportError: cannot import name 'seasons'`.

- [ ] **Step 4: Implementar**

```python
# pipeline/seasons.py
"""Qué ligas e internacionales sigue el sitio, cómo se agrupan en torneos y en qué estado está cada uno.

Un torneo es una página de Leaguepedia (OverviewPage) en las ligas, o el evento completo en los internacionales
(Worlds tiene una página para el Play-In y otra para el Main Event).
"""
import re
from datetime import date, timedelta
from pathlib import Path

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
```

- [ ] **Step 5: Correr los tests**

Run: `pytest tests/test_seasons.py -v`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add pipeline/seasons.py tests/test_seasons.py
git commit -m "feat: add tracked leagues and tournament grouping"
```

---

### Task 2: Datos crudos por torneo (`data/raw/worlds-2026/`)

**Files:**
- Move: `data/raw/worlds_2026_{matches,teams,games,game_players,rosters,schedule_games}.json` y `data/raw/lolesports_2026_games.json` → `data/raw/worlds-2026/{matches,teams,games,game_players,rosters,schedule_games,lolesports_games}.json`
- Modify: `pipeline/seasons.py` (constantes de nombres), `pipeline/fetch.py:16-25`, `pipeline/build.py:79-109`, `pipeline/assets.py:20,166-169`, `pipeline/history.py:108-117`
- Modify tests: `tests/test_build.py:24-58`, `tests/test_history.py:66-74`
- Modify: `CLAUDE.md` (sección Estructura)

**Interfaces:**
- Consumes: `seasons.tournament_dir`, `seasons.WORLDS_2026` (Task 1).
- Produces:
  - `seasons.RAW_FILES: dict[str, str]` — clave lógica → nombre de archivo dentro de la carpeta del torneo:
    `{"matches": "matches.json", "teams": "teams.json", "games": "games.json", "game_players": "game_players.json", "rosters": "rosters.json", "schedule_games": "schedule_games.json", "lolesports": "lolesports_games.json"}`.
  - `seasons.raw_file(raw_dir: Path, tournament_id: str, key: str) -> Path`.
  - `build.build(...)` con la misma firma de hoy, leyendo de `data/raw/worlds-2026/`.

- [ ] **Step 1: Guardar la salida actual del build para comparar después**

```bash
python -m pipeline.build
cp -r web/public/data "$TMPDIR/data_before"   # en PowerShell: Copy-Item -Recurse web/public/data $env:TEMP\data_before
```

Expected: `wrote web/public/data/...`.

- [ ] **Step 2: Escribir el test de los nombres nuevos**

Agregar a `tests/test_seasons.py`:

```python
def test_raw_file_lives_in_the_tournament_folder():
    assert seasons.raw_file(Path("data/raw"), "worlds-2026", "matches") == Path("data/raw/worlds-2026/matches.json")
    assert seasons.raw_file(Path("data/raw"), "worlds-2026", "lolesports") == Path(
        "data/raw/worlds-2026/lolesports_games.json")


def test_no_module_uses_the_old_flat_file_names():
    # Si un módulo sigue leyendo data/raw/worlds_2026_*.json, el cron volvería a crear los archivos viejos
    for module in ("pipeline/fetch.py", "pipeline/build.py", "pipeline/assets.py", "pipeline/history.py"):
        source = Path(module).read_text(encoding="utf-8")
        assert "worlds_2026_" not in source and "lolesports_2026_" not in source, module
```

- [ ] **Step 3: Correr y ver que fallan**

Run: `pytest tests/test_seasons.py -v`
Expected: FAIL (`raw_file` no existe; los módulos todavía usan `worlds_2026_`).

- [ ] **Step 4: Agregar las constantes a `pipeline/seasons.py`**

Debajo de `tournament_dir`:

```python
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
```

- [ ] **Step 5: Mover los archivos con git**

```bash
mkdir -p data/raw/worlds-2026
for k in matches teams games game_players rosters schedule_games; do git mv data/raw/worlds_2026_$k.json data/raw/worlds-2026/$k.json; done
git mv data/raw/lolesports_2026_games.json data/raw/worlds-2026/lolesports_games.json
```

Los `worlds_<año>_matches.json` de 2019–2023 (sin trackear) y los de años anteriores quedan donde están: son del backtest.

- [ ] **Step 6: Actualizar `pipeline/fetch.py`**

Reemplazar las líneas 16–25 (constantes de archivos) por:

```python
from pipeline.seasons import WORLDS_2026, raw_file

RAW_DIR = Path("data/raw")
```

Y en `main()`, cambiar cada constante por `raw_file(RAW_DIR, WORLDS_2026["id"], "<clave>")`:
`MATCHES_FILE` → `"matches"`, `GAMES_FILE` → `"games"`, `GAME_PLAYERS_FILE` → `"game_players"`,
`SCHEDULE_GAMES_FILE` → `"schedule_games"`, `LOLESPORTS_FILE` → `"lolesports"`, `ROSTERS_FILE` → `"rosters"`,
`TEAMS_FILE` → `"teams"`. `WORLDS_START` pasa a `WORLDS_2026["start"]` y `TOURNAMENT_PREFIX` a `WORLDS_2026["pages"][0]`.
(La Task 3 reescribe `main()` entera; acá solo se cambian los nombres.)

- [ ] **Step 7: Actualizar `pipeline/build.py`**

En `build()`, reemplazar las lecturas de las líneas 80–109:

```python
    tid = WORLDS_2026["id"]  # por ahora el sitio construye un solo torneo (Plan 3 suma las ligas)
    raw = lambda key: raw_file(raw_dir, tid, key)
    matches_raw = _read(raw("matches"))
    shorts = {t["Name"]: t.get("Short") or t["Name"] for t in _rows_if_exists(raw("teams"))}
```

y más abajo `raw("rosters")`, `raw("games")`, `raw("game_players")`, `raw("lolesports")`, `raw("schedule_games")`,
`raw("teams")` en lugar de los nombres `worlds_2026_*` y `lolesports_2026_games.json`. Import:
`from pipeline.seasons import WORLDS_2026, raw_file`.

- [ ] **Step 8: Actualizar `pipeline/assets.py`**

Los logos tienen que cubrir los equipos de todos los torneos, no solo los de Worlds. Reemplazar `TEAMS_FILE` (línea 20)
y las líneas 166–169:

```python
def known_teams(raw_dir: Path = RAW_DIR) -> list[str]:
    """Equipos de todos los torneos bajados (data/raw/<torneo>/teams.json), sin repetidos."""
    names = set()
    for path in raw_dir.glob(f"*/{RAW_FILES['teams']}"):
        names |= {t["Name"] for t in json.loads(path.read_text(encoding="utf-8"))["rows"]}
    return sorted(names)


def main(session=None) -> None:
    session = session or leaguepedia.make_session()
    print(f"team logos: {fetch_logos(session, known_teams())} new")
```

Import: `from pipeline.seasons import RAW_FILES`. Test en `tests/test_assets.py`:

```python
def test_known_teams_reads_every_tournament_folder(tmp_path):
    for tid, names in (("worlds-2026", ["T1", "G2 Esports"]), ("lck-2027-cup", ["T1", "Gen.G"])):
        (tmp_path / tid).mkdir()
        (tmp_path / tid / "teams.json").write_text(json.dumps({"fetched_at": "x", "rows": [{"Name": n} for n in names]}))
    assert assets.known_teams(tmp_path) == ["G2 Esports", "Gen.G", "T1"]
```

(`tests/test_assets.py` no importa `json`: agregar `import json` arriba).

- [ ] **Step 9: Actualizar `pipeline/history.py:114-116`**

```python
    worlds_file = raw_dir / f"worlds-{year}" / "games.json"
```

Y en `tests/test_history.py:72`:

```python
    (tmp_path / "worlds-2026").mkdir()
    write_rows(tmp_path / "worlds-2026" / "games.json", [worlds])
```

- [ ] **Step 10: Actualizar `tests/test_build.py`**

En `write_raw` y en `test_build_writes_contract_files`, cambiar las rutas:

```python
    write(raw / "worlds-2026" / "matches.json", {"fetched_at": stamp, "rows": list(rows)})
    write(raw / "worlds-2026" / "rosters.json", {"fetched_at": stamp, "rows": [{"Team": t, "OverviewPage": "x"} for t in rosters]})
```

```python
    write(tmp_path / "raw" / "worlds-2026" / "teams.json", {"fetched_at": "x", "rows": [{"Name": "G2 Esports", "Short": "G2"}]})
```

Buscar otras apariciones con `grep -n "worlds_2026_" tests/` y cambiarlas igual.

- [ ] **Step 11: Correr todos los tests**

Run: `pytest`
Expected: PASS (todos, incluidos los 2 nuevos de `test_seasons.py` y el de `test_assets.py`).

- [ ] **Step 12: Verificar que el sitio no cambia**

```bash
python -m pipeline.build
python - <<'EOF'
import json, os, pathlib, tempfile
before = pathlib.Path(os.environ.get("TMPDIR", tempfile.gettempdir())) / "data_before"
def clean(o):
    if isinstance(o, dict): return {k: clean(v) for k, v in o.items() if k != "updated_at"}
    if isinstance(o, list): return [clean(v) for v in o]
    return o
for f in sorted(before.glob("*.json")):
    a, b = (clean(json.loads(p.read_text(encoding="utf-8"))) for p in (f, pathlib.Path("web/public/data") / f.name))
    print(f.name, "OK" if a == b else "DIFFERENT")
EOF
```

Expected: todas las líneas `OK`.

- [ ] **Step 13: Actualizar `CLAUDE.md`**

En la sección Estructura, reemplazar la línea de `data/raw/` por:

```
data/raw/               # descargas sin modificar + fetched_at (commiteado: caché del cron; no editar a mano)
data/raw/<torneo>/      #   una carpeta por torneo (worlds-2026/, lck-2027-...): matches, games, rosters, teams...
```

y agregar debajo de `pipeline/`:

```
                        #   seasons.py: ligas e internacionales que se siguen, torneos, estados y modo del sitio
```

- [ ] **Step 14: Commit y graph**

```bash
graphify update .
git add -A data/raw pipeline tests CLAUDE.md
git commit -m "refactor: store raw data in one folder per tournament"
```

---

### Task 3: Descubrimiento diario y fetch por torneo

**Files:**
- Modify: `pipeline/seasons.py` (descubrimiento y torneos a bajar)
- Modify: `pipeline/fetch.py` (`main()` reescrita en `fetch_tournament` + `main`)
- Modify: `pipeline/lolesports.py:20,31-34,46` (liga como parámetro)
- Test: `tests/test_seasons.py`, `tests/test_fetch.py`, `tests/test_lolesports.py`

**Interfaces:**
- Consumes: `group_tournaments`, `status`, `raw_file`, `WORLDS_2026`, `TRACKED` (Tasks 1–2); `fetch.write_if_changed`, `fetch.read_rows`.
- Produces:
  - `seasons.TOURNAMENT_FIELDS: str`, `seasons.discovery_file(raw_dir: Path, year: int) -> Path` (`data/raw/tournaments_<año>.json`).
  - `seasons.known_tournaments(raw_dir: Path, today: str) -> list[dict]` — Worlds 2026 + los torneos descubiertos del año de `today` y el siguiente (sin repetir ids).
  - `seasons.write_discovery(path: Path, rows: list[dict], now: str) -> None` — escribe **siempre** (el `fetched_at` nuevo mantiene vivo el repo, spec §5).
  - `fetch.pages_where(field: str, pages: list[str]) -> str`.
  - `fetch.fetch_tournament(session, tournament: dict, now: str, full: bool) -> list[str]` — devuelve los equipos bajados.
  - `lolesports.fetch_games(session, since, cached, now=None, league_id=WORLDS_LEAGUE_ID)`.

- [ ] **Step 1: Tests de descubrimiento**

Agregar a `tests/test_seasons.py`:

```python
import json


def test_write_discovery_always_rewrites_fetched_at(tmp_path):
    path = tmp_path / "tournaments_2027.json"
    seasons.write_discovery(path, [{"a": "1"}], "2026-12-01T00:00:00Z")
    seasons.write_discovery(path, [{"a": "1"}], "2026-12-02T00:00:00Z")
    assert json.loads(path.read_text(encoding="utf-8")) == {"fetched_at": "2026-12-02T00:00:00Z", "rows": [{"a": "1"}]}


def test_known_tournaments_adds_worlds_2026_and_discovered_years(tmp_path):
    seasons.write_discovery(seasons.discovery_file(tmp_path, 2027),
                            [row("LCK/2027 Season/Cup", "LoL Champions Korea")], "x")
    ids = [t["id"] for t in seasons.known_tournaments(tmp_path, "2026-12-01")]
    assert ids == ["worlds-2026", "lck-2027-season-cup"]


def test_known_tournaments_without_discovery_is_just_worlds_2026(tmp_path):
    assert [t["id"] for t in seasons.known_tournaments(tmp_path, "2026-10-22")] == ["worlds-2026"]
```

- [ ] **Step 2: Tests del fetch**

Agregar a `tests/test_fetch.py`:

```python
def test_pages_where_matches_each_page_as_a_prefix():
    assert fetch.pages_where("OverviewPage", ["2026 Season World Championship"]) == (
        '(OverviewPage LIKE "2026 Season World Championship%")')
    assert fetch.pages_where("MatchId", ["LCK/2027 Season/Cup", 'A "B"']) == (
        '(MatchId LIKE "LCK/2027 Season/Cup%" OR MatchId LIKE "A \\"B\\"%")')


def test_targets_are_active_fully_and_upcoming_only_matches():
    from pipeline import seasons
    known = [dict(seasons.WORLDS_2026),
             {**seasons.WORLDS_2026, "id": "lck-2027-cup", "start": "2027-01-14", "end": "2027-02-22"},
             {**seasons.WORLDS_2026, "id": "old", "start": "2026-01-10", "end": "2026-02-01"}]
    assert fetch.targets(known, "2026-10-22") == [("worlds-2026", True), ("lck-2027-cup", False)]
```

- [ ] **Step 3: Test de lolesports con liga como parámetro**

Agregar a `tests/test_lolesports.py`:

```python
def test_started_matches_asks_for_the_given_league(monkeypatch):
    from pipeline import lolesports
    seen = {}
    def fake_get(session, url, **params):
        seen.update(params)
        return {"data": {"schedule": {"events": []}}}
    monkeypatch.setattr(lolesports, "_get", fake_get)
    assert lolesports.started_matches(None, "2027-01-01", league_id="98767991310872058") == []
    assert seen["leagueId"] == "98767991310872058"
```

- [ ] **Step 4: Correr y ver que fallan**

Run: `pytest tests/test_seasons.py tests/test_fetch.py tests/test_lolesports.py -v`
Expected: FAIL (`write_discovery`, `pages_where`, `targets` y el parámetro `league_id` no existen).

- [ ] **Step 5: Implementar en `pipeline/seasons.py`**

```python
import json

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
```

- [ ] **Step 6: Implementar en `pipeline/lolesports.py`**

```python
def started_matches(session, since: str, league_id: str = WORLDS_LEAGUE_ID) -> list[dict]:
    events = _get(session, f"{API_URL}/getSchedule", hl="en-US", leagueId=league_id)["data"]["schedule"]["events"]
    return [e for e in events if e["type"] == "match" and e["state"] != "unstarted" and e["startTime"] >= since]
```

y en `fetch_games` sumar el parámetro `league_id: str = WORLDS_LEAGUE_ID` y pasarlo:
`for event in started_matches(session, since, league_id):`. Actualizar el docstring del módulo: "de cada partida
de los torneos seguidos" en vez de "de Worlds".

- [ ] **Step 7: Reescribir `main()` de `pipeline/fetch.py`**

Reemplazar el cuerpo de `main()` por `fetch_tournament` + `main` (los campos y helpers de arriba no cambian):

```python
from pipeline import seasons
from pipeline.seasons import raw_file


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
    file = lambda key: raw_file(RAW_DIR, tid, key)
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
```

Borrar las constantes que quedaron sin uso (`WORLDS_START`, `TOURNAMENT_PREFIX`) y actualizar el docstring del módulo:
"Descarga los torneos activos (y el calendario de los próximos) a data/raw/<torneo>/."

Test del descubrimiento que falla (Review Focus 2), en `tests/test_fetch.py`:

```python
def test_discover_keeps_the_previous_file_when_leaguepedia_fails(tmp_path, monkeypatch):
    from pipeline import leaguepedia, seasons
    monkeypatch.setattr(fetch, "RAW_DIR", tmp_path)
    seasons.write_discovery(seasons.discovery_file(tmp_path, 2027), [{"kept": "1"}], "old")
    def boom(*args, **kwargs):
        raise leaguepedia.RateLimited("ratelimited")
    monkeypatch.setattr(leaguepedia, "cargo_query", boom)
    fetch.discover(None, "2026-12-01T00:00:00Z")
    saved = json.loads(seasons.discovery_file(tmp_path, 2027).read_text(encoding="utf-8"))
    assert saved == {"fetched_at": "old", "rows": [{"kept": "1"}]}
```

- [ ] **Step 8: Correr todos los tests**

Run: `pytest`
Expected: PASS.

- [ ] **Step 9: Probar el fetch real**

Run: `python -m pipeline.fetch`
Expected: líneas `discovery 2026: N tournaments`, `discovery 2027: M tournaments` (M puede ser 0 hoy),
`worlds-2026 matches: ...`. Se crean `data/raw/tournaments_2026.json` y `data/raw/tournaments_2027.json`.
`git status` no muestra archivos `worlds_2026_*` nuevos. Abrir `tournaments_2026.json` y confirmar que las páginas de
Worlds 2026 y LCK están ahí con fechas.

- [ ] **Step 10: Commit**

```bash
graphify update .
git add pipeline tests data/raw/tournaments_2026.json data/raw/tournaments_2027.json
git commit -m "feat: discover tracked tournaments daily and fetch each active one"
```

---

### Task 4: `index.json` y modo del sitio

**Files:**
- Modify: `pipeline/seasons.py` (`site_mode`, `index_payload`)
- Modify: `pipeline/build.py` (escribe `index.json`)
- Modify: `pipeline/validate.py` (`validate_index`)
- Test: `tests/test_seasons.py`, `tests/test_validate.py`, `tests/test_build.py`

**Interfaces:**
- Consumes: `known_tournaments`, `status`, `raw_file`, `TRACKED` (Tasks 1–3).
- Produces (contrato que lee el frontend en el Plan 4):
  - `seasons.has_dated_match(raw_dir: Path, tournament_id: str) -> bool`.
  - `seasons.site_mode(tournaments: list[dict], raw_dir: Path) -> str` — `"worlds-2026" | "season"`.
  - `seasons.index_payload(raw_dir: Path, today: str, now: str) -> dict` con esta forma:

```json
{"updated_at": "2026-10-22T12:00:00Z", "mode": "worlds-2026", "default": "worlds-2026",
 "leagues": [{"id": "lck", "short": "LCK", "region": "KR", "international": false}],
 "tournaments": [{"id": "worlds-2026", "league": "worlds", "name": "Worlds 2026", "status": "active",
                  "is_playoffs": false, "start": "2026-10-14", "end": "2026-11-15"}]}
```

  - `validate.validate_index(index: dict) -> list[str]`.

- [ ] **Step 1: Tests de modo e índice**

Agregar a `tests/test_seasons.py`:

```python
def write_matches(raw_dir, tid, rows):
    path = seasons.raw_file(raw_dir, tid, "matches")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"fetched_at": "x", "rows": rows}), encoding="utf-8")


def test_has_dated_match_ignores_matches_to_be_confirmed(tmp_path):
    write_matches(tmp_path, "lck-2027-cup", [{"DateTimeUTC": ""}, {"DateTimeUTC": None}])
    assert seasons.has_dated_match(tmp_path, "lck-2027-cup") is False
    write_matches(tmp_path, "lck-2027-cup", [{"DateTimeUTC": "2027-01-14 08:00:00"}])
    assert seasons.has_dated_match(tmp_path, "lck-2027-cup") is True
    assert seasons.has_dated_match(tmp_path, "missing") is False


def test_site_mode_switches_with_the_first_dated_2027_match(tmp_path):
    lck = {**seasons.WORLDS_2026, "id": "lck-2027-cup", "league": "lck", "year": 2027}
    assert seasons.site_mode([seasons.WORLDS_2026, lck], tmp_path) == "worlds-2026"
    write_matches(tmp_path, "lck-2027-cup", [{"DateTimeUTC": "2027-01-14 08:00:00"}])
    assert seasons.site_mode([seasons.WORLDS_2026, lck], tmp_path) == "season"


def test_index_payload_in_worlds_mode(tmp_path):
    index = seasons.index_payload(tmp_path, "2026-10-22", "2026-10-22T12:00:00Z")
    assert index["mode"] == "worlds-2026" and index["default"] == "worlds-2026"
    assert [t["id"] for t in index["tournaments"]] == ["worlds-2026"]
    assert index["tournaments"][0]["status"] == "active"
    assert {lg["id"] for lg in index["leagues"]} == set(seasons.TRACKED)
```

- [ ] **Step 2: Tests de validación**

Agregar a `tests/test_validate.py`:

```python
from pipeline.validate import validate_index


def test_validate_index_accepts_a_good_index():
    index = {"mode": "worlds-2026", "default": "worlds-2026", "leagues": [],
             "tournaments": [{"id": "worlds-2026", "status": "active"}]}
    assert validate_index(index) == []


def test_validate_index_rejects_unknown_mode_default_and_duplicates():
    index = {"mode": "x", "default": "nope", "leagues": [],
             "tournaments": [{"id": "a", "status": "active"}, {"id": "a", "status": "weird"}]}
    errors = validate_index(index)
    assert any("mode" in e for e in errors)
    assert any("default" in e for e in errors)
    assert any("duplicate" in e for e in errors)
    assert any("status" in e for e in errors)
```

- [ ] **Step 3: Correr y ver que fallan**

Run: `pytest tests/test_seasons.py tests/test_validate.py -v`
Expected: FAIL (`has_dated_match`, `site_mode`, `index_payload`, `validate_index` no existen).

- [ ] **Step 4: Implementar en `pipeline/seasons.py`**

```python
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
```

- [ ] **Step 5: Implementar `validate_index` en `pipeline/validate.py`**

```python
SITE_MODES = {"worlds-2026", "season"}
TOURNAMENT_STATUSES = {"upcoming", "active", "finished"}


def validate_index(index: dict) -> list[str]:
    """index.json: modo conocido, torneo por defecto que existe, ids únicos y estados válidos."""
    errors = []
    if index.get("mode") not in SITE_MODES:
        errors.append(f"index: unknown mode {index.get('mode')!r}")
    ids = [t["id"] for t in index.get("tournaments", [])]
    if index.get("default") not in ids:
        errors.append(f"index: default {index.get('default')!r} is not a listed tournament")
    for tid in sorted({i for i in ids if ids.count(i) > 1}):
        errors.append(f"index: duplicate tournament {tid}")
    for t in index.get("tournaments", []):
        if t.get("status") not in TOURNAMENT_STATUSES:
            errors.append(f"index: {t['id']} has invalid status {t.get('status')!r}")
    return errors
```

- [ ] **Step 6: Escribir `index.json` en `pipeline/build.py`**

Después de calcular `errors` (antes de `if errors: raise`), sumar:

```python
    index = seasons.index_payload(raw_dir, now[:10], now)
    errors += validate_index(index)
```

y junto a los demás `_write`:

```python
    _write(out_dir / "index.json", index)
```

Imports: `from pipeline import seasons` y `validate_index` en el import de `pipeline.validate`. Actualizar el `print`
de `main()` para que liste también `index.json`.

Test en `tests/test_build.py`:

```python
def test_build_writes_the_index_in_worlds_mode(tmp_path):
    write_raw(tmp_path / "raw")
    run(tmp_path)
    index = json.loads((tmp_path / "out" / "index.json").read_text(encoding="utf-8"))
    assert index["mode"] == "worlds-2026" and index["default"] == "worlds-2026"
```

- [ ] **Step 7: Correr todos los tests y el build real**

Run: `pytest` y después `python -m pipeline.build`
Expected: PASS; se escribe `web/public/data/index.json` con `"mode": "worlds-2026"`. Repetir la comparación del
Step 12 de la Task 2: todos los archivos viejos `OK`.

- [ ] **Step 8: Commit**

```bash
graphify update .
git add pipeline tests
git commit -m "feat: export index.json with site mode and tournaments"
```

(`web/public/data/` no se commitea: lo genera el build en cada deploy.)

---

### Task 5: Cron todo el año y cadena de 30 minutos solo en días de partido

**Files:**
- Modify: `pipeline/seasons.py` (`in_match_window`, `match_times`, CLI `--match-window`)
- Modify: `.github/workflows/update.yml`, `.github/workflows/tick.yml`
- Modify: `CLAUDE.md` (Stack/Comandos: cron), spec §5 (cada 6 h)
- Test: `tests/test_seasons.py`

**Interfaces:**
- Consumes: `known_tournaments`, `status`, `raw_file` (Tasks 1–4).
- Produces:
  - `seasons.match_times(raw_dir: Path, today: str) -> list[datetime]` — horarios confirmados de los torneos no terminados.
  - `seasons.in_match_window(times: list[datetime], now: datetime, before: timedelta = timedelta(hours=6), after: timedelta = timedelta(hours=24)) -> bool`.
  - `python -m pipeline.seasons --match-window` → exit 0 si hay partido en la ventana, exit 1 si no.

- [ ] **Step 1: Tests de la ventana**

Agregar a `tests/test_seasons.py`:

```python
from datetime import datetime, timedelta, timezone

NOW = datetime(2027, 1, 14, 12, 0, tzinfo=timezone.utc)


def test_in_match_window_edges():
    assert seasons.in_match_window([NOW - timedelta(hours=6)], NOW) is True
    assert seasons.in_match_window([NOW - timedelta(hours=6, minutes=1)], NOW) is False
    assert seasons.in_match_window([NOW + timedelta(hours=24)], NOW) is True
    assert seasons.in_match_window([NOW + timedelta(hours=24, minutes=1)], NOW) is False
    assert seasons.in_match_window([], NOW) is False


def test_match_times_skips_unconfirmed_times_and_finished_tournaments(tmp_path):
    write_matches(tmp_path, "worlds-2026", [
        {"DateTimeUTC": "2026-10-22 08:00:00", "HasTime": "1"},
        {"DateTimeUTC": "2026-10-23 00:00:00", "HasTime": "0"},  # a confirmar: no cuenta
        {"DateTimeUTC": "", "HasTime": ""},
    ])
    assert seasons.match_times(tmp_path, "2026-10-22") == [datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)]
    assert seasons.match_times(tmp_path, "2026-12-01") == []  # Worlds 2026 ya terminó
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `pytest tests/test_seasons.py -v`
Expected: FAIL (`in_match_window`, `match_times` no existen).

- [ ] **Step 3: Implementar en `pipeline/seasons.py`**

```python
import sys
from datetime import datetime, timezone

from pipeline import utc_now_iso


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
```

- [ ] **Step 4: Correr los tests y probar el comando**

Run: `pytest` y `python -m pipeline.seasons --match-window; echo $?`
Expected: PASS; hoy (Worlds en curso) imprime `match window: yes` y exit 0.

- [ ] **Step 5: `update.yml` — cada 6 h todo el año**

Reemplazar el bloque `schedule` y el mensaje del commit:

```yaml
on:
  schedule:
    # Cada 6 horas, todo el año (en :17: el minuto 0 está saturado y GitHub saltea corridas).
    # Descubre torneos nuevos, baja Oracle's Elixir y reengancha la cadena de 30 minutos de tick.yml en días de partido.
    - cron: "17 */6 * * *"
  workflow_dispatch:
  push:
    branches: [master]
```

```yaml
          git diff --cached --quiet || (git commit -m "data: update season data" && git push)
```

- [ ] **Step 6: `tick.yml` — sin fecha fija**

Actualizar el comentario del `if` ("Solo en días de partido: lo decide pipeline.seasons --match-window") y reemplazar el
step por uno que haga checkout y consulte la ventana antes de esperar:

```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Wait 30 minutes, trigger the update and re-trigger this tick (only around match days)
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
        run: |
          # Sin partidos entre 6 h atrás y 24 h adelante se corta la cadena; la corrida de cada 6 h la reengancha
          if ! python -m pipeline.seasons --match-window; then echo "No matches soon: end of the chain"; exit 0; fi
          sleep 1800
          gh workflow run update.yml
          gh workflow run tick.yml
```

(`pipeline.seasons` solo usa la stdlib, así que no hace falta `pip install`. Verificar con
`grep -n "^import\|^from" pipeline/seasons.py pipeline/__init__.py`: solo `json`, `re`, `sys`, `datetime`, `pathlib`.)

- [ ] **Step 7: Documentación**

En `CLAUDE.md`, sección Stack, reemplazar "(cron cada 30 minutos durante Worlds)" por
"(cada 6 horas todo el año; cada 30 minutos en días de partido)". En la sección Comandos, agregar:

```
python -m pipeline.seasons --match-window  # exit 0 si hay partido entre 6 h atrás y 24 h adelante (lo usa tick.yml)
```

En el spec (`docs/superpowers/specs/2026-10-22-season-2027-design.md`, §5), cambiar "una corrida diaria todo el año"
por "una corrida cada 6 horas todo el año (reengancha rápido la cadena si se corta)" y en §1 "Estado" anotar que sale
de las fechas `DateStart`/`Date` de `Tournaments` con 2 días de margen, y que un internacional agrupa sus páginas en un
solo torneo (`<liga>-<año>`).

- [ ] **Step 8: Commit, push y verificación en GitHub**

```bash
graphify update .
git add pipeline tests .github CLAUDE.md docs/superpowers/specs/2026-10-22-season-2027-design.md
git commit -m "ci: run the update all year and tick only around match days"
git push
```

Después del push: `gh run list --workflow=update.yml --limit 3` → la corrida del push termina en `completed success`.
`gh run list --workflow=tick.yml --limit 3` → la cadena sigue viva (hoy hay partidos). Confirmar en el sitio publicado
que se ve igual que antes y que `data/index.json` responde.
