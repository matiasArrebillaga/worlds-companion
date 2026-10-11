import { escapeHtml } from '../html';
import type { RatedTeam } from '../types';

// Identidad visual de cada equipo: color de su región (rombito o subrayado del logo) y logo.
// Los colores viven en styles.css (--region-*); los logos, en public/img/teams (los baja pipeline/assets.py).
const KNOWN = new Set(['KR', 'CN', 'EU', 'NA', 'BR', 'APAC']);

// Los partidos solo traen nombre y sigla: región y logo salen del ranking Elo al cargar los datos
let byTeam = new Map<string, Pick<RatedTeam, 'region' | 'logo'>>();

// Ligas de cada región, para que el buscador encuentre "lck" o "lec" (los datos traen el código de región)
export const REGION_LEAGUES: Record<string, string> = {
  KR: 'LCK', CN: 'LPL', EU: 'LEC', NA: 'LCS LTA', BR: 'CBLOL LTA', APAC: 'LCP PCS VCS',
};

export function setTeams(teams: RatedTeam[]): void {
  byTeam = new Map(teams.map((t) => [t.name, { region: t.region, logo: t.logo }]));
}

// Página de cada equipo (los partidos traen el nombre; la página usa el id de teams.json)
let pageOf = new Map<string, string>();

export function setTeamPages(teams: { id: string; name: string }[]): void {
  pageOf = new Map(teams.map((t) => [t.name, `#/equipo/${encodeURIComponent(t.id)}`]));
}

// null si el equipo no tiene página (no está en teams.json)
export function teamHref(teamName: string): string | null {
  return pageOf.get(teamName) ?? null;
}

export function regionColor(region: string | null | undefined): string {
  return `var(--region-${region && KNOWN.has(region) ? region.toLowerCase() : 'other'})`;
}

export function teamRegionColor(teamName: string): string {
  return regionColor(byTeam.get(teamName)?.region);
}

export function logoSrc(logo: string | null | undefined): string | null {
  return logo ? `${import.meta.env.BASE_URL}${logo}` : null;
}

// <img> del logo (decorativo: la sigla o el nombre siempre van al lado). Vacío si no hay logo
export function logoImg(logo: string | null | undefined): string {
  const src = logoSrc(logo);
  return src ? `<img class="logo" src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async">` : '';
}

// Logo del equipo o, si no tiene, el rombito de su región
export function teamMark(teamName: string): string {
  return logoImg(byTeam.get(teamName)?.logo) || '<i class="rg" aria-hidden="true"></i>';
}
