// Paletas de colores: los valores viven en styles.css (:root[data-palette="…"]); acá solo la lista y la elección
export const PALETTES = [
  { id: 'hextech', name: 'Hextech' }, // la de siempre, por defecto
  { id: 'arena', name: 'Arena' },
  { id: 'grafito', name: 'Grafito' }, // minimalista oscura
  { id: 'papel', name: 'Papel' }, // minimalista clara
] as const;

export const PALETTE_KEY = 'wc-palette';
const DEFAULT = 'hextech';

// Paleta guardada en el navegador; si no hay o no es válida, la de por defecto
export function storedPalette(storage: Pick<Storage, 'getItem'>): string {
  try {
    const id = storage.getItem(PALETTE_KEY);
    return PALETTES.some((p) => p.id === id) ? (id as string) : DEFAULT;
  } catch {
    return DEFAULT; // sin almacenamiento
  }
}

// Aplica la paleta en <html> y la guarda. La de por defecto no lleva atributo
export function applyPalette(id: string, storage: Pick<Storage, 'setItem'>): void {
  const root = document.documentElement;
  if (id === DEFAULT) delete root.dataset.palette;
  else root.dataset.palette = id;
  // Color de la barra del navegador en el celular
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  try { storage.setItem(PALETTE_KEY, id); } catch { /* sin almacenamiento: vale hasta recargar */ }
}
