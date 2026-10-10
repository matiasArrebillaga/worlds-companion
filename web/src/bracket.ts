import type { Match } from './types';

const ORDER = ['Quarterfinals', 'Semifinals', 'Finals'];

// Rondas de eliminación en orden; una ronda que no conocemos (ej. desempate) va al final
export function bracketRounds(matches: Match[]): { round: string; matches: Match[] }[] {
  const byRound = new Map<string, Match[]>();
  for (const m of matches) {
    if (m.phase === 'knockout') byRound.set(m.round, [...(byRound.get(m.round) ?? []), m]);
  }
  const rank = (round: string) => (ORDER.includes(round) ? ORDER.indexOf(round) : ORDER.length);
  return [...byRound].sort((a, b) => rank(a[0]) - rank(b[0])).map(([round, ms]) => ({ round, matches: ms }));
}
