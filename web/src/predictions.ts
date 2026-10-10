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

// En los Bo5, la chance del favorito de la serie en cada partida: muestra que un 90% de serie
// suele ser "solo" un 75% por partida (ganar al mejor de 5 amplifica la ventaja)
export function gameOdds(m: Match): { short: string; p: number } | null {
  const p = m.prediction;
  if (m.best_of !== 5 || !p || !m.team1 || !m.team2) return null;
  return favorite(m) === 'team1'
    ? { short: m.team1.short, p: p.p_team1_game }
    : { short: m.team2.short, p: 1 - p.p_team1_game };
}
