import { describe, expect, it } from 'vitest';
import { adjustedWinrate, defaultSample, flexPicks, kOptions, minutes, mirages, paceRows, presenceShifts, range, sampleOptions, sideVerdict } from './meta';
import type { ChampionEntry, Meta } from './types';

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

const champ = (champion: string, extra: Partial<ChampionEntry>): ChampionEntry => ({
  champion, games: 100, picks: 10, bans: 0, presence: 0.1, wins: 5, winrate: 0.5, first_rotation: 0, ...extra,
});

describe('range', () => {
  it('formats a confidence interval and tolerates missing data', () => {
    expect(range(0.4818, 0.7028)).toBe('48–70%');
    expect(range(null, null)).toBe('—');
    expect(range(undefined, undefined)).toBe('—');
  });
});

describe('sideVerdict', () => {
  it('only claims an advantage when the whole range is on one side of 50%', () => {
    expect(sideVerdict(0.48, 0.59)).toBe('No se distingue de 50%');
    expect(sideVerdict(0.52, 0.61)).toBe('Ventaja del lado azul');
    expect(sideVerdict(0.38, 0.47)).toBe('Ventaja del lado rojo');
    expect(sideVerdict(null, null)).toBe('—');
  });
});

describe('presenceShifts', () => {
  it('lists the biggest rises and drops against the guide', () => {
    const rows = [champ('A', { presence: 0.8, guide_presence: 0.2 }), champ('B', { presence: 0.1, guide_presence: 0.6 }),
      champ('C', { presence: 0.5, guide_presence: 0.45 }), champ('D', { presence: 0.3 })];
    const { up, down } = presenceShifts(rows, 1);
    expect(up).toEqual([{ champion: 'A', before: 0.2, after: 0.8, delta: 0.6 }]);
    expect(down.map((s) => s.champion)).toEqual(['B']);
  });
});

describe('mirages', () => {
  it('ranks champions whose raw winrate moves the most once adjusted, ignoring one-off picks', () => {
    const rows = [champ('Lucky', { picks: 15, wins: 11, winrate: 0.73, winrate_adj: 0.51 }),
      champ('Solid', { picks: 300, wins: 180, winrate: 0.6, winrate_adj: 0.575 }), champ('Banned', { picks: 0, winrate: null }),
      champ('OnePick', { picks: 1, wins: 0, winrate: 0, winrate_adj: 0.498 })];
    expect(mirages(rows, 5).map((c) => c.champion)).toEqual(['Lucky', 'Solid']);
  });
});

describe('flexPicks', () => {
  it('keeps champions played at least twice in two or more roles, roles by games', () => {
    const rows = [champ('Flex', { picks: 7, roles: { mid: 2, top: 5 } }), champ('OneOff', { picks: 6, roles: { mid: 5, bot: 1 } }),
      champ('Solo', { picks: 9, roles: { jng: 9 } })];
    expect(flexPicks(rows)).toEqual([{ champion: 'Flex', picks: 7, roles: [['top', 5], ['mid', 2]] }]);
  });
});

describe('adjusted winrate selector', () => {
  it('adds k imaginary games at 50%', () => {
    expect(adjustedWinrate({ wins: 5, picks: 5 }, 0)).toBe(1);
    expect(adjustedWinrate({ wins: 5, picks: 5 }, 50)).toBeCloseTo(30 / 55);
    expect(adjustedWinrate({ wins: 180, picks: 300 }, 300)).toBeCloseTo(0.55);
  });

  it('has no winrate without picks', () => {
    expect(adjustedWinrate({ wins: 0, picks: 0 }, 272)).toBeNull();
  });

  it('puts the estimated k among the fixed options, in order and without repeats', () => {
    expect(kOptions(272)).toEqual([50, 100, 200, 272, 400]);
    expect(kOptions(100)).toEqual([50, 100, 200, 400]);
    expect(kOptions(undefined)).toEqual([50, 100, 200, 400]);
  });
});
