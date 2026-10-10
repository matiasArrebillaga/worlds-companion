import type { Match } from './types';

export type Side = 'team1' | 'team2';

// Favorito de la serie según el modelo (con 50% exacto, el equipo 1, igual que en Python)
export function favorite(m: Match): Side | null {
  if (!m.prediction) return null;
  return m.prediction.p_team1_series >= 0.5 ? 'team1' : 'team2';
}

// ¿Acertó el modelo? Solo cuenta si la predicción se guardó antes del partido
export function verdict(m: Match): 'hit' | 'miss' | null {
  if (m.status !== 'finished' || !m.winner || !m.prediction?.frozen) return null;
  return favorite(m) === m.winner ? 'hit' : 'miss';
}

// Próximos partidos con predicción, en el orden del calendario
export function upcomingPredicted(matches: Match[]): Match[] {
  return matches.filter((m) => m.status === 'upcoming' && m.prediction !== null);
}
