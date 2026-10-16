import type { Layout, Stage } from '../bracket';
import { STAGES } from '../bracket';
import { formatTime } from '../format';
import { escapeHtml } from '../html';
import { PENDING } from '../swiss';
import type { BracketMatch } from '../types';
import { stretchLink, teamLink } from './matchCard';

// Cuadro de un Play-In o una Eliminatoria, compartido entre Calendario › Bracket y Predicciones › Torneo.
// En PC cada caja va en su lugar de la grilla, unida por conectores; en celular se apilan en orden.

// Chance como porcentaje entero; lo que casi nunca o casi siempre pasa se muestra como <1% o >99%
export function chance(p: number): string {
  if (p > 0 && p < 0.005) return '<1%';
  if (p < 1 && p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}

// Encabezado de la caja: más verde cuantas más victorias, más rojo cuantas más derrotas
export function recordTint(record: string): string {
  if (record === PENDING) return '--amt:0%';
  const [w, l] = record.split('-').map(Number);
  const balance = w - l;
  if (balance === 0) return '--amt:0%';
  return `--tint:var(${balance > 0 ? '--win' : '--loss'});--amt:${Math.min(60, Math.abs(balance) * 22)}%`;
}

function side(m: BracketMatch, which: 'team1' | 'team2'): string {
  const team = m[which];
  const isPick = m.pick === which;
  const finished = m.status === 'finished';
  const p = m.p_team1 === null ? null : which === 'team1' ? m.p_team1 : 1 - m.p_team1;
  let mark = '<span class="res-slot"></span>';
  if (finished) mark = isPick ? '<span class="res w" title="Victoria">V</span>' : '<span class="res l" title="Derrota">D</span>';
  else if (isPick) mark = '<span class="pick" title="Pick del modelo">✓</span>';
  const value = finished && m.score ? String(m.score[which === 'team1' ? 0 : 1]) : p === null ? '' : chance(p);
  const cls = `ln${finished && !isPick ? ' lose' : ''}${isPick && !finished ? ' picked' : ''}`;
  return `<div class="${cls}">${mark}${team ? teamLink(team) : '<span class="muted">Por definir</span>'}<span class="s">${value}</span></div>`;
}

export function bracketBox(m: BracketMatch, tz: string): string {
  const when = m.status === 'finished' ? 'Final' : m.start_utc ? formatTime(m.start_utc, tz) : 'a confirmar';
  return `
    <div class="grp pk">
      <div class="grp-h"><span>${escapeHtml(m.label)}</span><small>Bo${m.best_of}</small></div>
      <div class="mu">${side(m, 'team1')}${side(m, 'team2')}</div>
      <div class="pk-when">${escapeHtml(when)}</div>
      ${stretchLink(m)}
    </div>`;
}

// Caja vacía para un lugar del cuadro que todavía no está en el calendario
function placeholder(label: string): BracketMatch {
  return { id: null, key: null, label, start_utc: null, best_of: 5, team1: null, team2: null, p_team1: null,
    pick: null, status: 'scheduled', score: null };
}

export function bracketGrid(layout: Layout, items: Map<string, BracketMatch>, tz: string): string {
  const boxes = layout.slots.map((slot) =>
    `<div class="bk-cell" style="--area:${slot.area}">${bracketBox(items.get(slot.key) ?? placeholder(slot.label), tz)}</div>`).join('');
  const lines = layout.connectors.map((c) =>
    `<div class="bk-line" aria-hidden="true" style="--area:${c.area};--a:${c.a}%;--b:${c.b}%;--o:${c.o}%"></div>`).join('');
  return `<div class="bk">${boxes}${lines}</div>`;
}

// Botones Play-In · Suiza · Eliminatoria (group = nombre del data-atributo de los botones)
export function stageButtons(group: string, selected: Stage): string {
  const buttons = STAGES.map(([id, text]) =>
    `<button type="button" data-${group}="${id}"${id === selected ? ' aria-current="page"' : ''}>${escapeHtml(text)}</button>`).join('');
  return `<div class="subtabs" role="group" aria-label="Fase del torneo">${buttons}</div>`;
}
