import { drawBarChart } from '../charts/barChart';
import type { SiteData } from '../data';
import { PHASE_LABELS } from '../format';
import { escapeHtml } from '../html';
import { defaultSample, minutes, paceRows, PHASES, sampleOptions } from '../meta';
import { FEW_GAMES, fmt, pct, sortBy } from '../stats';
import type { ChampionEntry, MetaSample, Phase, SampleId } from '../types';
import { champHex } from './player';

type Tab = 'campeones' | 'draft' | 'lados' | 'ritmo' | 'regiones';
const TABS: [Tab, string][] = [['campeones', 'Campeones'], ['draft', 'Draft'], ['lados', 'Lados'], ['ritmo', 'Ritmo'], ['regiones', 'Regiones']];

// Estado mientras la página esté abierta; la muestra se elige la primera vez según los datos
const state = { tab: 'campeones' as Tab, sample: null as SampleId | null, sort: 'presence' as keyof ChampionEntry, dir: 'desc' as 'asc' | 'desc' };

// Limpieza del render actual (gráfico + listener). Vive a nivel de módulo: un click re-renderiza sin pasar por
// main.ts, y main.ts tiene que poder limpiar el último render, no el primero.
let teardown: () => void = () => {};

function seg(group: string, options: [string, string][], current: string, label: string): string {
  const buttons = options.map(([id, text]) =>
    `<button type="button" data-${group}="${id}" aria-pressed="${id === current}">${escapeHtml(text)}</button>`).join('');
  return `<div class="seg" role="group" aria-label="${label}">${buttons}</div>`;
}

function empty(): string {
  return '<div class="state"><b>Todavía no hay partidas de Worlds 2026</b><span>El meta del torneo aparece después de las primeras partidas.</span></div>';
}

const COLUMNS: { id: keyof ChampionEntry; label: string; show: (c: ChampionEntry) => string }[] = [
  { id: 'presence', label: 'Presencia', show: (c) => pct(c.presence) },
  { id: 'picks', label: 'Picks', show: (c) => String(c.picks) },
  { id: 'bans', label: 'Bans', show: (c) => String(c.bans) },
  { id: 'winrate', label: '% Vict.', show: (c) => (c.picks < FEW_GAMES && c.winrate !== null ? `${pct(c.winrate)} <span class="muted">· pocas</span>` : pct(c.winrate)) },
];

function header(): string {
  return COLUMNS.map((c) => {
    const active = c.id === state.sort;
    const sortState = active ? (state.dir === 'desc' ? 'descending' : 'ascending') : 'none';
    return `<th class="num" aria-sort="${sortState}"><button type="button" class="sort" data-sort="${c.id}">${c.label}${active ? (state.dir === 'desc' ? ' ▼' : ' ▲') : ''}</button></th>`;
  }).join('');
}

function champions(rows: ChampionEntry[]): string {
  if (!rows.length) return empty();
  // El % de victorias de un campeón con menos de 5 picks no se ordena: 3 de 3 = 100% engañaría
  const key = (c: ChampionEntry) => (state.sort === 'winrate' && c.picks < FEW_GAMES ? null : (c[state.sort] as number | string | null));
  const body = sortBy(rows, key, state.dir).map((c) => `
    <tr><td><span class="champ-cell">${champHex(c.champion)}<b>${escapeHtml(c.champion)}</b></span></td>${COLUMNS.map((col) => `<td class="num">${col.show(c)}</td>`).join('')}</tr>`).join('');
  return `
    <p class="note">Presencia = (picks + bans) / partidas: cuánto le importa el campeón al meta. Uno que se banea siempre tiene 0 picks y 100% de presencia. El % de victorias con menos de ${FEW_GAMES} picks dice "pocas" y no se ordena: con tan pocas partidas es casi azar.</p>
    <div class="table-wrap"><table class="rank"><thead><tr><th>Campeón · ${rows[0].games} partidas</th>${header()}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function draft(rows: ChampionEntry[]): string {
  if (!rows.length) return empty();
  const top = sortBy(rows, (c) => c.first_rotation, 'desc').slice(0, 20);
  const body = top.map((c, i) => `
    <tr><td class="num">${i + 1}</td><td><span class="champ-cell">${champHex(c.champion)}<b>${escapeHtml(c.champion)}</b></span></td>
      <td class="num">${pct(c.first_rotation)}</td><td class="num">${c.picks}</td><td class="num">${c.bans}</td></tr>`).join('');
  return `
    <p class="note">Prioridad = % de partidas en que el campeón se elige en la primera rotación (los 6 primeros picks) o se banea en la primera fase de bans. Mide qué se considera imprescindible, no qué gana más.</p>
    <div class="table-wrap"><table class="rank"><thead><tr><th class="num">#</th><th>Campeón</th><th class="num">Prioridad</th><th class="num">Picks</th><th class="num">Bans</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function phasesWithData(byPhase: Partial<Record<Phase, unknown>>): Phase[] {
  return PHASES.filter((p) => byPhase[p]);
}

function kpi(label: string, value: string, sub: string): string {
  return `<div class="bezel"><div class="core kpi"><span class="label">${label}</span><b>${value}</b><span class="muted">${sub}</span></div></div>`;
}

function sides(s: MetaSample): string {
  const t = s.sides.total;
  if (!t.games) return empty();
  return `
    <div class="kpis">
      ${kpi('Lado azul', pct(t.blue_winrate), `${t.blue_wins} de ${t.games} partidas`)}
      ${kpi('Lado rojo', pct(t.red_winrate), `${t.games - t.blue_wins} de ${t.games} partidas`)}
    </div>
    ${phasesWithData(s.sides.by_phase).length ? '<div class="chart-box"><canvas id="meta-chart" role="img" aria-label="Porcentaje de victorias de cada lado por fase"></canvas></div>' : ''}
    <p class="note">Cuidado al leerlo: en Bo3 y Bo5 el que perdió la partida anterior elige lado, y casi siempre elige azul. Entonces el rojo queda más seguido en manos del equipo que viene ganando: el % mezcla la ventaja del lado con quién lo elige.</p>`;
}

function pace(s: MetaSample): string {
  const t = s.pace.total;
  if (!t.games) return empty();
  return `
    <div class="kpis">
      ${kpi('Duración mediana', minutes(t.median_minutes), `${t.games} partidas`)}
      ${kpi('Kills por minuto', fmt(t.kills_per_min, 2), 'entre los dos equipos')}
    </div>
    ${phasesWithData(s.pace.by_phase).length ? `<div class="chart-box"><canvas id="meta-chart" role="img" aria-label="Duración mediana por fase"></canvas></div>
    <div class="table-wrap"><table class="rank"><thead><tr><th>Fase</th><th class="num">PJ</th><th class="num">Duración mediana</th><th class="num">Kills/min</th></tr></thead>
      <tbody>${paceRows(s.pace.by_phase).map((r) => `<tr><td>${r.label}</td><td class="num">${r.games}</td><td class="num">${r.duration}</td><td class="num">${r.kpm}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <p class="note">Mediana y no promedio: es la partida "del medio". Una partida de 50 minutos tira el promedio para arriba; la mediana casi no se mueve.</p>`;
}

function regions(s: MetaSample): string {
  if (!s.regions.length) return '<div class="state"><b>Todavía no hay partidas entre regiones</b><span>Aparecen cuando se crucen equipos de ligas distintas.</span></div>';
  const body = s.regions.map((r) => `
    <tr><td class="team"><b>${escapeHtml(r.region)}</b>${r.games < FEW_GAMES ? '<span class="muted">pocas partidas</span>' : ''}</td>
      <td class="num">${r.games}</td><td class="num">${r.wins}-${r.games - r.wins}</td><td class="num">${pct(r.winrate)}</td></tr>`).join('');
  return `
    <p class="note">Solo cuentan partidas contra otras regiones: en un LCK contra LCK la región gana siempre exactamente el 50%, así que esas partidas no dicen nada.</p>
    <div class="table-wrap"><table class="rank"><thead><tr><th>Región</th><th class="num">PJ</th><th class="num">V-D</th><th class="num">% Vict.</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function chartFor(canvas: HTMLCanvasElement, sample: MetaSample): Promise<() => void> {
  if (state.tab === 'lados') {
    const phases = phasesWithData(sample.sides.by_phase);
    return drawBarChart(canvas, phases.map((p) => PHASE_LABELS[p]), [
      { label: 'Azul', data: phases.map((p) => sample.sides.by_phase[p]?.blue_winrate ?? null), color: '--blue' },
      { label: 'Rojo', data: phases.map((p) => sample.sides.by_phase[p]?.red_winrate ?? null), color: '--red' },
    ], (v) => `${Math.round(v * 100)}%`);
  }
  const phases = phasesWithData(sample.pace.by_phase);
  return drawBarChart(canvas, phases.map((p) => PHASE_LABELS[p]), [
    { label: 'Duración mediana', data: phases.map((p) => sample.pace.by_phase[p]?.median_minutes ?? null), color: '--cyan' },
  ], minutes);
}

export function renderMeta(el: HTMLElement, data: SiteData): () => void {
  teardown();
  const options = sampleOptions(data.meta);
  if (!state.sample || !options.some(([id]) => id === state.sample)) state.sample = defaultSample(data.meta);
  const sample = data.meta.samples?.[state.sample];
  const champs = data.champions?.samples?.[state.sample] ?? [];
  const body = !sample ? empty()
    : state.tab === 'campeones' ? champions(champs)
    : state.tab === 'draft' ? draft(champs)
    : state.tab === 'lados' ? sides(sample)
    : state.tab === 'ritmo' ? pace(sample)
    : regions(sample);
  const guide = state.sample === 'guide'
    ? `<p class="note">Guía: partidas de las ligas en los parches ${escapeHtml(data.meta.guide_patch ?? '')}, no de Worlds. Sirve de orientación hasta que el torneo tenga 10 partidas; después se va.</p>`
    : '';

  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Parche ${escapeHtml(data.meta.worlds_patch ?? '—')} · datos de Oracle's Elixir</span>
      <h1>Meta</h1>
      ${seg('tab', TABS, state.tab, 'Secciones del meta')}
      ${options.length > 1 ? seg('sample', options, state.sample, 'Muestra') : ''}
      ${guide}
    </section>
    <section class="stack">${body}</section>`;

  // Gráfico de la sub-vista (si corresponde); se destruye al salir o al re-renderizar
  let destroy: (() => void) | null = null;
  let alive = true;
  const canvas = el.querySelector<HTMLCanvasElement>('#meta-chart');
  if (canvas && sample) {
    chartFor(canvas, sample).then((d) => { if (alive) destroy = d; else d(); }).catch(() => {
      canvas.parentElement?.remove(); // sin el gráfico la vista sigue teniendo los números
    });
  }

  el.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const d = button.dataset;
    if (d.tab) state.tab = d.tab as Tab;
    else if (d.sample) state.sample = d.sample as SampleId;
    else if (d.sort) {
      state.dir = state.sort === d.sort && state.dir === 'desc' ? 'asc' : 'desc';
      state.sort = d.sort as keyof ChampionEntry;
    } else return;
    renderMeta(el, data);
  };
  teardown = () => {
    alive = false;
    destroy?.();
    el.onclick = null;
  };
  return () => teardown();
}
