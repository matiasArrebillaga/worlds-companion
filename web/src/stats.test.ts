import { describe, expect, it } from 'vitest';
import { findById, fmt, pct, periodOf, sortBy, starterByRole, teamByName } from './stats';

describe('periodOf', () => {
  it('returns null when there are no Worlds games yet', () => {
    const entry = { season: { games: 3 }, worlds: null };
    expect(periodOf(entry, 'season')).toEqual({ games: 3 });
    expect(periodOf(entry, 'worlds')).toBeNull();
  });
});

describe('sortBy', () => {
  it('sorts both ways and keeps missing values last', () => {
    const rows = [{ v: 2 }, { v: null }, { v: 5 }];
    expect(sortBy(rows, (r) => r.v, 'desc').map((r) => r.v)).toEqual([5, 2, null]);
    expect(sortBy(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual([2, 5, null]);
  });
});

describe('findById', () => {
  it('finds or returns undefined for unknown ids', () => {
    expect(findById([{ id: 'a' }], 'a')).toEqual({ id: 'a' });
    expect(findById([{ id: 'a' }], 'nope')).toBeUndefined();
    expect(findById([{ id: 'a' }], null)).toBeUndefined();
  });
});

describe('fmt / pct', () => {
  it('shows a dash for missing data, never 0', () => {
    expect(fmt(null)).toBe('—');
    expect(fmt(4.256, 1)).toBe('4.3');
    expect(pct(null)).toBe('—');
    expect(pct(0.625)).toBe('63%');
  });
});

describe('teamByName / starterByRole', () => {
  const teams = [{ id: 't1', name: 'T1', roster: ['faker'] }];
  const players = [{ id: 'faker', role: 'mid' as const }, { id: 'sub', role: 'mid' as const }];
  it('finds the team of a match and its starter for a role', () => {
    expect(teamByName(teams, 'T1')?.id).toBe('t1');
    expect(teamByName(teams, 'Nope')).toBeUndefined();
    expect(starterByRole(teams[0], players, 'mid')?.id).toBe('faker');
    expect(starterByRole(teams[0], players, 'top')).toBeUndefined();
  });
});
