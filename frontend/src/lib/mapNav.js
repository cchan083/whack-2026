import Plotly from "plotly.js-dist-min";
import { easeInOutCubic } from "./hooks.js";
import { prefersReducedMotion } from "../theme.js";

/** Bounding box of points ({x, y}) padded by `pad` of its size on every side. */
export function boundsOf(points, pad = 0.15) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0)) return null;
  const w = Math.max(x1 - x0, 1e-6);
  const h = Math.max(y1 - y0, 1e-6);
  return { x: [x0 - w * pad, x1 + w * pad], y: [y0 - h * pad, y1 + h * pad] };
}

export function currentRanges(gd) {
  const full = gd?._fullLayout;
  if (!full?.xaxis || !full?.yaxis) return null;
  return { x: [...full.xaxis.range], y: [...full.yaxis.range] };
}

/**
 * Animate the axis ranges to `target` ({x:[a,b], y:[c,d]}).
 * Plotly.animate can't transition scattergl traces, so this tweens with
 * requestAnimationFrame + Plotly.relayout (cheap: data is untouched).
 * Duration 0 under prefers-reduced-motion. Resolves when finished.
 */
export function flyTo(gd, target, duration = 600) {
  if (!gd || !target) return Promise.resolve();
  if (gd.__flyCancel) gd.__flyCancel();
  const from = currentRanges(gd);
  if (!from || prefersReducedMotion() || duration <= 0) {
    return Plotly.relayout(gd, { "xaxis.range": target.x, "yaxis.range": target.y });
  }
  return new Promise((resolve) => {
    let raf;
    let cancelled = false;
    const start = performance.now();
    gd.__flyCancel = () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      resolve();
    };
    const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    const step = (now) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / duration);
      const k = easeInOutCubic(t);
      gd.__flying = t < 1;
      Plotly.relayout(gd, { "xaxis.range": lerp(from.x, target.x, k), "yaxis.range": lerp(from.y, target.y, k) });
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        gd.__flyCancel = null;
        resolve();
      }
    };
    raf = requestAnimationFrame(step);
  });
}

/** Zoom around the centre of the current view by `factor` (<1 zooms in). */
export function zoomBy(gd, factor, duration = 250) {
  const r = currentRanges(gd);
  if (!r) return Promise.resolve();
  const scale = ([a, b]) => {
    const c = (a + b) / 2;
    const h = ((b - a) / 2) * factor;
    return [c - h, c + h];
  };
  return flyTo(gd, { x: scale(r.x), y: scale(r.y) }, duration);
}
