import { describe, expect, it } from 'vitest';
import { swissRounds, swissStandings } from './swiss';
import type { Match } from './types';

const t = (name: string) => ({ name, short: name });

function m(id: string, round: string, a: string | null, b: string | null, winner: 'team1' | 'team2' | null = null): Match {
  return {
    id, phase: 'swiss', round, best_of: 1, start_utc: null, date: null,
    team1: a ? t(a) : null, team2: b ? t(b) : null, score: null, winner,
    status: winner ? 'finished' : 'upcoming', prediction: null,
  };
}

describe('swissRounds', () => {
  it('groups each round by the record before it was played', () => {
    const rounds = swissRounds([
      m('r2a', 'Round 2', 'A', 'C'), m('r1a', 'Round 1', 'A', 'B', 'team1'), m('r1b', 'Round 1', 'C', 'D', 'team1'),
      m('r2b', 'Round 2', 'B', 'D'), m('r3', 'Round 3', null, null),
    ]);
    expect(rounds.map((r) => r.round)).toEqual(['Round 1', 'Round 2', 'Round 3']);
    expect(rounds[0].groups.map((g) => g.record)).toEqual(['0-0']);
    expect(rounds[1].groups.map((g) => [g.record, g.matches.map((x) => x.id)])).toEqual([['1-0', ['r2a']], ['0-1', ['r2b']]]);
    expect(rounds[2].groups.map((g) => g.record)).toEqual(['a confirmar']);
  });

  it('ignores matches from other phases', () => {
    expect(swissRounds([{ ...m('k', 'Quarterfinals', 'A', 'B'), phase: 'knockout' }])).toEqual([]);
  });
});

describe('swissStandings', () => {
  it('marks 3 wins as qualified and 3 losses as eliminated', () => {
    const games = ['Round 1', 'Round 2', 'Round 3'].map((r, i) => m(`x${i}`, r, 'A', 'B', 'team1'));
    const table = swissStandings(games);
    expect(table.get('A')).toEqual({ wins: 3, losses: 0, status: 'qualified' });
    expect(table.get('B')).toEqual({ wins: 0, losses: 3, status: 'eliminated' });
    expect(swissStandings([m('u', 'Round 1', 'C', 'D')]).get('C')).toEqual({ wins: 0, losses: 0, status: 'alive' });
  });
});
