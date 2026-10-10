import { formatPercent, formatTime, PHASE_LABELS, roundLabel } from '../format';
import { escapeHtml } from '../html';
import { favorite, gameOdds, verdict } from '../predictions';
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

// Probabilidad de ganar la serie + si el modelo acertó (con texto, no solo color)
export function predictionBlock(m: Match): string {
  const p = m.prediction;
  if (!p || !m.team1 || !m.team2) return '';
  const fav = favorite(m);
  const p1 = formatPercent(p.p_team1_series);
  const p2 = formatPercent(1 - p.p_team1_series);
  const v = verdict(m);
  const verdictHtml = v === 'hit'
    ? '<span class="verdict hit">✓ El modelo acertó</span>'
    : v === 'miss' ? '<span class="verdict miss">✗ El modelo falló</span>' : '';
  const label = `Probabilidad de ganar la serie: ${escapeHtml(m.team1.short)} ${p1}, ${escapeHtml(m.team2.short)} ${p2}`;
  const odds = gameOdds(m);
  const oddsHtml = odds
    ? `<p class="pred-game">Por partida: ${escapeHtml(odds.short)} ${formatPercent(odds.p)}</p>`
    : '';
  return `
    <div class="pred" role="img" aria-label="${label}">
      <span class="pct${fav === 'team1' ? ' fav' : ''}">${p1}</span>
      <span class="bar" aria-hidden="true"><i style="width:${(p.p_team1_series * 100).toFixed(1)}%"></i></span>
      <span class="pct${fav === 'team2' ? ' fav' : ''}">${p2}</span>
    </div>${oddsHtml}${verdictHtml}`;
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
        ${predictionBlock(m)}
        <div class="foot"><span>${PHASE_LABELS[m.phase]}</span><span>${footRight}</span></div>
      </div>
    </article>`;
}
