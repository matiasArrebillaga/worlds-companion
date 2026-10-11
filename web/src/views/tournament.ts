import { formatTime } from '../format';
import { escapeHtml } from '../html';
import type { BracketMatch, TournamentFile, TournamentTeam } from '../types';
import { teamTag } from './matchCard';
import { how } from './ui';

// Predicciones › Torneo: el torneo completo para los pick'ems.
// Arriba, el camino más probable (un pick por partido); abajo, la chance de cada equipo (Monte Carlo).

// Chance como porcentaje entero; lo que casi nunca o casi siempre pasa se muestra como <1% o >99%
export function chance(p: number): string {
  if (p > 0 && p < 0.005) return '<1%';
  if (p < 1 && p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}

const HOW_TEXT = (n: number) => `El bracket muestra el camino más probable: en cada partido gana el favorito del modelo y así se arma el siguiente. Es lo que cargarías en un pick'em, partido por partido. Las tablas salen de jugar el torneo ${n.toLocaleString('es-AR')} veces en la computadora (simulación de Monte Carlo): cada serie se sortea con la probabilidad del modelo y se cuenta cuántas veces pasa cada cosa. Con tantas repeticiones el porcentaje tiene un margen de medio punto, pero el modelo se equivoca bastante más que eso (mirá Aciertos). Supuestos: las series son independientes; la fuerza de los equipos no cambia durante el torneo; los cruces de la suiza y de cuartos que todavía no se sortearon se sortean al azar sin repetir rivales. Los partidos jugados y los cruces publicados se respetan, y todo se recalcula con cada resultado nuevo. No son las predicciones congeladas: no cuentan para Aciertos.`;

function side(m: BracketMatch, which: 'team1' | 'team2'): string {
  const team = m[which];
  const isPick = m.pick === which;
  const p = m.p_team1 === null ? null : which === 'team1' ? m.p_team1 : 1 - m.p_team1;
  let mark = '<span class="res-slot"></span>';
  if (m.status === 'finished') {
    mark = isPick ? '<span class="res w" title="Victoria">V</span>' : '<span class="res l" title="Derrota">D</span>';
  } else if (isPick) {
    mark = '<span class="pick" title="Pick del modelo">✓</span>';
  }
  const score = m.status === 'finished' && m.score ? m.score[which === 'team1' ? 0 : 1] : p === null ? '' : chance(p);
  const lose = m.status === 'finished' && !isPick ? ' lose' : '';
  return `<div class="ln${lose}${isPick && m.status !== 'finished' ? ' picked' : ''}">${mark}${team ? teamTag(team) : '<span class="muted">Por definir</span>'}<span class="s">${score}</span></div>`;
}

function bracketBox(m: BracketMatch, tz: string): string {
  const when = m.status === 'finished' ? 'Final'
    : m.status === 'projected' ? 'Si se cumple lo anterior'
    : m.start_utc ? formatTime(m.start_utc, tz) : 'a confirmar';
  return `
    <div class="grp pk">
      <div class="grp-h"><span>${escapeHtml(m.label)}</span><small>Bo${m.best_of}</small></div>
      <div class="mu">${side(m, 'team1')}${side(m, 'team2')}</div>
      <div class="pk-when">${escapeHtml(when)}</div>
    </div>`;
}

function table(rows: TournamentTeam[], columns: [keyof TournamentTeam, string][], picks: Map<string, Set<string>>): string {
  const visible = rows.filter((r) => columns.some(([key]) => (r[key] as number) > 0));
  const head = columns.map(([, label]) => `<th class="num">${label}</th>`).join('');
  const body = visible.map((r) => `
    <tr><td>${teamTag({ name: r.name, short: r.short })}</td>${columns.map(([key]) => {
      const picked = picks.get(key as string)?.has(r.name);
      return `<td class="num${picked ? ' picked' : ''}">${chance(r[key] as number)}${picked ? ' <span class="pick" title="Pick sugerido">✓</span>' : ''}</td>`;
    }).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="rank pk-table"><thead><tr><th>Equipo</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// Los n equipos con más chance en una columna: el pick sugerido para esa categoría del pick'em
function top(rows: TournamentTeam[], key: keyof TournamentTeam, n: number): TournamentTeam[] {
  return [...rows].sort((a, b) => (b[key] as number) - (a[key] as number)).slice(0, n);
}

const shorts = (rows: TournamentTeam[]) => rows.map((r) => escapeHtml(r.short)).join(', ');

export function tournamentView(t: TournamentFile | null, tz: string): string {
  if (!t) return '<div class="state"><b>Todavía no hay simulación del torneo</b><span>Aparece con la próxima actualización de los datos.</span></div>';

  const swiss = t.swiss.teams;
  const s30 = top(swiss, 'p_3_0', 2);
  const s03 = top(swiss, 'p_0_3', 2);
  const adv = top(swiss, 'p_advance', 8);
  const champ = top(t.knockout.teams, 'p_champion', 1);
  const names = (rows: TournamentTeam[]) => new Set(rows.map((r) => r.name));

  const playin = t.playin.bracket.length ? `
    <section class="stack">
      <h2>Play-In</h2>
      <p class="muted">Doble eliminación, todo Bo5: pasa solo el campeón.</p>
      <div class="pk-grid">${t.playin.bracket.map((m) => bracketBox(m, tz)).join('')}</div>
      ${table(t.playin.teams, [['p_win', 'Gana el Play-In']], new Map([['p_win', names(top(t.playin.teams, 'p_win', 1))]]))}
    </section>` : '';

  const knockoutBracket = t.knockout.bracket.length
    ? `<div class="pk-grid">${t.knockout.bracket.map((m) => bracketBox(m, tz)).join('')}</div>`
    : '<p class="muted">Los picks partido por partido aparecen cuando se sorteen los cuartos.</p>';

  return `
    <p class="muted">Para los pick'ems: el torneo entero, recalculado con cada resultado.</p>
    ${how(HOW_TEXT(t.simulations), '¿Cómo se calcula?')}
    ${playin}
    <section class="stack">
      <h2>Fase suiza</h2>
      <div class="pk-summary">
        <div><span class="label">3-0</span><b>${shorts(s30)}</b></div>
        <div><span class="label">0-3</span><b>${shorts(s03)}</b></div>
        <div><span class="label">Clasifican</span><b>${shorts(adv)}</b></div>
      </div>
      ${table(swiss, [['p_3_0', '3-0'], ['p_advance', 'Clasifica'], ['p_0_3', '0-3']],
        new Map([['p_3_0', names(s30)], ['p_advance', names(adv)], ['p_0_3', names(s03)]]))}
    </section>
    <section class="stack">
      <h2>Eliminatorias</h2>
      ${knockoutBracket}
      ${table(t.knockout.teams, [['p_semis', 'Semis'], ['p_final', 'Final'], ['p_champion', 'Campeón']],
        new Map([['p_champion', names(champ)]]))}
    </section>`;
}
