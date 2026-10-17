import { relativeTime, isStale } from '../format';
import { escapeHtml } from '../html';
import type { Meta } from '../types';

// Marca la pestaña activa en la barra superior y en la inferior
export function setActiveTab(tab: string | null): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-tab]').forEach((link) => {
    if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

// Cambio de vista con un fundido corto (View Transitions del navegador). Donde no existe, o con
// "reducir movimiento", cambia de golpe como siempre
export function withTransition(update: () => void): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  type Transition = { ready: Promise<void>; finished: Promise<void> };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => Transition };
  // Con la pestaña oculta el navegador cancela la animación: se cambia directo
  if (!doc.startViewTransition || reduced || document.hidden) {
    update();
    return;
  }
  const transition = doc.startViewTransition(update);
  // Si la animación se cancela, la vista igual se actualiza: no es un error
  transition.ready.catch(() => {});
  transition.finished.catch(() => {});
}

// Con una serie en curso, punto rojo en la pestaña Calendario (arriba) y "En vivo" en la barra de abajo
export function renderLive(live: boolean): void {
  document.querySelectorAll<HTMLAnchorElement>('a[data-tab="#/"]').forEach((link) => {
    link.classList.toggle('is-live', live);
    if (live) link.title = 'Hay una serie en curso';
    else link.removeAttribute('title');
  });
  const label = document.querySelector('[data-cal-label]');
  if (label) label.textContent = live ? 'En vivo' : 'Calendario';
}

// Aviso de resultados nuevos (abajo de la pantalla); se va solo
let hideToast = 0;
export function showToast(html: string): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = html;
  el.classList.add('show');
  window.clearTimeout(hideToast);
  hideToast = window.setTimeout(() => el.classList.remove('show'), 6000);
}

// "Actualizado hace X": siempre visible, en blanco si los datos están atrasados en día de partido.
// Sin punto rojo: el rojo que late es solo para "en vivo"
export function renderUpdated(meta: Meta, now: Date, matchDay: boolean): void {
  const el = document.getElementById('updated');
  if (!el) return;
  const stale = isStale(meta.updated_at, now, matchDay);
  el.classList.toggle('stale', stale);
  // En el celular se oculta "Actualizado" (.upd-word) para que la barra entre en un renglón
  const when = escapeHtml(relativeTime(meta.updated_at, now));
  el.innerHTML = `<span class="upd-word">Actualizado </span>${when}${stale ? ' · puede estar atrasado' : ''}`;
}

// Barra de pestañas fija (.pinbar): queda pegada debajo de la barra superior al deslizar.
// Sus alturas van a variables CSS (--topbar-h, --pinbar-h) para ubicar lo que se pega debajo
// (encabezados de tabla, columna lateral) y el salto a "hoy"
export function trackStickyBars(view: HTMLElement): void {
  const root = document.documentElement.style;
  const topbar = document.querySelector<HTMLElement>('.topbar');
  let pinbar: HTMLElement | null = null;
  const measure = () => {
    root.setProperty('--topbar-h', `${topbar?.offsetHeight ?? 0}px`);
    root.setProperty('--pinbar-h', `${pinbar?.offsetHeight ?? 0}px`);
  };
  const sizes = new ResizeObserver(measure);
  if (topbar) sizes.observe(topbar);
  // Cada vista dibuja su propia barra: al cambiar, se mide la nueva
  new MutationObserver(() => {
    const found = view.querySelector<HTMLElement>('.pinbar');
    if (found === pinbar) return;
    if (pinbar) sizes.unobserve(pinbar);
    pinbar = found;
    if (pinbar) sizes.observe(pinbar);
    measure();
  }).observe(view, { childList: true, subtree: true });
}

// Al cambiar de pestaña con la barra ya pegada arriba, la pestaña nueva se ve desde su principio
// (justo debajo de la barra) en vez de quedar a la altura del scroll de la anterior
export function showFromTop(view: HTMLElement): void {
  const pinbar = view.querySelector<HTMLElement>('.pinbar');
  const content = pinbar?.nextElementSibling;
  if (!pinbar || !content) return;
  const stuckBottom = (parseFloat(getComputedStyle(pinbar).top) || 0) + pinbar.offsetHeight;
  // Lugar en la página donde empieza el contenido (el sticky no cambia el flujo)
  const contentTop = content.getBoundingClientRect().top + window.scrollY;
  const target = Math.max(0, contentTop - stuckBottom - 16);
  if (window.scrollY > target) window.scrollTo(0, target);
}
