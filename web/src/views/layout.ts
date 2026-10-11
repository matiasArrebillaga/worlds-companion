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

// Con una serie en curso, punto cian en la pestaña Calendario (arriba) y "En vivo" en la barra de abajo
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

// "Actualizado hace X": siempre visible, en dorado si los datos están atrasados en día de partido
export function renderUpdated(meta: Meta, now: Date, matchDay: boolean): void {
  const el = document.getElementById('updated');
  if (!el) return;
  const stale = isStale(meta.updated_at, now, matchDay);
  el.classList.toggle('stale', stale);
  const text = `Actualizado ${relativeTime(meta.updated_at, now)}`;
  el.innerHTML = stale
    ? `${escapeHtml(text)} · puede estar atrasado`
    : `<span class="dot" aria-hidden="true"></span>${escapeHtml(text)}`;
}
