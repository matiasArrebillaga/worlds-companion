import { localDayKey } from './format';
import type { Match } from './types';

export interface DayGroup {
  day: string | null;
  matches: Match[];
}

// Día local del partido; si no tiene hora confirmada se usa la fecha del calendario
export function dayKeyOf(m: Match, tz: string): string | null {
  return m.start_utc ? localDayKey(m.start_utc, tz) : m.date;
}

export function groupByDay(matches: Match[], tz: string): DayGroup[] {
  const byDay = new Map<string | null, Match[]>();
  for (const m of matches) {
    const key = dayKeyOf(m, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), m]);
  }
  return [...byDay.entries()]
    .map(([day, list]) => ({ day, matches: list }))
    .sort((a, b) => (a.day ?? '9999').localeCompare(b.day ?? '9999'));
}

// El pipeline marca "en vivo" recién cuando termina la primera partida (y corre cada hora), así que una serie
// que ya arrancó figura como "upcoming". Se toma como en curso desde su hora hasta ~1 h por partida + 30 min.
const HOUR_MS = 3_600_000;
export function markStarted(matches: Match[], now: Date): void {
  for (const m of matches) {
    if (m.status !== 'upcoming' || !m.start_utc) continue;
    const elapsed = now.getTime() - new Date(m.start_utc).getTime();
    if (elapsed >= 0 && elapsed < (m.best_of + 0.5) * HOUR_MS) m.status = 'live';
  }
}

// El próximo partido con hora confirmada que todavía no empezó
export function nextMatch(matches: Match[], now: Date): Match | null {
  return matches.find((m) => m.status === 'upcoming' && m.start_utc !== null && new Date(m.start_utc) >= now) ?? null;
}

// Una serie en curso tiene prioridad; si no, el próximo partido
export function featuredMatch(matches: Match[], now: Date): Match | null {
  return matches.find((m) => m.status === 'live') ?? nextMatch(matches, now);
}

export function recentResults(matches: Match[], limit: number): Match[] {
  return matches
    .filter((m) => m.status === 'finished')
    .sort((a, b) => (b.start_utc ?? b.date ?? '').localeCompare(a.start_utc ?? a.date ?? ''))
    .slice(0, limit);
}

// Primer día del torneo (YYYY-MM-DD), para marcar dónde empieza Worlds en los gráficos
export function firstDay(matches: Match[]): string | null {
  return matches.map((m) => m.date).filter((d): d is string => !!d).sort()[0] ?? null;
}

// Modo sin spoilers de la Lista: viene activado; solo se apaga si la persona eligió ver los resultados
export const SPOILERS_KEY = 'wc-spoilers';
export function spoilersHidden(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(SPOILERS_KEY) !== 'show';
  } catch {
    return true; // navegación privada o almacenamiento bloqueado
  }
}
