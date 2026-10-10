# Worlds Companion — Diseño

Fecha: 2026-10-09 · Estado: aprobado; actualizado con las convenciones de CLAUDE.md

## 1. Propósito

Página web personal y sin fines de lucro para seguir el Mundial de League of Legends (Worlds 2026):
calendario, análisis de datos y predicciones.

- **Para quién:** 60% uso propio y de un grupo de amigos, 40% proyecto de portfolio/aprendizaje de análisis de datos.
- **Éxito:** la uso a diario durante el torneo y el código/resultado se puede mostrar
  (incluida una evaluación honesta del modelo).
- **Plazo:** sin apuro. Si llega a Worlds 2026 (Play-In 15/10 → Final 14/11, EE.UU.), mejor;
  si no, sirve para MSI/Worlds 2027.
- **Restricción legal/estética:** no usar logos, arte oficial, fuentes ni assets de Riot Games.
  Citar Leaguepedia (CC-BY-SA). Aviso legal en el footer (sección 6).

## 2. Stack y convenciones

| Capa | Elección |
|---|---|
| Datos y modelo | Python 3.12, pandas, numpy (scikit-learn más adelante) |
| Exploración | Notebooks Jupyter en `notebooks/` con matplotlib (fuera de producción) |
| Frontend | Sitio estático Vite + TypeScript, sin framework, Chart.js (D3 solo si Chart.js no alcanza) |
| Deploy | GitHub Pages |
| Automatización | GitHub Actions |

**Regla central:** los scripts de Python generan JSON en `web/public/data/`; el frontend solo lee esos JSON.
El frontend nunca llama APIs externas.

**Idioma:** interfaz y textos de la página en español. Código, nombres y commits en inglés
(Conventional Commits: `feat:`, `fix:`, `data:`, `docs:`, `test:`). Comentarios en el código en español.

## 3. Fuente de datos

Solo **Leaguepedia (API Cargo)**: calendario, resultados, rosters, stats por jugador/partida, picks y bans.

- Rate limit agresivo: el error llega **dentro del cuerpo de una respuesta HTTP 200**. Hay que detectarlo
  leyendo el body.
- Todo lo descargado se cachea en `data/raw/` **con la fecha de descarga** (`fetched_at`) y no se repiten
  descargas innecesarias.
- Los wrappers de Python (`meeps`, `leaguepedia-parser`) no están verificados para 2026. Se decide en el plan
  si usar uno o consultas directas con `requests`.
- Métricas no disponibles en esta fuente (ej. GD@15) quedan fuera.
- Oracle's Elixir (agregado en las etapas 2 y 3): un extracto diario de 2026 alimenta la forma por rol del modelo
  (`elo-2`) y las estadísticas de equipos y jugadores (`teams.json`, `players.json`).

## 4. Arquitectura y flujo de datos

```
GitHub Actions (cron horario del 15/10 al 14/11; workflow_dispatch fuera de esas fechas)
 ├─ 1. python -m pipeline.fetch   → Leaguepedia → data/raw/ (solo lo nuevo; reintento con backoff)
 ├─ 2. python -m pipeline.build
 │     ├─ clean    → data/raw → data/processed (ids canónicos vía data/teams.csv)
 │     ├─ elo      → models.elo: ratings + probabilidades; congela predicciones en data/predictions.jsonl
 │     ├─ stats    → agregados por equipo, jugador, campeón, lado, fase, región
 │     ├─ validate → chequeos de cordura; si fallan, el job falla
 │     └─ export   → web/public/data/*.json
 ├─ 3. commit de data/raw/ y data/predictions.jsonl si cambiaron
 └─ 4. vite build → deploy GitHub Pages (solo si los pasos anteriores terminaron bien)
```

`python -m models.elo` también se puede correr suelto para experimentar (lee `data/processed/`).

### Estructura del repo

```
data/raw/                  descargas sin modificar + fetched_at (commiteado: es la caché del cron)
data/processed/            datos limpios (no se commitea; se regenera)
data/teams.csv             alias de nombres de equipo → id canónico, región (a mano)
data/predictions.jsonl     predicciones congeladas, append-only (commiteado)
pipeline/                  fetch.py, build.py (clean, stats, validate, export)
models/                    elo.py (+ futuros modelos)
notebooks/                 exploración y backtest
tests/                     pytest
web/                       Vite + TS; lee solo web/public/data/*.json
.github/workflows/         update.yml (cron + deploy), ci.yml (tests + build)
```

### Historial y frescura

- El Elo necesita los partidos de las ligas regionales y los torneos internacionales de 2026. Se descargan
  **una sola vez** a `data/raw/` (ya no cambian) para no castigar el rate limit.
- Cada hora solo se consultan los partidos de Worlds. Retraso aceptado: hasta 1 h después de cada game,
  más lo que tarde Leaguepedia en cargarlo. No hay datos en vivo.

### Contrato de datos (`web/public/data/`)

| Archivo | Contenido |
|---|---|
| `schedule.json` | Partidos: id, fecha UTC ISO 8601 o `null` si no está confirmada, fase (play-in / swiss / knockout), ronda, formato (Bo1/3/5), equipos, lado por game, resultado (si hay), predicción |
| `teams.json` | Por equipo: id, sigla, nombre, región, roster, récord, stats agregadas (winrate, winrate por lado, duración media, % primera sangre, % primer dragón, oro/min) |
| `players.json` | Por jugador: id, equipo, rol, KDA, CS/min, DPM, KP, campeones jugados, historial por partida |
| `champions.json` | Por campeón: picks, bans, presencia, winrate, prioridad de draft |
| `meta.json` | Hora de última actualización (UTC), agregados del meta (winrate por lado, duración por fase, por región), conteo de partidas |
| `elo.json` | Rating actual por equipo, historia de rating por partido, precisión del modelo (aciertos/total, Brier, calibración por tramos), `model_version` y parámetros (K, ajustes regionales) |

Los tipos TypeScript del contrato se escriben a mano en `web/src/types.ts`. Un test de Python verifica
que los JSON exportados tengan esas claves.

## 5. Modelo de predicción

- **Elo por game.** `P(A) = 1 / (1 + 10^((R_B − R_A) / 400))`.
- **Probabilidad de serie** derivada de la del game: binomial para Bo3/Bo5 (p. ej. 57% por game ≈ 64% en Bo5).
- **Comparación entre regiones:** el historial incluye los torneos internacionales de 2026 y cada liga
  arranca con un ajuste regional inicial.
- **Calibración:** K y ajustes regionales se eligen con un **backtest sobre Worlds 2024 y 2025**
  (minimizando el Brier score), en un notebook. Los valores elegidos quedan en el código y se publican en `elo.json`.
- **Predicciones congeladas:** antes de cada partido se agrega una línea a `data/predictions.jsonl` con
  `match_id`, probabilidades, `created_at` y `model_version`. Las líneas pasadas **nunca se editan ni se borran**;
  si el modelo cambia, sube `model_version`. La precisión mostrada se calcula solo con predicciones congeladas.
- **Presentación:** siempre como probabilidad (ej. 64%), nunca solo un ganador. La página indica que los Bo1
  tienen alta varianza.
- **Métricas publicadas:** precisión (aciertos/total), Brier score (referencia: moneda = 0.25), gráfico de
  calibración por tramos (50–60%, 60–70%, 70%+).
- **Fuera de alcance por ahora:** modelo con scikit-learn (regresión logística con más features), que tendrá
  que superar al Elo en el mismo backtest para reemplazarlo.

## 6. Frontend

### Navegación

Rutas por hash (funciona en GitHub Pages sin configuración). **Mobile first**: se usa mucho desde el celular
mientras se mira el partido. Barra de pestañas inferior en celular, barra flotante en desktop.

- **Logo → Hoy (`#/`):** próximo partido destacado con predicción y cuenta regresiva, partidos del día
  en hora local, últimos resultados (con ✓/✗ del modelo).
- **Calendario (`#/calendario`):** sub-vistas Lista por día | Suiza (columnas por récord) | Bracket. Filtro por fase.
- **Estadísticas (`#/estadisticas`):** sub-vistas Equipos | Jugadores (tablas ordenables).
  - `#/equipo/:id`: roster, stats, evolución del Elo (Chart.js), partidos.
  - `#/jugador/:id`: stats, campeones jugados, historial por partida.
- **Meta (`#/meta`):** sub-vistas Campeones | Draft | Lados | Ritmo | Regiones.
- **Predicciones (`#/predicciones`):** Próximos partidos | Cómo funciona | Aciertos (incluye calibración).
- **Partido (`#/partido/:id`):** head-to-head en espejo (stats por lado), duelos por rol, campeones más jugados,
  enfrentamientos previos en 2026, predicción.

### Fechas y horarios

- Todas las fechas se guardan en UTC (ISO 8601).
- Se muestran en la zona del navegador con `Intl.DateTimeFormat`; si no se puede detectar,
  `America/Argentina/Buenos_Aires`.
- Partidos sin horario confirmado (ej. rondas suizas antes del sorteo) se muestran como **"a confirmar"**,
  nunca con una hora inventada.

### Estados

Todas las secciones tienen estado de carga y de "sin datos todavía". Si un JSON no carga, se muestra un mensaje
claro, no una pantalla rota.

### Dirección visual

Referencia: artefacto "Worlds Companion · Guía visual" (https://claude.ai/artifact/QmLBrCguWxK5zjqBNwRW8m).

- Estilo "hextech de transmisión", oscuro y elegante, original. **Solo modo oscuro.**
- **Ornamento sutil:** esquinas cortadas (clip-path) con borde degradé dorado→cian tenue, filetes con rombo,
  panal de hexágonos muy tenue que se desvanece.
- **Tipografía (Google Fonts):** Saira Condensed 600–700 (display: siglas, títulos, pestañas; mayúsculas con
  leve espaciado), Plus Jakarta Sans (texto), JetBrains Mono (datos, con `tabular-nums`).
- **Paleta** (todo como variables CSS en `:root`; nunca colores sueltos en componentes):

| Token | Color | Uso |
|---|---|---|
| bg | `#0A0E1A` | Fondo principal |
| sunken | `#070A13` | Pistas de barras, inputs |
| card | `#131A2B` | Tarjetas |
| raised | `#1A2338` | Hover, sub-pestaña activa |
| line | `#24304A` | Divisores (solo decorativo) |
| line-ctl | `#56658A` | Bordes de controles (3:1) |
| fg | `#E8ECF4` | Texto principal |
| fg2 | `#8A95AD` | Texto secundario |
| gold | `#C8A24A` | Importancia: favorito, pestaña activa, final |
| cyan | `#3FC1C9` | Estado e interacción: en curso, foco, barras neutrales |
| win | `#4CAF7A` | Victoria |
| loss | `#E0565B` | Derrota |
| blue | `#4A8FE7` | Lado azul |
| red | `#E8784F` | Lado rojo (coral, para no confundirse con derrota) |

- **Accesibilidad:** contraste mínimo WCAG AA. Nunca información solo con color: el lado va como chip con
  texto (AZUL/ROJO) y el resultado como letra (V/D).
- **Regiones:** colores definidos una sola vez en `web/src/theme/regions.ts` (escala categórica del artefacto,
  que no reutiliza colores de lado ni de resultado). Escalas secuencial cian y divergente azul↔rojo también en el artefacto.
- **Gráficos:** fondo transparente, grilla tenue, tooltip con el dato exacto.
- **Campeones:** monograma en hexágono, sin retratos oficiales.
- **Movimiento:** animaciones sutiles y cortas con una sola curva `cubic-bezier(.32,.72,0,1)`. Las barras de
  probabilidad se llenan al cargar, hay un pulso cian solo en estados "en curso" y todo se desactiva con
  `prefers-reduced-motion`. Sin revelado al scrollear y con blur solo en la barra fija.
- **Densidad de dashboard:** 16–24 px dentro de tarjetas, ~64 px entre secciones.
- Funciona desde 360 px de ancho; las tablas anchas scrollean dentro de su contenedor.

### Footer (en todas las páginas)

> Worlds Companion no está respaldado por Riot Games y no refleja las opiniones de Riot Games ni de nadie
> involucrado oficialmente en la producción o gestión de League of Legends. League of Legends y Riot Games
> son marcas registradas de Riot Games, Inc.

Más la atribución a Leaguepedia (CC-BY-SA).

## 7. Manejo de errores

| Situación | Comportamiento |
|---|---|
| Rate limit / error de Leaguepedia | Detectado en el body; reintento con backoff exponencial; tras 5 intentos el job falla |
| Job falla | No se despliega; el sitio sigue con la última versión buena; GitHub avisa por mail |
| Validación falla (calendario vacío, equipo desconocido o duplicado, campo faltante, probabilidad fuera de [0,1]) | El job falla, no se publica |
| Nombre de equipo no reconocido | Se resuelve con `data/teams.csv`; si falta, la validación falla y nombra el alias |
| Datos atrasados | "Actualizado hace X" siempre visible, en tono de advertencia si pasaron más de 3 h en día de partido |
| JSON no carga en el navegador | Mensaje claro en la vista, sin pantalla rota |

## 8. Testing

- **pytest** (en `tests/`) para funciones puras de limpieza y del modelo: probabilidad y actualización del Elo,
  probabilidad de serie, agregados de stats (con un CSV chico de muestra), detección de rate limit (respuesta
  grabada), validación, append-only de predicciones, y que los JSON exportados respeten el contrato.
- La red real no se testea en CI.
- **Frontend:** `tsc` + `vite build`. `vitest` solo para formateadores (hora local, "a confirmar", porcentajes, duración).
- **CI (`ci.yml`):** en cada push corre pytest, tsc, vitest y build.
- **Evaluación del modelo:** backtest en notebook (no es test unitario).

## 9. Fuera de alcance

Login, pick'em con amigos, datos en vivo, internacionalización, modo claro, retratos o arte oficial de campeones.

## 10. Orden de construcción sugerido

1. Fetch de Worlds + `schedule.json` + `meta.json`; frontend con Hoy y Calendario (lista); footer; deploy.
2. Historial + Elo + predicciones congeladas + backtest; Predicciones y la predicción en las tarjetas.
3. Stats: Estadísticas, páginas de equipo y jugador, head-to-head.
4. Meta, vistas Suiza y Bracket.
5. Estilos de juego (no transitividad, "piedra, papel o tijera"): el Elo usa un solo número por equipo y no
   puede representar que A > B > C > A. Primero se mide en un notebook si los errores del Elo se explican por
   diferencias de estilo (duración media, % primera sangre, % primer dragón/torre; datos de Leaguepedia), con
   el efecto encontrado en 2024 y confirmado en 2025. Solo si aparece, se agrega como interacción de estilos en
   un modelo nuevo (regresión logística o Elo multidimensional) que reemplaza al Elo únicamente si le gana en
   el mismo backtest. Cuidado: pocos cruces por par de equipos, riesgo de ver patrones en el ruido, el estilo
   cambia con el parche.

Cada etapa deja el sitio desplegado y usable.
