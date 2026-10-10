import type { Match } from './types';

export interface SwissRound {
  round: string;
  groups: { record: string; matches: Match[] }[];
}

export interface TeamRecord {
  wins: number;
  losses: number;
  status: 'qualified' | 'eliminated' | 'alive';
}

type Tally = Map<string, { wins: number; losses: number }>;

const TO_ADVANCE = 3; // 3 victorias clasifican, 3 derrotas eliminan
export const PENDING = 'a confirmar';

// "Round 3" → 3, para recorrer las rondas en orden
function roundNumber(round: string): number {
  return Number(round.match(/\d+/)?.[0] ?? 0);
}

function swissMatches(matches: Match[]): Match[] {
  return matches.filter((m) => m.phase === 'swiss').sort((a, b) => roundNumber(a.round) - roundNumber(b.round));
}

function apply(table: Tally, m: Match): void {
  if (!m.winner || !m.team1 || !m.team2) return;
  const winner = m.winner === 'team1' ? m.team1.name : m.team2.name;
  const loser = m.winner === 'team1' ? m.team2.name : m.team1.name;
  const get = (name: string) => table.get(name) ?? { wins: 0, losses: 0 };
  table.set(winner, { ...get(winner), wins: get(winner).wins + 1 });
  table.set(loser, { ...get(loser), losses: get(loser).losses + 1 });
}

// Cada ronda agrupada por el récord que tenían los equipos ANTES de jugarla (en la suiza se cruzan iguales)
export function swissRounds(matches: Match[]): SwissRound[] {
  const table: Tally = new Map();
  const byRound = new Map<string, Match[]>();
  for (const m of swissMatches(matches)) byRound.set(m.round, [...(byRound.get(m.round) ?? []), m]);

  const rounds: SwissRound[] = [];
  for (const [round, list] of byRound) {
    const groups = new Map<string, Match[]>();
    for (const m of list) {
      const rec = m.team1 ? table.get(m.team1.name) ?? { wins: 0, losses: 0 } : null;
      const key = m.team1 && m.team2 && rec ? `${rec.wins}-${rec.losses}` : PENDING;
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    // Más victorias primero; los cruces sin definir, al final
    const order = (key: string) => (key === PENDING ? -1 : Number(key.split('-')[0]));
    const sorted = [...groups].sort((a, b) => order(b[0]) - order(a[0]));
    rounds.push({ round, groups: sorted.map(([record, ms]) => ({ record, matches: ms })) });
    list.forEach((m) => apply(table, m)); // recién ahora cuentan los resultados de esta ronda
  }
  return rounds;
}

// Récord actual de cada equipo de la suiza y si ya clasificó o quedó eliminado
export function swissStandings(matches: Match[]): Map<string, TeamRecord> {
  const table: Tally = new Map();
  for (const m of swissMatches(matches)) {
    for (const team of [m.team1, m.team2]) if (team && !table.has(team.name)) table.set(team.name, { wins: 0, losses: 0 });
    apply(table, m);
  }
  const result = new Map<string, TeamRecord>();
  for (const [name, r] of table) {
    const status = r.wins >= TO_ADVANCE ? 'qualified' : r.losses >= TO_ADVANCE ? 'eliminated' : 'alive';
    result.set(name, { ...r, status });
  }
  return result;
}
