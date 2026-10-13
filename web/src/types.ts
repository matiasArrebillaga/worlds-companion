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
  // Etapa 4 (opcionales: un meta.json viejo en caché no los trae)
  worlds_patch?: string;
  guide_patch?: string | null;
  worlds_games?: number;
  samples?: Partial<Record<SampleId, MetaSample>>;
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
  logo?: string | null; // ruta relativa al sitio (img/teams/...), null si no hay logo
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
  winrate_low: number | null; // rango del 95% (Wilson)
  winrate_high: number | null;
  blue: SideRecord;
  red: SideRecord;
  avg_minutes: number | null;
  gold_per_min: number | null;
  first_blood: number | null;
  first_dragon: number | null;
  first_tower: number | null;
  gd15: number | null; // diferencia de oro al minuto 15
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
  logo?: string | null;
  rating: number;
  roster: string[]; // ids de jugadores de la última alineación, en orden de rol
  season: TeamStats;
  worlds: TeamStats | null; // null hasta que juegue en Worlds
  vs_worlds?: TeamStats | null; // solo partidas de 2026 contra otros equipos clasificados
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
  form?: number | null; // forma del modelo elo-2: desvíos sobre el promedio del rol
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

// Meta (champions.json y samples de meta.json): "worlds" = Worlds 2026; "guide" = Demacia Cup (guía previa)
export type SampleId = 'worlds' | 'guide';

export interface SideSplit {
  games: number;
  blue_wins: number;
  blue_winrate: number | null;
  red_winrate: number | null;
  low?: number | null; // rango del 95% del % del azul
  high?: number | null;
}

export interface PaceSplit {
  games: number;
  median_minutes: number | null;
  kills_per_min: number | null;
  p25_minutes?: number | null; // la mitad de las partidas dura entre p25 y p75
  p75_minutes?: number | null;
}

export interface RegionEntry {
  region: string;
  games: number;
  wins: number;
  winrate: number | null;
  low?: number | null;
  high?: number | null;
}

export interface MetaSample {
  games: number;
  sides: { total: SideSplit; by_phase: Partial<Record<Phase, SideSplit>>; by_game?: { first: SideSplit; rest: SideSplit } };
  pace: { total: PaceSplit; by_phase: Partial<Record<Phase, PaceSplit>> };
  regions: RegionEntry[];
}

export interface ChampionEntry {
  champion: string;
  games: number;
  picks: number;
  bans: number;
  presence: number | null;
  pick_rate?: number | null;
  ban_rate?: number | null;
  wins: number;
  winrate: number | null;
  winrate_adj?: number | null; // encogido hacia 50% (promedio bayesiano)
  winrate_low?: number | null; // rango del 95% (Wilson)
  winrate_high?: number | null;
  first_rotation: number | null;
  kda?: number | null;
  cs_min?: number | null;
  dpm?: number | null;
  kp?: number | null;
  roles?: Partial<Record<Role, number>>;
  guide_presence?: number | null; // presencia en la guía (solo filas de Worlds)
}

// Cuánto de la diferencia de % de victorias entre campeones es azar
export interface WinrateNoise {
  champions: number;
  picks: number;
  observed_var: number;
  noise_var: number;
  noise_share: number;
  true_var: number;
}

export interface ChampionsFile {
  updated_at: string;
  worlds_patch: string;
  guide_patch: string | null;
  prior_picks?: number;
  samples: Partial<Record<SampleId, ChampionEntry[]>>;
  analysis?: Partial<Record<SampleId, WinrateNoise | null>>;
  icons?: ChampionIcons | null; // Data Dragon: URL = base + ids[nombre] + '.png'
}

export interface ChampionIcons {
  base: string;
  ids: Record<string, string>;
}

// tournament.json: el torneo completo simulado (Predicciones › Torneo)
export interface BracketMatch {
  id: string | null;
  key?: string | null; // lugar en el cuadro ('Round 1_1'); lo trae tournament.json
  label: string;
  start_utc: string | null;
  best_of: number;
  team1: Team | null;
  team2: Team | null;
  p_team1: number | null; // chance de que gane la serie el equipo 1
  pick: 'team1' | 'team2' | null; // favorito (o ganador real si ya se jugó)
  status: 'finished' | 'scheduled' | 'projected'; // projected = los equipos salen del camino más probable
  score: [number, number] | null;
}

export interface TournamentTeam {
  name: string;
  short: string;
  p_win?: number;
  p_3_0?: number;
  p_advance?: number;
  p_0_3?: number;
  p_semis?: number;
  p_final?: number;
  p_champion?: number;
}

export interface TournamentFile {
  updated_at: string;
  model_version: string;
  simulations: number;
  playin: { bracket: BracketMatch[]; teams: TournamentTeam[] };
  swiss: {
    teams: TournamentTeam[];
    rounds?: SwissProbRound[]; // por ronda, la chance de cada equipo de empezarla con cada récord
    final?: { record: string; teams: TeamChance[] }[]; // chance de cada récord final (3-0 … 2-3)
  };
  knockout: { bracket: BracketMatch[]; teams: TournamentTeam[] };
}

export interface TeamChance {
  name: string;
  short: string;
  p: number;
}

export interface SwissProbRound {
  round: number;
  groups: { record: string; best_of: number; expected: number; teams: TeamChance[] }[];
}
