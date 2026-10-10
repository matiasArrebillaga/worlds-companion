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

export interface RoleForm {
  fetched_at: string;
  test: { tournament: string; games: number; brier_elo: number; brier_model: number };
}

export interface Elo {
  model_version: string;
  updated_at: string;
  params: { k: number; region_offsets: Record<string, number>; role_weights: Record<string, number> };
  backtest: Backtest;
  role_form: RoleForm;
  teams: RatedTeam[];
  accuracy: Accuracy;
}

export type Role = 'top' | 'jng' | 'mid' | 'bot' | 'sup';

export interface SideRecord {
  games: number;
  wins: number;
}

export interface TeamStats {
  games: number;
  wins: number;
  winrate: number | null;
  blue: SideRecord;
  red: SideRecord;
  avg_minutes: number | null;
  gold_per_min: number | null;
  first_blood: number | null;
  first_dragon: number | null;
  first_tower: number | null;
}

export interface SeriesResult {
  date: string;
  opponent: string;
  page: string;
  wins: number;
  losses: number;
}

export interface TeamEntry {
  id: string;
  name: string;
  short: string;
  region: string | null;
  rating: number;
  roster: string[]; // ids de jugadores de la última alineación, en orden de rol
  season: TeamStats;
  worlds: TeamStats | null; // null hasta que juegue en Worlds
  elo_history: [string, number][];
  series: SeriesResult[];
}

export interface ChampionCount {
  name: string;
  games: number;
  wins: number;
}

export interface PlayerStats {
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  cs_min: number | null;
  dpm: number | null;
  kp: number | null;
  champions: ChampionCount[];
}

export interface GameLine {
  date: string;
  opponent: string;
  champion: string;
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs_min: number | null;
  dpm: number | null;
  worlds: boolean;
}

export interface PlayerEntry {
  id: string;
  name: string;
  team_id: string;
  team: string;
  role: Role;
  starter: boolean;
  season: PlayerStats;
  worlds: PlayerStats | null;
  history: GameLine[]; // últimas 20, la más nueva primero
}

export interface TeamsFile {
  updated_at: string;
  stats_fetched_at: string;
  teams: TeamEntry[];
}

export interface PlayersFile {
  players: PlayerEntry[];
}
