import type { SiteData } from '../data';
import { formatDayShort, formatPercent, roundLabel } from '../format';
import { escapeHtml } from '../html';
import { favorite, verdict } from '../predictions';
import { dayKeyOf } from '../schedule';
import type { CalibrationBucket, Elo, Match } from '../types';
import { tournamentView } from './tournament';
import { how } from './ui';

// Sub-vista Predicciones del calendario: Aciertos (Resumen | Partidos), Torneo (para los pick'ems) y Cómo funciona.
// Los próximos partidos ya muestran su probabilidad en el calendario y el Elo está en Equipos.
type Tab = 'aciertos' | 'torneo' | 'como';
type HitsTab = 'resumen' | 'partidos';
type Filter = 'all' | 'hit' | 'miss';
const TABS: [Tab, string][] = [['aciertos', 'Aciertos'], ['torneo', 'Torneo'], ['como', 'Cómo funciona']];
const HITS_TABS: [HitsTab, string][] = [['resumen', 'Resumen'], ['partidos', 'Partidos']];
const FILTERS: [Filter, string][] = [['all', 'Todos'], ['hit', 'Acertados'], ['miss', 'Errados']];

// Lo elegido se recuerda mientras la página esté abierta
const state: { tab: Tab; hits: HitsTab; filter: Filter } = { tab: 'aciertos', hits: 'resumen', filter: 'all' };

// Plegado como el resto de las explicaciones: está, pero solo se abre si el usuario quiere
export const BO1_NOTE = how('Los Bo1 tienen alta varianza: una sola partida decide la serie, así que un favorito al 65% pierde una de cada tres. Mirá el porcentaje, no solo quién es el favorito.', '¿Por qué el favorito puede perder un Bo1?');

const pct = (x: number) => `${Math.round(x * 100)}%`;

function empty(title: string, detail: string): string {
  return `<div class="state"><b>${title}</b><span>${detail}</span></div>`;
}

function seg(group: string, options: [string, string][], selected: string, label: string, small = false): string {
  const buttons = options.map(([id, text]) =>
    `<button type="button" data-${group}="${id}" aria-pressed="${id === selected}">${escapeHtml(text)}</button>`).join('');
  return `<div class="seg${small ? ' small' : ''}" role="group" aria-label="${label}">${buttons}</div>`;
}

function howItWorks(elo: Elo): string {
  const offsets = Object.entries(elo.params.region_offsets)
    .filter(([, v]) => v !== 0)
    .map(([region, v]) => `${escapeHtml(region)} ${v > 0 ? '+' : ''}${v}`)
    .join(' · ') || 'sin ajustes';
  const b = elo.backtest;
  const r = elo.role_form;
  return `
    <div class="prose stack">
      <h2>Elo por partida</h2>
      <p>Cada equipo tiene un rating. La diferencia entre dos ratings se convierte en probabilidad de ganar una partida: con 100 puntos de diferencia, el favorito gana el 64% de las veces. Después de cada partida el ganador suma puntos y el perdedor resta los mismos; una sorpresa mueve más los ratings que un resultado esperado.</p>
      <h2>De partida a serie</h2>
      <p>Para un Bo3 o un Bo5 se suman todas las formas de llegar primero a 2 o 3 victorias. Con 57% por partida, el favorito gana el 60% de los Bo3 y el 63% de los Bo5: cuantas más partidas, menos pesa la suerte. Supone que cada partida es independiente de la anterior, lo que es solo una aproximación.</p>
      <h2>Regiones</h2>
      <p>Las ligas casi no se cruzan entre sí, así que cada equipo arranca la temporada con un ajuste según su región (${offsets}) y los torneos internacionales de 2026 corrigen el resto. K = ${elo.params.k}: cuánto se mueve el rating después de cada partida.</p>
      <h2>Forma de los jugadores</h2>
      <p>Encima del Elo se suma cómo viene jugando cada titular comparado con el promedio de su rol: diferencia de oro, experiencia y farmeo al minuto 15 contra su rival directo, participación en kills, muertes, % del daño del equipo y daño por cada unidad de oro recibido. La forma reciente pesa más (una partida de hace 10 pesa la mitad que la última) y un jugador nuevo arranca en el promedio. Se compara la forma de los dos jugadores de cada rol; el top y el mid son los que más mueven la predicción.</p>
      <p>Se supone que cada equipo juega con su última alineación. Probado en el ${escapeHtml(r.test.tournament)}, que el modelo no había visto: el Brier score bajó de ${r.test.brier_elo.toFixed(3)} (solo Elo) a ${r.test.brier_model.toFixed(3)} en ${r.test.games} partidas. Datos de jugadores: <a href="https://oracleselixir.com" target="_blank" rel="noopener">Oracle's Elixir</a>.</p>
      <h2>¿Funciona?</h2>
      <p>Los valores se eligieron con la temporada ${b.calibration_year} y se probaron en ${b.validation_year}, que el modelo no había visto. En ${b.validation_games} partidas entre regiones distintas, el Brier score fue ${b.validation_brier.toFixed(3)} (tirar una moneda da 0.250; el Elo sin ajuste regional, ${b.baseline_brier.toFixed(3)}). En las ${b.worlds_series} series de Worlds ${b.validation_year} acertó el ${pct(b.worlds_accuracy)}.</p>
      <h2>Reglas</h2>
      <p>Cada predicción se guarda antes del partido y nunca se edita. Si el modelo cambia, cambia su versión (actual: ${escapeHtml(elo.model_version)}) y los aciertos se cuentan por separado.</p>
      ${BO1_NOTE}
    </div>`;
}

function calibrationRow(c: CalibrationBucket): string {
  if (!c.n || c.predicted === null || c.observed === null) {
    return `<div class="calib-row"><span class="label">Favorito con ${c.label} · sin partidos</span></div>`;
  }
  return `
    <div class="calib-row">
      <span class="label">Favorito con ${c.label} · ${c.n} ${c.n === 1 ? 'partido' : 'partidos'}</span>
      <div class="calib-line"><span>Predicho</span><span class="bar gold" aria-hidden="true"><i style="width:${(c.predicted * 100).toFixed(1)}%"></i></span><b>${pct(c.predicted)}</b></div>
      <div class="calib-line"><span>Real</span><span class="bar" aria-hidden="true"><i style="width:${(c.observed * 100).toFixed(1)}%"></i></span><b>${pct(c.observed)}</b></div>
    </div>`;
}

function summary(elo: Elo): string {
  const a = elo.accuracy;
  if (!a.n || a.accuracy === null || a.brier === null) {
    return empty('Todavía no hay partidos evaluados', 'Cada predicción se evalúa cuando termina su partido. Solo cuentan las que se guardaron antes de empezar.');
  }
  return `
    <div class="kpis">
      <div class="bezel"><div class="core kpi"><span class="label">Aciertos</span><b>${a.correct}/${a.n}</b><span class="muted">${pct(a.accuracy)}</span></div></div>
      <div class="bezel"><div class="core kpi"><span class="label">Brier score</span><b>${a.brier.toFixed(3)}</b><span class="muted">0 es perfecto · moneda = 0.250</span></div></div>
    </div>
    <h2>Calibración</h2>
    <p class="muted">Si el modelo está bien calibrado, los favoritos al 60–70% ganan entre el 60 y el 70% de las veces. Con pocos partidos estos números saltan mucho.</p>
    <div class="calib">${a.calibration.map(calibrationRow).join('')}</div>`;
}

// Una fila por partido evaluado: quién era favorito, cómo terminó y si el modelo acertó
function hitRow(m: Match, tz: string): string {
  const fav = favorite(m);
  if (!m.team1 || !m.team2 || !m.prediction || !fav) return '';
  const p = fav === 'team1' ? m.prediction.p_team1_series : 1 - m.prediction.p_team1_series;
  const day = dayKeyOf(m, tz);
  const v = verdict(m);
  return `
    <div class="hit-row">
      <span class="d">${day ? escapeHtml(formatDayShort(day)) : '—'}</span>
      <span class="m">${escapeHtml(m.team1.short)} vs ${escapeHtml(m.team2.short)}<small>Favorito: ${escapeHtml(m[fav]!.short)} ${formatPercent(p)} · ${escapeHtml(roundLabel(m.round))} · Bo${m.best_of}</small></span>
      <span class="s">${m.score ? `${m.score[0]}–${m.score[1]}` : ''}</span>
      <span class="mark ${v}">${v === 'hit' ? '✓ Acertó' : '✗ Falló'}</span>
    </div>`;
}

function matchList(matches: Match[], tz: string): string {
  // Más recientes primero
  const judged = matches.filter((m) => verdict(m) !== null).reverse();
  if (!judged.length) {
    return empty('Todavía no hay partidos evaluados', 'Cuando termine un partido con predicción guardada, aparece acá con su resultado.');
  }
  const visible = state.filter === 'all' ? judged : judged.filter((m) => verdict(m) === state.filter);
  const rows = visible.map((m) => hitRow(m, tz)).join('');
  return `
    ${seg('pfilter', FILTERS, state.filter, 'Filtrar partidos', true)}
    ${rows ? `<div class="hits">${rows}</div>` : empty('No hay partidos con este filtro', 'Probá con "Todos".')}`;
}

export function predictionsView(data: SiteData, tz: string): string {
  const body = state.tab === 'como' ? howItWorks(data.elo)
    : state.tab === 'torneo' ? tournamentView(data.tournament, tz)
    : `${seg('phits', HITS_TABS, state.hits, 'Aciertos', true)}
       ${state.hits === 'resumen' ? summary(data.elo) : matchList(data.schedule.matches, tz)}`;
  return `
    <section class="stack">
      <span class="eyebrow">Modelo ${escapeHtml(data.elo.model_version)}</span>
      ${seg('ptab', TABS, state.tab, 'Secciones de predicciones')}
      ${body}
    </section>`;
}

// Botones propios de esta sub-vista; devuelve true si cambió algo y hay que redibujar
export function handlePredictionsClick(button: HTMLButtonElement): boolean {
  const d = button.dataset;
  if (d.ptab) state.tab = d.ptab as Tab;
  else if (d.phits) state.hits = d.phits as HitsTab;
  else if (d.pfilter) state.filter = d.pfilter as Filter;
  else return false;
  return true;
}
