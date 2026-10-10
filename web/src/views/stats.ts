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
