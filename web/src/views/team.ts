import { drawEloChart } from '../charts/eloChart';
import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { logoImg } from '../theme/regions';
import { findById, fmt, PERIODS, pct, periodOf, ROLE_LABELS, signed, type Period } from '../stats';
import type { TeamEntry, TeamStats } from '../types';
import { backLink } from './ui';

let period: Period = 'season';

export function notFound(what: string): string {
  return `<div class="state"><b>No encontramos ${what}</b><span><a href="#/equipos">Volver a Equipos</a></span></div>`;
}

// KPIs de un equipo (también los usa la página de partido)
export function teamKpis(s: TeamStats): string {
  const kpi = (label: string, value: string, sub = '') =>
    `<div class="bezel"><div class="core kpi"><span class="label">${label}</span><b>${value}</b><span class="muted">${sub}</span></div></div>`;
  return `<div class="kpis">
    ${kpi('Récord', `${s.wins}-${s.games - s.wins}`, pct(s.winrate))}
    ${kpi('Lado azul', `${s.blue.wins}-${s.blue.games - s.blue.wins}`, 'AZUL')}
    ${kpi('Lado rojo', `${s.red.wins}-${s.red.games - s.red.wins}`, 'ROJO')}
    ${kpi('Duración', fmt(s.avg_minutes, 1), 'minutos')}
    ${kpi('Oro/min', fmt(s.gold_per_min))}
    ${kpi('GD@15', signed(s.gd15 ?? null), 'oro de ventaja al min 15')}
    ${kpi('1ª sangre', pct(s.first_blood))}
    ${kpi('1er dragón', pct(s.first_dragon))}
    ${kpi('1ª torre', pct(s.first_tower))}
  </div>`;
}

function roster(team: TeamEntry, data: SiteData): string {
  const items = team.roster.map((id) => {
    const p = findById(data.players.players, id);
    return p ? `<li><span class="label">${ROLE_LABELS[p.role]}</span><a href="#/jugador/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a></li>` : '';
  }).join('');
  return `<ul class="roster">${items}</ul>`;
}

function series(team: TeamEntry): string {
  if (!team.series.length) return '<div class="state"><b>Sin series todavía</b></div>';
  return team.series.slice(0, 30).map((s) => {
    const won = s.wins > s.losses;
    return `<div class="row"><span class="t">${escapeHtml(s.date.slice(5))}</span>
      <span class="m">vs ${escapeHtml(s.opponent)}<span class="muted"> · ${escapeHtml(s.page.split('/')[0])}</span></span>
      <span class="num"><span class="res ${won ? 'w' : 'l'}">${won ? 'V' : 'D'}</span> ${s.wins}-${s.losses}</span></div>`;
  }).join('');
}

export function renderTeam(el: HTMLElement, data: SiteData, _tz: string, param: string | null): () => void {
  const team = findById(data.teams.teams, param);
  if (!team) {
    el.innerHTML = notFound('ese equipo');
    return () => {};
  }
  const stats = periodOf(team, period);
  const buttons = PERIODS.map(([id, label]) => `<button type="button" data-period="${id}" aria-pressed="${id === period}">${label}</button>`).join('');
  el.innerHTML = `
    <section class="stack">
      ${backLink('#/equipos')}
      <span class="eyebrow">${escapeHtml(team.region ?? 'Equipo')} · Elo ${fmt(team.rating)}</span>
      <h1 class="team-title">${logoImg(team.logo)}${escapeHtml(team.short)}</h1>
      <p class="muted">${escapeHtml(team.name)}</p>
      <div class="seg" role="group" aria-label="Período">${buttons}</div>
      ${stats ? teamKpis(stats) : '<div class="state"><b>Todavía no jugó en Worlds 2026</b></div>'}
    </section>
    <section class="stack"><h2>Plantel</h2>${roster(team, data)}</section>
    <section class="stack"><h2>Evolución del Elo</h2>
      <div class="chart-box"><canvas aria-label="Evolución del Elo de ${escapeHtml(team.short)} en 2026" role="img"></canvas></div></section>
    <section class="stack"><h2>Series 2026</h2><div class="bezel"><div class="core">${series(team)}</div></div></section>`;

  let destroy: () => void = () => {};
  let alive = true;
  const canvas = el.querySelector('canvas');
  if (canvas && team.elo_history.length) {
    drawEloChart(canvas, team.elo_history).then((d) => { if (alive) destroy = d; else d(); });
  }
  const teardown = () => { alive = false; destroy(); el.onclick = null; };
  // El cleanup que guarda main.ts es este; al cambiar de período apunta al de la nueva vista,
  // así el gráfico que quede vivo siempre se destruye al salir de la página
  let current = teardown;
  el.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-period]');
    if (!button) return;
    period = button.dataset.period as Period;
    teardown();
    current = renderTeam(el, data, _tz, param);
  };
  return () => current();
}
