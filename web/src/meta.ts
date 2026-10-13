import { PHASE_LABELS } from './format';
import { FEW_GAMES, fmt } from './stats';
import type { ChampionEntry, Meta, PaceSplit, Phase, Role, SampleId } from './types';

export const PHASES: Phase[] = ['play-in', 'swiss', 'knockout'];

// Opciones del selector de muestra: la guía existe solo mientras Worlds tenga menos de 10 partidas
export function sampleOptions(meta: Meta): [SampleId, string][] {
  const worlds: [SampleId, string] = ['worlds', meta.worlds_patch ? `Worlds (${meta.worlds_patch})` : 'Worlds'];
  return meta.guide_patch ? [worlds, ['guide', `Guía ${meta.guide_patch}`]] : [worlds];
}

// Mientras exista la guía, se arranca por ella (Worlds tiene muy pocas partidas)
export function defaultSample(meta: Meta): SampleId {
  return meta.guide_patch ? 'guide' : 'worlds';
}

// % de victorias ajustado con otro k (igual que pipeline/meta.py · adjust_winrates): k partidas imaginarias al 50%
export function adjustedWinrate(c: { wins: number; picks: number }, k: number): number | null {
  return c.picks ? (c.wins + k / 2) / (c.picks + k) : null;
}

// Opciones del selector de k: valores fijos para comparar más el estimado por el pipeline, en orden y sin repetir
const K_FIXED = [25, 50, 100, 200, 400];
export function kOptions(estimated: number | undefined): number[] {
  return [...new Set(estimated ? [...K_FIXED, estimated] : K_FIXED)].sort((a, b) => a - b);
}

// 31.5 → "31:30"; un dato faltante es "—", nunca 0
export function minutes(value: number | null): string {
  if (value === null) return '—';
  const whole = Math.floor(value);
  return `${whole}:${String(Math.round((value - whole) * 60)).padStart(2, '0')}`;
}

// Ritmo por fase para la tabla de la vista Meta: solo las fases que ya tienen partidas, en orden del torneo
export function paceRows(byPhase: Partial<Record<Phase, PaceSplit>>) {
  return PHASES.flatMap((phase) => {
    const p = byPhase[phase];
    return p ? [{ phase, label: PHASE_LABELS[phase], games: p.games, duration: minutes(p.median_minutes), kpm: fmt(p.kills_per_min, 2) }] : [];
  });
}

// Rango del 95%: "48–70%". Faltante: "—"
export function range(low?: number | null, high?: number | null): string {
  if (low == null || high == null) return '—';
  return `${Math.round(low * 100)}–${Math.round(high * 100)}%`;
}

// Hay ventaja solo si todo el rango del % del azul queda de un lado del 50%
export function sideVerdict(low?: number | null, high?: number | null): string {
  if (low == null || high == null) return '—';
  if (low > 0.5) return 'Ventaja del lado azul';
  if (high < 0.5) return 'Ventaja del lado rojo';
  return 'No se distingue de 50%';
}

export interface PresenceShift {
  champion: string;
  before: number;
  after: number;
  delta: number;
}

// Mayores subas y bajas de presencia de Worlds respecto de la guía (qué cambió con el parche)
export function presenceShifts(rows: ChampionEntry[], limit: number): { up: PresenceShift[]; down: PresenceShift[] } {
  const shifts = rows.flatMap((c) => (c.guide_presence == null || c.presence === null ? [] : [{
    champion: c.champion, before: c.guide_presence, after: c.presence, delta: Math.round((c.presence - c.guide_presence) * 10000) / 10000,
  }]));
  return {
    up: shifts.filter((s) => s.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, limit),
    down: shifts.filter((s) => s.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, limit),
  };
}

// "Espejismos": campeones cuyo % de victorias crudo más cambia al ajustarlo. Desde 5 picks: con 1 pick
// (0% o 100%) es obvio que es azar; lo engañoso es un 73% con 15 picks que parece sólido
export function mirages(rows: ChampionEntry[], limit: number): ChampionEntry[] {
  const gap = (c: ChampionEntry) => Math.abs((c.winrate ?? 0) - (c.winrate_adj ?? 0));
  return rows.filter((c) => c.picks >= FEW_GAMES && c.winrate !== null && c.winrate_adj != null)
    .sort((a, b) => gap(b) - gap(a)).slice(0, limit);
}

// Flex: jugado al menos 2 veces en 2 roles o más (una sola vez puede ser un pick raro, no un flex)
export function flexPicks(rows: ChampionEntry[]): { champion: string; picks: number; roles: [Role, number][] }[] {
  return rows.flatMap((c) => {
    const roles = (Object.entries(c.roles ?? {}) as [Role, number][]).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
    return roles.length >= 2 ? [{ champion: c.champion, picks: c.picks, roles }] : [];
  }).sort((a, b) => b.picks - a.picks);
}
