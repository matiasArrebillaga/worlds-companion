import { describe, expect, it } from 'vitest';
import { currentStage, fromMatch, keyOf, PLAYIN_LAYOUT, slotMatches } from './bracket';
import type { Match } from './types';

const m = (id: string, phase: Match['phase'], overrides: Partial<Match> = {}): Match => ({
  id, phase, round: 'Round 1', best_of: 5, start_utc: null, date: null, team1: null, team2: null,
  score: null, winner: null, status: 'upcoming', prediction: null, ...overrides,
});

describe('currentStage', () => {
  it('is the first stage with matches left', () => {
    const done = { status: 'finished' as const, winner: 'team1' as const };
    expect(currentStage([m('p', 'play-in'), m('s', 'swiss')])).toBe('playin');
    expect(currentStage([m('p', 'play-in', done), m('s', 'swiss'), m('k', 'knockout')])).toBe('suiza');
    expect(currentStage([m('p', 'play-in', done), m('s', 'swiss', done), m('k', 'knockout')])).toBe('eliminatoria');
  });
});

describe('bracket slots', () => {
  it('finds each match by the end of its id', () => {
    expect(keyOf('2026 Season World Championship/Play-In_Round 2_1', 'Play-In_')).toBe('Round 2_1');
    expect(keyOf('2026 Season World Championship/Main Event_Round 1_1', 'Play-In_')).toBeNull();
    const slots = slotMatches([m('W/Play-In_Round 3_1', 'play-in')], PLAYIN_LAYOUT);
    expect(slots.get('Round 3_1')?.label).toBe('Gran final');
  });

  it('shows the real result or, before the match, the prediction without a pick', () => {
    const team = (s: string) => ({ name: s, short: s });
    const prediction = { p_team1_game: 0.6, p_team1_series: 0.7, model_version: 'elo-2', frozen: true };
    const upcoming = fromMatch(m('x', 'play-in', { team1: team('A'), team2: team('B'), prediction }), 'Semi 1');
    expect([upcoming.p_team1, upcoming.pick, upcoming.status]).toEqual([0.7, null, 'scheduled']);
    const played = fromMatch(m('x', 'play-in', {
      team1: team('A'), team2: team('B'), prediction, status: 'finished', winner: 'team2', score: [1, 3],
    }), 'Semi 1');
    expect([played.p_team1, played.pick, played.status, played.score]).toEqual([null, 'team2', 'finished', [1, 3]]);
  });
});
