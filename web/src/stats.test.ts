import { describe, expect, it } from 'vitest';
import { findById, fmt, formRanking, pct, periodOf, signed, sortBy, starterByRole, teamByName, vsWorldsRows } from './stats';
import type { PlayerEntry, TeamEntry, TeamStats } from './types';

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

const stats = (games: number, winrate: number | null) => ({ games, winrate } as TeamStats);

describe('vsWorldsRows', () => {
  it('compares season and vs-Worlds winrate, most inflated first, skipping teams without those games', () => {
    const team = (short: string, season: number, vs: number | null) =>
      ({ short, season: stats(100, season), vs_worlds: vs === null ? null : stats(40, vs) } as TeamEntry);
    const rows = vsWorldsRows([team('GEN', 0.74, 0.59), team('BLG', 0.71, 0.69), team('NEW', 0.6, null)]);
    expect(rows.map((r) => r.team.short)).toEqual(['GEN', 'BLG']);
    expect(rows[0].diff).toBeCloseTo(-0.15);
  });
});

describe('formRanking', () => {
  it('ranks starters with a form, filtered by role', () => {
    const p = (name: string, role: PlayerEntry['role'], form: number | null, starter = true) => ({ name, role, form, starter } as PlayerEntry);
    const players = [p('a', 'mid', 0.1), p('b', 'mid', 0.5), p('c', 'top', 0.9), p('d', 'mid', 0.7, false), p('e', 'mid', null)];
    expect(formRanking(players, 'mid').map((x) => x.name)).toEqual(['b', 'a']);
    expect(formRanking(players, 'all').map((x) => x.name)).toEqual(['c', 'b', 'a']);
  });
});

describe('signed', () => {
  it('always shows the sign of a deviation', () => {
    expect(signed(0.32, 2)).toBe('+0.32');
    expect(signed(-0.1, 2)).toBe('−0.10');
    expect(signed(null, 2)).toBe('—');
  });
});
