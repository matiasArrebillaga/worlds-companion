import { formatDayShort } from '../format';
import type { Chart as ChartInstance } from 'chart.js'; // solo el tipo: no carga Chart.js
import type { SeriesResult } from '../types';

// Gráfico de evolución del Elo: uno o dos equipos (Cara a cara). Chart.js se importa recién cuando hace falta,
// así no pesa en la carga inicial. Los colores salen de las variables CSS (nunca colores sueltos).

export interface EloLine {
  label: string; // sigla del equipo
  history: [string, number][]; // [fecha, Elo] después de cada partida
  series: SeriesResult[]; // para decir contra quién jugó ese día
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Un punto por día: el Elo con el que terminó ese día (el historial trae uno por partida)
export function dailyElo(history: [string, number][]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const [date, rating] of history) byDay.set(date, rating);
  return byDay;
}

// Las fechas de todos los equipos juntas y ordenadas; cada equipo tiene su valor o null los días que no jugó
export function alignLines(lines: Map<string, number>[]): { dates: string[]; values: (number | null)[][] } {
  const dates = [...new Set(lines.flatMap((l) => [...l.keys()]))].sort();
  return { dates, values: lines.map((l) => dates.map((d) => l.get(d) ?? null)) };
}

// Cuánto cambió respecto del último día que jugó (null el primer día)
export function dailyChange(values: (number | null)[], index: number): number | null {
  if (values[index] === null) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (values[i] !== null) return values[index]! - values[i]!;
  }
  return null;
}

// worldsStart: fecha (YYYY-MM-DD) del primer partido de Worlds; ahí se dibuja una línea vertical
export async function drawEloChart(canvas: HTMLCanvasElement, lines: EloLine[], worldsStart: string | null = null): Promise<() => void> {
  const { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip } = await import('chart.js');
  Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { dates, values } = alignLines(lines.map((l) => dailyElo(l.history)));
  // Primer equipo cian y continuo; el segundo dorado y punteado (no se distinguen solo por el color)
  const styles = [{ color: cssVar('--cyan'), dash: [] as number[] }, { color: cssVar('--gold'), dash: [6, 4] }];

  // Línea vertical "Worlds" en el primer día del torneo que aparezca en el gráfico
  const worldsLine = {
    id: 'worldsLine',
    afterDatasetsDraw(chart: ChartInstance) {
      const at = worldsStart ? dates.findIndex((d) => d >= worldsStart) : -1;
      if (at <= 0) return; // Worlds todavía no aparece en el historial (o no hay nada antes)
      const { ctx, chartArea } = chart;
      const x = chart.scales.x.getPixelForValue(at);
      ctx.save();
      ctx.strokeStyle = cssVar('--gold');
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.fillStyle = cssVar('--gold');
      ctx.font = `11px ${cssVar('--f-data')}`;
      ctx.fillText('Worlds', x + 5, chartArea.top + 12);
      ctx.restore();
    },
  };

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: dates,
      datasets: lines.map((line, i) => ({
        label: line.label,
        data: values[i],
        spanGaps: true,
        borderColor: styles[i % 2].color, borderDash: styles[i % 2].dash,
        borderWidth: 2, pointRadius: 0, pointHitRadius: 8, tension: 0.2,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: reduced ? false : { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          // Solo los equipos que jugaron ese día
          filter: (item) => values[item.datasetIndex][item.dataIndex] !== null,
          callbacks: {
            title: (items) => formatDayShort(dates[items[0].dataIndex]),
            label: (ctx) => {
              const change = dailyChange(values[ctx.datasetIndex], ctx.dataIndex);
              const delta = change === null ? '' : ` (${change >= 0 ? '+' : ''}${Math.round(change)})`;
              const played = lines[ctx.datasetIndex].series.filter((s) => s.date === dates[ctx.dataIndex])
                .map((s) => ` · vs ${s.opponent} ${s.wins}-${s.losses}`).join('');
              return `${lines[ctx.datasetIndex].label}: Elo ${Math.round(ctx.parsed.y)}${delta}${played}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: cssVar('--fg2'), maxTicksLimit: 6, callback: (_v, i) => formatDayShort(dates[i]) }, grid: { color: cssVar('--line') } },
        y: { ticks: { color: cssVar('--fg2') }, grid: { color: cssVar('--line') } },
      },
    },
    plugins: [worldsLine],
  });
  return () => chart.destroy();
}
