// Tooltip compartido: cualquier elemento con data-tip muestra ese texto al pasar el mouse, al tocarlo
// (celular) o al llegar con el teclado. Un solo cartel para toda la página, que sigue al puntero.

export function installTooltip(): void {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);

  const show = (el: Element, x: number, y: number) => {
    tip.textContent = el.getAttribute('data-tip');
    tip.classList.add('on');
    // Arriba del puntero; si no entra, abajo. Nunca fuera de la pantalla
    const left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, x - tip.offsetWidth / 2));
    const above = y - tip.offsetHeight - 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${above < 8 ? y + 18 : above}px`;
  };
  const hide = () => tip.classList.remove('on');
  const target = (event: Event) => (event.target as Element | null)?.closest?.('[data-tip]') ?? null;

  document.addEventListener('pointermove', (event) => {
    const el = target(event);
    if (el) show(el, event.clientX, event.clientY);
    else hide();
  });
  // En el celular no hay "pasar por encima": el toque muestra el dato y tocar otra cosa lo esconde
  document.addEventListener('pointerdown', (event) => {
    const el = target(event);
    if (el) show(el, event.clientX, event.clientY);
    else hide();
  });
  document.addEventListener('focusin', (event) => {
    const el = target(event);
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
}

// Texto del tooltip de un rango del 95%: "Dato 51% · rango 95%: 40–62%"
export function rangeTip(low: number | null | undefined, high: number | null | undefined, point: number | null | undefined, pointLabel = 'Dato'): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const parts = [];
  if (point != null) parts.push(`${pointLabel} ${pct(point)}`);
  if (low != null && high != null) parts.push(`rango 95%: ${Math.round(low * 100)}–${pct(high)}`);
  return parts.join(' · ');
}
