// Papers-over-time helpers for the timeline dock and the map filter.

/** Playback speed: milliseconds per year at 1x. */
export const MS_PER_YEAR = 400;
export const SPEEDS = [1, 2, 4];

/**
 * Publication year of a paper. The API sends `year` for every paper; if it is
 * ever missing, fall back to the arXiv id:
 *   new style "YYMM.NNNNN"        -> 20YY
 *   old style "category/YYMMNNN"  -> YY >= 91 ? 19YY : 20YY  (arXiv started in 1991)
 */
export function yearOf(paper) {
  if (Number.isFinite(paper.year)) return paper.year;
  const id = paper.arxiv_id ?? "";
  const m = id.match(/^(\d{2})\d{2}\.\d{4,5}/) ?? id.match(/\/(\d{2})\d{5}/);
  if (!m) return null;
  const yy = Number(m[1]);
  return yy >= 91 ? 1900 + yy : 2000 + yy;
}

/** Sort a list of papers by year (stable), so "up to year Y" is a prefix. */
export const byYear = (papers) => [...papers].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

/** How many papers in a year-sorted list were published in or before `year` (null = all). */
export function countUpTo(sorted, year) {
  if (year == null) return sorted.length;
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid].year ?? 0) <= year) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Papers per year, split by group for the selected gap:
 *   { years: [y0..y1], rows: [{ year, a, b, other, noise, total, cumulative }], total }
 */
export function yearHistogram(papers, pairIds) {
  const ys = papers.map((p) => p.year).filter(Number.isFinite);
  if (ys.length === 0) return { years: [], rows: [], total: 0 };
  const first = Math.min(...ys);
  const last = Math.max(...ys);
  const rows = [];
  for (let y = first; y <= last; y++) rows.push({ year: y, a: 0, b: 0, other: 0, noise: 0, total: 0, cumulative: 0 });
  for (const p of papers) {
    if (!Number.isFinite(p.year)) continue;
    const row = rows[p.year - first];
    if (p.cluster_id == null) row.noise += 1;
    else if (pairIds && p.cluster_id === pairIds[0]) row.a += 1;
    else if (pairIds && p.cluster_id === pairIds[1]) row.b += 1;
    else row.other += 1;
    row.total += 1;
  }
  let running = 0;
  for (const row of rows) {
    running += row.total;
    row.cumulative = running;
  }
  return { years: rows.map((r) => r.year), rows, total: running, first, last };
}
