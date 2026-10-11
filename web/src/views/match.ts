import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { advantage, findById, fmt, pct, ROLE_LABELS, signed, starterByRole, teamByName } from '../stats';
import { logoImg, regionColor } from '../theme/regions';
import type { ChampionCount, PlayerEntry, Role, TeamEntry } from '../types';
import { drawEloChart } from '../charts/eloChart';
import { firstDay } from '../schedule';
import { favMark, predictionBlock } from './matchCard';
import { champHex } from './player';
import { notFound } from './team';
import { backLink, how } from './ui';

// Fila espejo: el dato de cada equipo a los costados y, si el dato tiene un "mejor", una barra desde el centro
// hacia el que saca ventaja (su valor en dorado). edge = valores numéricos y la diferencia que ya es grande
function mirror(label: string, left: string, right: string, edge?: [number | null, number | null, number]): string {
  const adv = edge ? advantage(edge[0], edge[1], edge[2]) : null;
  const bar = adv ? `<i style="width:${adv.width.toFixed(0)}%"></i>` : '';
  return `<div class="mirror">
    <span class="num${adv?.side === 'a' ? ' lead' : ''}">${left}</span>
    <span class="mbar l" aria-hidden="true">${adv?.side === 'a' ? bar : ''}</span>
    <span class="label">${label}</span>
    <span class="mbar r" aria-hidden="true">${adv?.side === 'b' ? bar : ''}</span>
    <span class="num${adv?.side === 'b' ? ' lead' : ''}">${right}</span></div>`;
}

// Duelo de un rol: cerrado muestra los nombres y la forma del modelo; al tocarlo se despliegan KDA, DPM y KP.
// <details> nativo: se abre y se cierra sin JavaScript y funciona con teclado
function duel(role: Role, a: PlayerEntry | undefined, b: PlayerEntry | undefined, ta: TeamEntry, tb: TeamEntry): string {
  const name = (p: PlayerEntry | undefined, team: TeamEntry) => p
    ? `<a href="#/jugador/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>${logoImg(team.logo)}`
    : '<span class="muted">—</span>';
  const n = (p: PlayerEntry | undefined, pick: (p: PlayerEntry) => number | null | undefined) => (p ? pick(p) ?? null : null);
  const form = (p?: PlayerEntry) => n(p, (x) => x.form);
  return `<details class="duel">
    <summary>
      <span class="duel-names"><span class="l">${name(a, ta)}</span><span class="label">${ROLE_LABELS[role]}<i class="chev" aria-hidden="true"></i></span><span class="r">${name(b, tb)}</span></span>
      ${mirror('Forma', signed(form(a), 2), signed(form(b), 2), [form(a), form(b), 0.5])}
    </summary>
    <div class="duel-more">
      ${mirror('KDA', fmt(n(a, (x) => x.season.kda), 1), fmt(n(b, (x) => x.season.kda), 1), [n(a, (x) => x.season.kda), n(b, (x) => x.season.kda), 2])}
      ${mirror('DPM', fmt(n(a, (x) => x.season.dpm)), fmt(n(b, (x) => x.season.dpm)), [n(a, (x) => x.season.dpm), n(b, (x) => x.season.dpm), 150])}
      ${mirror('KP', pct(n(a, (x) => x.season.kp)), pct(n(b, (x) => x.season.kp)), [n(a, (x) => x.season.kp), n(b, (x) => x.season.kp), 0.1])}
    </div>
  </details>`;
}

// Un lado del encabezado: logo grande subrayado con el color de la región, sigla, nombre y Elo; lleva a la página del equipo
function heroSide(team: TeamEntry, fav: string, side: 'l' | 'r'): string {
  return `<a class="vs-side ${side}" href="#/equipo/${encodeURIComponent(team.id)}" style="--rc:${regionColor(team.region)}">
    ${logoImg(team.logo) || '<i class="rg" aria-hidden="true"></i>'}
    <span class="vs-short">${escapeHtml(team.short)}${fav}</span>
    <span class="vs-name">${escapeHtml(team.name)}</span>
    <span class="label">${escapeHtml(team.region ?? '—')} · Elo ${fmt(team.rating)}</span></a>`;
}

// Campeones más jugados por los titulares del equipo en la temporada
function topChampions(team: TeamEntry, players: PlayerEntry[]): string {
  const total = new Map<string, number>();
  for (const id of team.roster) {
    const p = findById(players, id);
    p?.season.champions.forEach((c: ChampionCount) => total.set(c.name, (total.get(c.name) ?? 0) + c.games));
  }
  const top = [...total.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
  return `<ul class="champs">${top.map(([name, n]) => `<li>${champHex(name)}<span><b>${escapeHtml(name)}</b><span class="muted num">${n} PJ</span></span></li>`).join('')}</ul>`;
}

export function renderMatch(el: HTMLElement, data: SiteData, _tz: string, param: string | null): () => void {
  const m = data.schedule.matches.find((x) => x.id === param);
  const a = m?.team1 ? teamByName(data.teams.teams, m.team1.name) : undefined;
  const b = m?.team2 ? teamByName(data.teams.teams, m.team2.name) : undefined;
  if (!m || !a || !b) {
    el.innerHTML = notFound('ese partido (o todavía no tiene los dos equipos definidos)');
    return () => {};
  }
  const sa = a.season;
  const sb = b.season;
  const meetings = a.series.filter((s) => s.opponent === b.name);
  const roles: Role[] = ['top', 'jng', 'mid', 'bot', 'sup'];
  el.innerHTML = `
    <section class="stack">
      ${backLink('#/')}
      <span class="eyebrow">Cara a cara</span>
      <div class="bezel"><div class="core"><h1 class="vs-hero">
        ${heroSide(a, favMark(m, 'team1'), 'l')}
        <span class="vs-mid"><span class="label">Bo${m.best_of}</span><b>VS</b></span>
        ${heroSide(b, favMark(m, 'team2'), 'r')}
      </h1></div></div>
      ${predictionBlock(m)}
    </section>
    <section class="stack"><h2>Temporada 2026</h2><div class="bezel"><div class="core">
      <div class="mirror mhead" aria-hidden="true"><span>${logoImg(a.logo) || escapeHtml(a.short)}</span><span></span><span></span><span></span><span>${logoImg(b.logo) || escapeHtml(b.short)}</span></div>
      ${mirror('Elo', fmt(a.rating), fmt(b.rating), [a.rating, b.rating, 100])}
      ${mirror('Récord', `${sa.wins}-${sa.games - sa.wins}`, `${sb.wins}-${sb.games - sb.wins}`)}
      ${mirror('% victorias', pct(sa.winrate), pct(sb.winrate), [sa.winrate, sb.winrate, 0.2])}
      ${mirror('Duración (min)', fmt(sa.avg_minutes, 1), fmt(sb.avg_minutes, 1))}
      ${mirror('Oro/min', fmt(sa.gold_per_min), fmt(sb.gold_per_min), [sa.gold_per_min, sb.gold_per_min, 100])}
      ${mirror('1ª sangre', pct(sa.first_blood), pct(sb.first_blood), [sa.first_blood, sb.first_blood, 0.2])}
      ${mirror('1er dragón', pct(sa.first_dragon), pct(sb.first_dragon), [sa.first_dragon, sb.first_dragon, 0.2])}
      ${mirror('1ª torre', pct(sa.first_tower), pct(sb.first_tower), [sa.first_tower, sb.first_tower, 0.2])}
    </div></div>
    ${how('La barra sale del centro hacia el equipo que saca ventaja en ese dato; llega al borde con 100 de Elo, 100 de oro por minuto o 20 puntos de % de diferencia. La duración y el récord no tienen barra: no hay un "mejor".')}</section>
    <section class="stack"><h2>Elo en 2026</h2>
      <div class="legend"><span><i class="lg-a"></i>${escapeHtml(a.short)}</span><span><i class="lg-b"></i>${escapeHtml(b.short)}</span></div>
      <div class="chart-box"><canvas aria-label="Evolución del Elo de ${escapeHtml(a.short)} y ${escapeHtml(b.short)} en 2026" role="img"></canvas></div></section>
    <section class="stack"><h2>Duelos por rol</h2><div class="bezel"><div class="core duels">
      ${roles.map((r) => duel(r, starterByRole(a, data.players.players, r), starterByRole(b, data.players.players, r), a, b)).join('')}</div></div>
      ${how('Tocá un rol para ver KDA, DPM y KP de la temporada. Forma = la del modelo elo-2: desvíos sobre el promedio del rol (+0.30 es 0,3 desvíos por encima). La barra va hacia el que saca ventaja y llega al borde con 0,5 de forma, 2 de KDA, 150 de DPM o 10 puntos de KP. Se comparan jugadores del mismo rol, así que el DPM es justo.')}</section>
    <section class="grid g2">
      <div class="stack"><h2>Campeones de ${escapeHtml(a.short)}</h2>${topChampions(a, data.players.players)}</div>
      <div class="stack"><h2>Campeones de ${escapeHtml(b.short)}</h2>${topChampions(b, data.players.players)}</div>
    </section>
    <section class="stack"><h2>Enfrentamientos en 2026</h2>
      ${meetings.length ? meetings.map((s) => `<div class="row"><span class="t">${escapeHtml(s.date.slice(5))}</span><span class="m">${escapeHtml(s.page.split('/')[0])}</span><span class="num">${escapeHtml(a.short)} ${s.wins}-${s.losses}</span></div>`).join('')
        : '<div class="state"><b>No se enfrentaron en 2026</b></div>'}
    </section>`;

  // Elo de los dos equipos en un mismo gráfico (Chart.js carga aparte; se destruye al salir)
  let alive = true;
  let destroy: () => void = () => {};
  const canvas = el.querySelector('canvas');
  if (canvas) {
    drawEloChart(canvas, [
      { label: a.short, history: a.elo_history, series: a.series },
      { label: b.short, history: b.elo_history, series: b.series },
    ], firstDay(data.schedule.matches)).then((d) => { if (alive) destroy = d; else d(); });
  }
  return () => { alive = false; destroy(); };
}
