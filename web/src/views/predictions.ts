import type { SiteData } from '../data';
import { escapeHtml } from '../html';
import { upcomingPredicted } from '../predictions';
import type { CalibrationBucket, Elo } from '../types';
import { matchCard } from './matchCard';

type Tab = 'proximos' | 'ranking' | 'como' | 'aciertos';
const TABS: [Tab, string][] = [['proximos', 'Próximos'], ['ranking', 'Ranking'], ['como', 'Cómo funciona'], ['aciertos', 'Aciertos']];

// La sub-vista se recuerda mientras la página esté abierta
let current: Tab = 'proximos';

const BO1_NOTE = '<p class="note">Los Bo1 tienen alta varianza: una sola partida decide la serie, así que un favorito al 65% pierde una de cada tres. Mirá el porcentaje, no solo quién es el favorito.</p>';

const pct = (x: number) => `${Math.round(x * 100)}%`;

function empty(title: string, detail: string): string {
  return `<div class="state"><b>${title}</b><span>${detail}</span></div>`;
}

function upcoming(data: SiteData, tz: string): string {
  const list = upcomingPredicted(data.schedule.matches);
  const body = list.length
    ? `<div class="grid g3">${list.map((m) => matchCard(m, tz)).join('')}</div>`
    : empty('Todavía no hay cruces definidos', 'Las predicciones aparecen cuando Leaguepedia confirma qué equipos juegan cada partido. Mientras tanto, mirá el ranking.');
  return `${BO1_NOTE}${body}`;
}

function ranking(elo: Elo): string {
  if (!elo.teams.length) return empty('Sin equipos todavía', 'El ranking aparece cuando se conozcan los clasificados.');
  const rows = elo.teams.map((t, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td class="team"><b>${escapeHtml(t.short)}</b><span class="muted">${escapeHtml(t.name)}</span></td>
      <td>${escapeHtml(t.region ?? '—')}</td>
      <td class="num">${Math.round(t.rating)}</td>
      <td class="num">${t.games}</td>
    </tr>`).join('');
  return `
    <p class="muted">Rating Elo de los clasificados, calculado con todas las partidas de 2026 (ligas e internacionales). 100 puntos de diferencia ≈ 64% de ganar una partida.</p>
    <p class="note">El ranking muestra solo el Elo. Las predicciones además suman la forma reciente de los jugadores de cada rol, así que un equipo puede estar más abajo en el ranking y aun así ser favorito.</p>
    <div class="table-wrap"><table class="rank">
      <thead><tr><th class="num">#</th><th>Equipo</th><th>Región</th><th class="num">Elo</th><th class="num">Partidas</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function howItWorks(elo: Elo): string {
  const offsets = Object.entries(elo.params.region_offsets)
    .filter(([, v]) => v !== 0)
    .map(([region, v]) => `${escapeHtml(region)} ${v > 0 ? '+' : ''}${v}`)
    .join(' · ') || 'sin ajustes';
  const b = elo.backtest;
  const r = elo.role_form;
  return `
    <div class="prose stack">
      <h2>Elo por partida</h2>
      <p>Cada equipo tiene un rating. La diferencia entre dos ratings se convierte en probabilidad de ganar una partida: con 100 puntos de diferencia, el favorito gana el 64% de las veces. Después de cada partida el ganador suma puntos y el perdedor resta los mismos; una sorpresa mueve más los ratings que un resultado esperado.</p>
      <h2>De partida a serie</h2>
      <p>Para un Bo3 o un Bo5 se suman todas las formas de llegar primero a 2 o 3 victorias. Con 57% por partida, el favorito gana el 60% de los Bo3 y el 63% de los Bo5: cuantas más partidas, menos pesa la suerte. Supone que cada partida es independiente de la anterior, lo que es solo una aproximación.</p>
      <h2>Regiones</h2>
      <p>Las ligas casi no se cruzan entre sí, así que cada equipo arranca la temporada con un ajuste según su región (${offsets}) y los torneos internacionales de 2026 corrigen el resto. K = ${elo.params.k}: cuánto se mueve el rating después de cada partida.</p>
      <h2>Forma de los jugadores</h2>
      <p>Encima del Elo se suma cómo viene jugando cada titular comparado con el promedio de su rol: diferencia de oro, experiencia y farmeo al minuto 15 contra su rival directo, participación en kills, muertes, % del daño del equipo y daño por cada unidad de oro recibido. La forma reciente pesa más (una partida de hace 10 pesa la mitad que la última) y un jugador nuevo arranca en el promedio. Se compara la forma de los dos jugadores de cada rol; el top y el mid son los que más mueven la predicción.</p>
      <p>Se supone que cada equipo juega con su última alineación. Probado en el ${escapeHtml(r.test.tournament)}, que el modelo no había visto: el Brier score bajó de ${r.test.brier_elo.toFixed(3)} (solo Elo) a ${r.test.brier_model.toFixed(3)} en ${r.test.games} partidas. Datos de jugadores: <a href="https://oracleselixir.com" target="_blank" rel="noopener">Oracle's Elixir</a>.</p>
      <h2>¿Funciona?</h2>
      <p>Los valores se eligieron con la temporada ${b.calibration_year} y se probaron en ${b.validation_year}, que el modelo no había visto. En ${b.validation_games} partidas entre regiones distintas, el Brier score fue ${b.validation_brier.toFixed(3)} (tirar una moneda da 0.250; el Elo sin ajuste regional, ${b.baseline_brier.toFixed(3)}). En las ${b.worlds_series} series de Worlds ${b.validation_year} acertó el ${pct(b.worlds_accuracy)}.</p>
      <h2>Reglas</h2>
      <p>Cada predicción se guarda antes del partido y nunca se edita. Si el modelo cambia, cambia su versión (actual: ${escapeHtml(elo.model_version)}) y los aciertos se cuentan por separado.</p>
      ${BO1_NOTE}
    </div>`;
}

function calibrationRow(c: CalibrationBucket): string {
  if (!c.n || c.predicted === null || c.observed === null) {
    return `<div class="calib-row"><span class="label">Favorito con ${c.label} · sin partidos</span></div>`;
  }
  return `
    <div class="calib-row">
      <span class="label">Favorito con ${c.label} · ${c.n} ${c.n === 1 ? 'partido' : 'partidos'}</span>
      <div class="calib-line"><span>Predicho</span><span class="bar gold" aria-hidden="true"><i style="width:${(c.predicted * 100).toFixed(1)}%"></i></span><b>${pct(c.predicted)}</b></div>
      <div class="calib-line"><span>Real</span><span class="bar" aria-hidden="true"><i style="width:${(c.observed * 100).toFixed(1)}%"></i></span><b>${pct(c.observed)}</b></div>
    </div>`;
}

function hits(elo: Elo): string {
  const a = elo.accuracy;
  if (!a.n || a.accuracy === null || a.brier === null) {
    return empty('Todavía no hay partidos evaluados', 'Cada predicción se evalúa cuando termina su partido. Solo cuentan las que se guardaron antes de empezar.');
  }
  return `
    <div class="kpis">
      <div class="bezel"><div class="core kpi"><span class="label">Aciertos</span><b>${a.correct}/${a.n}</b><span class="muted">${pct(a.accuracy)}</span></div></div>
      <div class="bezel"><div class="core kpi"><span class="label">Brier score</span><b>${a.brier.toFixed(3)}</b><span class="muted">0 es perfecto · moneda = 0.250</span></div></div>
    </div>
    <h2>Calibración</h2>
    <p class="muted">Si el modelo está bien calibrado, los favoritos al 60–70% ganan entre el 60 y el 70% de las veces. Con pocos partidos estos números saltan mucho.</p>
    <div class="calib">${a.calibration.map(calibrationRow).join('')}</div>`;
}

export function renderPredictions(el: HTMLElement, data: SiteData, tz: string): () => void {
  const body = current === 'proximos' ? upcoming(data, tz)
    : current === 'ranking' ? ranking(data.elo)
    : current === 'como' ? howItWorks(data.elo)
    : hits(data.elo);
  const buttons = TABS.map(
    ([id, label]) => `<button type="button" data-sub="${id}" aria-pressed="${id === current}">${label}</button>`,
  ).join('');

  el.innerHTML = `
    <section class="stack">
      <span class="eyebrow">Modelo ${escapeHtml(data.elo.model_version)}</span>
      <h1>Predicciones</h1>
      <div class="seg" role="group" aria-label="Secciones de predicciones">${buttons}</div>
    </section>
    <section class="stack">${body}</section>`;

  el.querySelector('.seg')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-sub]');
    if (!button) return;
    current = button.dataset.sub as Tab;
    renderPredictions(el, data, tz);
    el.querySelector<HTMLButtonElement>(`button[data-sub="${current}"]`)?.focus();
  });
  return () => {};
}
