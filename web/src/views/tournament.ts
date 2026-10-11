import { KNOCKOUT_LAYOUT, PLAYIN_LAYOUT, type Stage } from '../bracket';
import { escapeHtml } from '../html';
import type { BracketMatch, TournamentFile, TournamentTeam } from '../types';
import { bracketGrid, chance, stageButtons } from './bracketGrid';
import { teamTag } from './matchCard';
import { how } from './ui';

export { chance } from './bracketGrid';

// Predicciones › Torneo: el torneo completo para los pick'ems, con la misma distribución que Calendario › Bracket
// (Play-In · Suiza · Eliminatoria). En los cuadros, el camino más probable (un pick por partido);
// en las tablas, la chance de cada equipo (Monte Carlo).

const HOW_TEXT = (n: number) => `El cuadro muestra el camino más probable: en cada partido gana el favorito del modelo y así se arma el siguiente. Es lo que cargarías en un pick'em, partido por partido. Las tablas salen de jugar el torneo ${n.toLocaleString('es-AR')} veces en la computadora (simulación de Monte Carlo): cada serie se sortea con la probabilidad del modelo y se cuenta cuántas veces pasa cada cosa. Con tantas repeticiones el porcentaje tiene un margen de medio punto, pero el modelo se equivoca bastante más que eso (mirá Aciertos). Supuestos: las series son independientes; la fuerza de los equipos no cambia durante el torneo; los cruces de la suiza y de cuartos que todavía no se sortearon se sortean al azar sin repetir rivales. Los partidos jugados y los cruces publicados se respetan, y todo se recalcula con cada resultado nuevo. No son las predicciones congeladas: no cuentan para Aciertos.`;

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
const names = (rows: TournamentTeam[]) => new Set(rows.map((r) => r.name));
const byKey = (rows: BracketMatch[]) => new Map(rows.filter((r) => r.key).map((r) => [r.key as string, r]));

function playinStage(t: TournamentFile, tz: string): string {
  if (!t.playin.bracket.length) return '<div class="state"><b>Este torneo no tiene Play-In</b></div>';
  return `
    <p class="muted">Doble eliminación, todo Bo5: pasa solo el campeón.</p>
    ${bracketGrid(PLAYIN_LAYOUT, byKey(t.playin.bracket), tz)}
    ${table(t.playin.teams, [['p_win', 'Gana el Play-In']], new Map([['p_win', names(top(t.playin.teams, 'p_win', 1))]]))}`;
}

function swissStage(t: TournamentFile): string {
  const swiss = t.swiss.teams;
  const s30 = top(swiss, 'p_3_0', 2);
  const s03 = top(swiss, 'p_0_3', 2);
  const adv = top(swiss, 'p_advance', 8);
  return `
    <div class="pk-summary">
      <div><span class="label">3-0</span><b>${shorts(s30)}</b></div>
      <div><span class="label">0-3</span><b>${shorts(s03)}</b></div>
      <div><span class="label">Clasifican</span><b>${shorts(adv)}</b></div>
    </div>
    ${table(swiss, [['p_3_0', '3-0'], ['p_advance', 'Clasifica'], ['p_0_3', '0-3']],
      new Map([['p_3_0', names(s30)], ['p_advance', names(adv)], ['p_0_3', names(s03)]]))}`;
}

function knockoutStage(t: TournamentFile, tz: string): string {
  const bracket = t.knockout.bracket.length
    ? bracketGrid(KNOCKOUT_LAYOUT, byKey(t.knockout.bracket), tz)
    : '<p class="muted">Los picks partido por partido aparecen cuando se sorteen los cuartos.</p>';
  return `${bracket}
    ${table(t.knockout.teams, [['p_semis', 'Semis'], ['p_final', 'Final'], ['p_champion', 'Campeón']],
      new Map([['p_champion', names(top(t.knockout.teams, 'p_champion', 1))]]))}`;
}

export function tournamentView(t: TournamentFile | null, tz: string, stage: Stage): string {
  if (!t) return '<div class="state"><b>Todavía no hay simulación del torneo</b><span>Aparece con la próxima actualización de los datos.</span></div>';
  const body = stage === 'playin' ? playinStage(t, tz) : stage === 'suiza' ? swissStage(t) : knockoutStage(t, tz);
  return `
    <p class="muted">Para los pick'ems: el torneo entero, recalculado con cada resultado.</p>
    ${how(HOW_TEXT(t.simulations), '¿Cómo se calcula?')}
    ${stageButtons('tstage', stage)}
    ${body}`;
}
