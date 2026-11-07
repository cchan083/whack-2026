// Full-page shots plus zoomed crops of the densest and sparsest focused topic,
// at device pixel ratio 1 and 2, at the full-map view (no fly-to).
//
//   node scripts/crops.mjs <baseUrl> <outDir> [field]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [base = "http://localhost:5173", out = "crops", field = "ml-climate"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

for (const dpr of [1, 2]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${base}/#${field}`, { waitUntil: "networkidle" });
  const data = await page.evaluate(async (f) => (await fetch(`/api/topics/${f}`)).json(), field);
  const size = Object.fromEntries(data.clusters.map((c) => [c.id, c.size]));
  // Dense: the gap whose bigger topic is largest. Sparse: the gap whose smaller topic is smallest.
  const pick = (better) => data.gaps.reduce((best, g) => (better(g, best) ? g : best));
  const big = (g) => Math.max(size[g.cluster_a], size[g.cluster_b]);
  const small = (g) => Math.min(size[g.cluster_a], size[g.cluster_b]);
  const cases = {
    dense: { gap: pick((g, b) => big(g) > big(b)), which: (g) => (size[g.cluster_a] >= size[g.cluster_b] ? g.cluster_a : g.cluster_b) },
    sparse: { gap: pick((g, b) => small(g) < small(b)), which: (g) => (size[g.cluster_a] <= size[g.cluster_b] ? g.cluster_a : g.cluster_b) },
  };

  for (const [name, { gap, which }] of Object.entries(cases)) {
    const cluster = which(gap);
    await page.goto(`${base}/#${field}?gap=${gap.rank}`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" }); // hash-only change: load fresh so the view is full-extent
    await page.waitForSelector(".js-plotly-plot .scatterlayer");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${name}-full-dpr${dpr}.png` });
    const box = await page.evaluate(({ cluster, papers }) => {
      const gd = document.querySelector(".js-plotly-plot");
      const xa = gd._fullLayout.xaxis, ya = gd._fullLayout.yaxis;
      const r = gd.getBoundingClientRect();
      const pts = papers.filter((p) => p.cluster_id === cluster)
        .map((p) => [r.left + xa._offset + xa.l2p(p.x), r.top + ya._offset + ya.l2p(p.y)]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), n: pts.length };
    }, { cluster, papers: data.papers });
    const pad = 40;
    const clip = {
      x: Math.max(0, box.x0 - pad), y: Math.max(0, box.y0 - pad),
      width: Math.min(1440, box.x1 - box.x0 + 2 * pad), height: Math.min(900, box.y1 - box.y0 + 2 * pad),
    };
    await page.screenshot({ path: `${out}/${name}-crop-dpr${dpr}.png`, clip });
    console.log(`dpr${dpr} ${name}: gap #${gap.rank}, topic ${cluster} with ${box.n} papers, crop ${Math.round(clip.width)}x${Math.round(clip.height)}`);
  }
  if (errors.length) console.log("errors:", errors);
  await context.close();
}
await browser.close();
