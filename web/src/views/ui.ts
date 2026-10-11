import { escapeHtml } from '../html';
import { sortBy } from '../stats';
import { rangeTip } from '../tooltip';

// Piezas visuales compartidas por Estadísticas y Meta: barras, rangos, tabla aireada y recuadros.
// En PC la tabla es una tabla; en el celular (CSS) cada fila pasa a ser una tarjeta con un dato por baldosa.

export type BarKind = 'share' | 'count' | 'span' | 'diverge';
export type Dir = 'asc' | 'desc';

export interface Column<T> {
  id: string;
  label: string;
  hint?: string; // aclaración chica debajo del encabezado
  value: (row: T) => number | null; // para ordenar y para la barra
  show: (row: T) => string; // el número que se lee (también va en los recuadros de líderes)
  sub?: (row: T) => string; // detalle debajo del número: récord, % crudo
  bar?: (row: T) => string; // dibujo propio que se muestra siempre (presencia, rango)
  kind: BarKind;
  ref?: number; // centro de las barras 'diverge'
  wide?: boolean; // en el celular ocupa todo el ancho de la tarjeta
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));

// Ancho (0–100) de la barra de un dato según su tipo:
// share = proporción 0–1; count = desde 0 hasta el máximo de la lista;
// span = del mínimo al máximo (Elo, oro/min: ahí el 0 no significa nada; el mínimo igual se ve);
// diverge = media barra hacia cada lado del centro, escalada al mayor desvío de la lista
export function barWidth(kind: BarKind, value: number, values: number[], ref = 0): number {
  if (kind === 'share') return clamp(value * 100);
  if (kind === 'diverge') {
    const spread = Math.max(...values.map((v) => Math.abs(v - ref)));
    return spread > 0 ? (Math.abs(value - ref) / spread) * 50 : 0;
  }
  if (kind === 'span') {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return hi > lo ? 12 + (88 * (value - lo)) / (hi - lo) : 100;
  }
  const max = Math.max(...values);
  return max > 0 ? clamp((value / max) * 100) : 0;
}

export function meter(kind: BarKind, value: number | null, values: number[], ref = 0): string {
  if (value === null || !values.length) return '';
  const width = barWidth(kind, value, values, ref).toFixed(1);
  if (kind === 'diverge') {
    const up = value >= ref;
    return `<span class="meter div" aria-hidden="true"><i class="${up ? 'up' : 'down'}" style="width:${width}%;${up ? 'left' : 'right'}:50%"></i></span>`;
  }
  return `<span class="meter" aria-hidden="true"><i style="width:${width}%"></i></span>`;
}

// Posición (0–100) de un valor en un eje [min, max]; lo que se pasa del eje queda en el borde
function place(v: number, min: number, max: number): number {
  return clamp(((v - min) / (max - min)) * 100);
}

// Rango del 95% dibujado: línea con extremos, rombo en el dato y línea dorada en 50%.
// Verde si el rango entero queda sobre 50%, rojo si queda entero debajo. El texto del rango va al lado.
export function whisker(low: number | null | undefined, high: number | null | undefined, point: number | null | undefined, min = 0, max = 1): string {
  const x = (v: number) => place(v, min, max).toFixed(1);
  const range = low != null && high != null
    ? `<span class="ci ${low > 0.5 ? 'up' : high < 0.5 ? 'down' : ''}" style="left:${x(low)}%;width:${(place(high, min, max) - place(low, min, max)).toFixed(1)}%"></span>`
    : '';
  const dot = point != null ? `<span class="pt" style="left:${x(point)}%"></span>` : '';
  // El dibujo es decorativo para lectores de pantalla (el texto va al lado); con el mouse muestra el dato exacto
  return `<span class="wh" aria-hidden="true" data-tip="${escapeHtml(rangeTip(low, high, point))}"><span class="ref" style="left:${x(0.5)}%"></span>${range}${dot}</span>`;
}

// Mancuerna: rombo hueco = antes, rombo lleno = después; banda opcional = rango del 95% del después.
// labels: cómo se llaman el antes y el después en el tooltip (todas las mancuernas del sitio son porcentajes)
export function dumbbell(before: number, after: number, min: number, max: number, low?: number | null, high?: number | null,
  labels: [string, string] = ['Antes', 'Después']): string {
  const x = (v: number) => place(v, min, max);
  const band = low != null && high != null ? `<span class="band" style="left:${x(low).toFixed(1)}%;width:${(x(high) - x(low)).toFixed(1)}%"></span>` : '';
  const left = Math.min(x(before), x(after));
  const width = Math.abs(x(after) - x(before));
  const tip = `${labels[0]} ${Math.round(before * 100)}% → ${rangeTip(low, high, after, labels[1])}`;
  return `<span class="db" aria-hidden="true" data-tip="${escapeHtml(tip)}"><span class="ref" style="left:${x(0.5).toFixed(1)}%"></span>${band}` +
    `<span class="ln" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></span>` +
    `<span class="d a" style="left:${x(before).toFixed(1)}%"></span><span class="d b" style="left:${x(after).toFixed(1)}%"></span></span>`;
}

export function axis(ticks: number[], min: number, max: number, format: (v: number) => string): string {
  return `<div class="axis" aria-hidden="true">${ticks.map((t) => `<span style="left:${place(t, min, max)}%">${format(t)}</span>`).join('')}</div>`;
}

// "Volver" de las páginas de equipo, jugador y partido. Instalado como app no hay botón atrás del navegador.
// main.ts usa history.back() si se llegó navegando dentro del sitio; si no (link compartido), va a `fallback`
export function backLink(fallback: string): string {
  return `<a class="back" href="${fallback}" data-back><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Volver</a>`;
}

// Notas largas plegadas: la explicación está, pero no compite con los datos
export function how(text: string, question = '¿Cómo se lee?'): string {
  return `<details class="how"><summary>${question}</summary><p>${text}</p></details>`;
}

// Pestañas de sección (subrayadas) y filtros (chips que bajan de línea, nunca se deslizan)
export function subtabs(group: string, options: [string, string][], current: string, label: string): string {
  const buttons = options.map(([id, text]) =>
    `<button type="button" data-${group}="${id}" aria-pressed="${id === current}">${escapeHtml(text)}</button>`).join('');
  return `<div class="subtabs" role="group" aria-label="${label}">${buttons}</div>`;
}

export function chips(group: string, options: [string, string][], current: string, label: string): string {
  const buttons = options.map(([id, text]) =>
    `<button type="button" class="chip" data-${group}="${id}" aria-pressed="${id === current}">${escapeHtml(text)}</button>`).join('');
  return `<div class="chips" role="group" aria-label="${label}"><span class="label">${label}</span>${buttons}</div>`;
}

// Primera columna: chip o hexágono + nombre + detalle. name y sub ya vienen escapados
export function who(lead: string, name: string, sub: string, nameClass = ''): string {
  return `<span class="who">${lead}<span><b class="${nameClass}">${name}</b><small>${sub}</small></span></span>`;
}

export interface Leader<T> {
  column: Column<T>;
  label: string;
  rows: T[]; // entre quiénes se busca al mejor (sin muestras chicas)
}

// Recuadros con el mejor de cada categoría
export function leaders<T>(items: Leader<T>[], whoOf: (row: T) => string): string {
  const tiles = items.flatMap(({ column, label, rows }) => {
    const best = sortBy(rows, column.value, 'desc')[0];
    if (!best || column.value(best) === null) return [];
    return [`<div class="bezel leader"><div class="core"><span class="label">${label}</span>${whoOf(best)}<span class="val">${column.show(best)}</span></div></div>`];
  });
  return tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : '';
}

export function kpiTiles(items: [string, string, string][]): string {
  return `<div class="tiles">${items.map(([label, value, sub]) =>
    `<div class="bezel"><div class="core kpi"><span class="label">${label}</span><b>${value}</b><span class="muted">${sub}</span></div></div>`).join('')}</div>`;
}

// Selector para ordenar en el celular, donde no se ven los encabezados de la tabla
export function sortBar<T>(columns: Column<T>[], sort: string, dir: Dir): string {
  const options = columns.map((c) =>
    `<option value="${c.id}"${c.id === sort ? ' selected' : ''}>${c.label}${c.hint ? ` (${c.hint})` : ''}</option>`).join('');
  return `<div class="sortbar"><label class="label" for="sort-select">Ordenar</label>
    <select id="sort-select" data-sortselect>${options}</select>
    <button type="button" class="chip" data-dir>${dir === 'desc' ? 'Mayor ▼' : 'Menor ▲'}</button></div>`;
}

export interface TableOptions<T> {
  rows: T[]; // ya ordenadas y recortadas
  scale: T[]; // filas contra las que se escalan las barras (todas, no solo las visibles)
  groups: [string, Column<T>[]][];
  first: string; // encabezado de la primera columna
  whoOf: (row: T) => string;
  sort: string;
  dir: Dir;
  few?: (row: T) => boolean; // muestra chica: la fila se atenúa
  rankOf?: (row: T) => number; // puesto en la tabla completa (al buscar, las filas filtradas lo conservan)
}

// Tabla aireada: encabezado por grupo, la columna que ordena resaltada y con barra
export function airyTable<T>(o: TableOptions<T>): string {
  const columns = o.groups.flatMap(([, cols]) => cols);
  const starts = new Set(o.groups.slice(1).map(([, cols]) => cols[0].id)); // primera columna de cada grupo: lleva divisor
  const cls = (c: Column<T>) => [c.id === o.sort ? 'on' : '', starts.has(c.id) ? 'gs' : '', c.wide ? 'wide' : ''].join(' ').trim();
  const groupRow = o.groups.length > 1
    ? `<tr class="grp"><th></th>${o.groups.map(([label, cols], i) => `<th colspan="${cols.length}" class="${i ? 'gs' : ''}">${label}</th>`).join('')}</tr>`
    : '';
  const head = columns.map((c) => {
    const on = c.id === o.sort;
    const aria = on ? (o.dir === 'desc' ? 'descending' : 'ascending') : 'none';
    const arrow = on ? (o.dir === 'desc' ? ' ▼' : ' ▲') : '';
    return `<th class="${cls(c)}" aria-sort="${aria}"><button type="button" data-sort="${c.id}">${c.label}${arrow}${c.hint ? `<small>${c.hint}</small>` : ''}</button></th>`;
  }).join('');
  const scale = Object.fromEntries(columns.map((c) => [c.id, o.scale.map(c.value).filter((v): v is number => v !== null)]));
  const body = o.rows.map((row, i) => {
    const cells = columns.map((c) => {
      const drawing = c.bar ? c.bar(row) : c.id === o.sort ? meter(c.kind, c.value(row), scale[c.id], c.ref) : '';
      return `<td class="${cls(c)}" data-label="${c.label}">${c.show(row)}${c.sub ? `<small>${c.sub(row)}</small>` : ''}${drawing}</td>`;
    }).join('');
    return `<tr class="${o.few?.(row) ? 'few' : ''}"><td class="ent"><div class="ent-in"><span class="rk">${o.rankOf ? o.rankOf(row) : i + 1}</span>${o.whoOf(row)}</div></td>${cells}</tr>`;
  }).join('');
  return `<table class="airy"><thead>${groupRow}<tr><th>${o.first}</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ---- Buscador de tablas ----

// Sin tildes, mayúsculas ni signos: "kaisa" encuentra a "Kai'Sa" y "leblanc" a "LeBlanc"
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ¿Alguno de los campos contiene lo buscado? Sin búsqueda, todo coincide
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = normalize(query);
  return !q || fields.some((f) => f != null && normalize(f).includes(q));
}

export function searchBox(value: string, placeholder: string): string {
  return `<input type="search" class="search" id="search" data-search value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" autocomplete="off" spellcheck="false">`;
}

export function noResults(query: string): string {
  return `<div class="state"><b>No hay resultados para «${escapeHtml(query)}»</b><span>Probá con otra parte del nombre.</span></div>`;
}

// Puesto de cada fila en la lista completa ya ordenada
export function ranks<T>(sorted: T[]): (row: T) => number {
  const at = new Map(sorted.map((row, i) => [row, i + 1]));
  return (row) => at.get(row) ?? 0;
}

// Al escribir solo se reemplazan los resultados ([data-results]) con los de la vista nueva: el campo de texto
// queda intacto, así no se pierde el foco ni se cierra el teclado del celular
export function swapResults(el: HTMLElement, html: string): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  const fresh = template.content.querySelector('[data-results]');
  const old = el.querySelector('[data-results]');
  if (fresh && old) old.replaceWith(fresh);
}
