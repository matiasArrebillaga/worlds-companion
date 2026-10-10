import { drawBarChart } from '../charts/barChart';
import type { SiteData } from '../data';
import { PHASE_LABELS } from '../format';
import { escapeHtml } from '../html';
import { defaultSample, flexPicks, minutes, mirages, paceRows, PHASES, presenceShifts, range, sampleOptions, sideVerdict } from '../meta';
import { FEW_GAMES, fmt, pct, ROLE_LABELS, signed, sortBy } from '../stats';
import type { ChampionEntry, MetaSample, Phase, SampleId, SideSplit, WinrateNoise } from '../types';
import { champHex } from './player';

type Tab = 'campeones' | 'draft' | 'lados' | 'ritmo' | 'regiones' | 'analisis';
const TABS: [Tab, string][] = [['campeones', 'Campeones'], ['draft', 'Draft'], ['lados', 'Lados'], ['ritmo', 'Ritmo'], ['regiones', 'Regiones'], ['analisis', 'Análisis']];
const NOISE_MIN_PICKS = 5; // igual que en pipeline/meta.py

// Estado mientras la página esté abierta; la muestra se elige la primera vez según los datos
const state = { tab: 'campeones' as Tab, sample: null as SampleId | null, sort: 'presence', dir: 'desc' as 'asc' | 'desc' };

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

const COLUMNS: { id: string; label: string; value: (c: ChampionEntry) => number | null; show: (c: ChampionEntry) => string }[] = [
  { id: 'presence', label: 'Presencia', value: (c) => c.presence, show: (c) => pct(c.presence) },
  { id: 'pick_rate', label: '% Pick', value: (c) => c.pick_rate ?? null, show: (c) => pct(c.pick_rate ?? null) },
  { id: 'ban_rate', label: '% Ban', value: (c) => c.ban_rate ?? null, show: (c) => pct(c.ban_rate ?? null) },
  { id: 'picks', label: 'Picks', value: (c) => c.picks, show: (c) => String(c.picks) },
  { id: 'bans', label: 'Bans', value: (c) => c.bans, show: (c) => String(c.bans) },
  // El % de victorias de un campeón con menos de 5 picks no se ordena: 3 de 3 = 100% engañaría
  { id: 'winrate', label: '% Vict.', value: (c) => (c.picks < FEW_GAMES ? null : c.winrate),
    show: (c) => (c.picks < FEW_GAMES && c.winrate !== null ? `${pct(c.winrate)} <span class="muted">· pocas</span>` : pct(c.winrate)) },
  { id: 'kda', label: 'KDA', value: (c) => c.kda ?? null, show: (c) => fmt(c.kda ?? null, 2) },
  { id: 'cs_min', label: 'CS/min', value: (c) => c.cs_min ?? null, show: (c) => fmt(c.cs_min ?? null, 1) },
  { id: 'dpm', label: 'DPM', value: (c) => c.dpm ?? null, show: (c) => fmt(c.dpm ?? null) },
  { id: 'kp', label: 'KP', value: (c) => c.kp ?? null, show: (c) => pct(c.kp ?? null) },
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
  const column = COLUMNS.find((c) => c.id === state.sort) ?? COLUMNS[0];
  const body = sortBy(rows, column.value, state.dir).map((c) => `
    <tr><td><span class="champ-cell">${champHex(c.champion)}<b>${escapeHtml(c.champion)}</b></span></td>${COLUMNS.map((col) => `<td class="num">${col.show(c)}</td>`).join('')}</tr>`).join('');
  return `
    <p class="note">Presencia = % Pick + % Ban: cuánto le importa el campeón al meta. Uno que se banea siempre tiene 0 picks y 100% de presencia. El % de victorias con menos de ${FEW_GAMES} picks dice "pocas" y no se ordena: con tan pocas partidas es casi azar. KDA, CS/min, DPM y KP son de los jugadores que lo usaron, sumando todas sus partidas.</p>
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

// ---- Sub-pestaña Análisis: lo que se puede (y no se puede) concluir de los números ----

function noiseBlock(noise: WinrateNoise | null | undefined, k: number | undefined): string {
  if (!noise) return `<h2>¿Cuánto es ruido?</h2><div class="state"><b>Todavía hay pocos campeones con ${NOISE_MIN_PICKS} picks o más</b><span>La medición aparece cuando haya más partidas.</span></div>`;
  const realSpread = Math.round(Math.sqrt(noise.true_var) * 100);
  return `<h2>¿Cuánto es ruido?</h2>
    <div class="kpis">
      ${kpi('Azar', pct(noise.noise_share), 'de las diferencias de % de victorias')}
      ${kpi('Diferencia real', `±${realSpread} pts`, 'típica entre campeones')}
      ${k ? kpi('Picks para creerle', String(k), 'mitad dato propio, mitad 50%') : ''}
    </div>
    <p class="note">Aunque todos los campeones fueran igual de buenos, sus % de victorias serían distintos por pura suerte: con pocas partidas, el azar mueve mucho el número. Comparamos la dispersión que se ve entre los ${noise.champions} campeones con ${NOISE_MIN_PICKS} picks o más contra la que daría el azar solo (binomial); lo que sobra es la diferencia real. Además, con 100 campeones unos 5 parecen "significativos" de casualidad: ojo con el que encabeza la tabla.</p>`;
}

function adjustedBlock(rows: ChampionEntry[], k: number | undefined): string {
  const top = sortBy(rows.filter((c) => c.picks > 0), (c) => c.winrate_adj ?? null, 'desc').slice(0, 15);
  if (!top.length || top[0].winrate_adj == null) return '';
  const cell = (name: string) => `<span class="champ-cell">${champHex(name)}<b>${escapeHtml(name)}</b></span>`;
  const body = top.map((c, i) => `
    <tr><td class="num">${i + 1}</td><td>${cell(c.champion)}</td><td class="num"><b>${pct(c.winrate_adj ?? null)}</b></td>
      <td class="num">${pct(c.winrate)} <span class="muted">${c.wins}-${c.picks - c.wins}</span></td><td class="num">${range(c.winrate_low, c.winrate_high)}</td></tr>`).join('');
  const odd = mirages(rows, 5).map((c) => `
    <tr><td>${cell(c.champion)}</td><td class="num">${pct(c.winrate)}</td><td class="num">${pct(c.winrate_adj ?? null)}</td><td class="num">${c.picks}</td></tr>`).join('');
  const kk = k ?? 'k';
  return `<h2>% de victorias ajustado</h2>
    <p class="note">Ajustado = (victorias + ${kk}/2) / (picks + ${kk}): se le suman ${kk} partidas "imaginarias" al 50%. Con pocos picks queda cerca de 50%; con muchos manda el dato propio. El ${kk} sale de la temporada de las ligas: es cuánta evidencia hace falta cuando las diferencias reales son así de chicas. Rango = dónde está el % real con 95% de confianza.</p>
    <div class="table-wrap"><table class="rank"><thead><tr><th class="num">#</th><th>Campeón</th><th class="num">Ajustado</th><th class="num">Crudo</th><th class="num">Rango</th></tr></thead><tbody>${body}</tbody></table></div>
    <h3 class="eyebrow">Espejismos: los que más cambian al ajustar</h3>
    <div class="table-wrap"><table class="rank"><thead><tr><th>Campeón</th><th class="num">Crudo</th><th class="num">Ajustado</th><th class="num">Picks</th></tr></thead><tbody>${odd}</tbody></table></div>`;
}

function sideRow(label: string, s: SideSplit | undefined): string {
  if (!s || !s.games) return '';
  return `<tr><td>${label}</td><td class="num">${s.games}</td><td class="num">${pct(s.blue_winrate)}</td><td class="num">${range(s.low, s.high)}</td><td>${sideVerdict(s.low, s.high)}</td></tr>`;
}

function sidesBlock(s: MetaSample): string {
  if (!s.sides.total.games) return '';
  return `<h2>Lados: ¿hay ventaja de verdad?</h2>
    <div class="table-wrap"><table class="rank"><thead><tr><th>Partidas</th><th class="num">PJ</th><th class="num">% azul</th><th class="num">Rango</th><th>Veredicto</th></tr></thead>
      <tbody>${sideRow('Todas', s.sides.total)}${sideRow('Partida 1 de la serie', s.sides.by_game?.first)}${sideRow('Partidas 2 en adelante', s.sides.by_game?.rest)}</tbody></table></div>
    <p class="note">Solo hay ventaja si todo el rango queda de un lado del 50%. La partida 1 es la medición más limpia: en las siguientes elige lado el que perdió, así que el lado se mezcla con quién viene ganando.</p>`;
}

function shiftsBlock(rows: ChampionEntry[]): string {
  const { up, down } = presenceShifts(rows, 8);
  if (!up.length && !down.length) return '';
  const table = (items: typeof up) => `<div class="table-wrap"><table class="rank">
    <thead><tr><th>Campeón</th><th class="num">Guía</th><th class="num">Worlds</th><th class="num">Cambio</th></tr></thead>
    <tbody>${items.map((x) => `<tr><td><span class="champ-cell">${champHex(x.champion)}<b>${escapeHtml(x.champion)}</b></span></td>
      <td class="num">${pct(x.before)}</td><td class="num">${pct(x.after)}</td><td class="num">${signed(x.delta * 100)} pts</td></tr>`).join('')}</tbody></table></div>`;
  return `<h2>Qué cambió con el parche de Worlds</h2>
    <p class="note">Presencia en Worlds contra la de la guía (ligas en los parches anteriores). La presencia se estabiliza mucho antes que el % de victorias: cada partida dice si el campeón apareció o no.</p>
    ${up.length ? `<h3 class="eyebrow">Suben</h3>${table(up)}` : ''}
    ${down.length ? `<h3 class="eyebrow">Bajan</h3>${table(down)}` : ''}`;
}

function flexBlock(rows: ChampionEntry[]): string {
  const flex = flexPicks(rows);
  if (!flex.length) return '';
  const body = flex.map((f) => `
    <tr><td><span class="champ-cell">${champHex(f.champion)}<b>${escapeHtml(f.champion)}</b></span></td>
      <td>${f.roles.map(([role, n]) => `${ROLE_LABELS[role]} ${n}`).join(' · ')}</td><td class="num">${f.picks}</td></tr>`).join('');
  return `<h2>Picks flex</h2>
    <p class="note">Campeones jugados en dos roles o más (al menos 2 partidas en cada uno). Un flex esconde para qué rol se eligió y el rival no puede contrarrestarlo: por eso suelen salir temprano en el draft.</p>
    <div class="table-wrap"><table class="rank"><thead><tr><th>Campeón</th><th>Roles</th><th class="num">Picks</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function spreadBlock(s: MetaSample): string {
  const t = s.pace.total;
  const pace = t.p25_minutes != null && t.p75_minutes != null ? `<h2>Ritmo: no solo el centro</h2>
    <p class="note">La mitad de las partidas dura entre <b>${minutes(t.p25_minutes)}</b> y <b>${minutes(t.p75_minutes)}</b> (mediana ${minutes(t.median_minutes)}). Ese rango (intercuartil) dice cuánto varían: si es angosto, casi todas las partidas se parecen.</p>` : '';
  const rows = s.regions.map((r) => `
    <tr><td class="team"><b>${escapeHtml(r.region)}</b></td><td class="num">${r.games}</td><td class="num">${pct(r.winrate)}</td><td class="num">${range(r.low, r.high)}</td></tr>`).join('');
  const regionsTable = rows ? `<h2>Regiones con su rango</h2>
    <p class="note">Con pocas partidas entre regiones el rango es enorme. Si los rangos de dos regiones se superponen mucho, todavía no se puede decir cuál es mejor.</p>
    <div class="table-wrap"><table class="rank"><thead><tr><th>Región</th><th class="num">PJ</th><th class="num">% Vict.</th><th class="num">Rango</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';
  return pace + regionsTable;
}

function analysis(s: MetaSample, rows: ChampionEntry[], noise: WinrateNoise | null | undefined, k: number | undefined): string {
  if (!s.games) return empty();
  return [noiseBlock(noise, k), adjustedBlock(rows, k), sidesBlock(s), shiftsBlock(rows), flexBlock(rows), spreadBlock(s)].join('');
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
    : state.tab === 'regiones' ? regions(sample)
    : analysis(sample, champs, data.champions?.analysis?.[state.sample], data.champions?.prior_picks);
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
      state.sort = d.sort;
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
