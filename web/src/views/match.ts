import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { advantage, fmt, pct, ROLE_LABELS, signed, sizes, starterByRole, teamByName } from '../stats';
import { logoImg, regionColor } from '../theme/regions';
import type { GameDetail, GamePlayer, GameSide, Match, PlayerEntry, Role, TeamEntry } from '../types';
import { drawEloChart } from '../charts/eloChart';
import { go, pick } from '../router';
import { firstDay } from '../schedule';
import { showFromTop, withTransition } from './layout';
import { favMark, predictionBlock } from './matchCard';
import { champHex } from './player';
import { notFound } from './team';
import { backLink, how, normalize, subtabs } from './ui';

// Cómo se dibujan las barras de una fila espejo. Las dos mitades tienen un riel tenue para que se vea hasta dónde
// puede llegar cada barra, y el número del que saca ventaja va resaltado del mismo color que su barra.
// gap  = ventaja: una sola barra desde el centro hacia el que saca ventaja; llega al borde cuando la diferencia ya
//        es grande (scale). Para datos donde el 0 no significa nada (Elo, oro/min) o que pueden ser negativos (forma)
// size = mariposa: cada lado su barra, medida contra el mayor de los dos. Para cantidades que arrancan en 0
//        (kills, torres, oro de una partida)
type Bars =
  | { kind: 'gap'; a: number | null; b: number | null; scale: number }
  | { kind: 'size'; a: number | null; b: number | null };

// Fila espejo: el dato de cada equipo a los costados, la etiqueta en el medio y las barras entre ambos
function mirror(label: string, left: string, right: string, bars?: Bars): string {
  let widths: [number, number] = [0, 0];
  let lead: 'a' | 'b' | null = null;
  if (bars?.kind === 'gap') {
    const adv = advantage(bars.a, bars.b, bars.scale);
    if (adv) {
      lead = adv.side;
      widths = adv.side === 'a' ? [adv.width, 0] : [0, adv.width];
    }
  } else if (bars?.kind === 'size') {
    const s = sizes(bars.a, bars.b);
    if (s) {
      widths = s;
      lead = s[0] === s[1] ? null : s[0] > s[1] ? 'a' : 'b';
    }
  }
  // Sin barras (récord, duración, KDA) tampoco hay riel: no hay un "mejor" que marcar
  const half = (side: 'l' | 'r', width: number, on: boolean) => bars
    ? `<span class="mbar ${side}" aria-hidden="true">${width > 0 ? `<i class="${on ? 'on' : ''}" style="width:${width.toFixed(0)}%"></i>` : ''}</span>`
    : '<span class="mbar off" aria-hidden="true"></span>';
  return `<div class="mirror">
    <span class="num${lead === 'a' ? ' lead' : ''}">${left}</span>
    ${half('l', widths[0], lead === 'a')}
    <span class="label">${label}</span>
    ${half('r', widths[1], lead === 'b')}
    <span class="num${lead === 'b' ? ' lead' : ''}">${right}</span></div>`;
}

// Encabezado de un grupo de filas espejo: la sigla de cada equipo sobre su columna y el nombre del grupo al medio
function mirrorGroup(title: string, a: string, b: string): string {
  return `<div class="mirror mgroup"><span class="num">${escapeHtml(a)}</span><span></span><span class="label">${title}</span><span></span><span class="num">${escapeHtml(b)}</span></div>`;
}

// Minutos con decimales → "32:42", como el reloj de una partida
function clock(minutes: number | null): string {
  if (minutes === null) return '—';
  const total = Math.round(minutes * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Duelo de un rol: cerrado muestra los nombres y la forma del modelo; al tocarlo se despliegan KDA, DPM y KP.
// <details> nativo: se abre y se cierra sin JavaScript y funciona con teclado
function duel(role: Role, a: PlayerEntry | undefined, b: PlayerEntry | undefined, ta: TeamEntry, tb: TeamEntry): string {
  const name = (p: PlayerEntry | undefined, team: TeamEntry) => p
    ? `<a href="#/jugador/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>${logoImg(team.logo)}`
    : '<span class="muted">—</span>';
  const n = (p: PlayerEntry | undefined, get: (p: PlayerEntry) => number | null | undefined) => (p ? get(p) ?? null : null);
  const gap = (get: (p: PlayerEntry) => number | null | undefined, scale: number): Bars => ({ kind: 'gap', a: n(a, get), b: n(b, get), scale });
  const form = (x: PlayerEntry) => x.form;
  return `<details class="duel">
    <summary>
      <span class="duel-names"><span class="l">${name(a, ta)}</span><span class="label">${ROLE_LABELS[role]}<i class="chev" aria-hidden="true"></i></span><span class="r">${name(b, tb)}</span></span>
      ${mirror('Forma', signed(n(a, form), 2), signed(n(b, form), 2), gap(form, 0.5))}
    </summary>
    <div class="duel-more">
      ${mirror('KDA', fmt(n(a, (x) => x.season.kda), 1), fmt(n(b, (x) => x.season.kda), 1), gap((x) => x.season.kda, 2))}
      ${mirror('DPM', fmt(n(a, (x) => x.season.dpm)), fmt(n(b, (x) => x.season.dpm)), gap((x) => x.season.dpm, 150))}
      ${mirror('KP', pct(n(a, (x) => x.season.kp)), pct(n(b, (x) => x.season.kp)), gap((x) => x.season.kp, 0.1))}
      <div class="duel-champs">${playerChamps(a, 'l')}${playerChamps(b, 'r')}</div>
    </div>
  </details>`;
}

// Un lado del encabezado: logo grande subrayado con el color de la región, sigla, nombre y Elo; lleva a la página del equipo.
// lost = perdió la serie (se atenúa)
function heroSide(team: TeamEntry, fav: string, side: 'l' | 'r', lost: boolean): string {
  return `<a class="vs-side ${side}${lost ? ' lost' : ''}" href="#/equipo/${encodeURIComponent(team.id)}" style="--rc:${regionColor(team.region)}">
    ${logoImg(team.logo) || '<i class="rg" aria-hidden="true"></i>'}
    <span class="vs-short">${escapeHtml(team.short)}${fav}</span>
    <span class="vs-name">${escapeHtml(team.name)}</span>
    <span class="label">${escapeHtml(team.region ?? '—')} · Elo ${fmt(team.rating)}</span></a>`;
}

// Centro del encabezado: el marcador si la serie ya empezó; si no, "VS"
function heroMiddle(m: Match): string {
  if (!m.score) return `<span class="vs-mid"><span class="label">Bo${m.best_of}</span><b>VS</b></span>`;
  const state = m.status === 'live' ? 'En vivo' : 'Final';
  return `<span class="vs-mid"><span class="label">${state} · Bo${m.best_of}</span>
    <b class="vs-score" aria-label="${m.score[0]} a ${m.score[1]}">${m.score[0]}<i aria-hidden="true">–</i>${m.score[1]}</b></span>`;
}

// Los 3 campeones más jugados por un jugador en la temporada, con partidas y récord (como en su página).
// side = de qué lado del duelo va (los de la izquierda se alinean hacia el centro)
function playerChamps(p: PlayerEntry | undefined, side: 'l' | 'r'): string {
  const top = p?.season.champions.slice(0, 3) ?? [];
  if (!top.length) return `<div class="pchamps ${side}"><span class="muted">—</span></div>`;
  return `<ul class="pchamps ${side}" aria-label="Campeones más jugados por ${escapeHtml(p!.name)}">${top.map((c) => `
    <li>${champHex(c.name)}<b>${escapeHtml(c.name)}</b><span class="muted num">${c.games} PJ · ${c.wins}-${c.games - c.wins}</span></li>`).join('')}</ul>`;
}

// ---- Pestaña Partidas: el detalle de cada partida ya jugada (Leaguepedia) ----

const TABS: [string, string][] = [['previa', 'Previa'], ['partidas', 'Partidas']];
type Tab = 'previa' | 'partidas';
const ROLES: number[] = [1, 2, 3, 4, 5]; // Leaguepedia numera los roles del 1 al 5
const ROLE_BY_NUMBER: Role[] = ['top', 'jng', 'mid', 'bot', 'sup'];

const kda = (p: GamePlayer | undefined) =>
  p ? [p.kills, p.deaths, p.assists].map((v) => (v === null ? '—' : String(v))).join('/') : '—';
const thousands = (v: number | null) => (v === null ? '—' : `${(v / 1000).toFixed(1)}k`);

// El jugador de la partida, si está en players.json (mismo equipo y mismo nombre sin tildes ni mayúsculas)
function playerLink(p: GamePlayer, team: string, players: PlayerEntry[]): string {
  const known = players.find((x) => x.team === team && normalize(x.name) === normalize(p.name));
  return known ? `<a href="#/jugador/${encodeURIComponent(known.id)}">${escapeHtml(p.name)}</a>` : `<b>${escapeHtml(p.name)}</b>`;
}

type PlayerStat = 'cs' | 'gold' | 'damage';
const PLAYER_STATS: [string, PlayerStat][] = [['CS', 'cs'], ['Oro', 'gold'], ['Daño', 'damage']];
const showStat = (key: PlayerStat, v: number | null) => (key === 'cs' ? fmt(v) : thousands(v));

// Celular: un rol de la partida con campeón, jugador y KDA de cada lado; al tocarlo, CS, oro y daño a campeones
function gameDuel(role: number, l: GameSide, r: GameSide, players: PlayerEntry[]): string {
  const pl = l.players.find((p) => p.role === role);
  const pr = r.players.find((p) => p.role === role);
  const name = (p: GamePlayer | undefined, side: GameSide) =>
    p ? `${playerLink(p, side.team, players)}${champHex(p.champion)}` : '<span class="muted">—</span>';
  const n = (p: GamePlayer | undefined, key: PlayerStat) => p?.[key] ?? null;
  return `<details class="duel">
    <summary>
      <span class="duel-names"><span class="l">${name(pl, l)}</span><span class="label">${ROLE_LABELS[ROLE_BY_NUMBER[role - 1]]}<i class="chev" aria-hidden="true"></i></span><span class="r">${name(pr, r)}</span></span>
      ${mirror('KDA', kda(pl), kda(pr))}
    </summary>
    <div class="duel-more">
      ${PLAYER_STATS.map(([label, key]) => mirror(label, showStat(key, n(pl, key)), showStat(key, n(pr, key)), { kind: 'size', a: n(pl, key), b: n(pr, key) })).join('')}
    </div>
  </details>`;
}

// PC: el scoreboard abierto, espejado (izquierda: jugador → daño; derecha: daño → jugador) con el rol en el medio.
// En cada dato, el mayor de los dos jugadores del rol va resaltado
function scoreboard(l: GameSide, r: GameSide, players: PlayerEntry[]): string {
  const cols = PLAYER_STATS.map(([label]) => label);
  const head = `<tr><th class="who">Jugador</th><th>K/D/A</th>${cols.map((c) => `<th>${c}</th>`).join('')}<th></th>` +
    `${[...cols].reverse().map((c) => `<th>${c}</th>`).join('')}<th>K/D/A</th><th class="who r">Jugador</th></tr>`;
  const body = ROLES.map((role) => {
    const pl = l.players.find((p) => p.role === role);
    const pr = r.players.find((p) => p.role === role);
    const cells = (p: GamePlayer | undefined, other: GamePlayer | undefined) => PLAYER_STATS.map(([, key]) => {
      const v = p?.[key] ?? null;
      const o = other?.[key] ?? null;
      const lead = v !== null && o !== null && v > o;
      return `<td class="${lead ? 'lead' : ''}">${showStat(key, v)}</td>`;
    });
    const who = (p: GamePlayer | undefined, side: GameSide, cls: string) =>
      `<td class="who ${cls}">${p ? `<span>${champHex(p.champion)}${playerLink(p, side.team, players)}</span>` : '<span class="muted">—</span>'}</td>`;
    return `<tr>${who(pl, l, '')}<td>${kda(pl)}</td>${cells(pl, pr).join('')}` +
      `<td class="role label">${ROLE_LABELS[ROLE_BY_NUMBER[role - 1]]}</td>` +
      `${cells(pr, pl).reverse().join('')}<td>${kda(pr)}</td>${who(pr, r, 'r')}</tr>`;
  }).join('');
  return `<table class="sb"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

type SideStat = 'kills' | 'gold' | 'towers' | 'dragons' | 'barons' | 'grubs' | 'heralds' | 'atakhans';
// Objetivos por equipo: etiqueta y dato (todos son cantidades: barras mariposa)
const OBJECTIVES: [string, SideStat][] = [
  ['Kills', 'kills'], ['Oro', 'gold'], ['Torres', 'towers'], ['Dragones', 'dragons'],
  ['Barones', 'barons'], ['Larvas', 'grubs'], ['Heraldos', 'heralds'], ['Atakhan', 'atakhans'],
];

// Una partida. A la izquierda va siempre el equipo de la izquierda del encabezado (a), juegue del lado que juegue
function gameCard(g: GameDetail, a: TeamEntry, b: TeamEntry, players: PlayerEntry[]): string {
  const leftBlue = g.blue.team !== b.name;
  const [l, r] = leftBlue ? [g.blue, g.red] : [g.red, g.blue];
  const [ls, rs]: ('blue' | 'red')[] = leftBlue ? ['blue', 'red'] : ['red', 'blue'];
  // Equipo con su lado del mapa; el que perdió la partida va atenuado
  const sideTeam = (team: TeamEntry, s: 'blue' | 'red', cls: 'l' | 'r') => {
    const lost = g.winner !== null && g.winner !== s;
    return `<span class="gt ${cls}${lost ? ' lost' : ''}">${logoImg(team.logo)}<b>${escapeHtml(team.short)}</b>` +
      `<span class="side ${s}">${s === 'blue' ? 'Azul' : 'Rojo'}</span></span>`;
  };
  const winner = g.winner === null ? null : g.winner === ls ? a : b;
  const meta = [winner ? `${escapeHtml(winner.short)} ganó` : null, g.length, g.patch ? `Parche ${escapeHtml(g.patch)}` : null]
    .filter(Boolean).join(' · ');
  // Solo las filas que Leaguepedia trae
  const objectives = OBJECTIVES
    .filter(([, key]) => l[key] !== null || r[key] !== null)
    .map(([label, key]) => {
      const show = key === 'gold' ? thousands : (v: number | null) => fmt(v);
      return mirror(label, show(l[key]), show(r[key]), { kind: 'size', a: l[key], b: r[key] });
    }).join('');
  // Los picks ya aparecen en cada rol; acá solo los bans, chicos y atenuados
  const bans = l.bans.length || r.bans.length
    ? `<div class="bans-row"><span class="bans">${l.bans.map(champHex).join('')}</span><span class="label">Bans</span><span class="bans r">${r.bans.map(champHex).join('')}</span></div>`
    : '';
  const hasPlayers = l.players.length || r.players.length;
  const lineup = hasPlayers
    ? `${scoreboard(l, r, players)}<div class="duels">${ROLES.map((role) => gameDuel(role, l, r, players)).join('')}</div>`
    : '<p class="muted small-note">Leaguepedia todavía no cargó los jugadores de esta partida.</p>';
  return `<article class="bezel game"><div class="core">
    <div class="game-head"><h3>Partida ${g.n ?? '?'}</h3><span class="muted num">${meta}</span></div>
    <div class="game-sides">${sideTeam(a, ls, 'l')}${sideTeam(b, rs, 'r')}</div>
    <div class="cmp">${objectives}</div>
    ${bans}
    ${lineup}
  </div></article>`;
}

function gamesTab(m: Match, games: GameDetail[], a: TeamEntry, b: TeamEntry, players: PlayerEntry[]): string {
  if (!games.length) {
    return `<div class="state"><b>Todavía no hay partidas cargadas</b>
      <span>Cada partida aparece un rato después de terminar, cuando Leaguepedia carga el scoreboard.</span></div>`;
  }
  // Serie en curso: la partida que sigue (o la que todavía no se cargó) queda como lugar vacío
  const pending = m.status === 'live'
    ? `<div class="state"><b>Partida ${games.length + 1}</b><span>Todavía sin datos.</span></div>` : '';
  return `${games.map((g) => gameCard(g, a, b, players)).join('')}${pending}
    ${how('Datos de Leaguepedia: cada partida aparece un rato después de terminar y el sitio se actualiza cada 30 minutos. Cada equipo tiene su barra, medida contra el que más tiene: el que lleva más llena su mitad y el otro muestra cuánto le faltó (4 kills contra 12 = un tercio de barra). En el celular, tocá un rol para ver CS, oro y daño a campeones de cada jugador.')}`;
}

export function renderMatch(el: HTMLElement, data: SiteData, tz: string, param: string | null, tabParam: string | null = null): () => void {
  const m = data.schedule.matches.find((x) => x.id === param);
  const a = m?.team1 ? teamByName(data.teams.teams, m.team1.name) : undefined;
  const b = m?.team2 ? teamByName(data.teams.teams, m.team2.name) : undefined;
  if (!m || !a || !b) {
    el.innerHTML = notFound('ese partido (o todavía no tiene los dos equipos definidos)');
    return () => {};
  }
  const games = data.games?.matches[m.id] ?? [];
  // Las pestañas aparecen cuando la serie ya empezó; antes solo hay previa.
  // Un partido terminado con partidas cargadas abre en Partidas: ahí está lo que pasó
  const hasGames = m.status !== 'upcoming' || games.length > 0;
  const fallback: Tab = m.status === 'finished' && games.length ? 'partidas' : 'previa';
  const tab: Tab = hasGames ? pick(tabParam, ['previa', 'partidas'] as const, fallback) : 'previa';
  const sa = a.season;
  const sb = b.season;
  const meetings = a.series.filter((s) => s.opponent === b.name);
  const roles: Role[] = ['top', 'jng', 'mid', 'bot', 'sup'];
  const lost = (side: 'team1' | 'team2') => m.status === 'finished' && m.winner !== null && m.winner !== side;
  const gap = (x: number | null, y: number | null, scale: number): Bars => ({ kind: 'gap', a: x, b: y, scale });
  el.innerHTML = `
    <section class="stack">
      ${backLink('#/')}
      <span class="eyebrow">Cara a cara</span>
      <div class="bezel"><div class="core hero-core"><h1 class="vs-hero">
        ${heroSide(a, favMark(m, 'team1'), 'l', lost('team1'))}
        ${heroMiddle(m)}
        ${heroSide(b, favMark(m, 'team2'), 'r', lost('team2'))}
      </h1>${predictionBlock(m, true)}</div></div>
    </section>
    ${hasGames ? `<div class="pinbar"><div class="subhead">${subtabs('tab', TABS, tab, 'Secciones del partido')}</div></div>` : ''}
    ${tab === 'partidas' ? `<section class="stack">${gamesTab(m, games, a, b, data.players.players)}</section>` : `
    <div class="pair">
    <section class="stack"><h2>Temporada 2026</h2><div class="bezel cmp"><div class="core">
      ${mirrorGroup('Nivel', a.short, b.short)}
      ${mirror('Elo', fmt(a.rating), fmt(b.rating), gap(a.rating, b.rating, 100))}
      ${mirror('Récord', `${sa.wins}-${sa.games - sa.wins}`, `${sb.wins}-${sb.games - sb.wins}`)}
      ${mirror('Victorias', pct(sa.winrate), pct(sb.winrate), gap(sa.winrate, sb.winrate, 0.2))}
      ${mirrorGroup('Ritmo', a.short, b.short)}
      ${mirror('Duración', clock(sa.avg_minutes), clock(sb.avg_minutes))}
      ${mirror('Oro/min', fmt(sa.gold_per_min), fmt(sb.gold_per_min), gap(sa.gold_per_min, sb.gold_per_min, 100))}
      ${mirrorGroup('Primeros objetivos', a.short, b.short)}
      ${mirror('1ª sangre', pct(sa.first_blood), pct(sb.first_blood), gap(sa.first_blood, sb.first_blood, 0.2))}
      ${mirror('1er dragón', pct(sa.first_dragon), pct(sb.first_dragon), gap(sa.first_dragon, sb.first_dragon, 0.2))}
      ${mirror('1ª torre', pct(sa.first_tower), pct(sb.first_tower), gap(sa.first_tower, sb.first_tower, 0.2))}
    </div></div>
    ${how('La barra sale del centro hacia el equipo que saca ventaja en ese dato, y el riel tenue marca hasta dónde puede llegar: el borde es una diferencia grande (100 de Elo, 100 de oro por minuto o 20 puntos de %). Duración = lo que dura su partida promedio. La duración y el récord no tienen barra: no hay un "mejor". Los primeros objetivos son el % de partidas en que el equipo los consiguió.')}</section>
    <section class="stack"><h2>Elo en 2026</h2>
      <div class="legend"><span><i class="lg-a"></i>${escapeHtml(a.short)}</span><span><i class="lg-b"></i>${escapeHtml(b.short)}</span></div>
      <div class="chart-box"><canvas aria-label="Evolución del Elo de ${escapeHtml(a.short)} y ${escapeHtml(b.short)} en 2026" role="img"></canvas></div></section>
    </div>
    <section class="stack"><h2>Duelos por rol</h2>
      <div class="duel-grid">${roles.map((r) => {
        // Por rol: campeones del de la izquierda · el duelo · campeones del de la derecha (en PC, cada fila de la grilla)
        const pa = starterByRole(a, data.players.players, r);
        const pb = starterByRole(b, data.players.players, r);
        return `${playerChamps(pa, 'l')}${duel(r, pa, pb, a, b)}${playerChamps(pb, 'r')}`;
      }).join('')}</div>
      ${how('Tocá un rol para ver KDA, DPM y KP de la temporada. A los costados, los 3 campeones que más jugó cada uno (partidas y récord). Forma = la del modelo elo-2: desvíos sobre el promedio del rol (+0.30 es 0,3 desvíos por encima). La barra va hacia el que saca ventaja y llega al borde con 0,5 de forma, 2 de KDA, 150 de DPM o 10 puntos de KP. Se comparan jugadores del mismo rol, así que el DPM es justo.')}</section>
    <section class="stack"><h2>Enfrentamientos en 2026</h2>
      ${meetings.length ? meetings.map((s) => `<div class="row"><span class="t">${escapeHtml(s.date.slice(5))}</span><span class="m">${escapeHtml(s.page.split('/')[0])}</span><span class="num">${escapeHtml(a.short)} ${s.wins}-${s.losses}</span></div>`).join('')
        : '<div class="state"><b>No se enfrentaron en 2026</b></div>'}
    </section>`}`;

  // Elo de los dos equipos en un mismo gráfico (Chart.js carga aparte; se destruye al salir)
  let alive = true;
  let destroy: () => void = () => {};
  const canvas = el.querySelector('canvas');
  if (canvas) {
    drawEloChart(canvas, [
      { label: a.short, history: a.elo_history, series: a.series },
      { label: b.short, history: b.elo_history, series: b.series },
    ], firstDay(data.schedule.matches)).then((d) => { if (alive) destroy = d; else d(); });
  }
  // Cambio de pestaña: entra al historial ("atrás" vuelve a la anterior) y se redibuja la vista
  el.onclick = (event) => {
    const next = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]')?.dataset.tab;
    if (!next || next === tab) return;
    withTransition(() => {
      alive = false;
      destroy();
      go(`#/partido/${encodeURIComponent(m.id)}/${next}`);
      destroy = renderMatch(el, data, tz, param, next);
      el.querySelector<HTMLButtonElement>(`button[data-tab="${next}"]`)?.focus();
      showFromTop(el);
    });
  };
  return () => { alive = false; destroy(); el.onclick = null; };
}
