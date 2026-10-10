// Barras con Chart.js (import dinámico, como eloChart). Los colores salen de variables CSS.
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export interface BarSeries {
  label: string;
  data: (number | null)[];
  color: string; // nombre de la variable CSS, ej. '--blue'
}

export async function drawBarChart(canvas: HTMLCanvasElement, labels: string[], datasets: BarSeries[],
                                   format: (v: number) => string): Promise<() => void> {
  const { Chart, BarController, BarElement, LinearScale, CategoryScale, Tooltip, Legend } = await import('chart.js');
  Chart.register(BarController, BarElement, LinearScale, CategoryScale, Tooltip, Legend);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const chart = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: datasets.map((d) => ({ label: d.label, data: d.data, backgroundColor: cssVar(d.color) })) },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduced ? false : { duration: 400 },
      plugins: {
        legend: { labels: { color: cssVar('--fg2') } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${format(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: cssVar('--fg2') }, grid: { color: cssVar('--line') } },
        y: { beginAtZero: true, ticks: { color: cssVar('--fg2'), callback: (v) => format(Number(v)) }, grid: { color: cssVar('--line') } },
      },
    },
  });
  return () => chart.destroy();
}
