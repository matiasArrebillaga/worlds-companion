import type { CalibrationBucket } from '../types';

// Gráfico de calibración: un punto por franja (predicho vs. real) y la diagonal de la calibración perfecta.
// El radio crece con la raíz de la cantidad de partidos (así el área es proporcional a n).
// Chart.js se importa recién cuando hace falta, igual que en eloChart.ts.
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function bubbleRadius(n: number): number {
  return 4 + Math.sqrt(n) * 2.5;
}

export async function drawCalibrationChart(canvas: HTMLCanvasElement, buckets: CalibrationBucket[]): Promise<() => void> {
  const { Chart, BubbleController, LineController, LineElement, PointElement, LinearScale, Tooltip } = await import('chart.js');
  Chart.register(BubbleController, LineController, LineElement, PointElement, LinearScale, Tooltip);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Las franjas sin partidos no tienen punto
  const used = buckets.filter((b) => b.n > 0 && b.predicted !== null && b.observed !== null);
  const pct = (v: number) => `${Math.round(v)}%`;
  // Eje vertical desde un poco abajo del peor resultado (como mucho 40%): así los dos ejes tienen una escala
  // parecida y la diagonal se lee casi a 45°
  const lowest = Math.min(...used.map((b) => b.observed! * 100), 50);
  const yMin = Math.min(40, Math.floor(lowest / 10) * 10 - 10);
  const grid = { color: cssVar('--line') };
  const ticks = { color: cssVar('--fg2'), callback: (v: string | number) => pct(Number(v)) };
  const chart = new Chart(canvas, {
    type: 'bubble',
    data: {
      datasets: [
        {
          data: used.map((b) => ({ x: b.predicted! * 100, y: b.observed! * 100, r: bubbleRadius(b.n) })),
          backgroundColor: cssVar('--data-soft'), borderColor: cssVar('--data'), borderWidth: 2,
          clip: false, // un punto en 100% no se corta contra el borde
        },
        {
          // Calibración perfecta: lo predicho es igual a lo real
          type: 'line', data: [{ x: 50, y: 50, r: 0 }, { x: 100, y: 100, r: 0 }], // r: lo pide el tipo del gráfico, la línea no lo usa
          borderColor: cssVar('--gold'), borderWidth: 1.5, pointRadius: 0, pointHitRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduced ? false : { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            title: (items) => `Favorito con ${used[items[0].dataIndex].label}`,
            label: (ctx) => {
              const b = used[ctx.dataIndex];
              return `${b.n} ${b.n === 1 ? 'partido' : 'partidos'} · predicho ${pct(b.predicted! * 100)} · ganó ${pct(b.observed! * 100)}`;
            },
          },
        },
      },
      scales: {
        x: { type: 'linear', min: 50, max: 100, grid, ticks,
          title: { display: true, text: 'Chance del favorito (predicha)', color: cssVar('--fg2') } },
        y: { type: 'linear', min: Math.max(0, yMin), max: 100, grid, ticks,
          title: { display: true, text: 'Ganó el favorito (real)', color: cssVar('--fg2') } },
      },
    },
  });
  return () => chart.destroy();
}
