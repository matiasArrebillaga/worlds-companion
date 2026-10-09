import './styles.css';
import { loadData, type SiteData } from './data';
import { localDayKey, resolveTimeZone } from './format';
import { dayKeyOf } from './schedule';
import { renderCalendar } from './views/calendar';
import { renderUpdated, setActiveTab } from './views/layout';
import { renderToday } from './views/today';
import type { Match } from './types';

type View = (el: HTMLElement, matches: Match[], tz: string) => () => void;

const ROUTES: Record<string, View> = {
  '#/': renderToday,
  '#/calendario': renderCalendar,
};

const view = document.getElementById('view') as HTMLElement;
const tz = resolveTimeZone();
let cleanup: () => void = () => {};

function route(data: SiteData): void {
  const hash = location.hash in ROUTES ? location.hash : '#/';
  setActiveTab(hash);
  cleanup();
  window.scrollTo(0, 0);
  cleanup = ROUTES[hash](view, data.schedule.matches, tz);
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
  window.addEventListener('hashchange', () => route(data));
  route(data);
}

start();
