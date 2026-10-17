import './styles.css';
import { isNewer, loadData, loadMeta, type SiteData } from './data';
import { setChampionIcons } from './theme/champions';
import { setTeams } from './theme/regions';
import { localDayKey, resolveTimeZone } from './format';
import { dayKeyOf, markStarted, spoilersHidden } from './schedule';
import { renderCalendar } from './views/calendar';
import { canGoBack, markNewStep, parseHash, rememberScroll, savedScroll, syncDepth, tabFor, type Route } from './router';
import { renderLive, renderUpdated, setActiveTab, showToast, trackStickyBars, withTransition } from './views/layout';
import { finishedSince, matchupLine, resultLine } from './changes';
import { escapeHtml } from './html';
import { installTooltip } from './tooltip';
import { verdict } from './predictions';
import type { Match } from './types';
import { renderMatch } from './views/match';
import { renderMeta } from './views/meta';
import { renderPlayer } from './views/player';
import { renderStats } from './views/stats';
import { renderTeam } from './views/team';
import { setTeamPages } from './theme/regions';
import { PALETTES, applyPalette, storedPalette } from './theme/palette';

type View = (el: HTMLElement, data: SiteData, tz: string, route: Route) => () => void;

// La pestaña de cada sección va en la URL: '#/bracket/suiza', '#/equipos/jugadores', '#/meta/panorama',
// '#/partido/<id>/partidas'
const ROUTES: Record<string, View> = {
  '#/': (el, data, tz) => renderCalendar(el, data, tz, { sub: 'lista' }),
  '#/bracket': (el, data, tz, r) => renderCalendar(el, data, tz, { sub: 'bracket', stage: r.param }),
  '#/predicciones': (el, data, tz, r) => renderCalendar(el, data, tz, { sub: 'predicciones', tab: r.param, stage: r.sub }),
  '#/equipos': (el, data, _tz, r) => renderStats(el, data, r.param),
  '#/equipo': (el, data, tz, r) => renderTeam(el, data, tz, r.param),
  '#/jugador': (el, data, tz, r) => renderPlayer(el, data, tz, r.param),
  '#/partido': (el, data, tz, r) => renderMatch(el, data, tz, r.param, r.sub),
  '#/meta': (el, data, _tz, r) => renderMeta(el, data, r.param),
};

const view = document.getElementById('view') as HTMLElement;
const tz = resolveTimeZone();
let cleanup: () => void = () => {};

const REFRESH_EVERY_MS = 5 * 60_000;

function currentRoute(): Route {
  const route = parseHash(location.hash);
  return route.path in ROUTES ? route : { path: '#/', param: null, sub: null };
}

function render(data: SiteData): void {
  setTeams(data.elo.teams);
  setTeamPages(data.teams.teams);
  setChampionIcons(data.champions.icons);
  markStarted(data.schedule.matches, new Date());
  cleanup();
  const r = currentRoute();
  cleanup = ROUTES[r.path](view, data, tz, r);
  renderLive(data.schedule.matches.some((m) => m.status === 'live'));
}

// Navegar. Si es "atrás" o "adelante" y ya habíamos estado ahí, se vuelve al mismo lugar del scroll;
// si es una navegación nueva, arriba de todo o a lo de hoy (próximo partido o ronda en curso) si la vista lo marca
function route(data: SiteData, restore = false): void {
  setActiveTab(tabFor(currentRoute().path));
  render(data);
  const saved = restore ? savedScroll(location.hash) : undefined;
  const today = view.querySelector('#hoy');
  if (saved !== undefined) window.scrollTo(0, saved);
  else if (today) today.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
}

// Tarjetas esqueleto mientras llegan los datos: la espera tiene la forma de lo que viene
const SKELETON = `<div class="stack" aria-busy="true" aria-label="Cargando partidos">${'<div class="sk"><i style="width:30%"></i><i class="big" style="width:80%"></i><i style="width:55%"></i></div>'.repeat(3)}</div>`;

// Aviso de los partidos que terminaron desde la última carga, y destello en su tarjeta
function announce(finished: Match[]): void {
  // Con "Ocultar resultados" activado, el aviso dice qué serie terminó pero no quién ganó
  const hide = spoilersHidden(localStorage);
  const lines = finished.flatMap((m) => {
    const line = hide ? matchupLine(m) : resultLine(m);
    if (!line) return [];
    const v = hide ? null : verdict(m);
    const mark = v === 'hit' ? '<span class="verdict hit">✓ Acertó</span>' : v === 'miss' ? '<span class="verdict miss">✗ Falló</span>' : '';
    return [`<span class="toast-line"><b>${escapeHtml(line)}</b><span class="muted">terminó la serie</span>${mark}</span>`];
  });
  if (!lines.length) return;
  showToast(lines.slice(0, 3).join('') + (lines.length > 3 ? `<span class="muted">y ${lines.length - 3} más</span>` : ''));
  for (const m of finished) view.querySelector(`[data-id="${CSS.escape(m.id)}"]`)?.classList.add('flash');
}

// Un clic en un link interno es una navegación nueva; un hashchange sin clic es atrás/adelante
let linkClicked = false;
document.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!link) return;
  // "Volver": si llegamos navegando dentro del sitio, se vuelve de verdad (con el scroll y el orden de antes)
  if (link.dataset.back !== undefined && canGoBack()) {
    event.preventDefault();
    history.back();
    return;
  }
  // Un link a la misma dirección no dispara hashchange: no cuenta como navegación
  linkClicked = link.hash !== (location.hash || '#/');
});
history.scrollRestoration = 'manual';
syncDepth();

// Con la página abierta, buscar datos nuevos cada 5 minutos y redibujar sin mover el scroll
async function refreshIfNewer(data: SiteData): Promise<SiteData> {
  try {
    if (!isNewer(data.meta, await loadMeta())) return data;
    const fresh = await loadData();
    render(fresh);
    announce(finishedSince(data.schedule.matches, fresh.schedule.matches));
    return fresh;
  } catch {
    return data; // sin conexión: se sigue mostrando lo último que se cargó
  }
}

function refreshUpdated(data: SiteData): void {
  const now = new Date();
  const todayKey = localDayKey(now.toISOString(), tz);
  const matchDay = data.schedule.matches.some((m) => dayKeyOf(m, tz) === todayKey);
  renderUpdated(data.meta, now, matchDay);
}

async function start(): Promise<void> {
  installTooltip();
  trackStickyBars(view);
  view.innerHTML = SKELETON;
  let data: SiteData;
  try {
    data = await loadData();
  } catch {
    view.innerHTML = '<div class="state error"><b>No se pudieron cargar los datos</b><span>Revisá tu conexión y recargá la página. Si sigue pasando, el sitio se está actualizando: probá en unos minutos.</span></div>';
    return;
  }
  refreshUpdated(data);
  window.setInterval(() => refreshUpdated(data), 60_000);
  window.setInterval(async () => {
    data = await refreshIfNewer(data);
    refreshUpdated(data);
  }, REFRESH_EVERY_MS);
  window.addEventListener('hashchange', (event) => {
    // Todavía no se redibujó: el scroll es el de la página que se deja
    rememberScroll(new URL(event.oldURL).hash, window.scrollY);
    if (linkClicked) markNewStep();
    else syncDepth();
    const restore = !linkClicked;
    withTransition(() => route(data, restore));
    linkClicked = false;
  });
  // Selector de paleta junto al logo: al cambiar se redibuja la vista para que los gráficos tomen los colores nuevos
  const palette = document.getElementById('palette') as HTMLSelectElement;
  palette.innerHTML = PALETTES.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  palette.value = storedPalette(localStorage);
  // Reaplica al arrancar: si había guardada una paleta que ya no existe, vuelve a la de por defecto
  applyPalette(palette.value, localStorage);
  palette.addEventListener('change', () => {
    applyPalette(palette.value, localStorage);
    render(data);
  });
  route(data);
}

start();
