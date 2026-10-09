# Worlds Companion — Diseño

Fecha: 2026-10-09 · Estado: aprobado en brainstorming, pendiente de revisión del spec escrito

## 1. Propósito

Página web personal y sin fines de lucro para seguir el Mundial de League of Legends (Worlds 2026):
calendario, análisis de datos y predicciones.

- **Para quién:** 60% uso propio y de un grupo de amigos, 40% proyecto de portfolio/aprendizaje.
- **Éxito:** la uso a diario durante el torneo y el código/resultado se puede mostrar
  (incluida una evaluación honesta del modelo).
- **Plazo:** sin apuro. Si llega a Worlds 2026 (Play-In 15/10 → Final 14/11, EE.UU.), mejor;
  si no, sirve para MSI/Worlds 2027.
- **Restricción legal/estética:** no usar logos, arte oficial, fuentes ni assets de Riot Games.
  Citar Leaguepedia (CC-BY-SA). Aviso "no afiliado a Riot Games" en el pie.

## 2. Stack

| Capa | Elección |
|---|---|
| Datos y modelo | Python 3.12, pandas, numpy (scikit-learn más adelante) |
| Exploración | Notebooks Jupyter en `notebooks/` (fuera de producción) |
| Frontend | Sitio estático Vite + TypeScript, sin framework, Chart.js (D3 solo si Chart.js no alcanza) |
| Deploy | GitHub Pages |
| Automatización | GitHub Actions |

**Regla central:** los scripts de Python generan JSON en `web/public/data/`; el frontend solo lee esos JSON.
El frontend nunca llama APIs externas.

## 3. Fuente de datos

Solo **Leaguepedia (API Cargo)**: calendario, resultados, stats por jugador/partida, picks y bans.

- Rate limit agresivo: el error llega **dentro del cuerpo de una respuesta HTTP 200**. Hay que detectarlo
  leyendo el body.
- Los wrappers de Python (`meeps`, `leaguepedia-parser`) no están verificados para 2026. Se decide en el plan
  si usar uno o consultas directas con `requests`.
- Métricas no disponibles en esta fuente (ej. oro a los 15') quedan fuera.
- Oracle's Elixir queda como mejora futura.

## 4. Arquitectura y flujo de datos

```
GitHub Actions (cron horario del 15/10 al 14/11; workflow_dispatch fuera de esas fechas)
 ├─ 1. python -m pipeline
 │     ├─ fetch    → Leaguepedia (solo partidos de Worlds; reintento con backoff)
 │     ├─ stats    → pandas: agregados por equipo, jugador, campeón, lado, fase, región
 │     ├─ elo      → numpy: ratings + probabilidades de partidos pendientes
 │     ├─ validate → chequeos de cordura; si fallan, el job falla
 │     └─ export   → web/public/data/*.json
 └─ 2. vite build → deploy GitHub Pages (solo si el paso 1 terminó bien)
```

### Estructura del repo

```
pipeline/                  paquete Python (fetch, stats, elo, validate, export)
data/history/              snapshot de la temporada 2026 previa a Worlds (CSV, commiteado, se baja una vez)
data/teams.csv             alias de nombres de equipo → id canónico, región (mantenido a mano)
data/predictions.csv       predicciones congeladas (commiteado por el workflow)
notebooks/                 exploración y backtest
web/                       Vite + TS; lee solo /data/*.json
.github/workflows/         update.yml (cron + deploy), ci.yml (tests + build)
```

### Historial y frescura

- El Elo necesita los partidos de las ligas regionales y los torneos internacionales de 2026. Se descargan
  **una sola vez** a `data/history/` (ya no cambian) para no castigar el rate limit.
- Cada hora solo se consultan los partidos de Worlds. Retraso aceptado: hasta 1 h después de cada game,
  más lo que tarde Leaguepedia en cargarlo. No hay datos en vivo.

### Contrato de datos (`web/public/data/`)

| Archivo | Contenido |
|---|---|
| `schedule.json` | Partidos: id, fecha UTC, fase (play-in / swiss / knockout), ronda, formato (Bo1/3/5), equipos, lado por game, resultado (si hay), predicción congelada o vigente |
| `teams.json` | Por equipo: id, sigla, nombre, región, roster, récord, stats agregadas (winrate, winrate por lado, duración media, % primera sangre, % primer dragón, oro/min) |
| `players.json` | Por jugador: id, equipo, rol, KDA, CS/min, daño/min, participación en kills, campeones jugados, historial por partida |
| `champions.json` | Por campeón: picks, bans, presencia, winrate, prioridad de draft |
| `meta.json` | Hora de última actualización (UTC), agregados del meta (winrate por lado, duración por fase, por región), conteo de partidas |
| `elo.json` | Rating actual por equipo, historia de rating por partido, precisión del modelo (aciertos/total, Brier, calibración por tramos), parámetros usados (K, ajustes regionales) |

Los tipos TypeScript del contrato se escriben a mano en `web/src/types.ts`. Un test de Python verifica
que los JSON exportados tengan esas claves.

## 5. Modelo de predicción

- **Elo por game.** `P(A) = 1 / (1 + 10^((R_B − R_A) / 400))`.
- **Probabilidad de serie** derivada de la del game: binomial para Bo3/Bo5 (p. ej. 57% por game ≈ 64% en Bo5).
- **Comparación entre regiones:** el historial incluye los torneos internacionales de 2026 y cada liga
  arranca con un ajuste regional inicial.
- **Calibración:** K y ajustes regionales se eligen con un **backtest sobre Worlds 2024 y 2025**
  (minimizando el Brier score), en un notebook. Los valores elegidos quedan en el código y se publican en `elo.json`.
- **Predicciones congeladas:** al empezar un partido, su predicción se agrega a `data/predictions.csv` y no se
  vuelve a calcular. La precisión mostrada se calcula solo con predicciones congeladas.
- **Métricas publicadas:** aciertos/total, Brier score (referencia: moneda = 0.25), calibración por tramos
  (50–60%, 60–70%, 70%+).
- **Fuera de alcance por ahora:** modelo con scikit-learn (regresión logística con más features), que tendrá
  que superar al Elo en el mismo backtest para reemplazarlo.

## 6. Frontend

### Navegación

Rutas por hash (funciona en GitHub Pages sin configuración). Barra flotante en desktop y barra de pestañas
inferior en celular.

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

Horarios: el JSON trae UTC y el navegador convierte con `Intl.DateTimeFormat` a la zona del usuario.

### Dirección visual

Referencia: artefacto "Worlds Companion · Guía visual" (https://claude.ai/artifact/QmLBrCguWxK5zjqBNwRW8m).

- Estilo "hextech de transmisión", oscuro y elegante, original. **Solo modo oscuro.**
- **Ornamento sutil:** esquinas cortadas (clip-path) con borde degradé dorado→cian tenue, filetes con rombo,
  panal de hexágonos muy tenue que se desvanece.
- **Tipografía (par A, Google Fonts):** Saira Condensed (display: siglas, títulos, pestañas),
  Plus Jakarta Sans (texto), JetBrains Mono (datos, con cifras tabulares).
- **Paleta:**

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

  Además: lado siempre como chip con texto (AZUL/ROJO) y resultado siempre como letra (V/D), nunca solo color.
  Escalas para gráficos: categórica por región, secuencial cian, divergente azul↔rojo (definidas en el artefacto).
- **Campeones:** monograma en hexágono, sin retratos oficiales.
- **Movimiento:** una sola curva `cubic-bezier(.32,.72,0,1)`. Las barras de probabilidad se llenan al cargar,
  hay un pulso cian solo en estados "en curso" y todo se desactiva con `prefers-reduced-motion`.
  Sin revelado al scrollear y con blur solo en la barra fija.
- **Densidad de dashboard:** 16–24 px dentro de tarjetas, ~64 px entre secciones.
- Funciona desde 360 px de ancho; las tablas anchas scrollean dentro de su contenedor.

## 7. Manejo de errores

| Situación | Comportamiento |
|---|---|
| Rate limit / error de Leaguepedia | Detectado en el body; reintento con backoff exponencial; tras 5 intentos el job falla |
| Job falla | No se despliega; el sitio sigue con la última versión buena; GitHub avisa por mail |
| Validación falla (calendario vacío, equipo desconocido, probabilidad fuera de [0,1], etc.) | El job falla, no se publica |
| Nombre de equipo no reconocido | Se resuelve con `data/teams.csv`; si falta, la validación falla y nombra el alias |
| Datos atrasados | "Actualizado hace X" siempre visible, en tono de advertencia si pasaron más de 3 h en día de partido |
| JSON no carga en el navegador | Mensaje claro en la vista, sin pantalla rota |

## 8. Testing

- **pytest** para funciones puras: probabilidad y actualización del Elo, probabilidad de serie,
  agregados de stats (con un CSV chico de muestra), detección de rate limit (respuesta grabada),
  validación, y que los JSON exportados respeten el contrato.
- La red real no se testea en CI.
- **Frontend:** `tsc` + `vite build`. `vitest` solo para formateadores (hora local, porcentajes, duración).
- **CI (`ci.yml`):** en cada push corre pytest, tsc, vitest y build.
- **Evaluación del modelo:** backtest en notebook (no es test unitario).

## 9. Fuera de alcance

Login, pick'em con amigos, datos en vivo, internacionalización, modo claro, Oracle's Elixir,
modelo con scikit-learn, retratos o arte oficial de campeones.

## 10. Orden de construcción sugerido

1. Pipeline mínimo: fetch de Worlds + `schedule.json` + `meta.json`; frontend con Hoy y Calendario (lista); deploy.
2. Historial + Elo + predicciones congeladas + backtest; Predicciones y la predicción en las tarjetas.
3. Stats: Estadísticas, páginas de equipo y jugador, head-to-head.
4. Meta, vistas Suiza y Bracket.

Cada etapa deja el sitio desplegado y usable.
