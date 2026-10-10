// Gráfico de evolución del Elo. Chart.js se importa recién cuando hace falta, así no pesa en la carga inicial.
// Los colores salen de las variables CSS (nunca colores sueltos).
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export async function drawEloChart(canvas: HTMLCanvasElement, history: [string, number][]): Promise<() => void> {
  const { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip } = await import('chart.js');
  Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: history.map(([date]) => date),
      datasets: [{
        data: history.map(([, rating]) => rating),
        borderColor: cssVar('--cyan'), borderWidth: 2, pointRadius: 0, pointHitRadius: 8, tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduced ? false : { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `Elo ${Math.round(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: cssVar('--fg2'), maxTicksLimit: 6 }, grid: { color: cssVar('--line') } },
        y: { ticks: { color: cssVar('--fg2') }, grid: { color: cssVar('--line') } },
      },
    },
  });
  return () => chart.destroy();
}
