import type { SiteData } from '../data';
import { PHASE_LABELS } from '../format';
import { escapeHtml } from '../html';
import { defaultSample, flexPicks, minutes, mirages, paceRows, PHASES, presenceShifts, range, sampleOptions, sideVerdict } from '../meta';
import { FEW_GAMES, fmt, pct, ROLE_LABELS, signed, sortBy } from '../stats';
import type { ChampionEntry, MetaSample, SampleId, SideSplit, WinrateNoise } from '../types';
import { champHex } from './player';
import { airyTable, axis, chips, dumbbell, how, kpiTiles, leaders, sortBar, subtabs, who, whisker, type Column, type Dir } from './ui';

type Tab = 'campeones' | 'panorama';
type View = 'principal' | 'resultado';
const TABS: [Tab, string][] = [['campeones', 'Campeones'], ['panorama', 'Panorama']];
const NOISE_MIN_PICKS = 5; // igual que en pipeline/meta.py

// Estado mientras la página esté abierta; la muestra se elige la primera vez según los datos
const state = { tab: 'campeones' as Tab, sample: null as SampleId | null, view: 'principal' as View, sort: 'presence', dir: 'desc' as Dir };

function empty(): string {
  return '<div class="state"><b>Todavía no hay partidas de Worlds 2026</b><span>El meta del torneo aparece después de las primeras partidas.</span></div>';
}

// ---- Campeones: tabla aireada ----

// Presencia partida en pick (lleno) y ban (rayado)
function pickBan(c: ChampionEntry): string {
  if (c.pick_rate == null || c.ban_rate == null) return '';
  return `<span class="pb" title="Pick ${pct(c.pick_rate)} · Ban ${pct(c.ban_rate)}" aria-hidden="true"><i class="p" style="width:${c.pick_rate * 100}%"></i><i class="b" style="width:${c.ban_rate * 100}%"></i></span>`;
}

const rate = (id: 'pick_rate' | 'ban_rate' | 'kp' | 'first_rotation', label: string, hint?: string): Column<ChampionEntry> =>
  ({ id, label, hint, value: (c) => c[id] ?? null, show: (c) => pct(c[id] ?? null), kind: 'share' });

const COL = {
  presence: { id: 'presence', label: 'Presencia', hint: 'pick + ban', value: (c) => c.presence, show: (c) => pct(c.presence), bar: pickBan, kind: 'share' },
  first_rotation: rate('first_rotation', 'Prioridad', '1ª rotación'),
  // % y no cantidad: los picks y bans absolutos ya están debajo del nombre
  pick_rate: rate('pick_rate', '% Pick'),
  ban_rate: rate('ban_rate', '% Ban'),
  kda: { id: 'kda', label: 'KDA', value: (c) => c.kda ?? null, show: (c) => fmt(c.kda ?? null, 2), kind: 'count' },
  dpm: { id: 'dpm', label: 'DPM', hint: 'daño/min', value: (c) => c.dpm ?? null, show: (c) => fmt(c.dpm ?? null), kind: 'count' },
  cs_min: { id: 'cs_min', label: 'CS/min', value: (c) => c.cs_min ?? null, show: (c) => fmt(c.cs_min ?? null, 1), kind: 'count' },
  kp: rate('kp', 'KP', 'part. kills'),
  winrate_adj: { id: 'winrate_adj', label: '% Vict.', hint: 'ajustado', value: (c) => c.winrate_adj ?? null, show: (c) => pct(c.winrate_adj ?? null),
    sub: (c) => `${pct(c.winrate)} crudo`, kind: 'diverge', ref: 0.5 },
  range: { id: 'range', label: 'Rango 95%', hint: 'del % real', value: (c) => c.winrate_low ?? null, show: (c) => range(c.winrate_low, c.winrate_high),
    bar: (c) => whisker(c.winrate_low, c.winrate_high, c.winrate, 0.1, 0.9), kind: 'share', wide: true },
} satisfies Record<string, Column<ChampionEntry>>;

// Draft y Rendimiento juntos; Resultado aparte
const VIEWS: Record<View, [string, [string, Column<ChampionEntry>[]][]]> = {
  principal: ['Draft y rendimiento', [['Draft', [COL.presence, COL.first_rotation, COL.pick_rate, COL.ban_rate]], ['Rendimiento', [COL.kda, COL.dpm, COL.cs_min, COL.kp]]]],
  resultado: ['Resultado', [['Resultado', [COL.winrate_adj, COL.range, COL.pick_rate, COL.ban_rate]]]],
};

const champWho = (c: ChampionEntry) => who(champHex(c.champion), escapeHtml(c.champion), `${c.picks} picks · ${c.bans} bans`);

function champions(rows: ChampionEntry[], k: number | undefined): string {
  if (!rows.length) return empty();
  const groups = VIEWS[state.view][1];
  const columns = groups.flatMap(([, cols]) => cols);
  const sort = columns.find((c) => c.id === state.sort) ?? columns[0];
  const played = rows.filter((c) => c.picks >= FEW_GAMES); // el daño o el % de un campeón con 2 picks no dice nada
  const views = chips('view', Object.entries(VIEWS).map(([id, [label]]) => [id, label]), state.view, 'Vista');
  const legend = columns.includes(COL.presence)
    ? '<div class="legend"><span><i class="lg-pick"></i>Pick</span><span><i class="lg-ban"></i>Ban</span><span>Presencia = las dos juntas</span></div>' : '';
  const kk = k ?? 'k';
  return `
    ${leaders([
      { column: COL.presence, label: 'Más presente', rows },
      { column: COL.first_rotation, label: 'Más prioridad', rows },
      { column: COL.winrate_adj, label: 'Mejor % ajustado', rows: played },
      { column: COL.dpm, label: 'Más daño', rows: played },
    ], champWho)}
    <div class="tools">${views}${sortBar(columns, sort.id, state.dir)}${legend}</div>
    ${airyTable({ rows: sortBy(rows, sort.value, state.dir), scale: rows, groups, first: `Campeón · ${rows[0].games} partidas`, whoOf: champWho, sort: sort.id, dir: state.dir })}
    ${how(`Presencia = % pick + % ban: cuánto le importa el campeón al meta. Uno que se banea siempre tiene 0 picks y 100% de presencia. Prioridad = % de partidas en que se elige en la primera rotación (los 6 primeros picks) o se banea en la primera fase de bans: mide qué se considera imprescindible, no qué gana más. KDA, CS/min, DPM y KP son de los jugadores que lo usaron. El % de victorias es el ajustado: (victorias + ${kk}/2) / (picks + ${kk}), o sea ${kk} partidas "imaginarias" al 50%; abajo va el crudo. Rango = dónde está el % real con 95% de confianza: si cruza la línea dorada del 50%, no se distingue de una moneda.`)}`;
}

// ---- Panorama: tablero ----

function sideRow(label: string, s: SideSplit | undefined): string {
  if (!s || !s.games) return '';
  return `<div class="lrow"><span class="lab">${label}<small>${s.games} partidas</small></span>${whisker(s.low, s.high, s.blue_winrate, 0.2, 0.8)}<span class="v">${pct(s.blue_winrate)}<small>${range(s.low, s.high)}</small></span></div>`;
}

function sidesModule(s: MetaSample): string {
  const t = s.sides.total;
  if (!t.games) return '';
  const phases = PHASES.map((p) => sideRow(PHASE_LABELS[p], s.sides.by_phase[p])).join('');
  return `<section class="mod"><header class="mh"><h2>Lados</h2><span class="q">¿Gana más el azul?</span></header>
    <div class="split" role="img" aria-label="Azul ${pct(t.blue_winrate)}, rojo ${pct(t.red_winrate)}">
      <span class="bl" style="flex:${t.blue_winrate ?? 0.5}"><small>AZUL</small>${pct(t.blue_winrate)}</span><span class="rd" style="flex:${t.red_winrate ?? 0.5}">${pct(t.red_winrate)}<small>ROJO</small></span></div>
    <span class="side-verdict">${sideVerdict(t.low, t.high)}</span>
    <div><div class="lrow head"><span></span>${axis([0.2, 0.35, 0.5, 0.65, 0.8], 0.2, 0.8, pct)}<span></span></div>
      ${sideRow('Todas', t)}${sideRow('Partida 1 de la serie', s.sides.by_game?.first)}${sideRow('Partidas 2 en adelante', s.sides.by_game?.rest)}${phases}</div>
    ${how('El % es del lado azul. Solo hay ventaja si toda la línea del rango queda de un lado del 50% (línea dorada). La partida 1 es la medición más limpia: en Bo3 y Bo5, después elige lado el que perdió, y casi siempre elige azul, así que el lado se mezcla con quién viene ganando.')}</section>`;
}

function paceModule(s: MetaSample): string {
  const t = s.pace.total;
  if (!t.games) return '';
  const [min, max] = [20, 45];
  const x = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
  const iqr = t.p25_minutes != null && t.p75_minutes != null && t.median_minutes != null ? `
    <div class="iqr"><span class="label">La mitad de las partidas dura entre ${minutes(t.p25_minutes)} y ${minutes(t.p75_minutes)}</span>
      <div class="track" role="img" aria-label="Rango intercuartil de ${minutes(t.p25_minutes)} a ${minutes(t.p75_minutes)}, mediana ${minutes(t.median_minutes)}">
        <span class="band" style="left:${x(t.p25_minutes)}%;width:${x(t.p75_minutes) - x(t.p25_minutes)}%"></span><span class="med" style="left:${x(t.median_minutes)}%"></span></div>
      ${axis([20, 25, 30, 35, 40, 45], min, max, (v) => `${v}'`)}</div>` : '';
  const phases = paceRows(s.pace.by_phase).map((r) => `
    <div class="lrow"><span class="lab">${r.label}<small>${r.games} partidas</small></span><span class="v left">${r.duration}<small>mediana</small></span><span class="v">${r.kpm}<small>kills/min</small></span></div>`).join('');
  return `<section class="mod"><header class="mh"><h2>Ritmo</h2><span class="q">¿Cuánto duran las partidas?</span></header>
    <div class="big"><div><span class="label">Duración mediana</span><b>${minutes(t.median_minutes)}</b></div><div><span class="label">Kills por minuto</span><b>${fmt(t.kills_per_min, 2)}</b></div></div>
    ${iqr}${phases ? `<div>${phases}</div>` : ''}
    ${how(`Mediana y no promedio: es la partida "del medio" de las ${t.games}. Una partida de 50 minutos tira el promedio para arriba; la mediana casi no se mueve. La franja es el rango intercuartil: si es angosta, casi todas las partidas se parecen.`)}</section>`;
}

function regionsModule(s: MetaSample): string {
  const head = `<header class="mh"><h2>Regiones</h2><span class="q">¿Qué liga gana más contra las otras?</span></header>`;
  if (!s.regions.length) return `<section class="mod">${head}<div class="state"><b>Todavía no hay partidas entre regiones</b><span>Aparecen cuando se crucen equipos de ligas distintas.</span></div></section>`;
  const rows = s.regions.map((r) => `
    <div class="lrow ${r.games < FEW_GAMES ? 'few' : ''}"><span class="lab"><b>${escapeHtml(r.region)}</b><small>${r.wins}-${r.games - r.wins}${r.games < FEW_GAMES ? ' · pocas' : ''}</small></span>
      ${whisker(r.low, r.high, r.winrate)}<span class="v">${pct(r.winrate)}<small>${range(r.low, r.high)}</small></span></div>`).join('');
  return `<section class="mod">${head}
    <div><div class="lrow head"><span></span>${axis([0, 0.25, 0.5, 0.75, 1], 0, 1, pct)}<span></span></div>${rows}</div>
    ${how('Solo cuentan partidas contra otras regiones: en un LCK contra LCK la región gana siempre exactamente el 50%. Con pocas partidas el rango es enorme; si los rangos de dos regiones se superponen mucho, todavía no se puede decir cuál es mejor.')}</section>`;
}

function noiseModule(noise: WinrateNoise | null | undefined, k: number | undefined): string {
  const head = `<header class="mh"><h2>¿Cuánto es ruido?</h2><span class="q">Diferencias de % de victorias entre campeones</span></header>`;
  if (!noise) return `<section class="mod s2">${head}<div class="state"><b>Todavía hay pocos campeones con ${NOISE_MIN_PICKS} picks o más</b><span>La medición aparece cuando haya más partidas.</span></div></section>`;
  const spread = Math.round(Math.sqrt(noise.true_var) * 100);
  return `<section class="mod s2">${head}
    <div class="noisebar" role="img" aria-label="${pct(noise.noise_share)} azar, ${pct(1 - noise.noise_share)} diferencia real">
      <span class="nz" style="flex:${noise.noise_share}">${pct(noise.noise_share)} azar</span><span class="rl" style="flex:${1 - noise.noise_share}">${pct(1 - noise.noise_share)}</span></div>
    <div class="big"><div><span class="label">Diferencia real típica</span><b>±${spread}<small> pts</small></b></div>${k ? `<div><span class="label">Picks para creerle a medias</span><b>${k}</b></div>` : ''}</div>
    ${how(`Aunque todos los campeones fueran igual de buenos, sus % de victorias serían distintos por pura suerte: con pocas partidas, el azar mueve mucho el número. Comparamos la dispersión entre los ${noise.champions} campeones con ${NOISE_MIN_PICKS} picks o más contra la que daría el azar solo (binomial); lo que sobra es la diferencia real.${k ? ` Con ${k} picks, el % ajustado es mitad dato propio y mitad 50%.` : ''}`)}</section>`;
}

function miragesModule(rows: ChampionEntry[]): string {
  const odd = mirages(rows, 5);
  if (!odd.length) return '';
  const body = odd.map((c) => `
    <div class="lrow">${who(champHex(c.champion), escapeHtml(c.champion), `${c.wins}-${c.picks - c.wins}`)}
      ${dumbbell(c.winrate ?? 0, c.winrate_adj ?? 0, 0, 1)}<span class="v">${pct(c.winrate_adj ?? null)}<small>${pct(c.winrate)} crudo</small></span></div>`).join('');
  return `<section class="mod s2"><header class="mh"><h2>Espejismos</h2><span class="q">Los que más cambian al ajustar</span></header>
    <div class="legend"><span><i class="lg-hollow"></i>Crudo</span><span><i class="lg-solid"></i>Ajustado</span></div>
    <div><div class="lrow head"><span></span>${axis([0, 0.5, 1], 0, 1, pct)}<span></span></div>${body}</div>
    ${how('Un 100% con 5 picks parece imbatible; ajustado queda cerca del 50%. Con 100 campeones, unos 5 parecen "significativos" de casualidad: ojo con el que encabeza cualquier tabla de % de victorias.')}</section>`;
}

function flexModule(rows: ChampionEntry[]): string {
  const flex = flexPicks(rows).slice(0, 8);
  if (!flex.length) return '';
  const body = flex.map((f) => `
    <div class="lrow flex">${who(champHex(f.champion), escapeHtml(f.champion), `${f.picks} picks`)}
      <span class="roles">${f.roles.map(([role, n]) => `<span>${ROLE_LABELS[role]} ${n}</span>`).join('')}</span></div>`).join('');
  return `<section class="mod s2"><header class="mh"><h2>Picks flex</h2><span class="q">Jugados en dos roles o más</span></header><div>${body}</div>
    ${how('Al menos 2 partidas en cada rol. Un flex esconde para qué rol se eligió y el rival no puede contrarrestarlo: por eso suele salir temprano en el draft.')}</section>`;
}

function shiftsModule(rows: ChampionEntry[]): string {
  const head = `<header class="mh"><h2>Cambios del parche</h2><span class="q">Presencia en Worlds contra la guía</span></header>`;
  const { up, down } = presenceShifts(rows, 5);
  if (!up.length && !down.length) return `<section class="mod">${head}<div class="state"><b>Aparece con las primeras partidas de Worlds</b><span>Compara la presencia de cada campeón en Worlds con la que tenía en la guía.</span></div></section>`;
  const list = (title: string, items: typeof up) => (items.length ? `<span class="label">${title}</span>${items.map((x) => `
    <div class="lrow">${who(champHex(x.champion), escapeHtml(x.champion), `${pct(x.before)} → ${pct(x.after)}`)}
      ${dumbbell(x.before, x.after, 0, 1)}<span class="v ${x.delta < 0 ? 'neg' : 'pos'}">${signed(x.delta * 100)}<small>pts</small></span></div>`).join('')}` : '');
  return `<section class="mod">${head}
    <div class="legend"><span><i class="lg-hollow"></i>Guía</span><span><i class="lg-solid"></i>Worlds</span></div>
    <div>${list('Suben', up)}${list('Bajan', down)}</div>
    ${how('La guía son las ligas en los parches anteriores. La presencia se estabiliza mucho antes que el % de victorias: cada partida dice si el campeón apareció o no.')}</section>`;
}

function panorama(s: MetaSample, rows: ChampionEntry[], noise: WinrateNoise | null | undefined, k: number | undefined): string {
  if (!s.games) return empty();
  const t = s.sides.total;
  const kpis = kpiTiles([
    ['Lado azul', pct(t.blue_winrate), sideVerdict(t.low, t.high)],
    ['Duración mediana', minutes(s.pace.total.median_minutes), `${s.pace.total.games} partidas`],
    ['Kills por minuto', fmt(s.pace.total.kills_per_min, 2), 'entre los dos equipos'],
    ['Azar', noise ? pct(noise.noise_share) : '—', 'de las diferencias de % de victorias'],
  ]);
  return `<div class="board">${kpis}${sidesModule(s)}${paceModule(s)}${noiseModule(noise, k)}${miragesModule(rows)}${flexModule(rows)}${regionsModule(s)}${shiftsModule(rows)}</div>`;
}

export function renderMeta(el: HTMLElement, data: SiteData): () => void {
  const options = sampleOptions(data.meta);
  if (!state.sample || !options.some(([id]) => id === state.sample)) state.sample = defaultSample(data.meta);
  const sample = data.meta.samples?.[state.sample];
  const champs = data.champions?.samples?.[state.sample] ?? [];
  const k = data.champions?.prior_picks;
  const body = !sample ? empty()
    : state.tab === 'campeones' ? champions(champs, k)
    : panorama(sample, champs, data.champions?.analysis?.[state.sample], k);
  const samples = options.length > 1
    ? `<div class="seg small" role="group" aria-label="Muestra">${options.map(([id, label]) => `<button type="button" data-sample="${id}" aria-pressed="${id === state.sample}">${escapeHtml(label)}</button>`).join('')}</div>`
    : '';
  const guide = state.sample === 'guide'
    ? `<p class="muted small-note">Guía: partidas de las ligas en los parches ${escapeHtml(data.meta.guide_patch ?? '')}, no de Worlds. Sirve de orientación hasta que el torneo tenga 10 partidas; después se va.</p>`
    : '';

  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Parche ${escapeHtml(data.meta.worlds_patch ?? '—')} · datos de Oracle's Elixir</span>
      <h1>Meta</h1>
      <div class="subhead">${subtabs('tab', TABS, state.tab, 'Secciones del meta')}${samples}</div>
      ${guide}
    </section>
    <section class="stack">${body}</section>`;

  el.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const d = button.dataset;
    if (d.tab) state.tab = d.tab as Tab;
    else if (d.sample) state.sample = d.sample as SampleId;
    else if (d.view) { state.view = d.view as View; state.dir = 'desc'; }
    else if (d.dir !== undefined) state.dir = state.dir === 'desc' ? 'asc' : 'desc';
    else if (d.sort) {
      state.dir = state.sort === d.sort && state.dir === 'desc' ? 'asc' : 'desc';
      state.sort = d.sort;
    } else return;
    renderMeta(el, data);
  };
  el.onchange = (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.dataset.sortselect === undefined) return;
    state.sort = select.value;
    state.dir = 'desc';
    renderMeta(el, data);
    el.querySelector<HTMLSelectElement>('#sort-select')?.focus();
  };
  return () => { el.onclick = null; el.onchange = null; };
}
