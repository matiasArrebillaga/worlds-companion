import { describe, expect, it } from 'vitest';
import { favorite, upcomingPredicted, verdict } from './predictions';
import type { Match, Prediction } from './types';

const pred = (p: number, frozen = true): Prediction => ({ p_team1_game: p, p_team1_series: p, model_version: 'elo-1', frozen });

function match(overrides: Partial<Match>): Match {
  return {
    id: 'm', phase: 'swiss', round: 'Round 1', best_of: 1,
    start_utc: '2026-10-24T17:00:00Z', date: '2026-10-24',
    team1: { name: 'T1', short: 'T1' }, team2: { name: 'G2 Esports', short: 'G2' },
    score: null, winner: null, status: 'upcoming', prediction: null,
    ...overrides,
  };
}

describe('favorite', () => {
  it('is the side with 50% or more', () => {
    expect(favorite(match({ prediction: pred(0.64) }))).toBe('team1');
    expect(favorite(match({ prediction: pred(0.36) }))).toBe('team2');
    expect(favorite(match({ prediction: pred(0.5) }))).toBe('team1');
    expect(favorite(match({}))).toBeNull();
  });
});

describe('verdict', () => {
  it('compares the favorite with the winner', () => {
    expect(verdict(match({ status: 'finished', winner: 'team1', prediction: pred(0.7) }))).toBe('hit');
    expect(verdict(match({ status: 'finished', winner: 'team2', prediction: pred(0.7) }))).toBe('miss');
  });
  it('ignores unfinished matches and predictions that were not frozen', () => {
    expect(verdict(match({ prediction: pred(0.7) }))).toBeNull();
    expect(verdict(match({ status: 'finished', winner: 'team1', prediction: pred(0.7, false) }))).toBeNull();
  });
});

describe('upcomingPredicted', () => {
  it('keeps upcoming matches that have a prediction', () => {
    const list = upcomingPredicted([
      match({ id: 'a', prediction: pred(0.6) }),
      match({ id: 'b' }),
      match({ id: 'c', status: 'finished', winner: 'team1', prediction: pred(0.6) }),
    ]);
    expect(list.map((m) => m.id)).toEqual(['a']);
  });
});
