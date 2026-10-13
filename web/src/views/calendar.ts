import { currentStage, KNOCKOUT_LAYOUT, PLAYIN_LAYOUT, slotMatches, STAGES, type Stage } from '../bracket';
import type { SiteData } from '../data';
import { countdownParts, formatDateTimeLong, formatDayHeading, formatDayShort, formatTime, localDayKey, pad2, PHASE_LABELS, roundLabel } from '../format';
import { escapeHtml } from '../html';
import { go, pick } from '../router';
import { drawCalibrationChart } from '../charts/calibrationChart';
import { withTransition } from './layout';
import { dayKeyOf, featuredMatch, groupByDay, recentResults, SPOILERS_KEY, spoilersHidden } from '../schedule';
import { PENDING, swissRounds, swissStandings } from '../swiss';
import { teamMark, teamRegionColor } from '../theme/regions';
import type { Match, Team } from '../types';
import { bracketGrid, recordTint, stageButtons } from './bracketGrid';
import { hiddenScore, matchCard, middleOf, predictionBlock, stretchLink, teamWithFav, upsetTag } from './matchCard';
import { BO1_NOTE, handlePredictionsClick, predictionsView } from './predictions';

// Calendario: la página de inicio. Lista (línea de tiempo centrada en el próximo partido),
// Bracket (Play-In · Suiza · Eliminatoria) y Predicciones
type Sub = 'lista' | 'bracket' | 'predicciones';
const SUBS: [Sub, string][] = [['lista', 'Lista'], ['bracket', 'Bracket'], ['predicciones', 'Predicciones']];
const STAGE_IDS = STAGES.map(([id]) => id);

// Lo que se ve sale de la URL (main.ts): '#/' Lista, '#/bracket/<fase>', '#/predicciones/<pestaña>/<fase>'.
// stage null = la fase que se está jugando; tab null = Aciertos
export interface CalendarRoute {
  sub: Sub;
  stage?: string | null;
  tab?: string | null;
}

function hashOf(r: CalendarRoute): string {
  if (r.sub === 'bracket') return r.stage ? `#/bracket/${r.stage}` : '#/bracket';
  if (r.sub === 'predicciones') {
    const tab = r.tab ?? 'aciertos';
    return `#/predicciones/${tab}${tab === 'torneo' && r.stage ? `/${r.stage}` : ''}`;
  }
  return '#/';
}

// El equipo resaltado en la suiza se recuerda mientras la página esté abierta
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
  const middle = middleOf(m);
  return `
    <article class="bezel feature${m.status === 'live' ? ' live' : ''}" id="hoy" data-id="${escapeHtml(m.id)}">
      <div class="core">
        <div class="match-head">${pill}<span class="label">${when} · Bo${m.best_of}</span></div>
        <div class="teams">
          <div class="team">${teamWithFav(m, 'team1')}</div>
          ${middle}
          <div class="team r">${teamWithFav(m, 'team2')}</div>
        </div>
        ${predictionBlock(m)}
        ${m.status === 'upcoming' ? '<div class="countdown" data-countdown aria-label="Cuenta regresiva"></div>' : ''}
        ${m.team1 && m.team2 ? `<div class="foot">${stretchLink(m, 'Cara a cara')}</div>` : ''}
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
  // Interruptor del modo sin spoilers (el estado lo pone renderCalendar en .cal)
  const toggle = `<div class="seg small spoil-toggle"><button type="button" data-spoilers aria-pressed="${spoilersHidden(localStorage)}">Ocultar resultados</button></div>`;
  return days
    ? `${toggle}${BO1_NOTE}${days}`
    : emptyState('Todavía no hay partidos', 'Cuando Leaguepedia publique el calendario, aparecen acá.');
}

function todayRow(m: Match, tz: string): string {
  const label = m.status === 'finished' ? 'Final' : m.status === 'live' ? 'En curso' : formatTime(m.start_utc, tz);
  const extra = m.score ? hiddenScore(`${m.score[0]}–${m.score[1]}`) : `Bo${m.best_of}`;
  return `<div class="row"><span class="t">${escapeHtml(label)}</span><span class="m">${shortOf(m.team1)} <em>vs</em> ${shortOf(m.team2)}</span><span class="label">${extra}</span></div>`;
}

function resultRow(m: Match, tz: string): string {
  if (!m.winner || !m.team1 || !m.team2 || !m.score) return '';
  const [winner, loser] = m.winner === 'team1' ? [m.team1, m.team2] : [m.team2, m.team1];
  const [hi, lo] = m.winner === 'team1' ? m.score : [m.score[1], m.score[0]];
  const day = dayKeyOf(m, tz);
  // Con el modo sin spoilers se ve el cruce en el orden del calendario, sin ganador
  const plain = `<span class="safe">${escapeHtml(m.team1.short)} <em>vs</em> ${escapeHtml(m.team2.short)}</span>`;
  const told = `<span class="spoil">${escapeHtml(winner.short)} <em>a</em> ${escapeHtml(loser.short)}${upsetTag(m)}</span>`;
  return `<div class="row"><span class="t">${day ? escapeHtml(formatDayShort(day)) : ''}</span><span class="m">${told}${plain}</span><span class="label">${hiddenScore(`${hi}–${lo}`)}</span></div>`;
}

// Paneles laterales (solo PC): los partidos de hoy a la izquierda y los últimos resultados a la derecha
function todayAside(matches: Match[], tz: string): string {
  const todayKey = localDayKey(new Date().toISOString(), tz);
  const today = matches.filter((m) => dayKeyOf(m, tz) === todayKey);
  return `
    <aside class="cal-aside today-aside" aria-label="Partidos de hoy">
      <section class="panel"><h2 class="label">Hoy, en tu hora</h2>
        ${today.length ? today.map((m) => todayRow(m, tz)).join('') : '<p class="muted">No hay partidos hoy.</p>'}</section>
    </aside>`;
}

function resultsAside(matches: Match[], tz: string): string {
  const recent = recentResults(matches, 5);
  return `
    <aside class="cal-aside results-aside" aria-label="Últimos resultados">
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

function bracketView(matches: Match[], tz: string, current: Stage): string {
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

// Gráfico de calibración de Predicciones › Aciertos, si está en pantalla (Chart.js carga aparte)
let stopChart: () => void = () => {};
function startCalibration(el: HTMLElement, data: SiteData): () => void {
  const canvas = el.querySelector<HTMLCanvasElement>('canvas[data-calibration]');
  if (!canvas) return () => {};
  let alive = true;
  let destroy: () => void = () => {};
  drawCalibrationChart(canvas, data.elo.accuracy.calibration).then((d) => { if (alive) destroy = d; else d(); });
  return () => { alive = false; destroy(); };
}

// Cuenta regresiva del próximo partido, si tiene hora confirmada
function startCountdown(el: HTMLElement, featured: Match | null): () => void {
  const box = el.querySelector<HTMLElement>('[data-countdown]');
  if (!box || !featured?.start_utc) return () => {};
  const start = Date.parse(featured.start_utc);
  let timer = 0;
  const tick = () => {
    const left = start - Date.now();
    if (left <= 0) {
      // Llegó la hora: el resultado recién aparece con la próxima actualización de datos
      box.innerHTML = '<span class="pill cyan"><span class="dot" aria-hidden="true"></span>Por empezar</span>';
      window.clearInterval(timer);
      return;
    }
    const { h, m, s } = countdownParts(left);
    box.innerHTML = `<div><b>${pad2(h)}</b><span class="label">h</span></div><div><b>${pad2(m)}</b><span class="label">min</span></div><div><b>${pad2(s)}</b><span class="label">s</span></div>`;
  };
  tick();
  if (Date.now() < start) timer = window.setInterval(tick, 1000);
  return () => window.clearInterval(timer);
}

export function renderCalendar(el: HTMLElement, data: SiteData, tz: string, route: CalendarRoute): () => void {
  const matches = data.schedule.matches;
  const featured = featuredMatch(matches, new Date());
  const { sub } = route;
  const stage = pick(route.stage ?? null, STAGE_IDS, currentStage(matches));
  const body = sub === 'bracket' ? bracketView(matches, tz, stage)
    : sub === 'predicciones' ? predictionsView(data, tz, route.tab ?? null, route.stage ?? null)
    : listView(matches, tz, featured);

  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Worlds 2026</span>
      <h1>Calendario</h1>
      <p class="muted">Horarios en tu zona horaria. Los partidos sin hora confirmada dicen "a confirmar".</p>
      ${seg(SUBS, sub, 'Vista del calendario')}
    </section>
    ${sub === 'lista' ? `<div class="cal${spoilersHidden(localStorage) ? ' hide-res' : ''}">${todayAside(matches, tz)}<div class="stack timeline">${body}</div>${resultsAside(matches, tz)}</div>` : body}`;

  stopTimer();
  stopTimer = sub === 'lista' ? startCountdown(el, featured) : () => {};
  stopChart();
  stopChart = startCalibration(el, data);

  el.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    // Sin spoilers: "Ver" destapa solo ese partido; el interruptor tapa o destapa todos y se recuerda
    if (button.classList.contains('reveal')) {
      button.closest('.bezel, .row')?.classList.add('shown');
      return;
    }
    if (button.dataset.spoilers !== undefined) {
      const hide = el.querySelector('.cal')!.classList.toggle('hide-res');
      button.setAttribute('aria-pressed', String(hide));
      try { localStorage.setItem(SPOILERS_KEY, hide ? 'hide' : 'show'); } catch { /* sin almacenamiento: vale hasta recargar */ }
      return;
    }
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
    // Vista nueva según el botón: las pestañas y fases entran al historial (go); los filtros solo redibujan
    let next: CalendarRoute;
    if (button.dataset.sub) {
      next = { sub: button.dataset.sub as Sub };
    } else if (button.dataset.stage) {
      next = { sub: 'bracket', stage: button.dataset.stage };
    } else {
      const pred = handlePredictionsClick(button, route.tab ?? null, route.stage ?? null);
      if (!pred) return;
      next = { sub: 'predicciones', ...pred };
    }
    const [key, value] = Object.entries(button.dataset)[0];
    const hash = hashOf(next);
    const update = () => {
      go(hash);
      renderCalendar(el, data, tz, next);
      // Volver el foco al botón elegido (el re-render reemplaza los botones)
      el.querySelector<HTMLButtonElement>(`button[data-${key}="${value}"]`)?.focus();
      // Al entrar a la lista o a la suiza, ir a lo de hoy (como al abrir la página)
      const toSwiss = next.sub === 'bracket' && pick(next.stage ?? null, STAGE_IDS, currentStage(matches)) === 'suiza';
      if (button.dataset.stage === 'suiza' || (button.dataset.sub && (next.sub === 'lista' || toSwiss))) {
        el.querySelector('#hoy')?.scrollIntoView({ block: 'start' });
      }
    };
    // Cambiar de pestaña o de fase lleva fundido; un filtro redibuja en el lugar
    if (hash !== location.hash) withTransition(update);
    else update();
  };

  return () => {
    stopTimer();
    stopTimer = () => {};
    stopChart();
    stopChart = () => {};
    el.onclick = null;
  };
}
