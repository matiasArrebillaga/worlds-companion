import type { Phase } from './types';

export const FALLBACK_TZ = 'America/Argentina/Buenos_Aires';
const LOCALE = 'es-AR';
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export const PHASE_LABELS: Record<Phase, string> = {
  'play-in': 'Play-In',
  swiss: 'Fase suiza',
  knockout: 'Eliminatorias',
};

const ROUND_NAMES: Record<string, string> = {
  quarterfinals: 'Cuartos de final',
  semifinals: 'Semifinales',
  finals: 'Final',
  final: 'Final',
};

// Zona horaria del navegador; si no se puede detectar, Buenos Aires
export function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}

export function formatTime(startUtc: string | null, tz: string): string {
  if (!startUtc) return 'a confirmar';
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })
    .format(new Date(startUtc));
}

// "YYYY-MM-DD" del día local (en-CA formatea justo así)
export function localDayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz })
    .format(new Date(iso));
}

// dayKey ya es una fecha de calendario: se formatea al mediodía UTC para que no se corra de día
export function formatDayHeading(dayKey: string): string {
  return new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${dayKey}T12:00:00Z`));
}

// "17 oct": para listas donde el día largo no entra
export function formatDayShort(dayKey: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${dayKey}T12:00:00Z`)).replace('.', '');
}

export function relativeTime(fromIso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(fromIso).getTime()) / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

export function isStale(updatedAt: string, now: Date, matchDay: boolean): boolean {
  return matchDay && now.getTime() - new Date(updatedAt).getTime() > STALE_AFTER_MS;
}

export function roundLabel(raw: string): string {
  const text = raw.trim();
  const round = /^round\s+(\d+)$/i.exec(text);
  if (round) return `Ronda ${round[1]}`;
  return ROUND_NAMES[text.toLowerCase()] ?? text;
}

export function countdownParts(ms: number): { h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Probabilidad como porcentaje entero. Nunca 0% ni 100%: el modelo nunca está seguro
export function formatPercent(p: number): string {
  return `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`;
}
