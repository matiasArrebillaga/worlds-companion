# Etapa 3 — Estadísticas: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar la sección Estadísticas (tablas de equipos y jugadores), páginas por equipo (con evolución del Elo en Chart.js) y por jugador, y la página de partido con el cara a cara.

**Architecture:** `pipeline/stats.py` calcula los agregados a partir de dos fuentes:
- el extracto diario de Oracle's Elixir (`data/raw/oracles_2026.json`), para las stats de partida y jugador;
- las corridas del Elo sobre Leaguepedia, para la historia del rating y las series.

`pipeline/build.py` los valida y exporta `teams.json` y `players.json`. El frontend suma un router con parámetros (`#/equipo/:id`), cuatro vistas nuevas y un gráfico cargado de forma diferida.

**Tech Stack:** Python 3.12 + pytest; Vite + TypeScript sin framework + vitest; Chart.js 4 (dependencia nueva).

**Spec:** `docs/superpowers/specs/2026-10-09-worlds-companion-design.md`, §4 (contrato `teams.json` / `players.json`), §6 (rutas `#/estadisticas`, `#/equipo/:id`, `#/jugador/:id`, `#/partido/:id`) y §10, ítem 3.

**Decisiones del usuario (10/10):**
- Las stats salen de **Oracle's Elixir**, que se actualiza como mucho una vez por día. Los resultados y el Elo siguen siendo horarios.
- Hay un selector de período **Temporada 2026 | Worlds 2026**.

## Global Constraints

- UI y textos en español; código, nombres y commits en inglés; comentarios en el código en español.
- Colores solo como variables CSS de `:root`. Nada de colores sueltos en componentes, y en Chart.js se leen con `getComputedStyle`.
- Ninguna información se transmite solo con color: resultado como V/D y lado como AZUL/ROJO.
- Tipografía de datos: `var(--f-data)` con `tabular-nums`.
- Mobile first: funciona desde 360 px y las tablas anchas scrollean dentro de `.table-wrap`.
- Todas las vistas tienen estado "sin datos todavía" (`.state`).
- Gráficos con fondo transparente, grilla tenue y tooltip con el dato exacto.
- Animaciones respetan `prefers-reduced-motion`.
- Campeones con monograma en hexágono, sin retratos oficiales.
- Funciones de limpieza y stats con tests en `tests/`. Validar los JSON exportados: sin ids duplicados y con referencias válidas.
- Commits chicos con Conventional Commits y **sin** trailer `Co-Authored-By` de Claude.
- Modo aprendizaje: antes de la Tarea 2, explicarle al usuario en el chat los conceptos de la sección "Conceptos".

## Conceptos (modo aprendizaje: explicar antes de la Tarea 2)

1. **Cociente de totales vs. promedio de cocientes.** El KDA de la temporada se calcula como (K+A totales) / muertes totales, no como el promedio de los KDA de cada partida.
   - Una partida 5/0/10 da KDA 15, porque se divide por 1. Al promediar, esa sola partida infla todo.
   - Lo mismo vale para CS/min y DPM: se divide por los minutos totales, así cada partida pesa según cuánto duró.
2. **Normalizar por minuto.** Comparar el CS total de dos jugadores no tiene sentido si uno jugó partidas de 25 minutos y el otro de 38. Por eso se usa CS/min y daño por minuto.
3. **Muestras chicas.** En Worlds un jugador puede tener 3 partidas, y un KDA de 12 con 3 partidas no dice casi nada. Con menos de 5 partidas se marca "pocas partidas" y la tabla lo muestra atenuado. No se esconde: el usuario decide.
4. **Winrate por lado: correlación ≠ causalidad.** El lado no es aleatorio: en muchas ligas el perdedor de la partida anterior elige. Un winrate bajo en rojo puede reflejar a qué rivales les tocó jugar en rojo, no que el equipo juegue peor de ese lado.
5. **Datos faltantes.** La LPL de Oracle's Elixir no trae algunos datos, como primer heraldo y stats al minuto 15, en parte de 2024–2026. Un faltante se muestra como "—", nunca como 0.

## Review Focus

1. **Jugador con 0 muertes:** el KDA tiene que ser finito (se divide por máx(muertes, 1)), nunca `Infinity` en el JSON. Test: `test_player_stats_without_deaths_has_finite_kda`.
2. **Período Worlds sin partidas** (antes del 15/10): `worlds` es `null` y la vista muestra un estado vacío, no una tabla rota. Tests: `test_team_without_worlds_games_has_null_worlds` y `periodOf` en vitest.
3. **Datos faltantes de la LPL:** si un dato falta en todas las partidas, la stat es `null` (se muestra "—"), no 0. Test: `test_team_stats_missing_data_is_null`.
4. **Hash con id inexistente** (`#/equipo/nope`, o un link viejo): la vista muestra "no encontrado" con un link a Estadísticas. Tests: `parseHash` y `findById` en vitest.
5. **Dos jugadores con el mismo nombre** en distintos equipos: los ids tienen que ser únicos y la validación lo verifica. Tests: `test_player_ids_are_unique_even_with_the_same_name` y `test_validate_stats_finds_duplicates`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `models/oracles.py` (mod.) | `EXTRACT_COLUMNS` suma las columnas que necesitan las stats |
| `models/elo.py` (mod.) | `run_elo` guarda el rating de cada equipo después de cada partida en los records |
| `pipeline/stats.py` (nuevo) | `slug`, `team_stats`, `player_stats`, `build_team_and_player_stats`, `elo_history`, `series_list` |
| `pipeline/validate.py` (mod.) | `validate_stats` |
| `pipeline/build.py` (mod.) | Arma y exporta `teams.json` y `players.json` |
| `tests/test_stats.py` (nuevo) | Tests de `pipeline/stats.py` |
| `web/src/types.ts` (mod.) | Tipos de `teams.json` y `players.json` |
| `web/src/data.ts` (mod.) | Carga los dos JSON nuevos |
| `web/src/router.ts` (nuevo) | `parseHash`, `tabFor` |
| `web/src/stats.ts` (nuevo) | Helpers puros: `periodOf`, `sortBy`, `findById`, `fmt`, `ROLE_LABELS`, `FEW_GAMES` |
| `web/src/charts/eloChart.ts` (nuevo) | Gráfico de Elo con Chart.js (import diferido) |
| `web/src/views/stats.ts` (nuevo) | `#/estadisticas`: tablas de equipos y jugadores |
| `web/src/views/team.ts` (nuevo) | `#/equipo/:id` |
| `web/src/views/player.ts` (nuevo) | `#/jugador/:id` |
| `web/src/views/match.ts` (nuevo) | `#/partido/:id` (cara a cara) |
| `web/src/views/matchCard.ts` (mod.) | Link "Cara a cara" |
| `web/src/main.ts`, `web/index.html`, `web/src/styles.css` (mod.) | Rutas, pestaña Estadísticas y estilos |

---

### Task 1: Extracto de Oracle's Elixir con las columnas de stats

**Files:**
- Modify: `models/oracles.py` (`EXTRACT_COLUMNS`)
- Test: `tests/test_role_form.py`
- Data: `data/raw/oracles_2026.json` (se vuelve a bajar)

**Interfaces:**
- Produces: las filas de jugador y de equipo de `read_extract` traen además `champion`, `gamelength`, `total cs`, `damagetochampions`, `firstblood`, `firstdragon`, `firsttower` y `totalgold`.

- [ ] **Step 1: Write the failing test** (append to `tests/test_role_form.py`)

```python
def test_extract_keeps_the_columns_for_stats(tmp_path):
    rows = game_rows("g1", "A", "B", 1, "2026-01-01 10:00:00",
                     blue_stats={"gamelength": "1800", "totalgold": "60000", "firstdragon": "1"},
                     blue_player={"champion": "Ahri", "total cs": "300", "damagetochampions": "20000"})
    path = tmp_path / "oe.json"
    write_extract(path, rows, "2026-10-10T00:00:00Z")
    [game], _ = read_extract(path)
    assert game["players"]["blue"]["mid"]["champion"] == "Ahri"
    assert game["players"]["blue"]["mid"]["total cs"] == "300"
    assert game["teams"]["blue"]["gamelength"] == "1800"
    assert game["teams"]["blue"]["totalgold"] == "60000"
```

- [ ] **Step 2: Run it** — `python -m pytest tests/test_role_form.py::test_extract_keeps_the_columns_for_stats -v`. Expected: FAIL (`KeyError: 'champion'`).

- [ ] **Step 3: Implement** — in `models/oracles.py`, replace `EXTRACT_COLUMNS` with:

```python
# Columnas que guarda el extracto que usa el sitio: forma por rol (modelo) + estadísticas
EXTRACT_COLUMNS = ("gameid", "league", "date", "game", "side", "position", "teamname", "playername", "result",
                   "golddiffat15", "xpdiffat15", "csdiffat15", "kills", "deaths", "assists", "teamkills",
                   "damageshare", "earnedgoldshare",
                   "champion", "gamelength", "total cs", "damagetochampions",
                   "firstblood", "firstdragon", "firsttower", "totalgold")
```

- [ ] **Step 4: Run** — `python -m pytest -q`. Expected: all pass.

- [ ] **Step 5: Refresh the extract** — `python -m pipeline.fetch_oracles --force`, then `python -m pipeline.build`. Expected: `wrote data\raw\oracles_2026.json` (~8–9 MB) and the build writes without errors.

- [ ] **Step 6: Commit**

```bash
git add models/oracles.py tests/test_role_form.py
git commit -m "feat: keep champion, length and objective columns in the Oracle's Elixir extract"
git add data/raw/oracles_2026.json
git commit -m "data: refresh Oracle's Elixir extract with stats columns"
```

---

### Task 2: Agregados de equipo y de jugador

> Antes de esta tarea: explicarle al usuario los Conceptos 1 a 5 en el chat (modo aprendizaje).

**Files:**
- Create: `pipeline/stats.py`
- Test: `tests/test_stats.py`

**Interfaces:**
- Consumes: games de `models.oracles.read_extract` (`blue`, `red`, `winner`, `date`, `page`, `teams[side]`, `players[side][role]`, todos con valores en texto).
- Produces:
  - `slug(name: str) -> str`
  - `team_stats(games: list[dict], team: str) -> dict`, con las claves `games`, `wins`, `winrate`, `blue {games,wins}`, `red {games,wins}`, `avg_minutes`, `first_blood`, `first_dragon`, `first_tower`, `gold_per_min`.
  - `player_stats(entries: list[tuple[dict, str, dict]]) -> dict`, con las claves `games`, `wins`, `kills`, `deaths`, `assists`, `kda`, `cs_min`, `dpm`, `kp`, `champions[{name,games,wins}]`.
  - `build_team_and_player_stats(oe_games: list[dict], oe_names: dict[str, str], shorts: dict[str, str]) -> tuple[dict[str, dict], list[dict]]`. Recibe nombre de Leaguepedia → nombre en Oracle's Elixir y devuelve:
    - un dict de nombre de Leaguepedia → `{id, roster, season, worlds}`;
    - la lista de jugadores `{id, name, team_id, team, role, starter, season, worlds, history}`.

- [ ] **Step 1: Write the failing tests** — `tests/test_stats.py`:

```python
import pytest

from models.oracles import parse_rows
from pipeline.stats import build_team_and_player_stats, player_stats, slug, team_stats
from tests.test_features import game_rows


def games(*specs):
    """specs: (gameid, blue, red, blue_won, date, page, extra) → games como los de read_extract."""
    rows = []
    for gameid, blue, red, blue_won, date, page, extra in specs:
        for r in game_rows(gameid, blue, red, blue_won, date, **extra):
            rows.append({**r, "league": page})
    return parse_rows(rows)


TEAM = {"gamelength": "1800", "totalgold": "60000", "firstblood": "1", "firstdragon": "0", "firsttower": "1"}


def test_slug_is_url_safe():
    assert slug("Gen.G") == "gen-g"
    assert slug("Anyone's Legend") == "anyone-s-legend"
    assert slug("Kiin") == "kiin"


def test_team_stats_aggregate_record_sides_and_rates():
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LCK", {"blue_stats": TEAM, "red_stats": TEAM}),
               ("g2", "B", "A", 1, "2026-01-02 10:00:00", "LCK", {"blue_stats": TEAM, "red_stats": {**TEAM, "gamelength": "2400"}}))
    s = team_stats(gs, "A")
    assert (s["games"], s["wins"], s["winrate"]) == (2, 1, 0.5)
    assert s["blue"] == {"games": 1, "wins": 1} and s["red"] == {"games": 1, "wins": 0}
    assert s["avg_minutes"] == 35.0          # (30 + 40) / 2
    assert s["first_blood"] == 1.0 and s["first_dragon"] == 0.0
    assert s["gold_per_min"] == pytest.approx(1714, abs=1)   # 120000 de oro / 70 minutos


def test_team_stats_missing_data_is_null():
    empty = {k: "" for k in TEAM}
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LPL", {"blue_stats": empty, "red_stats": empty}))
    s = team_stats(gs, "A")
    assert s["games"] == 1
    assert s["first_dragon"] is None and s["avg_minutes"] is None and s["gold_per_min"] is None


def test_player_stats_use_totals_not_averages_of_ratios():
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LCK",
                {"blue_stats": TEAM, "blue_player": {"kills": "5", "deaths": "0", "assists": "10", "teamkills": "20",
                                                     "total cs": "300", "damagetochampions": "30000", "champion": "Ahri"}}),
               ("g2", "A", "B", 0, "2026-01-02 10:00:00", "LCK",
                {"blue_stats": TEAM, "blue_player": {"kills": "1", "deaths": "4", "assists": "1", "teamkills": "5",
                                                     "total cs": "240", "damagetochampions": "15000", "champion": "Azir"}}))
    entries = [(g, "blue", g["players"]["blue"]["mid"]) for g in gs]
    s = player_stats(entries)
    assert s["kda"] == 4.25                  # (6 + 11) / 4, no el promedio de 15 y 0.5
    assert s["cs_min"] == 9.0                # 540 CS / 60 minutos
    assert s["dpm"] == 750                   # 45000 / 60
    assert s["kp"] == 0.68                   # 17 / 25
    assert s["champions"] == [{"name": "Ahri", "games": 1, "wins": 1}, {"name": "Azir", "games": 1, "wins": 0}]


def test_player_stats_without_deaths_has_finite_kda():
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LCK",
                {"blue_stats": TEAM, "blue_player": {"kills": "3", "deaths": "0", "assists": "4"}}))
    assert player_stats([(gs[0], "blue", gs[0]["players"]["blue"]["top"])])["kda"] == 7.0


def test_team_without_worlds_games_has_null_worlds():
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LCK", {"blue_stats": TEAM, "red_stats": TEAM}))
    teams, players = build_team_and_player_stats(gs, {"Team A": "A"}, {"Team A": "TA"})
    assert teams["Team A"]["worlds"] is None
    assert teams["Team A"]["season"]["games"] == 1
    assert all(p["worlds"] is None for p in players)


def test_roster_is_the_last_lineup_in_role_order():
    gs = games(("g1", "A", "B", 1, "2026-01-01 10:00:00", "LCK", {}),
               ("g2", "A", "B", 1, "2026-01-02 10:00:00", "WLDs", {}))
    teams, players = build_team_and_player_stats(gs, {"Team A": "A"}, {"Team A": "TA"})
    assert teams["Team A"]["id"] == "team-a"
    assert teams["Team A"]["roster"] == ["a-top", "a-jng", "a-mid", "a-bot", "a-sup"]
    top = next(p for p in players if p["id"] == "a-top")
    assert (top["team_id"], top["role"], top["starter"]) == ("team-a", "top", True)
    assert top["season"]["games"] == 2 and top["worlds"]["games"] == 1
    assert top["history"][0]["date"] == "2026-01-02" and top["history"][0]["worlds"] is True


def test_player_ids_are_unique_even_with_the_same_name():
    rows_a = games(("g1", "A", "C", 1, "2026-01-01 10:00:00", "LCK", {}))
    rows_b = games(("g2", "B", "C", 1, "2026-01-01 11:00:00", "LCK", {}))
    for g in rows_b:
        for role, row in g["players"]["blue"].items():
            row["playername"] = f"A-{role}"   # mismos nombres que los jugadores de A
    _, players = build_team_and_player_stats(rows_a + rows_b, {"Team A": "A", "Team B": "B"},
                                             {"Team A": "TA", "Team B": "TB"})
    ids = [p["id"] for p in players]
    assert len(ids) == len(set(ids)) == 10
```

- [ ] **Step 2: Run** — `python -m pytest tests/test_stats.py -v`. Expected: FAIL (`ModuleNotFoundError: pipeline.stats`).

- [ ] **Step 3: Implement** — `pipeline/stats.py`:

```python
"""Estadísticas de equipos y jugadores para teams.json y players.json.

Fuente: games de Oracle's Elixir (models.oracles.read_extract). Los cocientes se calculan sobre
totales (ej. KDA = (K+A totales) / muertes totales), no como promedio de los cocientes de cada partida.
"""
import re
import unicodedata
from collections import Counter

from models.oracles import ROLES

WORLDS_PAGE = "WLDs"   # código de liga de Worlds en Oracle's Elixir
HISTORY_GAMES = 20     # últimas partidas que se guardan por jugador
FIRSTS = {"first_blood": "firstblood", "first_dragon": "firstdragon", "first_tower": "firsttower"}


def slug(name: str) -> str:
    """Nombre → id para la URL ('Gen.G' → 'gen-g')."""
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "x"


def _num(row: dict, key: str) -> float | None:
    value = row.get(key)
    return None if value is None or value == "" else float(value)


def _ratio(num: float, den: float, digits: int) -> float | None:
    """num / den redondeado; None si no hay con qué dividir (dato faltante, no 0)."""
    return round(num / den, digits) if den else None


def team_stats(games: list[dict], team: str) -> dict:
    played = wins = 0
    sides = {"blue": {"games": 0, "wins": 0}, "red": {"games": 0, "wins": 0}}
    minutes = minutes_games = gold = gold_minutes = 0.0
    firsts = {name: [0, 0.0] for name in FIRSTS}  # [partidas con dato, veces que lo consiguió]
    for g in games:
        for side in ("blue", "red"):
            if g[side] != team:
                continue
            row, won = g["teams"][side], g["winner"] == side
            played += 1
            wins += won
            sides[side]["games"] += 1
            sides[side]["wins"] += won
            length = _num(row, "gamelength")
            if length:
                minutes += length / 60
                minutes_games += 1
                total_gold = _num(row, "totalgold")
                if total_gold is not None:
                    gold += total_gold
                    gold_minutes += length / 60
            for name, column in FIRSTS.items():
                value = _num(row, column)
                if value is not None:
                    firsts[name][0] += 1
                    firsts[name][1] += value
    stats = {
        "games": played, "wins": wins, "winrate": _ratio(wins, played, 3),
        "blue": sides["blue"], "red": sides["red"],
        "avg_minutes": _ratio(minutes, minutes_games, 1),
        "gold_per_min": _ratio(gold, gold_minutes, 0),
    }
    for name, (n, got) in firsts.items():
        stats[name] = _ratio(got, n, 3)
    return stats


def player_stats(entries: list[tuple[dict, str, dict]]) -> dict:
    """entries: (game, lado, fila del jugador) de cada partida que jugó."""
    kills = deaths = assists = team_kills = wins = 0
    cs = cs_minutes = damage = damage_minutes = 0.0
    champions: dict[str, list[int]] = {}
    for g, side, row in entries:
        won = g["winner"] == side
        wins += won
        kills += int(_num(row, "kills") or 0)
        deaths += int(_num(row, "deaths") or 0)
        assists += int(_num(row, "assists") or 0)
        team_kills += int(_num(row, "teamkills") or 0)
        minutes = (_num(g["teams"][side], "gamelength") or 0) / 60
        if minutes and _num(row, "total cs") is not None:
            cs += _num(row, "total cs")
            cs_minutes += minutes
        if minutes and _num(row, "damagetochampions") is not None:
            damage += _num(row, "damagetochampions")
            damage_minutes += minutes
        champion = row.get("champion") or ""
        if champion:
            champions.setdefault(champion, [0, 0])
            champions[champion][0] += 1
            champions[champion][1] += won
    return {
        "games": len(entries), "wins": wins, "kills": kills, "deaths": deaths, "assists": assists,
        # max(muertes, 1): un jugador que nunca murió no tiene KDA infinito
        "kda": round((kills + assists) / max(deaths, 1), 2),
        "cs_min": _ratio(cs, cs_minutes, 1),
        "dpm": _ratio(damage, damage_minutes, 0),
        "kp": _ratio(kills + assists, team_kills, 2),
        "champions": [{"name": name, "games": n, "wins": w}
                      for name, (n, w) in sorted(champions.items(), key=lambda kv: (-kv[1][0], kv[0]))],
    }


def _game_line(g: dict, side: str, row: dict) -> dict:
    """Una partida del historial de un jugador."""
    one = player_stats([(g, side, row)])
    other = "red" if side == "blue" else "blue"
    return {"date": g["date"][:10], "opponent": g[other], "champion": row.get("champion") or "",
            "won": g["winner"] == side, "kills": one["kills"], "deaths": one["deaths"], "assists": one["assists"],
            "cs_min": one["cs_min"], "dpm": one["dpm"], "worlds": g["page"] == WORLDS_PAGE}


def build_team_and_player_stats(oe_games: list[dict], oe_names: dict[str, str],
                                shorts: dict[str, str]) -> tuple[dict[str, dict], list[dict]]:
    """Stats de cada equipo de Worlds y de cada jugador que jugó para ellos en 2026.

    oe_names: nombre de Leaguepedia → nombre en Oracle's Elixir. Un jugador que cambió de equipo
    cuenta solo las partidas con su equipo actual.
    """
    worlds = [g for g in oe_games if g["page"] == WORLDS_PAGE]
    teams: dict[str, dict] = {}
    players: list[dict] = []
    used_ids: set[str] = set()
    for lp_name, oe_name in oe_names.items():
        team_id = slug(lp_name)
        # Partidas de cada jugador con este equipo, en orden cronológico
        entries: dict[str, list[tuple[dict, str, dict]]] = {}
        last_lineup: dict[str, str] = {}
        for g in oe_games:
            for side in ("blue", "red"):
                if g[side] != oe_name:
                    continue
                for role in ROLES:
                    row = g["players"][side].get(role)
                    if row and row.get("playername"):
                        entries.setdefault(row["playername"], []).append((g, side, row))
                        last_lineup[role] = row["playername"]
        ids: dict[str, str] = {}
        for name in entries:
            pid = slug(name)
            if pid in used_ids:  # mismo nombre en otro equipo: se agrega el equipo para que sea único
                pid = f"{pid}-{slug(shorts.get(lp_name, lp_name))}"
            used_ids.add(pid)
            ids[name] = pid
        for name, mine in entries.items():
            role = Counter(row["position"] for _, _, row in mine).most_common(1)[0][0]
            in_worlds = [e for e in mine if e[0]["page"] == WORLDS_PAGE]
            players.append({
                "id": ids[name], "name": name, "team_id": team_id, "team": lp_name, "role": role,
                "starter": last_lineup.get(role) == name,
                "season": player_stats(mine),
                "worlds": player_stats(in_worlds) if in_worlds else None,
                "history": [_game_line(*e) for e in reversed(mine[-HISTORY_GAMES:])],
            })
        season = team_stats(oe_games, oe_name)
        worlds_stats = team_stats(worlds, oe_name)
        teams[lp_name] = {
            "id": team_id,
            "roster": [ids[last_lineup[r]] for r in ROLES if r in last_lineup],
            "season": season,
            "worlds": worlds_stats if worlds_stats["games"] else None,
        }
    return teams, players
```

- [ ] **Step 4: Run** — `python -m pytest tests/test_stats.py -v`, then `python -m pytest -q`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add pipeline/stats.py tests/test_stats.py
git commit -m "feat: aggregate team and player stats from Oracle's Elixir"
```

---

### Task 3: Historia del Elo y series de cada equipo

**Files:**
- Modify: `models/elo.py` (`run_elo`)
- Modify: `pipeline/stats.py`
- Test: `tests/test_elo.py`, `tests/test_stats.py`

**Interfaces:**
- Consumes: `models.elo.run_elo(...).records`.
- Produces:
  - records with `rating_blue` and `rating_red`: the rating **after** the game.
  - `elo_history(records: list[dict], team: str) -> list[list]`, which returns `[[fecha 'YYYY-MM-DD', rating]]`.
  - `series_list(records: list[dict], team: str) -> list[dict]`, which returns `{date, opponent, page, wins, losses}`, newest first.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_elo.py`:

```python
def test_records_keep_the_ratings_after_the_game():
    run = run_elo([game("A", "B")], Params(k=20), {})
    assert run.records[0]["rating_blue"] == pytest.approx(1510)
    assert run.records[0]["rating_red"] == pytest.approx(1490)
```

Append to `tests/test_stats.py`:

```python
from pipeline.stats import elo_history, series_list


def rec(blue, red, winner, date, match_id, page="LCK/2026 Season/Cup", rb=1500.0, rr=1500.0):
    return {"blue": blue, "red": red, "winner": winner, "date": date, "match_id": match_id, "page": page,
            "rating_blue": rb, "rating_red": rr}


def test_elo_history_follows_the_team_after_each_game():
    records = [rec("A", "B", "blue", "2026-01-01 10:00:00", "m1", rb=1510, rr=1490),
               rec("C", "A", "blue", "2026-01-05 10:00:00", "m2", rb=1508, rr=1502.4)]
    assert elo_history(records, "A") == [["2026-01-01", 1510.0], ["2026-01-05", 1502.4]]


def test_series_group_games_newest_first():
    records = [rec("A", "B", "blue", "2026-01-01 10:00:00", "m1"), rec("B", "A", "blue", "2026-01-01 11:00:00", "m1"),
               rec("A", "B", "blue", "2026-01-01 12:00:00", "m1"), rec("C", "A", "red", "2026-02-01 10:00:00", "m2")]
    assert series_list(records, "A") == [
        {"date": "2026-02-01", "opponent": "C", "page": "LCK/2026 Season/Cup", "wins": 1, "losses": 0},
        {"date": "2026-01-01", "opponent": "B", "page": "LCK/2026 Season/Cup", "wins": 2, "losses": 1},
    ]
```

- [ ] **Step 2: Run** — `python -m pytest tests/test_elo.py tests/test_stats.py -q`. Expected: FAIL (`KeyError: 'rating_blue'` and `ImportError: elo_history`).

- [ ] **Step 3: Implement**

In `models/elo.py`, inside `run_elo`, replace `records.append({**g, "p_blue": p_blue, "blue_won": blue_won})` with:

```python
        # Rating de cada equipo DESPUÉS del game (para la evolución del Elo); p_blue es el de antes
        records.append({**g, "p_blue": p_blue, "blue_won": blue_won,
                        "rating_blue": ratings[blue], "rating_red": ratings[red]})
```

Append to `pipeline/stats.py`:

```python
def elo_history(records: list[dict], team: str) -> list[list]:
    """[[fecha, rating después de la partida]] de un equipo, en orden cronológico."""
    history = []
    for r in records:
        for side in ("blue", "red"):
            if r[side] == team:
                history.append([r["date"][:10], round(r[f"rating_{side}"], 1)])
    return history


def series_list(records: list[dict], team: str) -> list[dict]:
    """Series del equipo (una por match_id) con el resultado, de la más nueva a la más vieja."""
    series: dict[str, dict] = {}
    for r in records:
        if team not in (r["blue"], r["red"]):
            continue
        side = "blue" if r["blue"] == team else "red"
        s = series.setdefault(r["match_id"], {"date": r["date"][:10], "opponent": r["red" if side == "blue" else "blue"],
                                              "page": r["page"], "wins": 0, "losses": 0})
        if r["winner"] == side:
            s["wins"] += 1
        else:
            s["losses"] += 1
    return sorted(series.values(), key=lambda s: s["date"], reverse=True)
```

- [ ] **Step 4: Run** — `python -m pytest -q`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add models/elo.py pipeline/stats.py tests/test_elo.py tests/test_stats.py
git commit -m "feat: track Elo history and series results per team"
```

---

### Task 4: Exportar y validar `teams.json` y `players.json`

**Files:**
- Modify: `pipeline/validate.py`, `pipeline/build.py`
- Test: `tests/test_validate.py`, `tests/test_build.py`

**Interfaces:**
- Consumes: `build_team_and_player_stats`, `elo_history`, `series_list` (Tasks 2–3); `resolve_team`, `ups` and `oe_games`, already in `build()`.
- Produces:
  - `web/public/data/teams.json` = `{"updated_at", "stats_fetched_at", "teams": [{id, name, short, region, rating, roster, season, worlds, elo_history, series}]}`, ordered by rating.
  - `web/public/data/players.json` = `{"players": [...]}`.
  - `validate_stats(teams: list[dict], players: list[dict]) -> list[str]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_validate.py`:

```python
def test_validate_stats_finds_duplicates_and_broken_links():
    from pipeline.validate import validate_stats
    teams = [{"id": "t1", "roster": ["faker"]}, {"id": "t1", "roster": []}]
    players = [{"id": "faker", "team_id": "t1"}, {"id": "faker", "team_id": "nope"}]
    errors = validate_stats(teams, players)
    assert any("duplicate team id t1" in e for e in errors)
    assert any("duplicate player id faker" in e for e in errors)
    assert any("nope" in e for e in errors)
    assert validate_stats([{"id": "t1", "roster": ["faker"]}], [{"id": "faker", "team_id": "t1"}]) == []
```

Append to `tests/test_build.py`:

```python
def test_build_writes_team_and_player_stats(tmp_path):
    write_raw(tmp_path / "raw")
    run(tmp_path)
    read = lambda name: json.loads((tmp_path / "out" / name).read_text(encoding="utf-8"))
    teams, players = read("teams.json"), read("players.json")
    assert set(teams) == {"updated_at", "stats_fetched_at", "teams"}
    t1 = next(t for t in teams["teams"] if t["name"] == "T1")
    assert set(t1) == {"id", "name", "short", "region", "rating", "roster", "season", "worlds", "elo_history", "series"}
    assert t1["id"] == "t1" and len(t1["elo_history"]) == 12 and t1["series"]
    assert len(t1["roster"]) == 5 and t1["worlds"] is None
    assert {p["team_id"] for p in players["players"]} == {"t1", "g2-esports"}
```

- [ ] **Step 2: Run** — `python -m pytest tests/test_validate.py tests/test_build.py -q`. Expected: FAIL (`ImportError: validate_stats` and missing `teams.json`).

- [ ] **Step 3: Implement**

Append to `pipeline/validate.py`:

```python
def validate_stats(teams: list[dict], players: list[dict]) -> list[str]:
    """Ids únicos y referencias válidas entre teams.json y players.json (los links del sitio dependen de esto)."""
    errors = []
    team_ids = [t["id"] for t in teams]
    player_ids = [p["id"] for p in players]
    for kind, ids in (("team", team_ids), ("player", player_ids)):
        for value, n in Counter(ids).items():
            if n > 1:
                errors.append(f"duplicate {kind} id {value}")
    known_teams, known_players = set(team_ids), set(player_ids)
    for p in players:
        if p["team_id"] not in known_teams:
            errors.append(f"player {p['id']}: unknown team {p['team_id']}")
    for t in teams:
        for pid in t["roster"]:
            if pid not in known_players:
                errors.append(f"team {t['id']}: roster has unknown player {pid}")
    return errors
```

(`Counter` is already imported in `validate.py`; if not, add `from collections import Counter`.)

In `pipeline/build.py`:
- add `from pipeline.stats import build_team_and_player_stats, elo_history, series_list`;
- add `validate_stats` to the `pipeline.validate` import.

Right after the `errors = (...)` block that includes `validate_lineups`, and before `current = ...`, insert:

```python
    # Estadísticas de equipos y jugadores (Oracle's Elixir) + historia del Elo y series (Leaguepedia)
    teams_payload, players_payload = [], []
    if not errors:
        oe_names = {t: resolve_team(t, ups) for t in teams}
        team_stats_by_name, players_payload = build_team_and_player_stats(oe_games, oe_names, shorts)
        for name in teams:
            canonical = aliases.get(name, name)
            teams_payload.append({
                **{k: team_stats_by_name[name][k] for k in ("id", "roster", "season", "worlds")},
                "name": name, "short": short_name(name, shorts), "region": regions.get(canonical),
                "rating": round(run.ratings[canonical], 1),
                "elo_history": elo_history(run.records, canonical),
                "series": series_list(run.records, canonical),
            })
        teams_payload.sort(key=lambda t: -t["rating"])
        errors += validate_stats(teams_payload, players_payload)
```

After the `_write(out_dir / "elo.json", ...)` line, add:

```python
    _write(out_dir / "teams.json", {"updated_at": now, "stats_fetched_at": oe_fetched_at, "teams": teams_payload})
    _write(out_dir / "players.json", {"players": players_payload})
```

Update the `print` in `main()` to: `print(f"wrote {OUT_DIR}/schedule.json, meta.json, elo.json, teams.json and players.json")`.

- [ ] **Step 4: Run** — `python -m pytest -q`, then `python -m pipeline.build`. Expected: all pass; the real build writes the 5 files. Sanity check: `python -c "import json; t=json.load(open('web/public/data/teams.json',encoding='utf-8')); print(len(t['teams']), t['teams'][0]['name'], t['teams'][0]['season'])"` shows 17 teams with stats.

- [ ] **Step 5: Commit**

```bash
git add pipeline/build.py pipeline/validate.py tests/test_build.py tests/test_validate.py
git commit -m "feat: export validated teams.json and players.json"
```

---

### Task 5: Tipos, carga de datos, router con parámetros y helpers de stats

**Files:**
- Modify: `web/src/types.ts`, `web/src/data.ts`, `web/src/main.ts`, `web/src/views/layout.ts`
- Create: `web/src/router.ts`, `web/src/router.test.ts`, `web/src/stats.ts`, `web/src/stats.test.ts`

**Interfaces:**
- Produces:
  - Types: `TeamEntry`, `PlayerEntry`, `TeamStats`, `PlayerStats`, `GameLine`, `SeriesResult`, `Role`, `TeamsFile`, `PlayersFile`.
  - `SiteData.teams: TeamsFile`, `SiteData.players: PlayersFile`.
  - `parseHash(hash) -> { path, param }` and `tabFor(path) -> string | null`.
  - `periodOf<T>(entry, period) -> T | null`, `sortBy<T>(rows, key, dir) -> T[]`, `findById<T>(rows, id) -> T | undefined`, `fmt(value, digits?) -> string`, `pct(value) -> string`, `ROLE_LABELS`, `FEW_GAMES = 5`, `type Period = 'season' | 'worlds'`.
  - New `View` type: `(el, data, tz, param: string | null) => () => void`.

- [ ] **Step 1: Write the failing tests**

`web/src/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseHash, tabFor } from './router';

describe('parseHash', () => {
  it('splits the section and the id', () => {
    expect(parseHash('#/equipo/gen-g')).toEqual({ path: '#/equipo', param: 'gen-g' });
    expect(parseHash('#/estadisticas')).toEqual({ path: '#/estadisticas', param: null });
    expect(parseHash('')).toEqual({ path: '#/', param: null });
    expect(parseHash('#/')).toEqual({ path: '#/', param: null });
    expect(parseHash('#/jugador/k%C3%ADin')).toEqual({ path: '#/jugador', param: 'kíin' });
  });
});

describe('tabFor', () => {
  it('lights the Estadísticas tab on team and player pages', () => {
    expect(tabFor('#/equipo')).toBe('#/estadisticas');
    expect(tabFor('#/jugador')).toBe('#/estadisticas');
    expect(tabFor('#/calendario')).toBe('#/calendario');
    expect(tabFor('#/partido')).toBeNull();
  });
});
```

`web/src/stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findById, fmt, pct, periodOf, sortBy } from './stats';

describe('periodOf', () => {
  it('returns null when there are no Worlds games yet', () => {
    const entry = { season: { games: 3 }, worlds: null };
    expect(periodOf(entry, 'season')).toEqual({ games: 3 });
    expect(periodOf(entry, 'worlds')).toBeNull();
  });
});

describe('sortBy', () => {
  it('sorts both ways and keeps missing values last', () => {
    const rows = [{ v: 2 }, { v: null }, { v: 5 }];
    expect(sortBy(rows, (r) => r.v, 'desc').map((r) => r.v)).toEqual([5, 2, null]);
    expect(sortBy(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual([2, 5, null]);
  });
});

describe('findById', () => {
  it('finds or returns undefined for unknown ids', () => {
    expect(findById([{ id: 'a' }], 'a')).toEqual({ id: 'a' });
    expect(findById([{ id: 'a' }], 'nope')).toBeUndefined();
    expect(findById([{ id: 'a' }], null)).toBeUndefined();
  });
});

describe('fmt / pct', () => {
  it('shows a dash for missing data, never 0', () => {
    expect(fmt(null)).toBe('—');
    expect(fmt(4.256, 1)).toBe('4.3');
    expect(pct(null)).toBe('—');
    expect(pct(0.625)).toBe('63%');
  });
});
```

- [ ] **Step 2: Run** — `cd web && npx vitest run src/router.test.ts src/stats.test.ts`. Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`web/src/router.ts`:

```ts
// Rutas por hash con un parámetro opcional: '#/equipo/gen-g' → { path: '#/equipo', param: 'gen-g' }
export interface Route {
  path: string;
  param: string | null;
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { path: '#/', param: null };
  return { path: `#/${parts[0]}`, param: parts[1] ? decodeURIComponent(parts[1]) : null };
}

// Qué pestaña se marca: las páginas de equipo y jugador cuelgan de Estadísticas
const TAB_OF: Record<string, string | null> = {
  '#/equipo': '#/estadisticas',
  '#/jugador': '#/estadisticas',
  '#/partido': null,
};

export function tabFor(path: string): string | null {
  return path in TAB_OF ? TAB_OF[path] : path;
}
```

`web/src/stats.ts`:

```ts
import type { Role } from './types';

export type Period = 'season' | 'worlds';
export const PERIODS: [Period, string][] = [['season', 'Temporada 2026'], ['worlds', 'Worlds 2026']];

// Con menos partidas que esto, la stat se muestra atenuada: muestra chica, dice poco
export const FEW_GAMES = 5;

export const ROLE_LABELS: Record<Role, string> = { top: 'Top', jng: 'Jungla', mid: 'Mid', bot: 'ADC', sup: 'Support' };

export function periodOf<T>(entry: { season: T; worlds: T | null }, period: Period): T | null {
  return period === 'season' ? entry.season : entry.worlds;
}

// Ordena sin modificar la lista original; los datos faltantes (null) siempre al final
export function sortBy<T>(rows: T[], key: (row: T) => number | string | null, dir: 'asc' | 'desc'): T[] {
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    const order = x < y ? -1 : x > y ? 1 : 0;
    return dir === 'asc' ? order : -order;
  });
}

export function findById<T extends { id: string }>(rows: T[], id: string | null): T | undefined {
  return id === null ? undefined : rows.find((r) => r.id === id);
}

// Un dato faltante se muestra como "—", nunca como 0
export function fmt(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toFixed(digits);
}

export function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}
```

Append to `web/src/types.ts`:

```ts
export type Role = 'top' | 'jng' | 'mid' | 'bot' | 'sup';

export interface SideRecord {
  games: number;
  wins: number;
}

export interface TeamStats {
  games: number;
  wins: number;
  winrate: number | null;
  blue: SideRecord;
  red: SideRecord;
  avg_minutes: number | null;
  gold_per_min: number | null;
  first_blood: number | null;
  first_dragon: number | null;
  first_tower: number | null;
}

export interface SeriesResult {
  date: string;
  opponent: string;
  page: string;
  wins: number;
  losses: number;
}

export interface TeamEntry {
  id: string;
  name: string;
  short: string;
  region: string | null;
  rating: number;
  roster: string[]; // ids de jugadores de la última alineación, en orden de rol
  season: TeamStats;
  worlds: TeamStats | null; // null hasta que juegue en Worlds
  elo_history: [string, number][];
  series: SeriesResult[];
}

export interface ChampionCount {
  name: string;
  games: number;
  wins: number;
}

export interface PlayerStats {
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  cs_min: number | null;
  dpm: number | null;
  kp: number | null;
  champions: ChampionCount[];
}

export interface GameLine {
  date: string;
  opponent: string;
  champion: string;
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs_min: number | null;
  dpm: number | null;
  worlds: boolean;
}

export interface PlayerEntry {
  id: string;
  name: string;
  team_id: string;
  team: string;
  role: Role;
  starter: boolean;
  season: PlayerStats;
  worlds: PlayerStats | null;
  history: GameLine[]; // últimas 20, la más nueva primero
}

export interface TeamsFile {
  updated_at: string;
  stats_fetched_at: string;
  teams: TeamEntry[];
}

export interface PlayersFile {
  players: PlayerEntry[];
}
```

In `web/src/data.ts`:
- import `PlayersFile` and `TeamsFile`;
- add `teams: TeamsFile; players: PlayersFile;` to `SiteData`;
- replace `loadData` with:

```ts
export async function loadData(): Promise<SiteData> {
  const [schedule, meta, elo, teams, players] = await Promise.all([
    getJson<Schedule>('schedule.json'),
    getJson<Meta>('meta.json'),
    getJson<Elo>('elo.json'),
    getJson<TeamsFile>('teams.json'),
    getJson<PlayersFile>('players.json'),
  ]);
  return { schedule, meta, elo, teams, players };
}
```

In `web/src/views/layout.ts`, change `setActiveTab(hash: string)` to `setActiveTab(tab: string | null)`, comparing `link.dataset.tab === tab`. The body stays the same.

In `web/src/main.ts`, switch routing to `parseHash`. The views for the new routes are added in Tasks 6–9; for now only the router changes:

```ts
import { parseHash, tabFor } from './router';

type View = (el: HTMLElement, data: SiteData, tz: string, param: string | null) => () => void;

const ROUTES: Record<string, View> = {
  '#/': (el, data, tz) => renderToday(el, data.schedule.matches, tz),
  '#/calendario': (el, data, tz) => renderCalendar(el, data.schedule.matches, tz),
  '#/predicciones': (el, data, tz) => renderPredictions(el, data, tz),
};

function currentRoute() {
  const route = parseHash(location.hash);
  return route.path in ROUTES ? route : { path: '#/', param: null };
}

function render(data: SiteData): void {
  cleanup();
  const { path, param } = currentRoute();
  cleanup = ROUTES[path](view, data, tz, param);
}

function route(data: SiteData): void {
  setActiveTab(tabFor(currentRoute().path));
  render(data);
  const today = view.querySelector('#hoy');
  if (today) today.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
}
```

Delete the old `currentHash()`.

- [ ] **Step 4: Run** — `cd web && npx tsc --noEmit && npm test`. Expected: tsc OK and all vitest pass.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat: load stats data and route pages with an id"
```

---

### Task 6: Sección Estadísticas (tablas de equipos y jugadores)

**Files:**
- Create: `web/src/views/stats.ts`
- Modify: `web/src/main.ts` (route), `web/index.html` (tabs), `web/src/styles.css`

**Interfaces:**
- Consumes: `periodOf`, `sortBy`, `fmt`, `pct`, `PERIODS`, `ROLE_LABELS`, `FEW_GAMES` (Task 5).
- Produces: `renderStats(el, data, tz, param)`.

- [ ] **Step 1: Implement the view** — `web/src/views/stats.ts`:

```ts
import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { FEW_GAMES, fmt, PERIODS, pct, periodOf, ROLE_LABELS, sortBy, type Period } from '../stats';
import type { PlayerEntry, PlayerStats, Role, TeamEntry, TeamStats } from '../types';

type Tab = 'equipos' | 'jugadores';
type Dir = 'asc' | 'desc';

interface Column<T, S> {
  id: string;
  label: string;
  value: (row: T, stats: S) => number | string | null;
  show: (row: T, stats: S) => string;
}

// Estado de la vista mientras la página esté abierta
const state = { tab: 'equipos' as Tab, period: 'season' as Period, role: 'all' as Role | 'all', sort: 'games', dir: 'desc' as Dir };

const TEAM_COLUMNS: Column<TeamEntry, TeamStats>[] = [
  { id: 'games', label: 'PJ', value: (_, s) => s.games, show: (_, s) => String(s.games) },
  { id: 'winrate', label: '% Vict.', value: (_, s) => s.winrate, show: (_, s) => pct(s.winrate) },
  { id: 'rating', label: 'Elo', value: (t) => t.rating, show: (t) => fmt(t.rating) },
  { id: 'avg_minutes', label: 'Duración', value: (_, s) => s.avg_minutes, show: (_, s) => fmt(s.avg_minutes, 1) },
  { id: 'gold_per_min', label: 'Oro/min', value: (_, s) => s.gold_per_min, show: (_, s) => fmt(s.gold_per_min) },
  { id: 'first_blood', label: '1ª sangre', value: (_, s) => s.first_blood, show: (_, s) => pct(s.first_blood) },
  { id: 'first_dragon', label: '1er dragón', value: (_, s) => s.first_dragon, show: (_, s) => pct(s.first_dragon) },
  { id: 'first_tower', label: '1ª torre', value: (_, s) => s.first_tower, show: (_, s) => pct(s.first_tower) },
];

const PLAYER_COLUMNS: Column<PlayerEntry, PlayerStats>[] = [
  { id: 'games', label: 'PJ', value: (_, s) => s.games, show: (_, s) => String(s.games) },
  { id: 'kda', label: 'KDA', value: (_, s) => s.kda, show: (_, s) => fmt(s.kda, 2) },
  { id: 'cs_min', label: 'CS/min', value: (_, s) => s.cs_min, show: (_, s) => fmt(s.cs_min, 1) },
  { id: 'dpm', label: 'DPM', value: (_, s) => s.dpm, show: (_, s) => fmt(s.dpm) },
  { id: 'kp', label: 'KP', value: (_, s) => s.kp, show: (_, s) => pct(s.kp) },
];

function seg(group: string, options: [string, string][], current: string, label: string): string {
  const buttons = options.map(([id, text]) =>
    `<button type="button" data-${group}="${id}" aria-pressed="${id === current}">${escapeHtml(text)}</button>`).join('');
  return `<div class="seg" role="group" aria-label="${label}">${buttons}</div>`;
}

function header<T, S>(columns: Column<T, S>[]): string {
  return columns.map((c) => {
    const active = c.id === state.sort;
    const sortState = active ? (state.dir === 'desc' ? 'descending' : 'ascending') : 'none';
    return `<th class="num" aria-sort="${sortState}"><button type="button" class="sort" data-sort="${c.id}">${c.label}${active ? (state.dir === 'desc' ? ' ▼' : ' ▲') : ''}</button></th>`;
  }).join('');
}

function empty(): string {
  return '<div class="state"><b>Todavía no hay partidas de Worlds 2026</b><span>Las estadísticas del torneo aparecen después de las primeras partidas. Mientras tanto, mirá la temporada.</span></div>';
}

function teamsTable(data: SiteData): string {
  const rows = data.teams.teams.flatMap((t) => {
    const s = periodOf(t, state.period);
    return s ? [{ t, s }] : [];
  });
  if (!rows.length) return empty();
  const column = TEAM_COLUMNS.find((c) => c.id === state.sort) ?? TEAM_COLUMNS[0];
  const sorted = sortBy(rows, (r) => column.value(r.t, r.s), state.dir);
  const body = sorted.map(({ t, s }) => `
    <tr class="${s.games < FEW_GAMES ? 'few' : ''}">
      <td class="team"><a href="#/equipo/${encodeURIComponent(t.id)}"><b>${escapeHtml(t.short)}</b></a><span class="muted">${escapeHtml(t.region ?? '—')}</span></td>
      ${TEAM_COLUMNS.map((c) => `<td class="num">${c.show(t, s)}</td>`).join('')}
    </tr>`).join('');
  return `<div class="table-wrap"><table class="rank"><thead><tr><th>Equipo</th>${header(TEAM_COLUMNS)}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function playersTable(data: SiteData): string {
  const shorts = new Map(data.teams.teams.map((t) => [t.id, t.short]));
  const rows = data.players.players.flatMap((p) => {
    const s = periodOf(p, state.period);
    return s && (state.role === 'all' || p.role === state.role) ? [{ p, s }] : [];
  });
  if (!rows.length) return empty();
  const column = PLAYER_COLUMNS.find((c) => c.id === state.sort) ?? PLAYER_COLUMNS[0];
  const sorted = sortBy(rows, (r) => column.value(r.p, r.s), state.dir);
  const body = sorted.map(({ p, s }) => `
    <tr class="${s.games < FEW_GAMES ? 'few' : ''}">
      <td class="team"><a href="#/jugador/${encodeURIComponent(p.id)}"><b>${escapeHtml(p.name)}</b></a><span class="muted">${escapeHtml(shorts.get(p.team_id) ?? p.team)} · ${ROLE_LABELS[p.role]}</span></td>
      ${PLAYER_COLUMNS.map((c) => `<td class="num">${c.show(p, s)}</td>`).join('')}
    </tr>`).join('');
  return `<div class="table-wrap"><table class="rank"><thead><tr><th>Jugador</th>${header(PLAYER_COLUMNS)}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderStats(el: HTMLElement, data: SiteData): () => void {
  const roles: [string, string][] = [['all', 'Todos'], ...(Object.entries(ROLE_LABELS) as [string, string][])];
  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Datos de Oracle's Elixir</span>
      <h1>Estadísticas</h1>
      ${seg('tab', [['equipos', 'Equipos'], ['jugadores', 'Jugadores']], state.tab, 'Equipos o jugadores')}
      ${seg('period', PERIODS, state.period, 'Período')}
      ${state.tab === 'jugadores' ? seg('role', roles, state.role, 'Rol') : ''}
      <p class="note">Las filas atenuadas tienen menos de ${FEW_GAMES} partidas: con tan pocas, los números dicen poco. "—" es un dato que la fuente no tiene.</p>
    </section>
    <section class="stack">${state.tab === 'equipos' ? teamsTable(data) : playersTable(data)}</section>`;

  el.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const d = button.dataset;
    if (d.tab) { state.tab = d.tab as Tab; state.sort = 'games'; state.dir = 'desc'; }
    else if (d.period) state.period = d.period as Period;
    else if (d.role) state.role = d.role as Role | 'all';
    else if (d.sort) {
      state.dir = state.sort === d.sort && state.dir === 'desc' ? 'asc' : 'desc';
      state.sort = d.sort;
    } else return;
    renderStats(el, data);
  };
  return () => { el.onclick = null; };
}
```

- [ ] **Step 2: Wire the route and the tab**

- `web/src/main.ts`: `import { renderStats } from './views/stats';` and add `'#/estadisticas': (el, data) => renderStats(el, data),` to `ROUTES`.
- `web/index.html`: in `.tabs`, before Calendario, add `<a class="tab" href="#/estadisticas" data-tab="#/estadisticas">Estadísticas</a>`.
- `web/index.html`: in `.bottombar`, after Calendario, add:

```html
      <a href="#/estadisticas" data-tab="#/estadisticas">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M7 16V9M12 16V5M17 16v-4"/></svg>Stats
      </a>
```

- `web/src/styles.css`: in the `.bottombar` rule, change its column count from 3 to 4. Look for `repeat(3` and replace it with `repeat(4`. Then append:

```css
/* Estadísticas */
.sort { all: unset; cursor: pointer; font: inherit; letter-spacing: inherit; text-transform: inherit; }
.sort:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.rank tr.few td { opacity: .55; }
.rank .team a { text-decoration: none; }
.rank .team a:hover b { color: var(--gold); }
.rank .team span { display: block; font-size: 12px; }
```

- [ ] **Step 3: Verify** — `cd web && npx tsc --noEmit && npm test && npm run build`. Expected: OK. Visual check: `npm run dev`, open `#/estadisticas` at a 360 px width. The table scrolls horizontally, sorting toggles ▼/▲, and the Worlds period shows the empty state.

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat: add Statistics section with sortable team and player tables"
```

---

### Task 7: Página de equipo con evolución del Elo (Chart.js)

**Files:**
- Create: `web/src/charts/eloChart.ts`, `web/src/views/team.ts`
- Modify: `web/package.json` (chart.js), `web/src/main.ts`, `web/src/styles.css`

**Interfaces:**
- Consumes: `findById`, `periodOf`, `fmt`, `pct`, `PERIODS`, `ROLE_LABELS` (Task 5).
- Produces: `renderTeam(el, data, tz, param)`; `drawEloChart(canvas, history: [string, number][]): Promise<() => void>`; the shared `teamKpis(s: TeamStats): string` (Task 9 uses it).

- [ ] **Step 1: Install** — `cd web && npm install chart.js@4.4.6 --save-exact`. Expected: added to `dependencies`.

- [ ] **Step 2: Chart** — `web/src/charts/eloChart.ts`:

```ts
// Gráfico de evolución del Elo. Chart.js se importa recién cuando hace falta, así no pesa en la carga inicial.
// Los colores salen de las variables CSS (nunca colores sueltos).
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export async function drawEloChart(canvas: HTMLCanvasElement, history: [string, number][]): Promise<() => void> {
  const { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip } = await import('chart.js');
  Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: history.map(([date]) => date),
      datasets: [{
        data: history.map(([, rating]) => rating),
        borderColor: cssVar('--cyan'), borderWidth: 2, pointRadius: 0, pointHitRadius: 8, tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduced ? false : { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `Elo ${Math.round(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: cssVar('--fg2'), maxTicksLimit: 6 }, grid: { color: cssVar('--line') } },
        y: { ticks: { color: cssVar('--fg2') }, grid: { color: cssVar('--line') } },
      },
    },
  });
  return () => chart.destroy();
}
```

- [ ] **Step 3: View** — `web/src/views/team.ts`:

```ts
import { drawEloChart } from '../charts/eloChart';
import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { findById, fmt, PERIODS, pct, periodOf, ROLE_LABELS, type Period } from '../stats';
import type { TeamEntry, TeamStats } from '../types';

let period: Period = 'season';

export function notFound(what: string): string {
  return `<div class="state"><b>No encontramos ${what}</b><span><a href="#/estadisticas">Volver a Estadísticas</a></span></div>`;
}

// KPIs de un equipo (también los usa la página de partido)
export function teamKpis(s: TeamStats): string {
  const kpi = (label: string, value: string, sub = '') =>
    `<div class="bezel"><div class="core kpi"><span class="label">${label}</span><b>${value}</b><span class="muted">${sub}</span></div></div>`;
  return `<div class="kpis">
    ${kpi('Récord', `${s.wins}-${s.games - s.wins}`, pct(s.winrate))}
    ${kpi('Lado azul', `${s.blue.wins}-${s.blue.games - s.blue.wins}`, 'AZUL')}
    ${kpi('Lado rojo', `${s.red.wins}-${s.red.games - s.red.wins}`, 'ROJO')}
    ${kpi('Duración', fmt(s.avg_minutes, 1), 'minutos')}
    ${kpi('Oro/min', fmt(s.gold_per_min))}
    ${kpi('1ª sangre', pct(s.first_blood))}
    ${kpi('1er dragón', pct(s.first_dragon))}
    ${kpi('1ª torre', pct(s.first_tower))}
  </div>`;
}

function roster(team: TeamEntry, data: SiteData): string {
  const items = team.roster.map((id) => {
    const p = findById(data.players.players, id);
    return p ? `<li><span class="label">${ROLE_LABELS[p.role]}</span><a href="#/jugador/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a></li>` : '';
  }).join('');
  return `<ul class="roster">${items}</ul>`;
}

function series(team: TeamEntry): string {
  if (!team.series.length) return '<div class="state"><b>Sin series todavía</b></div>';
  return team.series.slice(0, 30).map((s) => {
    const won = s.wins > s.losses;
    return `<div class="row"><span class="t">${escapeHtml(s.date.slice(5))}</span>
      <span class="m">vs ${escapeHtml(s.opponent)}<span class="muted"> · ${escapeHtml(s.page.split('/')[0])}</span></span>
      <span class="num"><span class="res ${won ? 'w' : 'l'}">${won ? 'V' : 'D'}</span> ${s.wins}-${s.losses}</span></div>`;
  }).join('');
}

export function renderTeam(el: HTMLElement, data: SiteData, _tz: string, param: string | null): () => void {
  const team = findById(data.teams.teams, param);
  if (!team) {
    el.innerHTML = notFound('ese equipo');
    return () => {};
  }
  const stats = periodOf(team, period);
  const buttons = PERIODS.map(([id, label]) => `<button type="button" data-period="${id}" aria-pressed="${id === period}">${label}</button>`).join('');
  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">${escapeHtml(team.region ?? 'Equipo')} · Elo ${fmt(team.rating)}</span>
      <h1>${escapeHtml(team.short)}</h1>
      <p class="muted">${escapeHtml(team.name)}</p>
      <div class="seg" role="group" aria-label="Período">${buttons}</div>
      ${stats ? teamKpis(stats) : '<div class="state"><b>Todavía no jugó en Worlds 2026</b></div>'}
    </section>
    <section class="stack"><h2>Plantel</h2>${roster(team, data)}</section>
    <section class="stack"><h2>Evolución del Elo</h2>
      <div class="chart-box"><canvas aria-label="Evolución del Elo de ${escapeHtml(team.short)} en 2026" role="img"></canvas></div></section>
    <section class="stack"><h2>Series 2026</h2><div class="bezel"><div class="core">${series(team)}</div></div></section>`;

  let destroy: () => void = () => {};
  let alive = true;
  const canvas = el.querySelector('canvas');
  if (canvas && team.elo_history.length) {
    drawEloChart(canvas, team.elo_history).then((d) => { if (alive) destroy = d; else d(); });
  }
  el.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-period]');
    if (!button) return;
    period = button.dataset.period as Period;
    alive = false;
    destroy();
    renderTeam(el, data, _tz, param);
  };
  return () => { alive = false; destroy(); el.onclick = null; };
}
```

- [ ] **Step 4: Wire + styles** — in `web/src/main.ts`, `import { renderTeam } from './views/team';` and add `'#/equipo': renderTeam,` to `ROUTES`. Append to `web/src/styles.css`:

```css
.chart-box { position: relative; height: 260px; }
.roster { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.roster li { display: grid; gap: 4px; padding: 12px; background: var(--card); border: 1px solid var(--line); }
.roster a { font: 700 1.2rem/1 var(--f-display); text-transform: uppercase; text-decoration: none; }
.roster a:hover { color: var(--gold); }
```

- [ ] **Step 5: Verify** — `cd web && npx tsc --noEmit && npm test && npm run build`. Expected: OK, with Chart.js in a separate chunk (the build output lists an extra `.js`). Visual check on `#/equipo/gen-g` and `#/equipo/nope`, which should show "No encontramos ese equipo".

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: add team page with Elo history chart"
```

---

### Task 8: Página de jugador

**Files:**
- Create: `web/src/views/player.ts`
- Modify: `web/src/main.ts`, `web/src/styles.css`

**Interfaces:**
- Consumes: `findById`, `periodOf`, `fmt`, `pct`, `PERIODS`, `ROLE_LABELS`, `FEW_GAMES`; `notFound` from `views/team.ts`.
- Produces: `renderPlayer(el, data, tz, param)`; `champHex(name: string): string`, the hexagon monogram (Task 9 uses it).

- [ ] **Step 1: View** — `web/src/views/player.ts`:

```ts
import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { FEW_GAMES, findById, fmt, PERIODS, pct, periodOf, ROLE_LABELS, type Period } from '../stats';
import type { PlayerEntry, PlayerStats } from '../types';
import { notFound } from './team';

let period: Period = 'season';

// Campeón como monograma en hexágono (sin retratos oficiales)
export function champHex(name: string): string {
  const initials = name.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0] ?? '').join('').slice(0, 2) || '?';
  return `<span class="champ" title="${escapeHtml(name)}" aria-hidden="true">${escapeHtml(initials.toUpperCase())}</span>`;
}

function kpis(s: PlayerStats): string {
  const kpi = (label: string, value: string, sub = '') =>
    `<div class="bezel"><div class="core kpi"><span class="label">${label}</span><b>${value}</b><span class="muted">${sub}</span></div></div>`;
  return `<div class="kpis">
    ${kpi('Partidas', String(s.games), `${s.wins}-${s.games - s.wins}`)}
    ${kpi('KDA', fmt(s.kda, 2), `${s.kills}/${s.deaths}/${s.assists}`)}
    ${kpi('CS/min', fmt(s.cs_min, 1))}
    ${kpi('DPM', fmt(s.dpm), 'daño por minuto')}
    ${kpi('KP', pct(s.kp), 'participación en kills')}
  </div>`;
}

function champions(s: PlayerStats): string {
  return `<ul class="champs">${s.champions.slice(0, 10).map((c) => `
    <li>${champHex(c.name)}<span><b>${escapeHtml(c.name)}</b><span class="muted num">${c.games} PJ · ${c.wins}-${c.games - c.wins}</span></span></li>`).join('')}</ul>`;
}

function history(p: PlayerEntry): string {
  const rows = p.history.map((g) => `
    <tr>
      <td class="num">${escapeHtml(g.date.slice(5))}</td>
      <td><span class="res ${g.won ? 'w' : 'l'}">${g.won ? 'V' : 'D'}</span></td>
      <td>${escapeHtml(g.champion)}</td>
      <td>vs ${escapeHtml(g.opponent)}${g.worlds ? ' <span class="pill gold">Worlds</span>' : ''}</td>
      <td class="num">${g.kills}/${g.deaths}/${g.assists}</td>
      <td class="num">${fmt(g.cs_min, 1)}</td>
      <td class="num">${fmt(g.dpm)}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table class="rank"><thead><tr><th>Fecha</th><th>Res.</th><th>Campeón</th><th>Rival</th><th class="num">KDA</th><th class="num">CS/min</th><th class="num">DPM</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderPlayer(el: HTMLElement, data: SiteData, tz: string, param: string | null): () => void {
  const p = findById(data.players.players, param);
  if (!p) {
    el.innerHTML = notFound('ese jugador');
    return () => {};
  }
  const team = findById(data.teams.teams, p.team_id);
  const s = periodOf(p, period);
  const buttons = PERIODS.map(([id, label]) => `<button type="button" data-period="${id}" aria-pressed="${id === period}">${label}</button>`).join('');
  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">${ROLE_LABELS[p.role]} · <a href="#/equipo/${encodeURIComponent(p.team_id)}">${escapeHtml(team?.short ?? p.team)}</a>${p.starter ? '' : ' · suplente'}</span>
      <h1>${escapeHtml(p.name)}</h1>
      <div class="seg" role="group" aria-label="Período">${buttons}</div>
      ${s && s.games < FEW_GAMES ? `<p class="note">Solo ${s.games} partidas: con tan pocas, estos números dicen poco.</p>` : ''}
      ${s ? kpis(s) : '<div class="state"><b>Todavía no jugó en Worlds 2026</b></div>'}
    </section>
    ${s ? `<section class="stack"><h2>Campeones</h2>${champions(s)}</section>` : ''}
    <section class="stack"><h2>Últimas partidas</h2>${history(p)}</section>`;
  el.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-period]');
    if (!button) return;
    period = button.dataset.period as Period;
    renderPlayer(el, data, tz, param);
  };
  return () => { el.onclick = null; };
}
```

- [ ] **Step 2: Wire + styles** — in `web/src/main.ts`, `import { renderPlayer } from './views/player';` and add `'#/jugador': renderPlayer,` to `ROUTES`. Append to `web/src/styles.css`:

```css
.champ { width: 34px; height: 38px; display: inline-grid; place-items: center; flex: none;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  background: var(--raised); color: var(--gold); font: 700 13px/1 var(--f-display); letter-spacing: .04em; }
.champs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
.champs li { display: flex; gap: 10px; align-items: center; }
.champs li > span { display: grid; gap: 3px; }
.eyebrow a { color: inherit; }
```

- [ ] **Step 3: Verify** — `cd web && npx tsc --noEmit && npm test && npm run build`. Expected: OK. Visual check on `#/jugador/faker`.

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat: add player page with champions and game history"
```

---

### Task 9: Página de partido (cara a cara) y links desde las tarjetas

**Files:**
- Create: `web/src/views/match.ts`
- Modify: `web/src/views/matchCard.ts`, `web/src/main.ts`, `web/src/styles.css`
- Test: `web/src/stats.test.ts`, `web/src/stats.ts` (`teamByName`, `starterByRole`)

**Interfaces:**
- Consumes: `predictionBlock` (matchCard), `teamKpis`, `notFound` (team), `champHex` (player), `findById`, `ROLE_LABELS`, `fmt`, `pct`.
- Produces: `renderMatch(el, data, tz, param)`; `teamByName(teams, name)`; `starterByRole(team, players, role)`.

- [ ] **Step 1: Write the failing test** (append to `web/src/stats.test.ts`)

```ts
import { starterByRole, teamByName } from './stats';

describe('teamByName / starterByRole', () => {
  const teams = [{ id: 't1', name: 'T1', roster: ['faker'] }];
  const players = [{ id: 'faker', role: 'mid' as const }, { id: 'sub', role: 'mid' as const }];
  it('finds the team of a match and its starter for a role', () => {
    expect(teamByName(teams, 'T1')?.id).toBe('t1');
    expect(teamByName(teams, 'Nope')).toBeUndefined();
    expect(starterByRole(teams[0], players, 'mid')?.id).toBe('faker');
    expect(starterByRole(teams[0], players, 'top')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** — `cd web && npx vitest run src/stats.test.ts`. Expected: FAIL (`teamByName` is not exported).

- [ ] **Step 3: Implement the helpers** (append to `web/src/stats.ts`):

```ts
// Equipo de una tarjeta de partido (el calendario usa el nombre de Leaguepedia, igual que teams.json)
export function teamByName<T extends { name: string }>(teams: T[], name: string): T | undefined {
  return teams.find((t) => t.name === name);
}

// Titular de un rol: el jugador de la última alineación que juega ese rol
export function starterByRole<P extends { id: string; role: Role }>(team: { roster: string[] }, players: P[], role: Role): P | undefined {
  return players.find((p) => team.roster.includes(p.id) && p.role === role);
}
```

- [ ] **Step 4: View** — `web/src/views/match.ts`:

```ts
import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { findById, fmt, pct, ROLE_LABELS, starterByRole, teamByName } from '../stats';
import type { ChampionCount, PlayerEntry, Role, TeamEntry } from '../types';
import { predictionBlock } from './matchCard';
import { champHex } from './player';
import { notFound } from './team';

function mirror(label: string, left: string, right: string): string {
  return `<div class="mirror"><span class="num">${left}</span><span class="label">${label}</span><span class="num">${right}</span></div>`;
}

function duel(role: Role, a: PlayerEntry | undefined, b: PlayerEntry | undefined): string {
  const name = (p?: PlayerEntry) => p ? `<a href="#/jugador/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>` : '—';
  const line = (p?: PlayerEntry) => p ? `KDA ${fmt(p.season.kda, 1)} · DPM ${fmt(p.season.dpm)} · KP ${pct(p.season.kp)}` : '';
  return `<div class="duel"><div>${name(a)}<span class="muted">${line(a)}</span></div>
    <span class="label">${ROLE_LABELS[role]}</span>
    <div class="r">${name(b)}<span class="muted">${line(b)}</span></div></div>`;
}

// Campeones más jugados por los titulares del equipo en la temporada
function topChampions(team: TeamEntry, players: PlayerEntry[]): string {
  const total = new Map<string, number>();
  for (const id of team.roster) {
    const p = findById(players, id);
    p?.season.champions.forEach((c: ChampionCount) => total.set(c.name, (total.get(c.name) ?? 0) + c.games));
  }
  const top = [...total.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
  return `<ul class="champs">${top.map(([name, n]) => `<li>${champHex(name)}<span><b>${escapeHtml(name)}</b><span class="muted num">${n} PJ</span></span></li>`).join('')}</ul>`;
}

export function renderMatch(el: HTMLElement, data: SiteData, _tz: string, param: string | null): () => void {
  const m = data.schedule.matches.find((x) => x.id === param);
  const a = m?.team1 ? teamByName(data.teams.teams, m.team1.name) : undefined;
  const b = m?.team2 ? teamByName(data.teams.teams, m.team2.name) : undefined;
  if (!m || !a || !b) {
    el.innerHTML = notFound('ese partido (o todavía no tiene los dos equipos definidos)');
    return () => {};
  }
  const sa = a.season;
  const sb = b.season;
  const meetings = a.series.filter((s) => s.opponent === b.name);
  const roles: Role[] = ['top', 'jng', 'mid', 'bot', 'sup'];
  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Cara a cara · Bo${m.best_of}</span>
      <h1><a href="#/equipo/${encodeURIComponent(a.id)}">${escapeHtml(a.short)}</a> vs <a href="#/equipo/${encodeURIComponent(b.id)}">${escapeHtml(b.short)}</a></h1>
      ${predictionBlock(m)}
    </section>
    <section class="stack"><h2>Temporada 2026</h2><div class="bezel"><div class="core">
      ${mirror('Elo', fmt(a.rating), fmt(b.rating))}
      ${mirror('Récord', `${sa.wins}-${sa.games - sa.wins}`, `${sb.wins}-${sb.games - sb.wins}`)}
      ${mirror('% victorias', pct(sa.winrate), pct(sb.winrate))}
      ${mirror('Duración (min)', fmt(sa.avg_minutes, 1), fmt(sb.avg_minutes, 1))}
      ${mirror('Oro/min', fmt(sa.gold_per_min), fmt(sb.gold_per_min))}
      ${mirror('1ª sangre', pct(sa.first_blood), pct(sb.first_blood))}
      ${mirror('1er dragón', pct(sa.first_dragon), pct(sb.first_dragon))}
      ${mirror('1ª torre', pct(sa.first_tower), pct(sb.first_tower))}
    </div></div></section>
    <section class="stack"><h2>Duelos por rol</h2>
      ${roles.map((r) => duel(r, starterByRole(a, data.players.players, r), starterByRole(b, data.players.players, r))).join('')}</section>
    <section class="grid g2">
      <div class="stack"><h2>Campeones de ${escapeHtml(a.short)}</h2>${topChampions(a, data.players.players)}</div>
      <div class="stack"><h2>Campeones de ${escapeHtml(b.short)}</h2>${topChampions(b, data.players.players)}</div>
    </section>
    <section class="stack"><h2>Enfrentamientos en 2026</h2>
      ${meetings.length ? meetings.map((s) => `<div class="row"><span class="t">${escapeHtml(s.date.slice(5))}</span><span class="m">${escapeHtml(s.page.split('/')[0])}</span><span class="num">${escapeHtml(a.short)} ${s.wins}-${s.losses}</span></div>`).join('')
        : '<div class="state"><b>No se enfrentaron en 2026</b></div>'}
    </section>`;
  return () => {};
}
```

- [ ] **Step 5: Wire + link + styles**

- `web/src/main.ts`: `import { renderMatch } from './views/match';` and add `'#/partido': renderMatch,` to `ROUTES`.
- `web/src/views/matchCard.ts`, in `matchCard`: replace `<span>${PHASE_LABELS[m.phase]}</span>` in the foot with:

```ts
<span>${PHASE_LABELS[m.phase]}${m.team1 && m.team2 ? ` · <a href="#/partido/${encodeURIComponent(m.id)}">Cara a cara</a>` : ''}</span>
```

- Append to `web/src/styles.css`:

```css
.mirror { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.mirror:first-child { border-top: 0; }
.mirror .num:first-child { text-align: right; }
.duel { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
.duel > div { display: grid; gap: 4px; }
.duel .r { text-align: right; }
.duel a { font: 700 1.1rem/1 var(--f-display); text-transform: uppercase; text-decoration: none; }
.duel .muted { font: 12px var(--f-data); }
h1 a { text-decoration: none; }
```

- [ ] **Step 6: Verify** — `cd web && npx tsc --noEmit && npm test && npm run build`. Expected: OK. Visual check: from Calendario, open a match with both teams; `#/partido/nope` shows the "No encontramos" state.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat: add head-to-head match page linked from match cards"
```

---

### Task 10: Documentación y cierre

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-10-09-worlds-companion-design.md`

- [ ] **Step 1: Docs**
  - Spec §3: note that the stats come from the Oracle's Elixir daily extract.
  - Spec §9: remove "Oracle's Elixir (y por lo tanto GD@15)" from "Fuera de alcance".
  - `CLAUDE.md`, `## Estructura`: add `pipeline/stats.py` with the comment "agregados de equipos y jugadores".

- [ ] **Step 2: Full verification** — `python -m pytest -q && python -m pipeline.build && cd web && npx tsc --noEmit && npm test && npm run build`. Expected: everything green.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs
git commit -m "docs: document stats sources and stage 3 structure"
```
