import { useEffect, useRef } from 'react';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

Chart.register(...registerables);

// Thin lifecycle wrapper — Chart.js owns the canvas imperatively (it's not
// a React-controlled DOM), so the chart instance has to be created once and
// explicitly destroyed on unmount/re-render, or Chart.js logs a "Canvas is
// already in use" warning and leaks the previous instance. Re-creates
// (rather than calling chart.update()) whenever the data actually changes —
// simplest correct option at this app's data volume (a handful of charts,
// each with at most a few hundred points); revisit with incremental
// updates only if that becomes a measured problem.
//
// The canvas MUST sit inside a wrapper with a real CSS height (not just a
// `height` attribute on the canvas itself) — `responsive: true` +
// `maintainAspectRatio: false` makes Chart.js resize the canvas to fill
// its parent via a ResizeObserver. Without an explicit CSS height on that
// parent, the parent's height is itself derived from the canvas's content,
// which the canvas is simultaneously trying to fill — an unstable loop
// that grows the canvas taller on every resize cycle (confirmed via a real
// headless-browser check, 2026-10-05: an unconstrained canvas reached
// several thousand px tall within seconds). The fixed-height wrapper div
// breaks that loop by giving Chart.js a stable box to measure against.
export function ChartCanvas({ config, height = 260 }: { config: ChartConfiguration; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const dataKey = JSON.stringify(config.data);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current = new Chart(canvasRef.current, config);
    return () => chartRef.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, config.type]);

  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
