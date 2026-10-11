import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { championIcon } from '../theme/champions';
import { FEW_GAMES, findById, fmt, PERIODS, pct, periodOf, ROLE_LABELS, signed, type Period } from '../stats';
import type { PlayerEntry, PlayerStats } from '../types';
import { notFound } from './team';
import { how } from './ui';

let period: Period = 'season';

// Campeón en hexágono: el ícono de Data Dragon encima del monograma. Si la imagen no carga
// (alt vacío = no se dibuja nada roto), se sigue viendo el monograma de abajo
export function champHex(name: string): string {
  const initials = name.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0] ?? '').join('').slice(0, 2) || '?';
  const icon = championIcon(name);
  const img = icon ? `<img src="${escapeHtml(icon)}" alt="" loading="lazy" decoding="async">` : '';
  return `<span class="champ" title="${escapeHtml(name)}" aria-hidden="true">${escapeHtml(initials.toUpperCase())}${img}</span>`;
}

function kpis(s: PlayerStats): string {
  const kpi = (label: string, value: string, sub = '') =>
    `<div class="bezel"><div class="core kpi"><span class="label">${label}</span><b>${value}</b><span class="muted">${sub}</span></div></div>`;
  return `<div class="kpis">
    ${kpi('Partidas', String(s.games), `${s.wins}-${s.games - s.wins}`)}
    ${kpi('KDA', fmt(s.kda, 2), `${s.kills}/${s.deaths}/${s.assists}`)}
    ${kpi('CS/min', fmt(s.cs_min, 1))}
    ${kpi('DPM', fmt(s.dpm), 'daño por minuto')}
    ${kpi('KP', pct(s.kp), 'participación en kills')}
  </div>`;
}

function champions(s: PlayerStats): string {
  return `<ul class="champs">${s.champions.slice(0, 10).map((c) => `
    <li>${champHex(c.name)}<span><b>${escapeHtml(c.name)}</b><span class="muted num">${c.games} PJ · ${c.wins}-${c.games - c.wins}</span></span></li>`).join('')}</ul>`;
}

function history(p: PlayerEntry): string {
  const rows = p.history.map((g) => `
    <tr>
      <td class="num">${escapeHtml(g.date.slice(5))}</td>
      <td><span class="res ${g.won ? 'w' : 'l'}">${g.won ? 'V' : 'D'}</span></td>
      <td>${escapeHtml(g.champion)}</td>
      <td>vs ${escapeHtml(g.opponent)}${g.worlds ? ' <span class="pill gold">Worlds</span>' : ''}</td>
      <td class="num">${g.kills}/${g.deaths}/${g.assists}</td>
      <td class="num">${fmt(g.cs_min, 1)}</td>
      <td class="num">${fmt(g.dpm)}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table class="rank"><thead><tr><th>Fecha</th><th>Res.</th><th>Campeón</th><th>Rival</th><th class="num">KDA</th><th class="num">CS/min</th><th class="num">DPM</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderPlayer(el: HTMLElement, data: SiteData, tz: string, param: string | null): () => void {
  const p = findById(data.players.players, param);
  if (!p) {
    el.innerHTML = notFound('ese jugador');
    return () => {};
  }
  const team = findById(data.teams.teams, p.team_id);
  const s = periodOf(p, period);
  const buttons = PERIODS.map(([id, label]) => `<button type="button" data-period="${id}" aria-pressed="${id === period}">${label}</button>`).join('');
  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">${ROLE_LABELS[p.role]} · <a href="#/equipo/${encodeURIComponent(p.team_id)}">${escapeHtml(team?.short ?? p.team)}</a>${p.starter ? '' : ' · suplente'}</span>
      <h1>${escapeHtml(p.name)}</h1>
      ${p.form != null ? `<p class="muted">Forma según el modelo: <b>${signed(p.form, 2)}</b> desvíos sobre el promedio de su rol (<a href="#/equipos">ver ranking en Equipos › Análisis</a>)</p>` : ''}
      <div class="seg" role="group" aria-label="Período">${buttons}</div>
      ${s && s.games < FEW_GAMES ? how(`Solo ${s.games} partidas: con tan pocas, estos números dicen poco.`, '¿Cuánto confiar en estos números?') : ''}
      ${s ? kpis(s) : '<div class="state"><b>Todavía no jugó en Worlds 2026</b></div>'}
    </section>
    ${s ? `<section class="stack"><h2>Campeones</h2>${champions(s)}</section>` : ''}
    <section class="stack"><h2>Últimas partidas</h2>${history(p)}</section>`;
  el.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-period]');
    if (!button) return;
    period = button.dataset.period as Period;
    renderPlayer(el, data, tz, param);
  };
  return () => { el.onclick = null; };
}
