import { formatPercent, formatTime, PHASE_LABELS, roundLabel } from '../format';
import { escapeHtml } from '../html';
import { favorite, gameOdds, upsetChance, verdict } from '../predictions';
import { teamHref, teamMark, teamRegionColor } from '../theme/regions';
import type { Match, Team } from '../types';

type Side = 'team1' | 'team2';

function result(m: Match, side: Side): string {
  if (!m.winner) return '';
  return m.winner === side
    ? '<span class="res w spoil" title="Victoria">V</span>'
    : '<span class="res l spoil" title="Derrota">D</span>';
}

// Sigla del equipo con su logo (subrayado con el color de la región) o, si no hay logo, el rombito
export function teamTag(team: Team | null): string {
  if (!team) return '<span class="tag tbd">Por definir</span>';
  return `<span class="tag" title="${escapeHtml(team.name)}" style="--rc:${teamRegionColor(team.name)}">${teamMark(team.name)}${escapeHtml(team.short)}</span>`;
}

// La sigla como link a la página del equipo (queda por encima del link que cubre la tarjeta)
export function teamLink(team: Team | null): string {
  const href = team ? teamHref(team.name) : null;
  return href ? `<a class="tag-link" href="${href}">${teamTag(team)}</a>` : teamTag(team);
}

// Link que cubre toda la tarjeta o caja (con ::after): tocar en cualquier lado abre el Cara a cara
export function stretchLink(m: { id: string | null; team1: Team | null; team2: Team | null }, text = ''): string {
  if (!m.id || !m.team1 || !m.team2) return '';
  const label = text ? '' : ` aria-label="Cara a cara: ${escapeHtml(m.team1.short)} vs ${escapeHtml(m.team2.short)}"`;
  return `<a class="stretch" href="#/partido/${encodeURIComponent(m.id)}"${label}>${text}</a>`;
}

// Rombito dorado chico junto a la sigla del favorito del modelo (vacío si no lo es o no hay predicción)
export function favMark(m: Match, side: Side): string {
  return favorite(m) === side ? '<i class="fv" title="Favorito del modelo" aria-hidden="true"></i>' : '';
}

// La sigla con el rombito del favorito del lado de adentro (hacia el VS)
export function teamWithFav(m: Match, side: Side): string {
  const name = teamLink(m[side]);
  return side === 'team1' ? `${name}${favMark(m, side)}` : `${favMark(m, side)}${name}`;
}

function teamSide(m: Match, side: Side): string {
  const name = teamWithFav(m, side);
  const lost = m.winner && m.winner !== side ? ' lost' : '';
  const cls = side === 'team2' ? `team r${lost}` : `team${lost}`;
  // El resultado (V/D) va del lado de afuera de cada equipo
  return side === 'team1'
    ? `<div class="${cls}">${result(m, side)}${name}</div>`
    : `<div class="${cls}">${name}${result(m, side)}</div>`;
}

// "Sorpresa · tenía 28%": ganó el que el modelo daba con menos de 35%
export function upsetTag(m: Match): string {
  const p = upsetChance(m);
  return p === null ? '' : `<span class="upset spoil">Sorpresa · tenía ${formatPercent(p)}</span>`;
}

// Marcador que el modo sin spoilers de la Lista tapa con un botón para verlo (fuera de la Lista no se tapa)
export function hiddenScore(score: string): string {
  return `<span class="spoil">${score}</span><button type="button" class="reveal" aria-label="Ver resultado">Ver</button>`;
}

// Centro de la tarjeta: el marcador (tapable) o "VS" si todavía no hay
export function middleOf(m: Match): string {
  return m.score ? `<span class="mid">${hiddenScore(`<span class="score">${m.score[0]}–${m.score[1]}</span>`)}</span>` : '<span class="vs">VS</span>';
}

function head(m: Match, time: string, next: boolean): string {
  if (next) return `<span class="pill gold">Próximo · ${escapeHtml(time)}</span>`;
  if (m.status === 'live') return '<span class="pill live"><span class="dot" aria-hidden="true"></span>Serie en curso</span>';
  if (m.status === 'finished') return '<span class="pill">Finalizado</span>';
  return `<span class="pill time">${escapeHtml(time)}</span>`;
}

// Barra de probabilidad de ganar la serie, dividida: cada equipo ocupa su parte desde su lado
// y el favorito va en dorado (como el rombito)
export function predictionBar(m: Match): string {
  const p = m.prediction;
  if (!p || !m.team1 || !m.team2) return '';
  const fav = favorite(m);
  const p1 = formatPercent(p.p_team1_series);
  const p2 = formatPercent(1 - p.p_team1_series);
  const label = `Probabilidad de ganar la serie: ${escapeHtml(m.team1.short)} ${p1}, ${escapeHtml(m.team2.short)} ${p2}`;
  // flex-grow proporcional: las dos partes suman el ancho completo aunque haya un hueco entre ellas
  const part = (share: number, side: Side) =>
    `<i class="${fav === side ? 'fav' : ''}" style="flex-grow:${(share * 100).toFixed(1)}"></i>`;
  return `
    <div class="pred" role="img" aria-label="${label}">
      <div class="ends"><span class="pct${fav === 'team1' ? ' fav' : ''}">${p1}</span><span class="pct${fav === 'team2' ? ' fav' : ''}">${p2}</span></div>
      <div class="track" aria-hidden="true">${part(p.p_team1_series, 'team1')}${part(1 - p.p_team1_series, 'team2')}</div>
    </div>`;
}

// "Por partida: KC 52%" (solo Bo3/Bo5)
function oddsText(m: Match): string {
  const odds = gameOdds(m);
  return odds ? `Por partida: ${escapeHtml(odds.short)} ${formatPercent(odds.p)}` : '';
}

// Si el modelo acertó (con texto, no solo color) y la etiqueta de sorpresa
function verdictHtml(m: Match): string {
  const v = verdict(m);
  const text = v === 'hit'
    ? '<span class="verdict hit">✓ El modelo acertó</span>'
    : v === 'miss' ? '<span class="verdict miss">✗ El modelo falló</span>' : '';
  return text ? `<div class="verdicts spoil">${text}${upsetTag(m)}</div>` : '';
}

// Barra + chance por partida + veredicto, todo junto (próximo partido y Cara a cara)
export function predictionBlock(m: Match): string {
  if (!m.prediction || !m.team1 || !m.team2) return '';
  const odds = oddsText(m);
  return `${predictionBar(m)}${odds ? `<p class="pred-game">${odds}</p>` : ''}${verdictHtml(m)}`;
}

export function matchCard(m: Match, tz: string, next = false): string {
  const time = formatTime(m.start_utc, tz);
  const middle = middleOf(m);
  // Pie: veredicto si ya se jugó; si no, la chance por partida (o el aviso de la serie en curso)
  const note = m.status === 'live' ? 'Se actualiza cada 30 minutos'
    : verdictHtml(m) || (m.team1 && m.team2 && m.prediction ? oddsText(m) : '');
  const link = stretchLink(m, 'Cara a cara');
  return `
    <article class="bezel${m.status === 'live' ? ' live' : m.status === 'finished' ? ' done' : ''}" data-id="${escapeHtml(m.id)}">
      <div class="core match">
        <div class="match-head">${head(m, time, next)}<span class="label">${PHASE_LABELS[m.phase]} · ${escapeHtml(roundLabel(m.round))} · Bo${m.best_of}</span></div>
        <div class="teams">${teamSide(m, 'team1')}${middle}${teamSide(m, 'team2')}</div>
        ${predictionBar(m)}
        ${note || link ? `<div class="foot"><span>${note}</span>${link}</div>` : ''}
      </div>
    </article>`;
}
