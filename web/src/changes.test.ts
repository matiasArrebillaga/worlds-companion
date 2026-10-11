import { describe, expect, it } from 'vitest';
import { finishedSince, resultLine } from './changes';
import type { Match } from './types';

const match = (id: string, status: Match['status'], extra: Partial<Match> = {}): Match => ({
  id, phase: 'swiss', round: 'Round 1', best_of: 1, start_utc: null, date: null,
  team1: { name: 'Gen.G', short: 'GEN' }, team2: { name: 'Bilibili Gaming', short: 'BLG' },
  score: null, winner: null, status, prediction: null, ...extra,
});

describe('finishedSince', () => {
  it('returns only the matches that just finished', () => {
    const old = [match('a', 'live'), match('b', 'finished'), match('c', 'upcoming')];
    const fresh = [match('a', 'finished'), match('b', 'finished'), match('c', 'upcoming'), match('d', 'finished')];
    expect(finishedSince(old, fresh).map((m) => m.id)).toEqual(['a']);
  });
});

describe('resultLine', () => {
  it('puts the winner first', () => {
    expect(resultLine(match('a', 'finished', { winner: 'team2', score: [1, 3] }))).toBe('BLG 3–1 GEN');
    expect(resultLine(match('a', 'finished', { winner: 'team1', score: [2, 0] }))).toBe('GEN 2–0 BLG');
  });

  it('needs a winner and a score', () => {
    expect(resultLine(match('a', 'live'))).toBeNull();
  });
});
