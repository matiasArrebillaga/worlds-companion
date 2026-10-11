// Rutas por hash con hasta dos parámetros: '#/equipo/gen-g' → { path: '#/equipo', param: 'gen-g', sub: null };
// '#/predicciones/torneo/suiza' → { path: '#/predicciones', param: 'torneo', sub: 'suiza' }
export interface Route {
  path: string;
  param: string | null;
  sub: string | null;
}

// Links viejos (guardados o compartidos) que ahora viven en otra ruta
const ALIASES: Record<string, string> = {
  '#/calendario': '#/',
  '#/estadisticas': '#/equipos',
};

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { path: '#/', param: null, sub: null };
  const path = `#/${parts[0]}`;
  return {
    path: ALIASES[path] ?? path,
    param: parts[1] ? decode(parts[1]) : null,
    sub: parts[2] ? decode(parts[2]) : null,
  };
}

// Un link roto o escrito a mano ('100%') no puede romper la página: se usa tal cual
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Qué pestaña se marca: las páginas de equipo y jugador cuelgan de Equipos; Bracket y Predicciones, del Calendario
const TAB_OF: Record<string, string | null> = {
  '#/equipo': '#/equipos',
  '#/jugador': '#/equipos',
  '#/bracket': '#/',
  '#/predicciones': '#/',
  '#/partido': null,
};

export function tabFor(path: string): string | null {
  return path in TAB_OF ? TAB_OF[path] : path;
}

// Un valor de la URL solo vale si está entre las opciones; si no (link viejo o a mano), el de por defecto
export function pick<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

// ---- Historial ----

// Dónde estaba el scroll en cada dirección visitada (para volver al mismo lugar con "atrás")
const scrollByHash = new Map<string, number>();

export function rememberScroll(hash: string, y: number): void {
  scrollByHash.set(hash || '#/', y);
}

export function savedScroll(hash: string): number | undefined {
  return scrollByHash.get(hash || '#/');
}

// Cuántos pasos dentro del sitio hay detrás de cada entrada del historial (se guarda en la entrada misma, así
// sobrevive a atrás/adelante y a recargar). Con 0, "Volver" no puede usar history.back: saldría del sitio
const depthOf = (): number => (history.state as { depth?: number } | null)?.depth ?? 0;
let lastDepth = 0;

// Navegación nueva por un link: la entrada nueva queda un paso más adentro que la anterior
export function markNewStep(): void {
  lastDepth += 1;
  history.replaceState({ depth: lastDepth }, '');
}

// Atrás/adelante (o carga inicial): la entrada ya trae su profundidad
export function syncDepth(): void {
  lastDepth = depthOf();
}

export function canGoBack(): boolean {
  return depthOf() > 0;
}

// Cambio de pestaña dentro de una vista: entra al historial sin disparar hashchange (la vista se redibuja sola
// y conserva el foco); "atrás" sí dispara hashchange y main.ts dibuja la vista anterior
export function go(hash: string): void {
  if (location.hash === hash || (!location.hash && hash === '#/')) return;
  rememberScroll(location.hash, window.scrollY);
  lastDepth += 1;
  history.pushState({ depth: lastDepth }, '', hash);
}
