import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { findById, fmt, pct, ROLE_LABELS, starterByRole, teamByName } from '../stats';
import type { ChampionCount, PlayerEntry, Role, TeamEntry } from '../types';
import { predictionBlock } from './matchCard';
import { champHex } from './player';
import { notFound } from './team';
import { backLink } from './ui';

function mirror(label: string, left: string, right: string): string {
  return `<div class="mirror"><span class="num">${left}</span><span class="label">${label}</span><span class="num">${right}</span></div>`;
}

function duel(role: Role, a: PlayerEntry | undefined, b: PlayerEntry | undefined): string {
  const name = (p?: PlayerEntry) => p ? `<a href="#/jugador/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>` : '—';
  const line = (p?: PlayerEntry) => p ? `KDA ${fmt(p.season.kda, 1)} · DPM ${fmt(p.season.dpm)} · KP ${pct(p.season.kp)}` : '';
  return `<div class="duel"><div>${name(a)}<span class="muted">${line(a)}</span></div>
    <span class="label">${ROLE_LABELS[role]}</span>
    <div class="r">${name(b)}<span class="muted">${line(b)}</span></div></div>`;
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
      <span class="eyebrow">Cara a cara · Bo${m.best_of}</span>
      <h1><a href="#/equipo/${encodeURIComponent(a.id)}">${escapeHtml(a.short)}</a> vs <a href="#/equipo/${encodeURIComponent(b.id)}">${escapeHtml(b.short)}</a></h1>
      ${predictionBlock(m)}
    </section>
    <section class="stack"><h2>Temporada 2026</h2><div class="bezel"><div class="core">
      ${mirror('Elo', fmt(a.rating), fmt(b.rating))}
      ${mirror('Récord', `${sa.wins}-${sa.games - sa.wins}`, `${sb.wins}-${sb.games - sb.wins}`)}
      ${mirror('% victorias', pct(sa.winrate), pct(sb.winrate))}
      ${mirror('Duración (min)', fmt(sa.avg_minutes, 1), fmt(sb.avg_minutes, 1))}
      ${mirror('Oro/min', fmt(sa.gold_per_min), fmt(sb.gold_per_min))}
      ${mirror('1ª sangre', pct(sa.first_blood), pct(sb.first_blood))}
      ${mirror('1er dragón', pct(sa.first_dragon), pct(sb.first_dragon))}
      ${mirror('1ª torre', pct(sa.first_tower), pct(sb.first_tower))}
    </div></div></section>
    <section class="stack"><h2>Duelos por rol</h2>
      ${roles.map((r) => duel(r, starterByRole(a, data.players.players, r), starterByRole(b, data.players.players, r))).join('')}</section>
    <section class="grid g2">
      <div class="stack"><h2>Campeones de ${escapeHtml(a.short)}</h2>${topChampions(a, data.players.players)}</div>
      <div class="stack"><h2>Campeones de ${escapeHtml(b.short)}</h2>${topChampions(b, data.players.players)}</div>
    </section>
    <section class="stack"><h2>Enfrentamientos en 2026</h2>
      ${meetings.length ? meetings.map((s) => `<div class="row"><span class="t">${escapeHtml(s.date.slice(5))}</span><span class="m">${escapeHtml(s.page.split('/')[0])}</span><span class="num">${escapeHtml(a.short)} ${s.wins}-${s.losses}</span></div>`).join('')
        : '<div class="state"><b>No se enfrentaron en 2026</b></div>'}
    </section>`;
  return () => {};
}
