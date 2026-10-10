// Rutas por hash con un parámetro opcional: '#/equipo/gen-g' → { path: '#/equipo', param: 'gen-g' }
export interface Route {
  path: string;
  param: string | null;
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { path: '#/', param: null };
  return { path: `#/${parts[0]}`, param: parts[1] ? decode(parts[1]) : null };
}

// Un link roto o escrito a mano ('100%') no puede romper la página: se usa tal cual
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Qué pestaña se marca: las páginas de equipo y jugador cuelgan de Estadísticas
const TAB_OF: Record<string, string | null> = {
  '#/equipo': '#/estadisticas',
  '#/jugador': '#/estadisticas',
  '#/partido': null,
};

export function tabFor(path: string): string | null {
  return path in TAB_OF ? TAB_OF[path] : path;
}
