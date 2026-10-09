import type { Meta, Schedule } from './types';

export interface SiteData {
  schedule: Schedule;
  meta: Meta;
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
  const [schedule, meta] = await Promise.all([getJson<Schedule>('schedule.json'), getJson<Meta>('meta.json')]);
  return { schedule, meta };
}
