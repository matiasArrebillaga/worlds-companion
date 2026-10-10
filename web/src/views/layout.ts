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
