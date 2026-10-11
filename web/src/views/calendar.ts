import { currentStage, KNOCKOUT_LAYOUT, PLAYIN_LAYOUT, slotMatches, type Stage } from '../bracket';
import type { SiteData } from '../data';
import { countdownParts, formatDateTimeLong, formatDayHeading, formatDayShort, formatTime, localDayKey, pad2, PHASE_LABELS, roundLabel } from '../format';
import { escapeHtml } from '../html';
import { dayKeyOf, featuredMatch, groupByDay, recentResults } from '../schedule';
import { PENDING, swissRounds, swissStandings } from '../swiss';
import { teamMark, teamRegionColor } from '../theme/regions';
import type { Match, Team } from '../types';
import { bracketGrid, stageButtons } from './bracketGrid';
import { matchCard, predictionBlock, teamTag } from './matchCard';
import { BO1_NOTE, handlePredictionsClick, predictionsView } from './predictions';

// Calendario: la página de inicio. Lista (línea de tiempo centrada en el próximo partido),
// Bracket (Play-In · Suiza · Eliminatoria) y Predicciones
type Sub = 'lista' | 'bracket' | 'predicciones';
const SUBS: [Sub, string][] = [['lista', 'Lista'], ['bracket', 'Bracket'], ['predicciones', 'Predicciones']];

// La sub-vista y el equipo resaltado en la suiza se recuerdan mientras la página esté abierta
let sub: Sub = 'lista';
// Fase del Bracket; null = la que se está jugando (hasta que el usuario elija otra)
let stage: Stage | null = null;
let picked: string | null = null;
// Reloj de la cuenta regresiva de la vista actual (se frena al redibujar o al salir)
let stopTimer: () => void = () => {};

function emptyState(title: string, detail: string): string {
  return `<div class="state"><b>${title}</b><span>${detail}</span></div>`;
}

// ---------- Lista ----------

// El próximo partido (o la serie en curso), destacado y más grande que el resto
function featureCard(m: Match, tz: string): string {
  const when = m.start_utc ? escapeHtml(formatDateTimeLong(m.start_utc, tz)) : 'Fecha a confirmar';
  const pill = m.status === 'live'
    ? '<span class="pill cyan"><span class="dot" aria-hidden="true"></span>Serie en curso</span>'
    : `<span class="pill gold">Próximo · ${PHASE_LABELS[m.phase]} · ${escapeHtml(roundLabel(m.round))}</span>`;
  const middle = m.score ? `<span class="score">${m.score[0]}–${m.score[1]}</span>` : '<span class="vs">VS</span>';
  return `
    <article class="bezel feature${m.status === 'live' ? ' live' : ''}" id="hoy">
      <div class="core">
        <div class="match-head">${pill}<span class="label">${when} · Bo${m.best_of}</span></div>
        <div class="teams">
          <div class="team">${teamTag(m.team1)}</div>
          ${middle}
          <div class="team r">${teamTag(m.team2)}</div>
        </div>
        ${predictionBlock(m)}
        ${m.status === 'upcoming' ? '<div class="countdown" data-countdown aria-label="Cuenta regresiva"></div>' : ''}
        ${m.team1 && m.team2 ? `<div class="foot"><a href="#/partido/${encodeURIComponent(m.id)}">Cara a cara</a></div>` : ''}
      </div>
    </article>`;
}

// Días pasados arriba, el próximo partido en el medio y lo que viene abajo (main.ts hace scroll a #hoy)
function listView(matches: Match[], tz: string, featured: Match | null): string {
  const todayKey = localDayKey(new Date().toISOString(), tz);
  const days = groupByDay(matches, tz).map((g) => {
    const today = g.day === todayKey;
    // Sin próximo partido (torneo terminado o sin horarios), el ancla es el día de hoy
    const anchor = today && !featured ? ' id="hoy"' : '';
    const cards = g.matches.map((m) => (m.id === featured?.id ? featureCard(m, tz) : matchCard(m, tz))).join('');
    return `
      <section class="day${today ? ' today' : ''}"${anchor}>
        <h2 class="day-title">${g.day ? formatDayHeading(g.day) : 'Fecha a confirmar'}${today ? ' · hoy' : ''}</h2>
        <div class="day-list">${cards}</div>
      </section>`;
  }).join('');
  return days
    ? `${BO1_NOTE}${days}`
    : emptyState('Todavía no hay partidos', 'Cuando Leaguepedia publique el calendario, aparecen acá.');
}

function todayRow(m: Match, tz: string): string {
  const label = m.status === 'finished' ? 'Final' : m.status === 'live' ? 'En curso' : formatTime(m.start_utc, tz);
  const extra = m.score ? `${m.score[0]}–${m.score[1]}` : `Bo${m.best_of}`;
  return `<div class="row"><span class="t">${escapeHtml(label)}</span><span class="m">${shortOf(m.team1)} <em>vs</em> ${shortOf(m.team2)}</span><span class="label">${extra}</span></div>`;
}

function resultRow(m: Match, tz: string): string {
  if (!m.winner || !m.team1 || !m.team2 || !m.score) return '';
  const [winner, loser] = m.winner === 'team1' ? [m.team1, m.team2] : [m.team2, m.team1];
  const [hi, lo] = m.winner === 'team1' ? m.score : [m.score[1], m.score[0]];
  const day = dayKeyOf(m, tz);
  return `<div class="row"><span class="t">${day ? escapeHtml(formatDayShort(day)) : ''}</span><span class="m">${escapeHtml(winner.short)} <em>a</em> ${escapeHtml(loser.short)}</span><span class="label">${hi}–${lo}</span></div>`;
}

// Columna lateral (solo PC): los partidos de hoy y los últimos resultados
function aside(matches: Match[], tz: string): string {
  const todayKey = localDayKey(new Date().toISOString(), tz);
  const today = matches.filter((m) => dayKeyOf(m, tz) === todayKey);
  const recent = recentResults(matches, 5);
  return `
    <aside class="cal-aside" aria-label="Resumen del día">
      <section class="panel"><h2 class="label">Hoy, en tu hora</h2>
        ${today.length ? today.map((m) => todayRow(m, tz)).join('') : '<p class="muted">No hay partidos hoy.</p>'}</section>
      <section class="panel"><h2 class="label">Últimos resultados</h2>
        ${recent.length ? recent.map((m) => resultRow(m, tz)).join('') : '<p class="muted">Aparecen en cuanto termine el primer partido.</p>'}</section>
    </aside>`;
}

function shortOf(team: Team | null): string {
  return escapeHtml(team?.short ?? 'Por definir');
}

// ---------- Suiza ----------

// Botón con la sigla: tocarlo resalta el camino del equipo en todas las rondas
function teamButton(team: Team): string {
  const on = picked === team.name ? ' hl' : '';
  return `<button type="button" class="tm${on}" data-team="${escapeHtml(team.name)}" aria-pressed="${picked === team.name}" style="--rc:${teamRegionColor(team.name)}">${teamMark(team.name)}${escapeHtml(team.short)}</button>`;
}

function teamLine(m: Match, side: 'team1' | 'team2'): string {
  const team = m[side];
  if (!team) return '<div class="ln"><span class="res-slot"></span><span class="muted">Por definir</span><span></span></div>';
  const won = m.winner === side;
  const chip = !m.winner ? '<span class="res-slot"></span>'
    : won ? '<span class="res w" title="Victoria">V</span>' : '<span class="res l" title="Derrota">D</span>';
  const score = m.score ? m.score[side === 'team1' ? 0 : 1] : '';
  const cls = `ln${m.winner && !won ? ' lose' : ''}${picked === team.name ? ' hl' : ''}`;
  return `<div class="${cls}">${chip}${teamButton(team)}<span class="s">${score}</span></div>`;
}

// Un cruce: jugado, dos líneas con V/D; por jugar, en celular queda en una línea "GEN VS BLG"
function matchup(m: Match): string {
  const up = m.winner ? '' : ' up';
  return `<div class="mu${up}">${teamLine(m, 'team1')}<span class="vs">VS</span>${teamLine(m, 'team2')}</div>`;
}

// Encabezado de la caja: más verde cuantas más victorias, más rojo cuantas más derrotas
function recordTint(record: string): string {
  if (record === PENDING) return '--amt:0%';
  const [w, l] = record.split('-').map(Number);
  const balance = w - l;
  if (balance === 0) return '--amt:0%';
  return `--tint:var(${balance > 0 ? '--win' : '--loss'});--amt:${Math.min(60, Math.abs(balance) * 22)}%`;
}

function endBox(title: string, cls: 'q' | 'e', slots: [string, (w: number, l: number) => boolean][], standings: [string, Team][], records: Map<string, { wins: number; losses: number }>): string {
  const rows = slots.map(([label, test]) => {
    const teams = standings.filter(([name]) => {
      const r = records.get(name)!;
      return test(r.wins, r.losses);
    }).map(([, team]) => teamButton(team));
    return `<div class="slot"><b>${label}</b>${teams.length ? teams.join('') : '<span class="muted">—</span>'}</div>`;
  }).join('');
  return `<div class="grp end ${cls}"><div class="grp-h"><span>${title}</span></div>${rows}</div>`;
}

function swissView(matches: Match[]): string {
  const rounds = swissRounds(matches);
  if (!rounds.length) return emptyState('La fase suiza todavía no tiene partidos', 'Aparecen acá en cuanto Leaguepedia los publique.');

  // Ronda en curso: la primera con algún partido sin terminar (en celular la vista abre ahí)
  const current = rounds.find((r) => r.groups.some((g) => g.matches.some((m) => m.status !== 'finished')))?.round;
  const columns = rounds.map((r) => `
    <section class="sw-col"${r.round === current ? ' id="hoy"' : ''}>
      <h2 class="day-title">${escapeHtml(roundLabel(r.round))}${r.round === current ? ' · en curso' : ''}</h2>
      ${r.groups.map((g) => `
        <div class="grp">
          <div class="grp-h" style="${recordTint(g.record)}"><span>${g.record === PENDING ? 'Cruces a confirmar' : g.record}</span><small>Bo${g.matches[0].best_of}</small></div>
          ${g.matches.some((m) => m.team1 || m.team2)
            ? g.matches.map(matchup).join('')
            : `<div class="mu tbd">${g.matches.length} ${g.matches.length === 1 ? 'cruce' : 'cruces'} · se definen al terminar la ronda anterior</div>`}
        </div>`).join('')}
    </section>`).join('');

  // Clasificados y eliminados, según el récord final
  const records = swissStandings(matches);
  const teams = new Map<string, Team>();
  for (const m of matches) for (const t of [m.team1, m.team2]) if (t) teams.set(t.name, t);
  const standings = [...records.keys()].filter((n) => teams.has(n)).map((n): [string, Team] => [n, teams.get(n)!]);
  const end = `
    <section class="sw-col">
      <h2 class="day-title">Final</h2>
      ${endBox('✓ Clasificados', 'q', [['3-0', (w, l) => w === 3 && l === 0], ['3-1', (w, l) => w === 3 && l === 1], ['3-2', (w, l) => w === 3 && l === 2]], standings, records)}
      ${endBox('✗ Eliminados', 'e', [['0-3', (w, l) => l === 3 && w === 0], ['1-3', (w, l) => l === 3 && w === 1], ['2-3', (w, l) => l === 3 && w === 2]], standings, records)}
    </section>`;

  return `
    <p class="muted">Los equipos con el mismo récord se enfrentan entre sí: 3 victorias clasifican, 3 derrotas eliminan. Tocá un equipo para seguir su camino.</p>
    <div class="sw-cols">${columns}${end}</div>`;
}

// ---------- Bracket: Play-In · Suiza · Eliminatoria ----------

function bracketView(matches: Match[], tz: string): string {
  const current = stage ?? currentStage(matches);
  const body = current === 'suiza' ? swissView(matches)
    : current === 'playin'
      ? `<p class="muted">Doble eliminación, todo Bo5: pasa solo el campeón.</p>${bracketGrid(PLAYIN_LAYOUT, slotMatches(matches, PLAYIN_LAYOUT), tz)}`
      : `<p class="muted">Eliminación directa, todo Bo5.</p>${bracketGrid(KNOCKOUT_LAYOUT, slotMatches(matches, KNOCKOUT_LAYOUT), tz)}`;
  return `<section class="stack">${stageButtons('stage', current)}${body}</section>`;
}

// ---------- Página ----------

function seg(options: [string, string][], selected: string, label: string): string {
  const buttons = options.map(([id, text]) =>
    `<button type="button" data-sub="${id}" aria-pressed="${id === selected}">${escapeHtml(text)}</button>`).join('');
  return `<div class="seg" role="group" aria-label="${label}">${buttons}</div>`;
}

// Cuenta regresiva del próximo partido, si tiene hora confirmada
function startCountdown(el: HTMLElement, featured: Match | null): () => void {
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

export function renderCalendar(el: HTMLElement, data: SiteData, tz: string): () => void {
  const matches = data.schedule.matches;
  const featured = featuredMatch(matches, new Date());
  const body = sub === 'bracket' ? bracketView(matches, tz)
    : sub === 'predicciones' ? predictionsView(data, tz)
    : listView(matches, tz, featured);

  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Worlds 2026</span>
      <h1>Calendario</h1>
      <p class="muted">Horarios en tu zona horaria. Los partidos sin hora confirmada dicen "a confirmar".</p>
      ${seg(SUBS, sub, 'Vista del calendario')}
    </section>
    ${sub === 'lista' ? `<div class="cal"><div class="stack timeline">${body}</div>${aside(matches, tz)}</div>` : body}`;

  stopTimer();
  stopTimer = sub === 'lista' ? startCountdown(el, featured) : () => {};

  el.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.team !== undefined) {
      // Resaltar (o soltar) el camino de un equipo sin redibujar la página
      picked = picked === button.dataset.team ? null : button.dataset.team;
      el.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'));
      el.querySelectorAll<HTMLButtonElement>('.tm').forEach((b) => {
        const on = b.dataset.team === picked;
        b.setAttribute('aria-pressed', String(on));
        if (on) { b.classList.add('hl'); b.closest('.ln')?.classList.add('hl'); }
      });
      return;
    }
    let focus: string;
    if (button.dataset.sub) {
      sub = button.dataset.sub as Sub;
      focus = `button[data-sub="${sub}"]`;
    } else if (button.dataset.stage) {
      stage = button.dataset.stage as Stage;
      focus = `button[data-stage="${stage}"]`;
    } else if (handlePredictionsClick(button)) {
      const [key, value] = Object.entries(button.dataset)[0];
      focus = `button[data-${key}="${value}"]`;
    } else return;
    renderCalendar(el, data, tz);
    // Volver el foco al botón elegido (el re-render reemplaza los botones)
    el.querySelector<HTMLButtonElement>(focus)?.focus();
    // Al entrar a la lista o a la suiza, ir a lo de hoy (como al abrir la página)
    const toSwiss = button.dataset.stage === 'suiza'
      || (button.dataset.sub === 'bracket' && (stage ?? currentStage(matches)) === 'suiza');
    if (button.dataset.sub === 'lista' || toSwiss) {
      el.querySelector('#hoy')?.scrollIntoView({ block: 'start' });
    }
  };

  return () => {
    stopTimer();
    stopTimer = () => {};
    el.onclick = null;
  };
}
