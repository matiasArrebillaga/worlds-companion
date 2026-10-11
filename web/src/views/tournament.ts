import { KNOCKOUT_LAYOUT, PLAYIN_LAYOUT, type Stage } from '../bracket';
import { escapeHtml } from '../html';
import type { BracketMatch, TeamChance, TournamentFile, TournamentTeam } from '../types';
import { bracketGrid, chance, recordTint, stageButtons } from './bracketGrid';
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

// Lista de equipos con su chance: los `slots` más probables resaltados (el pick), y unos pocos más, atenuados
const EXTRA = 2;
function chanceList(teams: TeamChance[], slots: number): string {
  return teams.slice(0, slots + EXTRA).map((t, i) => `
    <div class="ln${i < slots ? ' picked' : ' lose'}">${teamTag({ name: t.name, short: t.short })}<span class="s">${chance(t.p)}</span></div>`).join('');
}

// La suiza con la estructura de lolesports: por ronda, una caja por récord con la chance de cada equipo de llegar
// a esa ronda con ese récord; al final, la chance de cada récord final
const FINAL_SLOTS: Record<string, number> = { '3-0': 2, '3-1': 3, '3-2': 3, '0-3': 2, '1-3': 3, '2-3': 3 };

function swissStage(t: TournamentFile): string {
  const swiss = t.swiss.teams;
  const s30 = top(swiss, 'p_3_0', 2);
  const s03 = top(swiss, 'p_0_3', 2);
  const adv = top(swiss, 'p_advance', 8);
  const summary = `
    <div class="pk-summary">
      <div><span class="label">3-0</span><b>${shorts(s30)}</b></div>
      <div><span class="label">0-3</span><b>${shorts(s03)}</b></div>
      <div><span class="label">Clasifican</span><b>${shorts(adv)}</b></div>
    </div>`;
  if (!t.swiss.rounds || !t.swiss.final) return summary;
  const columns = t.swiss.rounds.map((r) => `
    <section class="sw-col">
      <h2 class="day-title">Ronda ${r.round}</h2>
      ${r.groups.map((g) => `
        <div class="grp pr">
          <div class="grp-h" style="${recordTint(g.record)}"><span>${g.record}</span><small>Bo${g.best_of}</small></div>
          ${chanceList(g.teams, Math.round(g.expected))}
        </div>`).join('')}
    </section>`).join('');
  const finalBox = (title: string, cls: 'q' | 'e', records: string[]) => `
    <div class="grp end ${cls}"><div class="grp-h"><span>${title}</span></div>
      ${records.map((rec) => {
        const box = t.swiss.final!.find((f) => f.record === rec);
        return `<div class="pr-final"><b>${rec}</b>${chanceList(box?.teams ?? [], FINAL_SLOTS[rec])}</div>`;
      }).join('')}
    </div>`;
  return `${summary}
    <p class="muted">Cada caja: chance de llegar a esa ronda con ese récord. Resaltados, los más probables (tantos como lugares tiene la caja, en promedio).</p>
    <div class="sw-cols">${columns}
      <section class="sw-col">
        <h2 class="day-title">Final</h2>
        ${finalBox('✓ Clasificados', 'q', ['3-0', '3-1', '3-2'])}
        ${finalBox('✗ Eliminados', 'e', ['0-3', '1-3', '2-3'])}
      </section>
    </div>`;
}

// Eliminatoria: con los cuartos sorteados, el cuadro con los picks; antes, una columna por ronda con los
// equipos que más chance tienen de llegar (cuartos 8 lugares, semis 4, final 2, campeón 1)
function knockoutStage(t: TournamentFile, tz: string): string {
  if (t.knockout.bracket.length) return bracketGrid(KNOCKOUT_LAYOUT, byKey(t.knockout.bracket), tz);
  const teams = t.knockout.teams;
  const advance = new Map(t.swiss.teams.map((r) => [r.name, r.p_advance ?? 0]));
  const column = (title: string, slots: number, value: (r: TournamentTeam) => number) => {
    const list = teams.map((r) => ({ name: r.name, short: r.short, p: value(r) }))
      .filter((r) => r.p > 0).sort((a, b) => b.p - a.p);
    return `
      <section class="sw-col">
        <h2 class="day-title">${title}</h2>
        <div class="grp pr"><div class="grp-h"><span>${slots} ${slots === 1 ? 'lugar' : 'lugares'}</span><small>Bo5</small></div>
          ${chanceList(list, slots)}</div>
      </section>`;
  };
  return `
    <p class="muted">Los picks partido por partido aparecen cuando se sorteen los cuartos. Mientras tanto: la chance de cada equipo de llegar a cada ronda.</p>
    <div class="sw-cols">
      ${column('Cuartos', 8, (r) => advance.get(r.name) ?? 0)}
      ${column('Semis', 4, (r) => r.p_semis ?? 0)}
      ${column('Final', 2, (r) => r.p_final ?? 0)}
      ${column('Campeón', 1, (r) => r.p_champion ?? 0)}
    </div>`;
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
