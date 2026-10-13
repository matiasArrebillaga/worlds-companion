import { describe, expect, it } from 'vitest';
import { storedPalette } from './palette';

const storage = (value: string | null) => ({ getItem: () => value });

describe('storedPalette', () => {
  it('devuelve la paleta guardada si existe', () => {
    expect(storedPalette(storage('arena'))).toBe('arena');
  });
  it('vuelve a la de por defecto si no hay nada o el valor no es válido', () => {
    expect(storedPalette(storage(null))).toBe('hextech');
    expect(storedPalette(storage('rosa'))).toBe('hextech');
  });
  it('vuelve a la de por defecto si el almacenamiento falla', () => {
    expect(storedPalette({ getItem: () => { throw new Error('bloqueado'); } })).toBe('hextech');
  });
});
