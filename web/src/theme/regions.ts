import type { RatedTeam } from '../types';

// Color de cada región: un rombito al lado del nombre del equipo, siempre junto al texto (nunca solo color).
// Los valores viven en styles.css (--region-*); acá solo se elige cuál usar.
const KNOWN = new Set(['KR', 'CN', 'EU', 'NA', 'BR', 'APAC']);

// Región por nombre de equipo. Los partidos no traen la región: sale del ranking Elo al cargar los datos
let byTeam = new Map<string, string | null>();

export function setRegions(teams: RatedTeam[]): void {
  byTeam = new Map(teams.map((t) => [t.name, t.region]));
}

export function regionColor(region: string | null | undefined): string {
  return `var(--region-${region && KNOWN.has(region) ? region.toLowerCase() : 'other'})`;
}

export function teamRegionColor(teamName: string): string {
  return regionColor(byTeam.get(teamName));
}
