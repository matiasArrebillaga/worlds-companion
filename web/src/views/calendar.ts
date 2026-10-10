import { bracketRounds } from '../bracket';
import { formatDayHeading, localDayKey, PHASE_LABELS, roundLabel } from '../format';
import { escapeHtml } from '../html';
import { groupByDay } from '../schedule';
import { PENDING, swissRounds, swissStandings, type TeamRecord } from '../swiss';
import type { Match, Phase } from '../types';
import { matchCard } from './matchCard';

type Filter = Phase | 'all';
type Sub = 'lista' | 'suiza' | 'bracket';
const FILTERS: Filter[] = ['all', 'play-in', 'swiss', 'knockout'];
const SUBS: [Sub, string][] = [['lista', 'Lista'], ['suiza', 'Suiza'], ['bracket', 'Bracket']];

// La sub-vista y el filtro se recuerdan mientras la página esté abierta
let current: Filter = 'all';
let sub: Sub = 'lista';

// Estado con texto, no solo color
const STATUS: Record<TeamRecord['status'], string> = {
  qualified: '<span class="pill win">Clasifica</span>',
  eliminated: '<span class="pill loss">Eliminado</span>',
  alive: '<span class="muted">En juego</span>',
};

function filterLabel(f: Filter): string {
  return f === 'all' ? 'Todas' : PHASE_LABELS[f];
}

function listView(matches: Match[], tz: string): string {
  const visible = current === 'all' ? matches : matches.filter((m) => m.phase === current);
  const todayKey = localDayKey(new Date().toISOString(), tz);
  const days = groupByDay(visible, tz).map((g) => `
    <section class="day${g.day === todayKey ? ' today' : ''}" ${g.day === todayKey ? 'id="hoy"' : ''}>
      <h2 class="day-title">${g.day ? formatDayHeading(g.day) : 'Fecha a confirmar'}${g.day === todayKey ? ' · hoy' : ''}</h2>
      <div class="grid g3">${g.matches.map((m) => matchCard(m, tz)).join('')}</div>
    </section>`).join('');
  return days || '<div class="state"><b>No hay partidos en esta fase todavía</b><span>Aparecen acá en cuanto Leaguepedia los publique.</span></div>';
}

function swissView(matches: Match[], tz: string): string {
  const rounds = swissRounds(matches);
  if (!rounds.length) return '<div class="state"><b>La fase suiza todavía no tiene partidos</b><span>Aparecen acá en cuanto Leaguepedia los publique.</span></div>';
  const standings = [...swissStandings(matches)].sort((a, b) => b[1].wins - a[1].wins || a[1].losses - b[1].losses);
  const table = standings.length ? `
    <div class="table-wrap"><table class="rank">
      <thead><tr><th>Equipo</th><th class="num">Récord</th><th>Estado</th></tr></thead>
      <tbody>${standings.map(([name, r]) => `
        <tr><td class="team"><b>${escapeHtml(name)}</b></td><td class="num">${r.wins}-${r.losses}</td><td>${STATUS[r.status]}</td></tr>`).join('')}
      </tbody>
    </table></div>` : '';
  const columns = rounds.map((r) => `
    <section class="swiss-round stack">
      <h2 class="day-title">${escapeHtml(roundLabel(r.round))}</h2>
      ${r.groups.map((g) => `
        <h3 class="eyebrow">${g.record === PENDING ? 'Cruces a confirmar' : `Récord ${g.record}`}</h3>
        <div class="grid">${g.matches.map((m) => matchCard(m, tz)).join('')}</div>`).join('')}
    </section>`).join('');
  return `<p class="muted">Los equipos con el mismo récord se enfrentan entre sí: 3 victorias clasifican, 3 derrotas eliminan.</p>${table}<div class="swiss">${columns}</div>`;
}

function bracketView(matches: Match[], tz: string): string {
  const rounds = bracketRounds(matches);
  if (!rounds.length) return '<div class="state"><b>Las eliminatorias todavía no tienen partidos</b><span>Aparecen cuando termine la fase suiza.</span></div>';
  return `<div class="bracket">${rounds.map((r) => `
    <section class="stack">
      <h2 class="day-title">${escapeHtml(roundLabel(r.round))}</h2>
      <div class="grid">${r.matches.map((m) => matchCard(m, tz)).join('')}</div>
    </section>`).join('')}</div>`;
}

function seg(group: string, options: [string, string][], selected: string, label: string): string {
  const buttons = options.map(([id, text]) =>
    `<button type="button" data-${group}="${id}" aria-pressed="${id === selected}">${escapeHtml(text)}</button>`).join('');
  return `<div class="seg" role="group" aria-label="${label}">${buttons}</div>`;
}

export function renderCalendar(el: HTMLElement, matches: Match[], tz: string): () => void {
  const body = sub === 'suiza' ? swissView(matches, tz) : sub === 'bracket' ? bracketView(matches, tz) : listView(matches, tz);
  const filters = FILTERS.map((f): [string, string] => [f, filterLabel(f)]);

  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Worlds 2026</span>
      <h1>Calendario</h1>
      <p class="muted">Horarios en tu zona horaria. Los partidos sin hora confirmada dicen "a confirmar".</p>
      ${seg('sub', SUBS, sub, 'Vista del calendario')}
      ${sub === 'lista' ? seg('filter', filters, current, 'Filtrar por fase') : ''}
    </section>
    ${body}`;

  el.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-sub], button[data-filter]');
    if (!button) return;
    if (button.dataset.sub) sub = button.dataset.sub as Sub;
    else current = button.dataset.filter as Filter;
    renderCalendar(el, matches, tz);
    // Volver el foco al botón elegido (el re-render reemplaza los botones)
    const selector = button.dataset.sub ? `button[data-sub="${sub}"]` : `button[data-filter="${current}"]`;
    el.querySelector<HTMLButtonElement>(selector)?.focus();
  };

  // El salto al día de hoy (#hoy) lo hace main.ts solo al navegar, no en cada re-render
  return () => { el.onclick = null; };
}
