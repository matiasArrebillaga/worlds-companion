import type { ChampionIcons } from '../types';

// Íconos de campeones del CDN de Riot (Data Dragon). Si no hay ícono, queda el monograma
let icons: ChampionIcons | null = null;

export function setChampionIcons(value: ChampionIcons | null | undefined): void {
  icons = value ?? null;
}

export function championIcon(name: string): string | null {
  const id = icons?.ids[name];
  return icons && id ? `${icons.base}${encodeURIComponent(id)}.png` : null;
}
