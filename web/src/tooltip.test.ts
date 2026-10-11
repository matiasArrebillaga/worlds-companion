import { describe, expect, it } from 'vitest';
import { rangeTip } from './tooltip';

describe('rangeTip', () => {
  it('names the point and the 95% range', () => {
    expect(rangeTip(0.4, 0.62, 0.51)).toBe('Dato 51% · rango 95%: 40–62%');
    expect(rangeTip(null, null, 0.72, 'Ajustado')).toBe('Ajustado 72%');
    expect(rangeTip(0.1, 0.3, null)).toBe('rango 95%: 10–30%');
  });
});
