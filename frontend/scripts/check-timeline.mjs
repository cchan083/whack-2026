// Timeline checks: counts, drag, keyboard, play, URL, frame rate; records videos.
//   node scripts/check-timeline.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
const [base = "http://localhost:5173", out = "."] = process.argv.slice(2);
// Real GPU rendering (headless defaults to software WebGL, which halves the frame rate).
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const log = (...a) => console.log(...a);
const field = "ml-climate"; // the largest topic (~2,100 papers)

await page.goto(`${base}/#${field}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelector("#map-heading")?.textContent === "ml climate", null, { timeout: 20000 });
await page.waitForTimeout(800);
const data = await page.evaluate(async (f) => (await fetch(`/api/topics/${f}`)).json(), field);
const years = data.papers.map((p) => p.year);
const first = Math.min(...years), last = Math.max(...years);

// What the map draws: points in the paper traces (noise, others, A, B).
const mapCount = () => page.evaluate(() => {
  const gd = document.querySelector(".js-plotly-plot");
  return [0, 1, 4, 5].reduce((n, i) => n + (gd.data[i].x?.length ?? 0), 0);
});
const slider = page.getByRole("slider", { name: /papers published up to/ });
const val = () => slider.getAttribute("aria-valuetext");

log("all time:", await val(), "| map points:", await mapCount(), "of", data.papers.length);

// Counts at a few years must equal papers with year <= Y.
let ok = true;
for (const y of [first, first + 3, last - 2]) {
  await page.evaluate((y) => (location.hash = `#ml-climate?year=${y}`), y);
  await page.waitForTimeout(400);
  const want = years.filter((v) => v <= y).length;
  const got = await mapCount();
  log(`year ${y}: map ${got}, expected ${want}, slider "${await val()}"`);
  ok &&= got === want;
}
log("counts match:", ok);
// Histogram: hover every bar and add up the tooltip counts.
const track = await page.locator(".tl-track").boundingBox();
const nYears = last - first + 1;
let sum = 0;
for (let i = 0; i < nYears; i++) {
  await page.mouse.move(track.x + ((i + 0.5) / nYears) * track.width, track.y + track.height / 2);
  const tip = await page.locator(".tl-tip").textContent();
  sum += Number(tip.match(/: (\d+) paper/)[1]);
}
log("histogram sum:", sum, "of", data.papers.length, sum === data.papers.length ? "OK" : "MISMATCH");
await page.mouse.move(10, 10);

// Keyboard: focus with "t", Home, arrows, Shift+arrow, End -> All time.
await page.evaluate(() => (location.hash = "#ml-climate"));
await page.waitForTimeout(300);
await page.locator("body").click({ position: { x: 5, y: 5 } }); // focus the page, not an input
await page.keyboard.press("t");
log("t focuses slider:", await page.evaluate(() => document.activeElement?.getAttribute("role")));
await page.keyboard.press("Home"); log("Home:", await val());
await page.keyboard.press("ArrowRight"); log("Right:", await val());
await page.keyboard.press("Shift+ArrowRight"); log("Shift+Right:", await val());
const gapBefore = await page.evaluate(() => document.querySelector('.gap-row[aria-current="true"]')?.dataset.index);
await page.keyboard.press("ArrowUp");
log("Up on slider changes year, not gap:", await val(), "| gap", gapBefore, "->", await page.evaluate(() => document.querySelector('.gap-row[aria-current="true"]')?.dataset.index));
log("url:", await page.evaluate(() => location.hash));
await page.keyboard.press("End"); log("End:", await val(), "| url:", await page.evaluate(() => location.hash));

// Drag across the track.
const box = await slider.boundingBox();
await page.mouse.move(box.x + 5, box.y + box.height / 2);
await page.mouse.down();
for (let i = 0; i <= 20; i++) { await page.mouse.move(box.x + 5 + (box.width * 0.6 * i) / 20, box.y + box.height / 2); await page.waitForTimeout(30); }
log("dragged to:", await val(), "| chip:", await page.locator(".year-chip").textContent());
await page.screenshot({ path: `${out}/timeline-scrub.png` });
await page.mouse.up();
await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
await page.mouse.down(); await page.mouse.up();
log("click at max year:", await val());

// Frame rate while playing at 1x (rAF frames over 3 s).
await page.getByRole("button", { name: "Play timeline" }).click();
const fps = await page.evaluate(() => new Promise((res) => {
  let frames = 0; const t0 = performance.now();
  const f = (t) => { frames++; if (t - t0 < 3000) requestAnimationFrame(f); else res(Math.round((frames * 1000) / (t - t0))); };
  requestAnimationFrame(f);
}));
log("fps while playing (largest topic):", fps, "| at", await val());
await page.getByRole("button", { name: "Pause timeline" }).click();
log("paused at:", await val(), "| announced:", await page.locator(".timeline [role=status]").textContent());

// Frame rate while scrubbing fast with the keyboard.
await slider.focus();
await page.keyboard.press("Home");
const fps2 = await page.evaluate(async () => {
  const s = document.querySelector(".tl-track");
  let frames = 0; let run = true; const t0 = performance.now();
  const f = () => { frames++; if (run) requestAnimationFrame(f); }; requestAnimationFrame(f);
  for (let i = 0; i < 40; i++) {
    s.dispatchEvent(new KeyboardEvent("keydown", { key: i % 30 < 15 ? "ArrowRight" : "ArrowLeft", bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
  }
  run = false; return Math.round((frames * 1000) / (performance.now() - t0));
});
log("fps while scrubbing:", fps2);

// Play to the end -> back to All time.
await page.keyboard.press("End");
await page.getByRole("button", { name: "Speed" }).count();
await page.getByRole("button", { name: /Playback speed/ }).click();
await page.getByRole("button", { name: /Playback speed/ }).click(); // 4x
await page.getByRole("button", { name: "Play timeline" }).click();
await page.waitForTimeout(((last - first + 1) * 100) + 800);
log("after playing to end:", await val(), "| announced:", await page.locator(".timeline [role=status]").textContent());

// Collapse / expand.
await page.getByRole("button", { name: "Hide timeline" }).click();
log("collapsed:", await page.locator(".timeline.is-collapsed").count());
await page.screenshot({ path: `${out}/timeline-collapsed.png` });
await page.getByRole("button", { name: "Show timeline" }).click();

log("errors:", errs);
await ctx.close();
await b.close();
