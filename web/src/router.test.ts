import { describe, expect, it } from 'vitest';
import { parseHash, tabFor } from './router';

describe('parseHash', () => {
  it('splits the section and the id', () => {
    expect(parseHash('#/equipo/gen-g')).toEqual({ path: '#/equipo', param: 'gen-g' });
    expect(parseHash('#/estadisticas')).toEqual({ path: '#/estadisticas', param: null });
    expect(parseHash('')).toEqual({ path: '#/', param: null });
    expect(parseHash('#/')).toEqual({ path: '#/', param: null });
    expect(parseHash('#/jugador/k%C3%ADin')).toEqual({ path: '#/jugador', param: 'kíin' });
  });
});

describe('tabFor', () => {
  it('lights the Estadísticas tab on team and player pages', () => {
    expect(tabFor('#/equipo')).toBe('#/estadisticas');
    expect(tabFor('#/jugador')).toBe('#/estadisticas');
    expect(tabFor('#/calendario')).toBe('#/calendario');
    expect(tabFor('#/partido')).toBeNull();
  });
});
