import { describe, expect, it } from 'vitest';
import { parseHash, pick, tabFor } from './router';

describe('parseHash', () => {
  it('splits the section and the id', () => {
    expect(parseHash('#/equipo/gen-g')).toEqual({ path: '#/equipo', param: 'gen-g', sub: null });
    expect(parseHash('#/equipos')).toEqual({ path: '#/equipos', param: null, sub: null });
    expect(parseHash('')).toEqual({ path: '#/', param: null, sub: null });
    expect(parseHash('#/')).toEqual({ path: '#/', param: null, sub: null });
    expect(parseHash('#/jugador/k%C3%ADin')).toEqual({ path: '#/jugador', param: 'kíin', sub: null });
  });

  it('reads a second level for nested tabs', () => {
    expect(parseHash('#/predicciones/torneo/suiza')).toEqual({ path: '#/predicciones', param: 'torneo', sub: 'suiza' });
    expect(parseHash('#/bracket/eliminatoria')).toEqual({ path: '#/bracket', param: 'eliminatoria', sub: null });
  });
});

describe('tabFor', () => {
  it('lights the Equipos tab on team and player pages', () => {
    expect(tabFor('#/equipo')).toBe('#/equipos');
    expect(tabFor('#/jugador')).toBe('#/equipos');
    expect(tabFor('#/')).toBe('#/');
    expect(tabFor('#/partido')).toBeNull();
  });

  it('lights the Calendario tab on bracket and predictions', () => {
    expect(tabFor('#/bracket')).toBe('#/');
    expect(tabFor('#/predicciones')).toBe('#/');
  });
});

describe('parseHash with old links', () => {
  it('sends the removed sections to their new place', () => {
    expect(parseHash('#/calendario')).toEqual({ path: '#/', param: null, sub: null });
    expect(parseHash('#/estadisticas')).toEqual({ path: '#/equipos', param: null, sub: null });
  });
});

describe('parseHash with match ids', () => {
  it('keeps ids that contain slashes and spaces when they are encoded', () => {
    const id = '2026 Season World Championship/Play-In_Round 1_1';
    expect(parseHash(`#/partido/${encodeURIComponent(id)}`)).toEqual({ path: '#/partido', param: id, sub: null });
  });
});

describe('parseHash with a broken link', () => {
  it('does not throw on a malformed percent sign', () => {
    expect(parseHash('#/equipo/100%')).toEqual({ path: '#/equipo', param: '100%', sub: null });
  });
});

describe('pick', () => {
  it('accepts only known options', () => {
    const tabs = ['equipos', 'jugadores'] as const;
    expect(pick('jugadores', tabs, 'equipos')).toBe('jugadores');
    expect(pick('nada', tabs, 'equipos')).toBe('equipos');
    expect(pick(null, tabs, 'equipos')).toBe('equipos');
  });
});
