// Screenshot the main UI states at four viewports and check for console
// errors and horizontal scroll. Optional axe accessibility scan.
//
//   node scripts/shots.mjs <baseUrl> <outDir> [--axe] [--topic=wildfire]
//
// The backend must be running (the dev server proxies /api to it).
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const [base = "http://localhost:5173", out = "shots"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const runAxe = process.argv.includes("--axe");
const topic = (process.argv.find((a) => a.startsWith("--topic=")) ?? "--topic=wildfire").split("=")[1];
mkdirSync(out, { recursive: true });

const VIEWPORTS = [
  [1440, 900],
  [1280, 720],
  [768, 1024],
  [390, 844],
];

const problems = [];
const axeReport = {};
const browser = await chromium.launch();

for (const [width, height] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("console", (m) => m.type() === "error" && problems.push(`${width}: console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`${width}: pageerror: ${e.message}`));

  await page.goto(`${base}/#${topic}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".js-plotly-plot .scatterlayer", { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${width}x${height}-default.png` });

  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (hscroll) problems.push(`${width}: horizontal scroll`);

  // Select gap 3 via keyboard where the redesign supports it, else the old <select>.
  if (await page.locator("#gap-select").count()) {
    await page.selectOption("#gap-select", { index: 2 });
  } else {
    await page.evaluate(() => (window.location.hash = window.location.hash.split("?")[0] + "?gap=3"));
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${width}x${height}-gap3.png` });

  if (runAxe) {
    const result = await new AxeBuilder({ page }).disableRules(["region"]).analyze();
    axeReport[`${width}x${height}`] = result.violations.map((v) => ({
      id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help,
      targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    }));
  }
  await page.close();
}

await browser.close();
if (runAxe) writeFileSync(`${out}/axe.json`, JSON.stringify(axeReport, null, 2));
console.log(problems.length ? problems.join("\n") : "No console errors or horizontal scroll.");
if (runAxe) {
  for (const [vp, v] of Object.entries(axeReport)) {
    console.log(`axe ${vp}: ${v.length ? v.map((x) => `${x.id}(${x.impact},${x.nodes})`).join(", ") : "clean"}`);
  }
}
