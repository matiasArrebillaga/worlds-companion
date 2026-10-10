# Etapa 4 — Meta, Suiza y Bracket

Amplía el spec general (`2026-10-09-worlds-companion-design.md`, §4 contrato de datos, §6 navegación, §10 punto 4).

## Objetivo

- Sección **Meta** (`#/meta`): Campeones | Draft | Lados | Ritmo | Regiones, con lo que se juega en Worlds 2026.
- Sub-vistas **Suiza** y **Bracket** en el Calendario.

## Muestras de la sección Meta

- **Parche de Worlds: 16.20, fijo** (constante `WORLDS_PATCH` en `pipeline/meta.py`).
- **Muestra "Worlds":** partidas de Oracle's Elixir con liga `WLDs` y fecha ≥ `worlds_start` (la fecha del primer
  partido del calendario, igual que en la Etapa 3; deja afuera los clasificatorios regionales de septiembre).
- **Muestra "Guía 16.17–16.18":** todas las partidas de las ligas principales en los últimos parches que jugaron
  (`GUIDE_PATCHES = ("16.17", "16.18")`). No hay partidas en 16.19 y en 16.18 solo jugó la VCS (16 partidas), así
  que se suma 16.17 (último parche de LPL, LEC, LCS, CBLOL): ~305 partidas. Sirve de orientación antes de Worlds.
- **La guía desaparece cuando Worlds tiene 10 partidas o más** (`GUIDE_UNTIL_GAMES = 10`). Mientras exista, el
  selector muestra Worlds | Guía 16.17–16.18 y arranca en Guía si Worlds tiene menos de 10 partidas. Después solo queda
  Worlds. La regla se aplica en el pipeline: con 10+ partidas de Worlds, la guía no se exporta.

## Datos (pipeline)

### Extracto de Oracle's Elixir

`EXTRACT_COLUMNS` suma `patch`, `ban1`–`ban5` y `pick1`–`pick5` (vienen en las filas de equipo).
`models/oracles.parse_rows` los guarda en `teams[side]`.

### `pipeline/meta.py` (nuevo)

Funciones puras sobre la lista de games de `load_season`/`read_extract`:

- `worlds_games(games, worlds_start)` y `patch_games(games, patch)`: filtran las muestras.
- `phase_of(date, schedule)`: fase de una partida de Worlds según las fechas del calendario (fecha ≥ primer partido
  de knockout → knockout; ≥ primer partido suizo → swiss; si no, play-in).
- `draft_slots(game)`: orden global de picks y bans. Picks del azul en las posiciones 1, 4, 5, 8, 9 y del rojo en
  2, 3, 6, 7, 10. Bans de la primera fase: los 3 primeros de cada equipo; de la segunda: ban4–ban5.
- `champion_stats(games)` → por campeón: `games`, `picks`, `bans`, `presence` = (picks + bans) / partidas,
  `wins`, `winrate` (null si no tiene picks), `first_rotation` = % de partidas en que fue pickeado entre los
  6 primeros picks o baneado en la primera fase de bans.
- `side_stats(games, phase_fn)` → partidas, victorias del azul y winrate del azul y del rojo, total y por fase.
- `pace_stats(games, phase_fn)` → por fase: partidas, duración **mediana** (minutos), kills por minuto
  (total de kills / total de minutos: ratio de totales, como en la Etapa 3).
- `region_stats(games, regions)` → por región: partidas, victorias y winrate **solo contra otras regiones**.
  La región de cada equipo sale de `team_regions` (la liga donde más jugó en 2026).

Faltantes como `null`, nunca 0. Campeones vacíos o columnas faltantes se ignoran.

### JSON (contrato)

- `champions.json`: `{updated_at, worlds_patch, guide_patch | null, samples: {worlds: [...], guide?: [...]}}`.
  Cada entrada: `{champion, games, picks, bans, presence, wins, winrate, first_rotation}`.
- `meta.json` (se amplía): agrega `worlds_patch`, `guide_patch | null`, `worlds_games` y `samples: {worlds, guide?}`
  con `{games, sides, pace, regions}` en cada una. Mantiene `updated_at`, `source_fetched_at`, `match_count`.
- Tipos en `web/src/types.ts`; el test de contrato de Python verifica las claves.
- Validación (`pipeline/validate.py`): sin campeones duplicados por muestra; porcentajes en [0, 1].

## Calendario: Suiza y Bracket (frontend)

Sin JSON nuevo: `schedule.json` ya trae fase, ronda, equipos, ganador y predicción.

- `web/src/swiss.ts`: `swissRecords(matches)` recorre las rondas suizas en orden y devuelve, por ronda, los
  partidos agrupados por el récord previo de los equipos (`"1-0"`, `"0-1"`…), y el estado de cada equipo:
  clasificado (3 victorias), eliminado (3 derrotas) o en juego.
- Vista Suiza: una columna por ronda, con grupos por récord. Clasificado/eliminado como chip de texto ("CLASIFICA",
  "ELIMINADO"), no solo color. Cruces sin equipos: "a confirmar".
- `web/src/bracket.ts`: `bracketRounds(matches)` arma Cuartos → Semis → Final en orden.
- Vista Bracket: columnas en desktop, lista por ronda en celular. Cada serie muestra marcador o predicción.

## Vista Meta (`#/meta`)

- Nueva pestaña en la barra (5 en total) y ruta `#/meta`.
- Sub-pestañas Campeones | Draft | Lados | Ritmo | Regiones; selector de muestra mientras exista la guía, con aviso
  "Guía: partidas de las ligas en los parches 16.17–16.18, no de Worlds".
- **Campeones:** tabla ordenable (presencia por defecto), monograma en hexágono. Menos de 5 partidas jugadas →
  etiqueta "pocas partidas" en el winrate.
- **Draft:** ranking por `first_rotation`, con picks y bans.
- **Lados:** barras azul/rojo (Chart.js) total y por fase, con nota de confusión: en Bo3/Bo5 el perdedor de la
  partida anterior elige lado.
- **Ritmo:** duración mediana y kills/min por fase (Chart.js), con nota de por qué mediana.
- **Regiones:** tabla de winrate entre regiones, con nota de que solo cuentan partidas contra otras regiones.
- Estados de carga y de "sin datos todavía" en todas las sub-vistas.

## Conceptos para explicar en la página (modo aprendizaje)

- Presencia vs. pick rate.
- Winrate con muestras chicas (umbral de 5 partidas).
- Mediana vs. promedio.
- Confusión en el winrate por lado.
- Por qué las regiones solo se comparan en partidas entre regiones.

## Tests

- pytest: `draft_slots` por lado; `champion_stats` (presencia con un campeón solo baneado, winrate null sin picks);
  `pace_stats` (mediana con un valor extremo); `region_stats` excluye partidas de la misma región; filtros de
  muestra y la regla de los 10 partidos; contrato de `champions.json` y `meta.json`; validación.
- vitest: `swissRecords` (récords, clasificados y eliminados, ronda sin equipos), `bracketRounds`, selector de
  muestra.

## Fuera de alcance

Builds, runas, objetos, sinergias entre campeones, pick'em.
