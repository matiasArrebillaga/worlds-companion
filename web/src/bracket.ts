import type { BracketMatch, Match } from './types';

// Cuadros de Play-In y Eliminatoria al estilo lolesports: cada partido tiene un lugar fijo en una grilla de
// 5 columnas (caja · conector · caja · conector · caja). Las filas miden lo mismo (todas las cajas son iguales),
// así que el centro de cada caja cae en una fracción conocida de la altura y los conectores se dibujan con %.

export type Stage = 'playin' | 'suiza' | 'eliminatoria';
export const STAGES: [Stage, string][] = [['playin', 'Play-In'], ['suiza', 'Suiza'], ['eliminatoria', 'Eliminatoria']];

export interface Slot {
  key: string; // final del id de Leaguepedia ('Round 1_1', 'Quarterfinals_1')
  label: string;
  area: string; // grid-area en PC
}

// Conector: dos entradas (a y b, en % de su alto) que se juntan y salen por o
export interface Connector {
  area: string;
  a: number;
  b: number;
  o: number;
}

export interface Layout {
  prefix: string;
  slots: Slot[];
  connectors: Connector[];
}

// Doble eliminación de 4: ganadores arriba (filas 1-2), perdedores abajo (fila 3), gran final a la derecha
export const PLAYIN_LAYOUT: Layout = {
  prefix: 'Play-In_',
  slots: [
    { key: 'Round 1_1', label: 'Semi 1', area: '1 / 1 / 2 / 2' },
    { key: 'Round 1_2', label: 'Semi 2', area: '2 / 1 / 3 / 2' },
    { key: 'Round 2_1', label: 'Final de ganadores', area: '1 / 3 / 3 / 4' },
    { key: 'Round 1_3', label: 'Partido de perdedores', area: '3 / 1 / 4 / 2' },
    { key: 'Round 2_2', label: 'Final de perdedores', area: '3 / 3 / 4 / 4' },
    { key: 'Round 3_1', label: 'Gran final', area: '1 / 5 / 3 / 6' },
  ],
  connectors: [
    { area: '1 / 2 / 3 / 3', a: 25, b: 75, o: 50 }, // semis → final de ganadores
    { area: '3 / 2 / 4 / 3', a: 50, b: 50, o: 50 }, // perdedores → final de perdedores
    // Final de ganadores (centro de las filas 1-2 = 1/3 del alto) y final de perdedores (5/6) → gran final (1/3)
    { area: '1 / 4 / 4 / 5', a: 100 / 3, b: 500 / 6, o: 100 / 3 },
  ],
};

export const KNOCKOUT_LAYOUT: Layout = {
  prefix: 'Main Event_',
  slots: [
    { key: 'Quarterfinals_1', label: 'Cuartos 1', area: '1 / 1 / 2 / 2' },
    { key: 'Quarterfinals_2', label: 'Cuartos 2', area: '2 / 1 / 3 / 2' },
    { key: 'Quarterfinals_3', label: 'Cuartos 3', area: '3 / 1 / 4 / 2' },
    { key: 'Quarterfinals_4', label: 'Cuartos 4', area: '4 / 1 / 5 / 2' },
    { key: 'Semifinals_1', label: 'Semi 1', area: '1 / 3 / 3 / 4' },
    { key: 'Semifinals_2', label: 'Semi 2', area: '3 / 3 / 5 / 4' },
    { key: 'Finals_1', label: 'Final', area: '1 / 5 / 5 / 6' },
  ],
  connectors: [
    { area: '1 / 2 / 3 / 3', a: 25, b: 75, o: 50 },
    { area: '3 / 2 / 5 / 3', a: 25, b: 75, o: 50 },
    { area: '1 / 4 / 5 / 5', a: 25, b: 75, o: 50 },
  ],
};

// '.../Play-In_Round 1_1' → 'Round 1_1' (o null si el partido es de otra fase)
export function keyOf(matchId: string, prefix: string): string | null {
  const at = matchId.indexOf(prefix);
  return at === -1 ? null : matchId.slice(at + prefix.length);
}

// Fase que se está jugando: la primera que tiene partidos sin terminar
export function currentStage(matches: Match[]): Stage {
  const pending = (phase: Match['phase']) => matches.some((m) => m.phase === phase && m.status !== 'finished');
  if (pending('play-in')) return 'playin';
  if (pending('swiss') || !matches.some((m) => m.phase === 'knockout')) return 'suiza';
  return 'eliminatoria';
}

// Partido del calendario → caja del cuadro: resultado real si se jugó; si no, la predicción (sin pick)
export function fromMatch(m: Match, label: string): BracketMatch {
  const finished = m.status === 'finished' && m.winner !== null;
  return {
    id: m.id, key: null, label, start_utc: m.start_utc, best_of: m.best_of, team1: m.team1, team2: m.team2,
    p_team1: !finished && m.prediction ? m.prediction.p_team1_series : null,
    pick: finished ? m.winner : null,
    status: finished ? 'finished' : 'scheduled',
    score: finished ? m.score : null,
  };
}

// Partidos de un cuadro por lugar ('Round 1_1' → partido)
export function slotMatches(matches: Match[], layout: Layout): Map<string, BracketMatch> {
  const out = new Map<string, BracketMatch>();
  for (const slot of layout.slots) {
    const m = matches.find((x) => keyOf(x.id, layout.prefix) === slot.key);
    if (m) out.set(slot.key, fromMatch(m, slot.label));
  }
  return out;
}
