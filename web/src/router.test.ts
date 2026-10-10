import { describe, expect, it } from 'vitest';
import { parseHash, tabFor } from './router';

describe('parseHash', () => {
  it('splits the section and the id', () => {
    expect(parseHash('#/equipo/gen-g')).toEqual({ path: '#/equipo', param: 'gen-g' });
    expect(parseHash('#/equipos')).toEqual({ path: '#/equipos', param: null });
    expect(parseHash('')).toEqual({ path: '#/', param: null });
    expect(parseHash('#/')).toEqual({ path: '#/', param: null });
    expect(parseHash('#/jugador/k%C3%ADin')).toEqual({ path: '#/jugador', param: 'kíin' });
  });
});

describe('tabFor', () => {
  it('lights the Equipos tab on team and player pages', () => {
    expect(tabFor('#/equipo')).toBe('#/equipos');
    expect(tabFor('#/jugador')).toBe('#/equipos');
    expect(tabFor('#/')).toBe('#/');
    expect(tabFor('#/partido')).toBeNull();
  });
});

describe('parseHash with old links', () => {
  it('sends the removed sections to their new place', () => {
    expect(parseHash('#/calendario')).toEqual({ path: '#/', param: null });
    expect(parseHash('#/predicciones')).toEqual({ path: '#/', param: null });
    expect(parseHash('#/estadisticas')).toEqual({ path: '#/equipos', param: null });
  });
});

describe('parseHash with match ids', () => {
  it('keeps ids that contain slashes and spaces when they are encoded', () => {
    const id = '2026 Season World Championship/Play-In_Round 1_1';
    expect(parseHash(`#/partido/${encodeURIComponent(id)}`)).toEqual({ path: '#/partido', param: id });
  });
});

describe('parseHash with a broken link', () => {
  it('does not throw on a malformed percent sign', () => {
    expect(parseHash('#/equipo/100%')).toEqual({ path: '#/equipo', param: '100%' });
  });
});
