import { useEffect, useRef } from 'react';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

Chart.register(...registerables);

// Recursively rebuilds `value` with every function replaced by a wrapper
// that looks up the same path in `configRef.current.options` at call time
// and invokes whatever's there then — so a callback fires with the latest
// closure instead of the one captured when the Chart.js instance was built.
function wrapLiveCallbacks(value: any, configRef: { current: ChartConfiguration }, path: (string | number)[] = []): any {
  if (typeof value === 'function') {
    return (...args: any[]) => {
      const live = path.reduce<any>((o, key) => o?.[key], configRef.current.options);
      return typeof live === 'function' ? live(...args) : undefined;
    };
  }
  if (Array.isArray(value)) return value.map((v, i) => wrapLiveCallbacks(v, configRef, [...path, i]));
  // Only recurse into plain objects — a Date/RegExp/CanvasGradient etc. has
  // no own enumerable properties, so walking it here would silently replace
  // it with {} instead of passing it through. None of this app's charts put
  // one in `options` today, but the guard is one line and makes that an
  // assumption this code enforces rather than one it just happens to hold.
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    const result: Record<string, any> = {};
    for (const key of Object.keys(value)) result[key] = wrapLiveCallbacks(value[key], configRef, [...path, key]);
    return result;
  }
  return value;
}

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
  // Always the latest config, updated every render — not gated by dataKey
  // below, unlike the Chart.js instance itself.
  const configRef = useRef(config);
  configRef.current = config;
  const dataKey = JSON.stringify(config.data);

  useEffect(() => {
    if (!canvasRef.current) return;
    // The effect (and so the Chart.js instance) only recreates when the
    // chart's data or type changes — not when `options` changes. Any
    // function nested in `options` (onClick, plugins.tooltip.callbacks.*,
    // scales.*.ticks.callback, legend callbacks, …) closes over whatever
    // filter values were active when the chart was last recreated; if a
    // later filter change happens to produce byte-identical data (e.g. two
    // different teams with the same counts), the instance isn't recreated
    // and the stale callback stays bound. Originally this only wrapped
    // onClick — tooltip/tick callbacks were still exposed to the same
    // staleness, just needing byte-identical data to trigger. Walking the
    // whole options tree and wrapping every function through configRef
    // (always fresh) fixes the class of bug at this one shared point,
    // instead of special-casing each callback path in every chart config.
    // Found in the 2026-10-28 audit.
    const wrappedConfig: ChartConfiguration = { ...configRef.current, options: wrapLiveCallbacks(configRef.current.options, configRef) };
    chartRef.current = new Chart(canvasRef.current, wrappedConfig);
    return () => chartRef.current?.destroy();
  }, [dataKey, config.type]);

  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
