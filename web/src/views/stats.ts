import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { go, pick } from '../router';
import { logoImg, REGION_LEAGUES } from '../theme/regions';
import { minutes } from '../meta';
import { FEW_GAMES, fmt, formRanking, PERIODS, pct, periodOf, ROLE_LABELS, signed, sortBy, vsWorldsRows, type Period } from '../stats';
import type { PlayerEntry, PlayerStats, Role, TeamEntry, TeamStats } from '../types';
import { airyTable, axis, chips, dumbbell, how, leaders, matches, meter, noResults, ranks, searchBox, swapResults, sortBar, subtabs, who,
  type Column, type Dir } from './ui';

type Tab = 'equipos' | 'jugadores' | 'analisis';
type Table = 'equipos' | 'jugadores';

interface TeamRow { team: TeamEntry; s: TeamStats }
interface PlayerRow { player: PlayerEntry; s: PlayerStats; team: string }

const TABS: [Tab, string][] = [['equipos', 'Equipos'], ['jugadores', 'Jugadores'], ['analisis', 'Análisis']];
const ROLE_TAGS: Record<Role, string> = { top: 'TOP', jng: 'JG', mid: 'MID', bot: 'ADC', sup: 'SUP' };
const LIMIT = 20; // filas visibles antes de "Mostrar todos" (jugadores y forma)

// Estado de la vista mientras la página esté abierta; cada tabla recuerda su orden
const state = {
  period: 'season' as Period,
  role: 'all' as Role | 'all',
  sort: { equipos: 'rating', jugadores: 'kda' } as Record<Table, string>,
  dir: { equipos: 'desc', jugadores: 'desc' } as Record<Table, Dir>,
  showAll: { jugadores: false, forma: false } as Record<string, boolean>,
  query: { equipos: '', jugadores: '' } as Record<Table, string>, // texto del buscador de cada tabla
};

const share = (label: string, id: keyof TeamStats): Column<TeamRow> =>
  ({ id, label, value: (r) => r.s[id] as number | null, show: (r) => pct(r.s[id] as number | null), kind: 'share' });

// Equipos: General, Juego temprano y Economía en una sola tabla
const TEAM_GROUPS: [string, Column<TeamRow>[]][] = [
  ['General', [
    { id: 'rating', label: 'Elo', value: (r) => r.team.rating, show: (r) => fmt(r.team.rating), kind: 'span' },
    { id: 'winrate', label: '% Vict.', value: (r) => r.s.winrate, show: (r) => pct(r.s.winrate), sub: (r) => `${r.s.wins}-${r.s.games - r.s.wins}`, kind: 'share' },
    { id: 'games', label: 'PJ', value: (r) => r.s.games, show: (r) => String(r.s.games), kind: 'count' },
  ]],
  ['Juego temprano', [
    { id: 'gd15', label: 'GD@15', hint: 'oro al 15', value: (r) => r.s.gd15 ?? null, kind: 'diverge',
      show: (r) => (r.s.gd15 == null ? '—' : `<span class="${r.s.gd15 < 0 ? 'neg' : 'pos'}">${signed(r.s.gd15)}</span>`) },
    share('1ª sangre', 'first_blood'),
    share('1er dragón', 'first_dragon'),
    share('1ª torre', 'first_tower'),
  ]],
  ['Economía', [
    { id: 'gold_per_min', label: 'Oro/min', value: (r) => r.s.gold_per_min, show: (r) => fmt(r.s.gold_per_min), kind: 'span' },
    { id: 'avg_minutes', label: 'Duración', hint: 'promedio', value: (r) => r.s.avg_minutes, show: (r) => minutes(r.s.avg_minutes), kind: 'span' },
  ]],
];

// Jugadores: Combate y Farmeo en una sola tabla
const PLAYER_GROUPS: [string, Column<PlayerRow>[]][] = [
  ['Combate', [
    { id: 'kda', label: 'KDA', value: (r) => r.s.kda, show: (r) => fmt(r.s.kda, 2), kind: 'count' },
    { id: 'kp', label: 'KP', hint: 'part. kills', value: (r) => r.s.kp, show: (r) => pct(r.s.kp), kind: 'share' },
    { id: 'dpm', label: 'DPM', hint: 'daño/min', value: (r) => r.s.dpm, show: (r) => fmt(r.s.dpm), kind: 'count' },
  ]],
  ['Farmeo y partidas', [
    { id: 'cs_min', label: 'CS/min', value: (r) => r.s.cs_min, show: (r) => fmt(r.s.cs_min, 1), kind: 'count' },
    { id: 'games', label: 'PJ', value: (r) => r.s.games, show: (r) => String(r.s.games), sub: (r) => `${r.s.wins}-${r.s.games - r.s.wins}`, kind: 'count' },
  ]],
];

function column<T>(groups: [string, Column<T>[]][], id: string): Column<T> {
  const all = groups.flatMap(([, cols]) => cols);
  return all.find((c) => c.id === id) ?? all[0];
}

function empty(): string {
  return '<div class="state"><b>Todavía no hay partidas de Worlds 2026</b><span>Las estadísticas del torneo aparecen después de las primeras partidas. Mientras tanto, mirá la temporada.</span></div>';
}

const teamWho = (r: TeamRow) => who(`${logoImg(r.team.logo)}<span class="tagchip">${escapeHtml(r.team.region ?? '—')}</span>`,
  `<a href="#/equipo/${encodeURIComponent(r.team.id)}">${escapeHtml(r.team.short)}</a>`, escapeHtml(r.team.name), 'tm');

const playerWho = (r: PlayerRow) => who(`<span class="tagchip">${ROLE_TAGS[r.player.role]}</span>`,
  `<a href="#/jugador/${encodeURIComponent(r.player.id)}">${escapeHtml(r.player.name)}</a>`,
  `${escapeHtml(r.team)} · ${ROLE_LABELS[r.player.role]}${r.s.games < FEW_GAMES ? ' · pocas partidas' : ''}`);

function teamsView(data: SiteData): string {
  const rows = data.teams.teams.flatMap((team) => {
    const s = periodOf(team, state.period);
    return s ? [{ team, s }] : [];
  });
  if (!rows.length) return empty();
  const sort = column(TEAM_GROUPS, state.sort.equipos);
  const solid = rows.filter((r) => r.s.games >= FEW_GAMES);
  const top = (id: string, label: string) => ({ column: column(TEAM_GROUPS, id), label, rows: solid });
  return `
    ${leaders([top('rating', 'Mejor Elo'), top('gd15', 'Más oro al 15'), top('first_tower', 'Más 1ª torre'), top('gold_per_min', 'Más oro/min')], teamWho)}
    <div class="tools">${searchBox(state.query.equipos, 'Buscar equipo o región')}${sortBar(TEAM_GROUPS.flatMap(([, c]) => c), sort.id, state.dir.equipos)}</div>
    ${teamTable(rows, sort)}
    ${how(`GD@15 = oro de ventaja al minuto 15 (a parte de la LPL le falta: "—"). Los "primeros" son el % de partidas en que el equipo consiguió ese objetivo antes que el rival. Las filas atenuadas tienen menos de ${FEW_GAMES} partidas: con tan pocas, los números dicen poco.`)}`;
}

function teamTable(rows: TeamRow[], sort: Column<TeamRow>): string {
  const sorted = sortBy(rows, sort.value, state.dir.equipos);
  const q = state.query.equipos;
  const found = sorted.filter((r) => matches(q, r.team.short, r.team.name, r.team.region, REGION_LEAGUES[r.team.region ?? '']));
  const table = found.length
    ? airyTable({ rows: found, scale: rows, groups: TEAM_GROUPS, first: 'Equipo', whoOf: teamWho,
      sort: sort.id, dir: state.dir.equipos, few: (r) => r.s.games < FEW_GAMES, rankOf: ranks(sorted) })
    : noResults(q);
  return `<div data-results>${table}</div>`;
}

function playersView(data: SiteData): string {
  const shorts = new Map(data.teams.teams.map((t) => [t.id, t.short]));
  const rows = data.players.players.flatMap((player) => {
    const s = periodOf(player, state.period);
    return s && (state.role === 'all' || player.role === state.role) ? [{ player, s, team: shorts.get(player.team_id) ?? player.team }] : [];
  });
  const roles = chips('role', [['all', 'Todos'], ...(Object.entries(ROLE_LABELS) as [string, string][])], state.role, 'Rol');
  if (!rows.length) return `<div class="tools">${roles}</div>${empty()}`;
  const sort = column(PLAYER_GROUPS, state.sort.jugadores);
  const sorted = sortBy(rows, sort.value, state.dir.jugadores);
  // Buscando se recorre la lista entera; sin buscar, los primeros 20 hasta "Mostrar todos"
  const q = state.query.jugadores;
  const found = sorted.filter((r) => matches(q, r.player.name, r.team, r.player.team, ROLE_LABELS[r.player.role]));
  const visible = q || state.showAll.jugadores ? found : found.slice(0, LIMIT);
  const solid = rows.filter((r) => r.s.games >= FEW_GAMES);
  const top = (id: string, label: string) => ({ column: column(PLAYER_GROUPS, id), label, rows: solid });
  return `
    ${leaders([top('kda', 'Mejor KDA'), top('dpm', 'Más daño'), top('kp', 'Más presente en kills'), top('cs_min', 'Más farmeo')], playerWho)}
    <div class="tools">${searchBox(q, 'Buscar jugador, equipo o rol')}${roles}${sortBar(PLAYER_GROUPS.flatMap(([, c]) => c), sort.id, state.dir.jugadores)}</div>
    <div data-results>
      ${visible.length ? airyTable({ rows: visible, scale: rows, groups: PLAYER_GROUPS, first: 'Jugador', whoOf: playerWho,
        sort: sort.id, dir: state.dir.jugadores, few: (r) => r.s.games < FEW_GAMES, rankOf: ranks(sorted) }) : noResults(q)}
      ${q ? '' : moreButton('jugadores', rows.length)}
    </div>
    ${how(`Compará jugadores del mismo rol: un support nunca va a tener el DPM de un ADC. Las filas atenuadas tienen menos de ${FEW_GAMES} partidas. "—" es un dato que la fuente no tiene.`)}`;
}

function moreButton(list: string, total: number): string {
  if (total <= LIMIT) return '';
  return `<button type="button" class="more" data-all="${list}">${state.showAll[list] ? 'Mostrar menos' : `Mostrar los ${total}`}</button>`;
}

// ---- Sub-pestaña Análisis (tablero) ----

function vsWorldsModule(data: SiteData): string {
  const rows = vsWorldsRows(data.teams.teams).filter((r) => r.diff !== null);
  const head = `<header class="mh"><h2>Temporada vs. contra equipos de Worlds</h2><span class="q">¿Quién inflaba sus números contra rivales débiles?</span></header>`;
  if (!rows.length) return `<section class="mod">${head}<div class="state"><b>Sin partidas entre clasificados todavía</b></div></section>`;
  const [min, max] = [0.2, 0.9];
  const body = rows.map(({ team, season, vs, diff }) => `
    <div class="lrow">${who('', `<a href="#/equipo/${encodeURIComponent(team.id)}">${escapeHtml(team.short)}</a>`, `${escapeHtml(team.region ?? '—')} · ${vs.games} PJ`, 'tm')}
      ${dumbbell(season.winrate ?? 0, vs.winrate ?? 0, min, max, vs.winrate_low, vs.winrate_high)}
      <span class="v ${diff! < 0 ? 'neg' : 'pos'}">${signed(diff! * 100)}<small>pts · GD@15 ${signed(vs.gd15 ?? null)}</small></span></div>`).join('');
  return `<section class="mod">${head}
    <div class="legend"><span><i class="lg-hollow"></i>Temporada</span><span><i class="lg-solid"></i>Solo vs. clasificados</span><span><i class="lg-band"></i>Rango 95%</span></div>
    <div><div class="lrow head"><span></span>${axis([0.3, 0.5, 0.7, 0.9], min, max, pct)}<span></span></div>${body}</div>
    ${how('El % de victorias de la temporada mezcla rivales muy distintos: ganar el 75% en una liga débil no es lo mismo que en la LCK. Acá se cuentan solo las partidas de 2026 contra otros clasificados (ligas e internacionales), así todos se miden con la misma vara. Arriba, los que más bajan: sus números de temporada estaban inflados por el nivel de sus rivales. GD@15 = oro de ventaja al minuto 15 contra clasificados.')}</section>`;
}

function formModule(data: SiteData): string {
  const shorts = new Map(data.teams.teams.map((t) => [t.id, t.short]));
  const ranked = formRanking(data.players.players, state.role);
  const roles = chips('role', [['all', 'Todos'], ...(Object.entries(ROLE_LABELS) as [string, string][])], state.role, 'Rol');
  const head = `<header class="mh"><h2>Forma según el modelo</h2><span class="q">Desvíos sobre el promedio de su rol (elo-2)</span></header>`;
  if (!ranked.length) return `<section class="mod">${head}${roles}<div class="state"><b>Sin datos de forma todavía</b></div></section>`;
  const values = ranked.map((p) => p.form ?? 0);
  const visible = state.showAll.forma ? ranked : ranked.slice(0, LIMIT);
  const body = visible.map((p, i) => `
    <div class="formrow"><span class="rk">${i + 1}</span>
      ${who(`<span class="tagchip">${ROLE_TAGS[p.role]}</span>`, `<a href="#/jugador/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>`, `${escapeHtml(shorts.get(p.team_id) ?? p.team)} · ${ROLE_LABELS[p.role]}`)}
      ${meter('diverge', p.form ?? null, values)}
      <span class="v ${(p.form ?? 0) < 0 ? 'neg' : 'pos'}">${signed(p.form ?? null, 2)}</span></div>`).join('');
  return `<section class="mod">${head}${roles}<div>${body}</div>${moreButton('forma', ranked.length)}
    ${how('La forma que usa el modelo de predicción (elo-2): en cada partida se compara al jugador con el promedio de su rol (oro, experiencia y CS al minuto 15, participación en kills, muertes, daño y eficiencia), en desvíos estándar (z-score), y se hace una media móvil que pesa más las partidas recientes. +0.30 = 0,3 desvíos por encima del pro promedio del rol. Ojo: el promedio mezcla todas las ligas, así que no corrige por el nivel de la liga.')}</section>`;
}

// tabParam viene de la URL ('#/equipos/jugadores'); sin pestaña o con una que no existe, Equipos
export function renderStats(el: HTMLElement, data: SiteData, tabParam: string | null): () => void {
  const tab = pick(tabParam, TABS.map(([id]) => id), 'equipos');
  const body = tab === 'equipos' ? teamsView(data)
    : tab === 'jugadores' ? playersView(data)
    : `<div class="board">${vsWorldsModule(data)}${formModule(data)}</div>`;
  const periods = PERIODS.map(([id, label]) => `<button type="button" data-period="${id}" aria-pressed="${id === state.period}">${label}</button>`).join('');
  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Datos de Oracle's Elixir</span>
      <h1>Equipos</h1>
      <div class="subhead">${subtabs('tab', TABS, tab, 'Secciones de estadísticas')}
        ${tab === 'analisis' ? '' : `<div class="seg small" role="group" aria-label="Período">${periods}</div>`}</div>
    </section>
    <section class="stack">${body}</section>`;

  const table: Table | null = tab === 'analisis' ? null : tab;
  el.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const d = button.dataset;
    if (d.tab) {
      // La pestaña entra al historial: "atrás" vuelve a la anterior
      go(`#/equipos/${d.tab}`);
      renderStats(el, data, d.tab);
      el.querySelector<HTMLButtonElement>(`button[data-tab="${d.tab}"]`)?.focus();
      return;
    }
    if (d.period) state.period = d.period as Period;
    else if (d.role) state.role = d.role as Role | 'all';
    else if (d.all) state.showAll[d.all] = !state.showAll[d.all];
    else if (d.dir !== undefined && table) state.dir[table] = state.dir[table] === 'desc' ? 'asc' : 'desc';
    else if (d.sort && table) {
      state.dir[table] = state.sort[table] === d.sort && state.dir[table] === 'desc' ? 'asc' : 'desc';
      state.sort[table] = d.sort;
    } else return;
    renderStats(el, data, tab);
  };
  el.oninput = (event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.search === undefined || !table) return;
    state.query[table] = input.value;
    swapResults(el, table === 'equipos' ? teamsView(data) : playersView(data));
  };
  el.onchange = (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.dataset.sortselect === undefined || !table) return;
    state.sort[table] = select.value;
    state.dir[table] = 'desc';
    renderStats(el, data, tab);
    el.querySelector<HTMLSelectElement>('#sort-select')?.focus();
  };
  return () => { el.onclick = null; el.onchange = null; el.oninput = null; };
}
