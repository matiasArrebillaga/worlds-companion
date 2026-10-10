import type { ChampionsFile, Elo, Meta, PlayersFile, Schedule, TeamsFile } from './types';

export interface SiteData {
  schedule: Schedule;
  meta: Meta;
  elo: Elo;
  teams: TeamsFile;
  players: PlayersFile;
  champions: ChampionsFile;
}

async function getJson<T>(file: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

// ¿El pipeline corrió de nuevo desde la última carga? (fechas ISO en UTC se comparan como texto)
export function isNewer(current: Meta, latest: Meta): boolean {
  return latest.updated_at > current.updated_at;
}

export function loadMeta(): Promise<Meta> {
  return getJson<Meta>('meta.json');
}

export async function loadData(): Promise<SiteData> {
  const [schedule, meta, elo, teams, players, champions] = await Promise.all([
    getJson<Schedule>('schedule.json'),
    getJson<Meta>('meta.json'),
    getJson<Elo>('elo.json'),
    getJson<TeamsFile>('teams.json'),
    getJson<PlayersFile>('players.json'),
    getJson<ChampionsFile>('champions.json'),
  ]);
  return { schedule, meta, elo, teams, players, champions };
}
