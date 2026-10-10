import type { Role } from './types';

export type Period = 'season' | 'worlds';
export const PERIODS: [Period, string][] = [['season', 'Temporada 2026'], ['worlds', 'Worlds 2026']];

// Con menos partidas que esto, la stat se muestra atenuada: muestra chica, dice poco
export const FEW_GAMES = 5;

export const ROLE_LABELS: Record<Role, string> = { top: 'Top', jng: 'Jungla', mid: 'Mid', bot: 'ADC', sup: 'Support' };

export function periodOf<T>(entry: { season: T; worlds: T | null }, period: Period): T | null {
  return period === 'season' ? entry.season : entry.worlds;
}

// Ordena sin modificar la lista original; los datos faltantes (null) siempre al final
export function sortBy<T>(rows: T[], key: (row: T) => number | string | null, dir: 'asc' | 'desc'): T[] {
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    const order = x < y ? -1 : x > y ? 1 : 0;
    return dir === 'asc' ? order : -order;
  });
}

export function findById<T extends { id: string }>(rows: T[], id: string | null): T | undefined {
  return id === null ? undefined : rows.find((r) => r.id === id);
}

// Un dato faltante se muestra como "—", nunca como 0
export function fmt(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toFixed(digits);
}

export function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

// Equipo de una tarjeta de partido (el calendario usa el nombre de Leaguepedia, igual que teams.json)
export function teamByName<T extends { name: string }>(teams: T[], name: string): T | undefined {
  return teams.find((t) => t.name === name);
}

// Titular de un rol: el jugador de la última alineación que juega ese rol
export function starterByRole<P extends { id: string; role: Role }>(team: { roster: string[] }, players: P[], role: Role): P | undefined {
  return players.find((p) => team.roster.includes(p.id) && p.role === role);
}
