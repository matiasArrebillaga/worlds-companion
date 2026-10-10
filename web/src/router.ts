// Rutas por hash con un parámetro opcional: '#/equipo/gen-g' → { path: '#/equipo', param: 'gen-g' }
export interface Route {
  path: string;
  param: string | null;
}

// Links viejos (guardados o compartidos) que ahora viven en otra ruta
const ALIASES: Record<string, string> = {
  '#/calendario': '#/',
  '#/predicciones': '#/',
  '#/estadisticas': '#/equipos',
};

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { path: '#/', param: null };
  const path = `#/${parts[0]}`;
  return { path: ALIASES[path] ?? path, param: parts[1] ? decode(parts[1]) : null };
}

// Un link roto o escrito a mano ('100%') no puede romper la página: se usa tal cual
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Qué pestaña se marca: las páginas de equipo y jugador cuelgan de Equipos
const TAB_OF: Record<string, string | null> = {
  '#/equipo': '#/equipos',
  '#/jugador': '#/equipos',
  '#/partido': null,
};

export function tabFor(path: string): string | null {
  return path in TAB_OF ? TAB_OF[path] : path;
}
