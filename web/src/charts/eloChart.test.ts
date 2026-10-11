import { describe, expect, it } from 'vitest';
import { alignLines, dailyChange, dailyElo } from './eloChart';

describe('dailyElo', () => {
  it('keeps the rating at the end of each day', () => {
    const day = dailyElo([['2026-09-01', 1800], ['2026-09-01', 1810], ['2026-09-03', 1805]]);
    expect([...day.entries()]).toEqual([['2026-09-01', 1810], ['2026-09-03', 1805]]);
  });
});

describe('alignLines', () => {
  it('merges the dates and leaves gaps where a team did not play', () => {
    const a = new Map([['2026-09-01', 1810], ['2026-09-03', 1805]]);
    const b = new Map([['2026-09-02', 1700]]);
    expect(alignLines([a, b])).toEqual({
      dates: ['2026-09-01', '2026-09-02', '2026-09-03'],
      values: [[1810, null, 1805], [null, 1700, null]],
    });
  });
});

describe('dailyChange', () => {
  it('compares with the last day the team played', () => {
    expect(dailyChange([1810, null, 1805], 2)).toBe(-5);
    expect(dailyChange([1810, null, 1805], 0)).toBeNull();
    expect(dailyChange([1810, null, 1805], 1)).toBeNull();
  });
});
