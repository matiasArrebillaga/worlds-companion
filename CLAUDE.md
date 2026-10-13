# CLAUDE.md — Worlds Companion

Página web de soporte para seguir el Mundial de League of Legends (Worlds 2026) con calendario, análisis de
datos y predicciones. Proyecto personal, sin fines de lucro, cuyo objetivo principal es aprender análisis de datos.

Diseño completo: `docs/superpowers/specs/2026-10-09-worlds-companion-design.md`.
Guía visual: https://claude.ai/artifact/QmLBrCguWxK5zjqBNwRW8m

## Modo aprendizaje

Estoy aprendiendo análisis de datos y estadística. Solo en esos temas (limpieza, stats, Elo, backtest, métricas):

- Explicá el concepto en detalle (qué es, por qué sirve, cómo se interpreta) antes de implementarlo.
- Cuando haya varias formas de resolverlo, mostrame las opciones y por qué elegís una.
- Señalá errores estadísticos comunes cuando aparezcan (muestras chicas, sobreajuste, correlación ≠ causalidad).

Para todo lo demás (frontend, infraestructura, CI, deploy): sin explicaciones extra, solo resumen breve de lo hecho.
En todo el código: claro y comentado por sobre "inteligente" o compacto.
No me dejes tareas para hacer a mí: implementá vos.

## Idioma

- Interfaz de la página, textos y explicaciones para mí: español.
- Código, nombres de variables, funciones y commits: inglés.
- Comentarios en el código: español.

## Stack

- Datos y modelos: Python 3.12, pandas, numpy (scikit-learn más adelante); matplotlib para exploración.
- Exploración: notebooks Jupyter en `notebooks/` (no se usan en producción).
- Frontend: sitio estático Vite + TypeScript sin framework, gráficos con Chart.js (D3 solo si Chart.js no alcanza).
- Deploy: GitHub Pages, actualizado por GitHub Actions (cron horario durante Worlds).
- Flujo: scripts de Python generan JSON en `web/public/data/`; el frontend solo lee esos JSON.
  El frontend nunca llama directamente a APIs externas (la única excepción son las imágenes de campeones,
  que se cargan del CDN de Data Dragon de Riot).

## Estructura

```
data/raw/               # descargas sin modificar + fetched_at (commiteado: caché del cron; no editar a mano)
data/processed/         # datos limpios (no se commitea; se regenera)
data/teams.csv          # alias de equipos → id canónico y región (a mano)
data/predictions.jsonl  # predicciones congeladas, append-only
pipeline/               # fetch, build (limpieza, stats, validación, export a JSON)
                        #   stats.py: agregados de equipos y jugadores (Oracle's Elixir) + historia del Elo
                        #   meta.py: campeones, draft, lados, ritmo y regiones (Oracle's Elixir)
models/                 # Elo y modelos de predicción
                        #   tournament.py: torneo completo (camino más probable + Monte Carlo, semilla fija)
notebooks/              # exploración, aprendizaje y backtest
tests/                  # pytest
web/                    # sitio (Vite)
web/public/data/        # JSON que consume el sitio
web/public/img/teams/   # logos de equipos (128 px, los baja pipeline/assets.py; commiteados)
```

## Comandos

```
python -m pipeline.fetch        # descarga datos nuevos a data/raw/
python -m pipeline.fetch_oracles  # extracto de Oracle's Elixir (como mucho una vez por día)
python -m pipeline.assets       # logos que falten + versión de Data Dragon (también lo corre pipeline.fetch)
python -m models.role_form      # reajusta los pesos de la forma por rol (necesita --history)
python -m pipeline.build        # limpia, corre el Elo, calcula stats, valida y genera los JSON del sitio
python -m models.elo            # recalcula ratings y predicciones (suelto, para experimentar)
pytest                          # tests
cd web && npm run dev           # servidor local
cd web && npm run build         # build de producción
```

## Fuente de datos

- Leaguepedia (API Cargo): calendario, resultados, rosters, stats por partida y drafts.
- El rate limit llega como error dentro de una respuesta HTTP 200: revisar el body, no solo el status.
- Cachear en `data/raw/` y no repetir descargas innecesarias. El historial de la temporada se baja una sola vez.
- Guardar siempre la fecha de descarga junto a los datos.
- Atribuir a Leaguepedia (CC-BY-SA).
- Logos de equipos: variante "square" de Leaguepedia (respaldo: campo Image de Teams), bajados una sola vez.
  El CDN de Fandom pide Referer de lol.fandom.com. Los logos negros se pasan a blanco (no se verían).
- Íconos de campeones: Data Dragon de Riot (`data/raw/ddragon_champions.json`: nombre en inglés → id de imagen).
- Oracle's Elixir: forma de los jugadores del modelo elo-2 y meta (parche de Worlds 16.20; guía: Demacia Cup, liga `DCGI`,
  hasta que Worlds tenga 10 partidas), con un extracto diario en `data/raw/oracles_2026.json`; CSV completos para los
  notebooks (`--history`, no se commitean). Atribuir en el footer.

## Secciones del sitio

- **Calendario** (inicio, `#/`): Lista | Bracket | Predicciones.
  - Lista: línea de tiempo (una tarjeta por fila) que abre en el próximo partido; arriba lo jugado, abajo lo que viene.
    En PC, columna lateral con "Hoy, en tu hora" y "Últimos resultados". Cada tarjeta lleva su predicción.
  - Bracket: Play-In · Suiza · Eliminatoria (abre en la fase que se está jugando).
    - Play-In y Eliminatoria: cuadro estilo lolesports (cajas unidas por conectores en PC; apiladas en celular).
    - Suiza: estructura de lolesports (columna por ronda, cajas por récord con Bo1/Bo3, Clasificados/Eliminados).
      En celular las rondas se apilan y la vista abre en la ronda en curso; nada se desliza de costado.
  - Predicciones: Aciertos (Resumen | Partidos acertados/errados) | Torneo | Cómo funciona.
    Torneo (para los pick'ems): misma distribución y formato que Bracket (Play-In · Suiza · Eliminatoria), con
    probabilidades. Play-In: cuadro con el camino más probable (pick y % por partido). Suiza: columnas por ronda con
    la chance de cada equipo de llegar con cada récord, y Clasificados/Eliminados con la chance de cada récord final.
    Eliminatoria: hasta el sorteo, columnas Cuartos/Semis/Final/Campeón con la chance de llegar; después, cuadro de
    picks. Los más probables van resaltados (tantos como lugares). Chances por Monte Carlo.
    Sale de `tournament.json`, se recalcula en cada build y no cuenta para Aciertos.
    Cómo funciona termina con un link al apunte completo `web/public/modelo.html` (modelo + estadística del sitio).
    Es el mismo HTML que el artefacto https://claude.ai/artifact/EGrK1XZGqehxXodqSoWX9X: si cambia uno, actualizar el otro.
- **Equipos** (`#/equipos`): Equipos | Jugadores | Análisis (temporada vs. contra equipos de Worlds, forma del modelo), con páginas por
  equipo y por jugador.
- **Meta**: Campeones (draft, rendimiento y resultado) | Panorama (lados, ritmo, regiones, ruido vs. señal, espejismos, flex,
  cambios del parche).
- La pestaña elegida va en la URL (atrás, recargar y compartir la conservan): `#/bracket/<fase>`,
  `#/predicciones/<pestaña>/<fase>`, `#/equipos/<pestaña>`, `#/meta/<pestaña>`. Filtros y orden quedan en memoria.
  Atrás/adelante vuelven al mismo lugar del scroll; equipo, jugador y partido tienen "Volver".
- Favorito del modelo: rombito dorado junto a la sigla (sin texto extra); "Sorpresa" si ganó el que tenía < 35%.
- Buscador en las tablas de Equipos, Jugadores y Campeones: ignora tildes, mayúsculas y signos, encuentra ligas
  ("lck") y conserva el puesto real de cada fila. Al escribir solo se reemplazan los resultados, no el campo.
- **Partido**: head-to-head.

## Reglas de fechas y horarios

- Guardar todas las fechas en UTC (ISO 8601).
- Mostrar en la zona horaria del navegador; si no se puede detectar, `America/Argentina/Buenos_Aires`.
- Partidos sin horario confirmado se muestran como "a confirmar", nunca con una hora inventada.

## Reglas de predicciones

- Cada predicción se guarda antes del partido en `data/predictions.jsonl` con `created_at` y `model_version`.
- Las predicciones pasadas nunca se editan ni se borran: si el modelo cambia, sube `model_version`.
- Mostrar siempre probabilidades (ej. 64%), no solo un ganador.
- Métricas de evaluación: precisión, Brier score y gráfico de calibración.
- Indicar en la página que los Bo1 tienen alta varianza.

## Estilo visual

Estética "hextech de transmisión", oscura y elegante, original. 
Se usan recursos del juego (íconos de campeones) bajo la política de fan content de Riot; nunca logos ni marcas de
Riot Games (ni el de League of Legends ni el de Worlds). Fotos de jugadores: no. Solo modo oscuro.

| Token | Color | Uso |
|---|---|---|
| bg | `#090D18` | Fondo principal |
| sunken | `#05070E` | Pistas de barras, inputs |
| card | `#111A2E` | Tarjetas |
| raised | `#1C2842` | Hover, sub-pestaña activa, paneles laterales |
| card-hi | `#24324F` | Tarjeta del próximo partido |
| line | `#2A3858` | Divisores (solo decorativo) |
| line-ctl | `#6A7AA3` | Bordes de controles |
| fg | `#F5F7FC` | Texto principal |
| fg2 | `#A6B1C8` | Texto secundario |
| fg3 | `#6F7B96` | Texto terciario (conectores, vacíos) |
| gold | `#D4AE52` | Importancia: favorito, pestaña activa, final |
| cyan | `#45CCD4` | Estado e interacción: en curso, foco |
| win | `#52C285` | Victoria |
| loss | `#F0606A` | Derrota |
| blue | `#4F95F0` | Lado azul |
| red | `#F07F55` | Lado rojo (coral, distinto de derrota) |

- Regiones (`--region-*`, rombito junto a la sigla): KR blanco `#F2F4F8`, CN rojo `#E8424F`, EU cian `#4DD9E8`,
  NA azul `#4F7BFF`, BR verde `#3DDC84`, APAC violeta `#A57CFF`.
- Tarjetas por estado: jugada apagada, próxima en card-hi con borde dorado, en curso con borde cian.

- Todo como variables CSS en `:root`; nunca colores sueltos en componentes.
- Contraste mínimo WCAG AA. No transmitir información solo con color: lado como chip AZUL/ROJO, resultado como V/D.
- Colores por región: valores en `styles.css` (`--region-*`), elección por equipo en `web/src/theme/regions.ts`.
- Tipografía (Google Fonts): Saira Condensed 600–700 para títulos (mayúsculas, leve espaciado),
  Plus Jakarta Sans para texto, JetBrains Mono con `tabular-nums` para números.
- Tarjetas con esquinas cortadas (clip-path) y borde degradé dorado→cian sutil; panal de hexágonos muy tenue.
- Campeones: ícono de Data Dragon recortado en hexágono; si no carga, monograma.
- Equipos: logo junto a la sigla, subrayado con el color de la región; sin logo, rombito de la región.
- Mobile first: se usa mucho desde el celular mientras se mira el partido.
- Gráficos con fondo transparente, grillas tenues y tooltips con el dato exacto.
- Animaciones sutiles y cortas con `cubic-bezier(.32,.72,0,1)`; respetar `prefers-reduced-motion`.
- Estados de carga y de "sin datos todavía" en todas las secciones.

## Calidad

- Funciones de limpieza y del modelo con tests en `tests/`.
- Validar los JSON exportados (que no falten campos ni haya equipos duplicados).
- `data/processed/` y otros datos regenerables no se suben al repo.
- Commits chicos y descriptivos (Conventional Commits: `feat:`, `fix:`, `data:`, `docs:`, `test:`).

## Aviso legal

El footer de todas las páginas debe incluir: "Worlds Companion no está respaldado por Riot Games y no refleja
las opiniones de Riot Games ni de nadie involucrado oficialmente en la producción o gestión de League of Legends.
League of Legends y Riot Games son marcas registradas de Riot Games, Inc." y, como se usan recursos de Riot,
"Worlds Companion se creó bajo la política «Legal Jibber Jabber» de Riot Games usando recursos propiedad de
Riot Games. Riot Games no respalda ni patrocina este proyecto."

## Glosario

- **GD@15:** diferencia de oro al minuto 15 (Oracle's Elixir; a parte de la LPL le falta, se trata como dato faltante).
- **DPM:** daño a campeones por minuto.
- **KP:** participación en asesinatos del equipo.
- **Bo1 / Bo3 / Bo5:** series al mejor de 1, 3 o 5 partidas.
- **Fase suiza:** los equipos con el mismo récord se enfrentan entre sí; 3 victorias clasifican, 3 derrotas eliminan.
- **Elo:** rating que sube al ganar y baja al perder; la diferencia entre dos equipos da la probabilidad de victoria.
- **Brier score:** error cuadrático medio de las probabilidades; 0 es perfecto, 0.25 es tirar una moneda.
- **Monte Carlo:** jugar el torneo muchas veces sorteando cada serie con la probabilidad del modelo y contar
  cuántas veces pasa cada cosa. Con 10.000 simulaciones el error de cada porcentaje es ≤ 0,5 puntos.
- **Camino más probable (chalk):** en cada partido avanza el favorito; da un pick por partido, no la chance del torneo.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Before any Glob or Grep, read graphify-out/GRAPH_REPORT.md first.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
