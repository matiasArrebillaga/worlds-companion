import { describe, expect, it } from 'vitest';
import { defaultSample, minutes, paceRows, sampleOptions } from './meta';
import type { Meta } from './types';

const base: Meta = { updated_at: 'x', source_fetched_at: 'x', match_count: 1 };

describe('sample selector', () => {
  it('offers the guide only while it exists and starts there', () => {
    const before: Meta = { ...base, worlds_patch: '16.20', guide_patch: '16.17–16.18', worlds_games: 3 };
    expect(sampleOptions(before)).toEqual([['worlds', 'Worlds (16.20)'], ['guide', 'Guía 16.17–16.18']]);
    expect(defaultSample(before)).toBe('guide');
    const after: Meta = { ...base, worlds_patch: '16.20', guide_patch: null, worlds_games: 12 };
    expect(sampleOptions(after)).toEqual([['worlds', 'Worlds (16.20)']]);
    expect(defaultSample(after)).toBe('worlds');
  });

  it('tolerates an old meta.json without patches', () => {
    expect(sampleOptions(base)).toEqual([['worlds', 'Worlds']]);
    expect(defaultSample(base)).toBe('worlds');
  });
});

describe('minutes', () => {
  it('formats decimal minutes as m:ss and missing data as a dash', () => {
    expect(minutes(31.5)).toBe('31:30');
    expect(minutes(null)).toBe('—');
  });
});

describe('paceRows', () => {
  it('lists each phase with data in tournament order, with duration and kills per minute', () => {
    const split = (games: number, m: number | null, k: number | null) => ({ games, median_minutes: m, kills_per_min: k });
    const rows = paceRows({ knockout: split(4, 33.2, 0.7), 'play-in': split(6, 30.1, 0.9) });
    expect(rows).toEqual([
      { phase: 'play-in', label: 'Play-In', games: 6, duration: '30:06', kpm: '0.90' },
      { phase: 'knockout', label: 'Eliminatorias', games: 4, duration: '33:12', kpm: '0.70' },
    ]);
  });
});
