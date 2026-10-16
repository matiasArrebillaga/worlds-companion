import type { Match } from './types';

// Qué cambió entre dos cargas de datos, para avisar mientras la página está abierta

// Partidos que estaban en el calendario sin terminar y en los datos nuevos ya terminaron
export function finishedSince(old: Match[], fresh: Match[]): Match[] {
  const before = new Map(old.map((m) => [m.id, m.status]));
  return fresh.filter((m) => m.status === 'finished' && before.has(m.id) && before.get(m.id) !== 'finished');
}

// "GEN vs BLG": el cruce en el orden del calendario, sin marcador (modo sin spoilers)
export function matchupLine(m: Match): string | null {
  if (!m.team1 || !m.team2) return null;
  return `${m.team1.short} vs ${m.team2.short}`;
}

// "GEN 3–1 BLG": el ganador primero, con su marcador
export function resultLine(m: Match): string | null {
  if (!m.winner || !m.score || !m.team1 || !m.team2) return null;
  const [winner, loser] = m.winner === 'team1' ? [m.team1, m.team2] : [m.team2, m.team1];
  const [hi, lo] = m.winner === 'team1' ? m.score : [m.score[1], m.score[0]];
  return `${winner.short} ${hi}–${lo} ${loser.short}`;
}
