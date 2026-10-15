import { describe, expect, it } from 'vitest';
import { featuredMatch, groupByDay, markStarted, recentResults, spoilersHidden } from './schedule';
import type { Match } from './types';

const BA = 'America/Argentina/Buenos_Aires';

function match(overrides: Partial<Match>): Match {
  return {
    id: 'm', phase: 'swiss', round: 'Round 1', best_of: 1,
    start_utc: '2026-10-24T17:00:00Z', date: '2026-10-24',
    team1: { name: 'T1', short: 'T1' }, team2: { name: 'G2 Esports', short: 'G2' },
    score: null, winner: null, status: 'upcoming', prediction: null,
    ...overrides,
  };
}

describe('groupByDay', () => {
  it('groups by local day and puts undated matches last', () => {
    const groups = groupByDay([
      match({ id: 'late', start_utc: '2026-10-24T02:00:00Z', date: '2026-10-24' }),
      match({ id: 'a', start_utc: '2026-10-24T17:00:00Z' }),
      match({ id: 'tbc', start_utc: null, date: '2026-10-25' }),
      match({ id: 'nodate', start_utc: null, date: null }),
    ], BA);
    expect(groups.map((g) => [g.day, g.matches.map((m) => m.id)])).toEqual([
      ['2026-10-23', ['late']],
      ['2026-10-24', ['a']],
      ['2026-10-25', ['tbc']],
      [null, ['nodate']],
    ]);
  });
});

describe('markStarted', () => {
  it('treats a started series as live until its time window ends', () => {
    const ms = [
      match({ id: 'bo5', best_of: 5, start_utc: '2026-10-24T14:00:00Z' }), // 2 h de 5,5: en curso
      match({ id: 'bo1', best_of: 1, start_utc: '2026-10-24T14:00:00Z' }), // 2 h de 1,5: ya pasó
      match({ id: 'later', start_utc: '2026-10-24T17:00:00Z' }),
      match({ id: 'done', status: 'finished', start_utc: '2026-10-24T15:00:00Z' }),
    ];
    markStarted(ms, new Date('2026-10-24T16:00:00Z'));
    expect(ms.map((m) => m.status)).toEqual(['live', 'upcoming', 'upcoming', 'finished']);
  });
});

describe('featuredMatch', () => {
  const now = new Date('2026-10-24T16:00:00Z');
  it('prefers a live series', () => {
    const live = match({ id: 'live', status: 'live', score: [1, 1] });
    expect(featuredMatch([match({ id: 'next' }), live], now)?.id).toBe('live');
  });
  it('otherwise picks the next upcoming match with a time', () => {
    const past = match({ id: 'past', start_utc: '2026-10-24T10:00:00Z' });
    const tbc = match({ id: 'tbc', start_utc: null });
    const next = match({ id: 'next', start_utc: '2026-10-24T17:00:00Z' });
    expect(featuredMatch([past, tbc, next], now)?.id).toBe('next');
  });
  it('returns null when nothing is coming', () => {
    expect(featuredMatch([], now)).toBeNull();
  });
});

describe('recentResults', () => {
  it('returns the latest finished matches first', () => {
    const results = recentResults([
      match({ id: 'old', status: 'finished', winner: 'team1', start_utc: '2026-10-23T17:00:00Z' }),
      match({ id: 'new', status: 'finished', winner: 'team2', start_utc: '2026-10-24T17:00:00Z' }),
      match({ id: 'up' }),
    ], 5);
    expect(results.map((m) => m.id)).toEqual(['new', 'old']);
  });
});

describe('spoilersHidden', () => {
  const store = (value: string | null) => ({ getItem: () => value });

  it('oculta los resultados si no hay nada guardado', () => {
    expect(spoilersHidden(store(null))).toBe(true);
  });

  it('los muestra solo si se eligió verlos', () => {
    expect(spoilersHidden(store('show'))).toBe(false);
    expect(spoilersHidden(store('hide'))).toBe(true);
  });

  it('sin acceso al almacenamiento, oculta', () => {
    expect(spoilersHidden({ getItem: () => { throw new Error('bloqueado'); } })).toBe(true);
  });
});
