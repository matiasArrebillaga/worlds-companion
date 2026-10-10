import './styles.css';
import { isNewer, loadData, loadMeta, type SiteData } from './data';
import { localDayKey, resolveTimeZone } from './format';
import { dayKeyOf } from './schedule';
import { renderCalendar } from './views/calendar';
import { parseHash, tabFor } from './router';
import { renderUpdated, setActiveTab } from './views/layout';
import { renderPredictions } from './views/predictions';
import { renderMatch } from './views/match';
import { renderMeta } from './views/meta';
import { renderPlayer } from './views/player';
import { renderStats } from './views/stats';
import { renderTeam } from './views/team';
import { renderToday } from './views/today';

type View = (el: HTMLElement, data: SiteData, tz: string, param: string | null) => () => void;

const ROUTES: Record<string, View> = {
  '#/': (el, data, tz) => renderToday(el, data.schedule.matches, tz),
  '#/calendario': (el, data, tz) => renderCalendar(el, data.schedule.matches, tz),
  '#/estadisticas': (el, data) => renderStats(el, data),
  '#/equipo': renderTeam,
  '#/jugador': renderPlayer,
  '#/partido': renderMatch,
  '#/meta': (el, data) => renderMeta(el, data),
  '#/predicciones': (el, data, tz) => renderPredictions(el, data, tz),
};

const view = document.getElementById('view') as HTMLElement;
const tz = resolveTimeZone();
let cleanup: () => void = () => {};

const REFRESH_EVERY_MS = 5 * 60_000;

function currentRoute() {
  const route = parseHash(location.hash);
  return route.path in ROUTES ? route : { path: '#/', param: null };
}

function render(data: SiteData): void {
  cleanup();
  const { path, param } = currentRoute();
  cleanup = ROUTES[path](view, data, tz, param);
}

// Navegar: arriba de todo, o al día de hoy si la vista lo marca
function route(data: SiteData): void {
  setActiveTab(tabFor(currentRoute().path));
  render(data);
  const today = view.querySelector('#hoy');
  if (today) today.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
}

// Con la página abierta, buscar datos nuevos cada 5 minutos y redibujar sin mover el scroll
async function refreshIfNewer(data: SiteData): Promise<SiteData> {
  try {
    if (!isNewer(data.meta, await loadMeta())) return data;
    const fresh = await loadData();
    render(fresh);
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
  view.innerHTML = '<div class="state"><b>Cargando partidos…</b></div>';
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
  window.addEventListener('hashchange', () => route(data));
  route(data);
}

start();
