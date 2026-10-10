// Contrato de datos: debe coincidir con pipeline/schedule.py (MATCH_KEYS) y pipeline/build.py
export type Phase = 'play-in' | 'swiss' | 'knockout';
export type MatchStatus = 'upcoming' | 'live' | 'finished';

export interface Team {
  name: string;
  short: string;
}

export interface Match {
  id: string;
  phase: Phase;
  round: string;
  best_of: number;
  start_utc: string | null;
  date: string | null;
  team1: Team | null;
  team2: Team | null;
  score: [number, number] | null;
  winner: 'team1' | 'team2' | null;
  status: MatchStatus;
  prediction: Prediction | null;
}

export interface Schedule {
  matches: Match[];
}

export interface Meta {
  updated_at: string;
  source_fetched_at: string;
  match_count: number;
}

export interface Prediction {
  p_team1_game: number;
  p_team1_series: number;
  model_version: string;
  frozen: boolean; // true = guardada antes del partido (cuenta para los aciertos)
}

export interface RatedTeam {
  name: string;
  short: string;
  region: string | null;
  rating: number;
  games: number;
}

export interface CalibrationBucket {
  label: string;
  n: number;
  predicted: number | null;
  observed: number | null;
}

export interface Accuracy {
  n: number;
  correct: number;
  accuracy: number | null;
  brier: number | null;
  calibration: CalibrationBucket[];
}

export interface Backtest {
  calibration_year: number;
  validation_year: number;
  validation_games: number;
  validation_brier: number;
  baseline_brier: number;
  worlds_series: number;
  worlds_accuracy: number;
  worlds_brier: number;
}

export interface Elo {
  model_version: string;
  updated_at: string;
  params: { k: number; region_offsets: Record<string, number> };
  backtest: Backtest;
  teams: RatedTeam[];
  accuracy: Accuracy;
}
