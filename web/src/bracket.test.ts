import { describe, expect, it } from 'vitest';
import { bracketRounds } from './bracket';
import type { Match } from './types';

const k = (id: string, round: string, phase: Match['phase'] = 'knockout'): Match => ({
  id, phase, round, best_of: 5, start_utc: null, date: null, team1: null, team2: null,
  score: null, winner: null, status: 'upcoming', prediction: null,
});

describe('bracketRounds', () => {
  it('orders quarterfinals, semifinals and the final, keeping only knockout matches', () => {
    const rounds = bracketRounds([k('f', 'Finals'), k('q1', 'Quarterfinals'), k('s1', 'Semifinals'),
      k('q2', 'Quarterfinals'), k('sw', 'Round 1', 'swiss')]);
    expect(rounds.map((r) => [r.round, r.matches.map((x) => x.id)])).toEqual([
      ['Quarterfinals', ['q1', 'q2']], ['Semifinals', ['s1']], ['Finals', ['f']]]);
  });

  it('puts unknown rounds last and returns nothing without knockout matches', () => {
    expect(bracketRounds([k('x', 'Tiebreaker'), k('f', 'Finals')]).map((r) => r.round)).toEqual(['Finals', 'Tiebreaker']);
    expect(bracketRounds([])).toEqual([]);
  });
});
