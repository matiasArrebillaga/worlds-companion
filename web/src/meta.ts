import { PHASE_LABELS } from './format';
import { fmt } from './stats';
import type { Meta, PaceSplit, Phase, SampleId } from './types';

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
