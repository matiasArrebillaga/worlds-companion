import { formatTime, PHASE_LABELS, roundLabel } from '../format';
import { escapeHtml } from '../html';
import type { Match } from '../types';

type Side = 'team1' | 'team2';

function result(m: Match, side: Side): string {
  if (!m.winner) return '';
  return m.winner === side
    ? '<span class="res w" title="Victoria">V</span>'
    : '<span class="res l" title="Derrota">D</span>';
}

function teamSide(m: Match, side: Side): string {
  const team = m[side];
  const name = team
    ? `<span class="tag" title="${escapeHtml(team.name)}">${escapeHtml(team.short)}</span>`
    : '<span class="tag tbd">Por definir</span>';
  const lost = m.winner && m.winner !== side ? ' lost' : '';
  const cls = side === 'team2' ? `team r${lost}` : `team${lost}`;
  // El resultado (V/D) va del lado de afuera de cada equipo
  return side === 'team1'
    ? `<div class="${cls}">${result(m, side)}${name}</div>`
    : `<div class="${cls}">${name}${result(m, side)}</div>`;
}

function head(m: Match, time: string): string {
  if (m.status === 'live') return '<span class="pill cyan"><span class="dot" aria-hidden="true"></span>Serie en curso</span>';
  if (m.status === 'finished') return '<span class="pill">Finalizado</span>';
  return `<span class="pill">${escapeHtml(time)}</span>`;
}

export function matchCard(m: Match, tz: string): string {
  const time = formatTime(m.start_utc, tz);
  const middle = m.score ? `<span class="score">${m.score[0]}–${m.score[1]}</span>` : '<span class="vs">VS</span>';
  const footRight = m.status === 'live' ? 'Se actualiza cada hora' : escapeHtml(time);
  return `
    <article class="bezel${m.status === 'live' ? ' live' : ''}">
      <div class="core match">
        <div class="match-head">${head(m, time)}<span class="label">${escapeHtml(roundLabel(m.round))} · Bo${m.best_of}</span></div>
        <div class="teams">${teamSide(m, 'team1')}${middle}${teamSide(m, 'team2')}</div>
        <div class="foot"><span>${PHASE_LABELS[m.phase]}</span><span>${footRight}</span></div>
      </div>
    </article>`;
}
