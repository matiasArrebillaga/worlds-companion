import { formatDayHeading, localDayKey, PHASE_LABELS } from '../format';
import { groupByDay } from '../schedule';
import type { Match, Phase } from '../types';
import { matchCard } from './matchCard';

type Filter = Phase | 'all';
const FILTERS: Filter[] = ['all', 'play-in', 'swiss', 'knockout'];

// El filtro se recuerda mientras la página esté abierta
let current: Filter = 'all';

function filterLabel(f: Filter): string {
  return f === 'all' ? 'Todas' : PHASE_LABELS[f];
}

export function renderCalendar(el: HTMLElement, matches: Match[], tz: string): () => void {
  const visible = current === 'all' ? matches : matches.filter((m) => m.phase === current);
  const groups = groupByDay(visible, tz);
  const todayKey = localDayKey(new Date().toISOString(), tz);

  const buttons = FILTERS.map(
    (f) => `<button type="button" data-filter="${f}" aria-pressed="${f === current}">${filterLabel(f)}</button>`,
  ).join('');

  const days = groups.map((g) => `
    <section class="day${g.day === todayKey ? ' today' : ''}" ${g.day === todayKey ? 'id="hoy"' : ''}>
      <h2 class="day-title">${g.day ? formatDayHeading(g.day) : 'Fecha a confirmar'}${g.day === todayKey ? ' · hoy' : ''}</h2>
      <div class="grid g3">${g.matches.map((m) => matchCard(m, tz)).join('')}</div>
    </section>`).join('');

  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Worlds 2026</span>
      <h1>Calendario</h1>
      <p class="muted">Horarios en tu zona horaria. Los partidos sin hora confirmada dicen "a confirmar".</p>
      <div class="seg" role="group" aria-label="Filtrar por fase">${buttons}</div>
    </section>
    ${days || '<div class="state"><b>No hay partidos en esta fase todavía</b><span>Aparecen acá en cuanto Leaguepedia los publique.</span></div>'}`;

  el.querySelector('.seg')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-filter]');
    if (!button) return;
    current = button.dataset.filter as Filter;
    renderCalendar(el, matches, tz);
  });

  // Al entrar, saltar al día de hoy si está en la lista
  el.querySelector('#hoy')?.scrollIntoView({ block: 'start' });
  return () => {};
}
