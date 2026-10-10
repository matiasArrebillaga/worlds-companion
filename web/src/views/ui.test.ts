import { describe, expect, it } from 'vitest';
import { barWidth } from './ui';

describe('barWidth', () => {
  it('scales each kind of bar so the biggest value is visible and the zero point means something', () => {
    // Proporción: 62% → 62% de la barra
    expect(barWidth('share', 0.62, [0.3, 0.62])).toBeCloseTo(62);
    // Cantidad: relativa al máximo de la lista
    expect(barWidth('count', 4, [2, 4, 8])).toBe(50);
    // Mínimo a máximo: el más bajo igual se ve (12%), el más alto llena
    expect(barWidth('span', 1700, [1700, 1950])).toBe(12);
    expect(barWidth('span', 1950, [1700, 1950])).toBe(100);
    // Divergente: el mayor desvío ocupa media barra, hacia cualquiera de los dos lados
    expect(barWidth('diverge', -800, [400, -800], 0)).toBe(50);
    expect(barWidth('diverge', 0.55, [0.45, 0.55, 0.6], 0.5)).toBeCloseTo(25);
    // Todos iguales: sin división por cero
    expect(barWidth('diverge', 0, [0, 0], 0)).toBe(0);
    expect(barWidth('span', 5, [5, 5])).toBe(100);
  });
});
