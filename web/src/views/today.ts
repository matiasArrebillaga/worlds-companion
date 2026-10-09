import { countdownParts, formatDateTimeLong, formatTime, localDayKey, pad2, PHASE_LABELS, roundLabel } from '../format';
import { escapeHtml } from '../html';
import { dayKeyOf, featuredMatch, recentResults } from '../schedule';
import type { Match } from '../types';
import { matchCard } from './matchCard';

function emptyState(title: string, detail: string): string {
  return `<div class="state"><b>${title}</b><span>${detail}</span></div>`;
}

function short(m: Match, side: 'team1' | 'team2'): string {
  return escapeHtml(m[side]?.short ?? 'Por definir');
}

function featureCard(m: Match, tz: string): string {
  const when = m.start_utc ? escapeHtml(formatDateTimeLong(m.start_utc, tz)) : 'Fecha a confirmar';
  const pill = m.status === 'live'
    ? '<span class="pill cyan"><span class="dot" aria-hidden="true"></span>Serie en curso</span>'
    : `<span class="pill gold">Próximo · ${PHASE_LABELS[m.phase]} · ${escapeHtml(roundLabel(m.round))}</span>`;
  const middle = m.score ? `<span class="score">${m.score[0]}–${m.score[1]}</span>` : '<span class="vs">VS</span>';
  return `
    <article class="bezel feature${m.status === 'live' ? ' live' : ''}">
      <div class="core">
        <div class="match-head">${pill}<span class="label">${when}</span></div>
        <div class="teams">
          <div class="team"><span class="tag">${short(m, 'team1')}</span></div>
          ${middle}
          <div class="team r"><span class="tag">${short(m, 'team2')}</span></div>
        </div>
        ${m.status === 'upcoming' ? '<div class="countdown" data-countdown aria-label="Cuenta regresiva"></div>' : ''}
      </div>
    </article>`;
}

function listRow(m: Match, tz: string): string {
  const label = m.status === 'finished' ? 'Final' : m.status === 'live' ? 'En curso' : formatTime(m.start_utc, tz);
  return `<div class="row"><span class="t">${escapeHtml(label)}</span><span class="m">${short(m, 'team1')} vs ${short(m, 'team2')}</span><span class="label">Bo${m.best_of}</span></div>`;
}

export function renderToday(el: HTMLElement, matches: Match[], tz: string): () => void {
  const now = new Date();
  const featured = featuredMatch(matches, now);
  const todayKey = localDayKey(now.toISOString(), tz);
  const today = matches.filter((m) => dayKeyOf(m, tz) === todayKey);
  const recent = recentResults(matches, 4);

  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Hoy</span>
      ${featured ? featureCard(featured, tz) : emptyState('No hay partidos próximos', 'Cuando Leaguepedia publique el calendario, el próximo partido aparece acá.')}
    </section>
    <div class="grid g2">
      <section class="bezel"><div class="core">
        <h2 class="label">Hoy, en tu hora</h2>
        ${today.length ? today.map((m) => listRow(m, tz)).join('') : emptyState('No hay partidos hoy', 'Mirá el calendario completo para ver los próximos días.')}
      </div></section>
      <section class="stack">
        <h2 class="label">Últimos resultados</h2>
        ${recent.length ? recent.map((m) => matchCard(m, tz)).join('') : emptyState('Sin resultados todavía', 'Aparecen acá en cuanto termine el primer partido.')}
      </section>
    </div>`;

  // Cuenta regresiva: solo para un partido próximo con hora confirmada
  const box = el.querySelector<HTMLElement>('[data-countdown]');
  if (!box || !featured?.start_utc) return () => {};
  const start = Date.parse(featured.start_utc);
  const tick = () => {
    const { h, m, s } = countdownParts(start - Date.now());
    box.innerHTML = `<div><b>${pad2(h)}</b><span class="label">h</span></div><div><b>${pad2(m)}</b><span class="label">min</span></div><div><b>${pad2(s)}</b><span class="label">s</span></div>`;
  };
  tick();
  const timer = window.setInterval(tick, 1000);
  return () => window.clearInterval(timer);
}
