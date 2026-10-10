import type { Meta, SampleId } from './types';

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
