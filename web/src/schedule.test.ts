import { describe, expect, it } from 'vitest';
import { featuredMatch, groupByDay, recentResults } from './schedule';
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
