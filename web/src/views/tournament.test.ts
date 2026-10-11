import { describe, expect, it } from 'vitest';
import type { TournamentFile } from '../types';
import { chance, tournamentView } from './tournament';

const team = (short: string) => ({ name: short, short });

const sample: TournamentFile = {
  updated_at: '2026-10-15T00:00:00Z', model_version: 'elo-2', simulations: 10000,
  playin: {
    bracket: [
      { id: 'a', key: 'Round 1_1', label: 'Semi 1', start_utc: null, best_of: 5, team1: team('FUR'), team2: team('MVK'), p_team1: 0.89, pick: 'team1', status: 'finished', score: [3, 1] },
      { id: 'b', key: 'Round 3_1', label: 'Gran final', start_utc: null, best_of: 5, team1: team('FUR'), team2: team('KC'), p_team1: 0.3, pick: 'team2', status: 'projected', score: null },
    ],
    teams: [{ ...team('KC'), p_win: 0.6 }, { ...team('FUR'), p_win: 0.4 }],
  },
  swiss: {
    teams: [{ ...team('GEN'), p_3_0: 0.5, p_advance: 0.98, p_0_3: 0.001 }, { ...team('CFO'), p_3_0: 0, p_advance: 0.1, p_0_3: 0.7 }],
    rounds: [{ round: 2, groups: [{ record: '1-0', best_of: 1, expected: 1, teams: [{ ...team('GEN'), p: 0.83 }, { ...team('CFO'), p: 0.17 }] }] }],
    final: [{ record: '3-0', teams: [{ ...team('GEN'), p: 0.56 }] }],
  },
  knockout: { bracket: [], teams: [{ ...team('GEN'), p_semis: 0.9, p_final: 0.7, p_champion: 0.6 }] },
};

describe('chance', () => {
  it('rounds to whole percents and marks the extremes', () => {
    expect(chance(0.384)).toBe('38%');
    expect(chance(0.001)).toBe('<1%');
    expect(chance(0.999)).toBe('>99%');
    expect(chance(0)).toBe('0%');
  });
});

describe('tournamentView', () => {
  it('draws the Play-In with real results and projected picks', () => {
    const html = tournamentView(sample, 'UTC', 'playin');
    expect(html).toContain('title="Victoria">V'); // la semi ya se jugó
    expect(html).toContain('70%'); // KC en la gran final (proyectada)
    expect(html).toContain('Final de ganadores'); // lugar del cuadro todavía sin partido
    expect(html).not.toContain('Si se cumple lo anterior');
  });

  it('draws the Swiss structure with the chance of each record', () => {
    const html = tournamentView(sample, 'UTC', 'suiza');
    expect(html).toContain('Ronda 2');
    expect(html).toContain('83%'); // GEN llega 1-0 a la ronda 2
    expect(html).toContain('56%'); // GEN termina 3-0
    expect(html).toContain('Clasificados');
  });

  it('shows the chance of reaching each knockout round before the draw', () => {
    const html = tournamentView(sample, 'UTC', 'eliminatoria');
    expect(html).toContain('Campeón');
    expect(html).toContain('60%');
  });

  it('has an empty state without data', () => {
    expect(tournamentView(null, 'UTC', 'playin')).toContain('Todavía no hay simulación');
  });
});
