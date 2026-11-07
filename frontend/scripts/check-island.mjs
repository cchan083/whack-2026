// Island header checks: "/" focus, suggestions, Esc, toast once per topic, building state.
// The build is simulated by intercepting the API in the browser (no real arXiv build).
import { chromium } from "playwright";
const [base = "http://localhost:5173", out = "."] = process.argv.slice(2);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const log = (...a) => console.log(...a);
// Wait until a topic's map has loaded (gap rows rendered for that topic).
const loaded = async (pg, name) => {
  await pg.waitForFunction((n) => document.querySelector("#map-heading")?.textContent === n, name, { timeout: 20000 });
  await pg.waitForTimeout(300);
};

await page.goto(`${base}/#game-theory__stat.ML`, { waitUntil: "networkidle" });
await loaded(page, "game theory (stat.ML)");
log("toast visible on first visit:", await page.locator(".verdict-limited").count());

await page.keyboard.press("/");
log("'/' focused:", await page.evaluate(() => document.activeElement?.id));
await page.keyboard.type("wild");
await page.waitForTimeout(200);
log("suggestions:", await page.locator(".suggest-option").allTextContents());
await page.screenshot({ path: `${out}/island-suggest.png` });
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
await loaded(page, "wildfire");
log("after Enter:", await page.evaluate(() => location.hash), "| focus:", await page.evaluate(() => document.activeElement?.tagName));

await page.keyboard.press("/");
await page.keyboard.press("Escape");
log("Esc blurred:", await page.evaluate(() => document.activeElement?.id !== "topic"), "| list closed:", (await page.locator(".suggest").count()) === 0);

// Back to the limited topic: the toast must not show again.
await page.evaluate(() => (location.hash = "#game-theory__stat.ML"));
await loaded(page, "game theory (stat.ML)");
log("toast on second visit:", await page.locator(".verdict-limited").count());

// Auto-dismiss: fresh page, wait 8.5 s.
const p2 = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p2.goto(`${base}/#game-theory__stat.ML`, { waitUntil: "networkidle" });
await loaded(p2, "game theory (stat.ML)");
const before = await p2.locator(".verdict-limited").count();
await p2.waitForTimeout(8500);
log("toast auto-dismiss:", before, "->", await p2.locator(".verdict-limited").count());
await p2.close();

// Simulated build.
let polls = 0;
await page.route("**/api/topics", (route) =>
  route.request().method() === "POST"
    ? route.fulfill({ json: { status: "running", field: "demo", job_id: "demo1" } })
    : route.continue());
await page.route("**/api/jobs/demo1", (route) => {
  polls += 1;
  route.fulfill({ json: { status: "running", progress: Math.min(0.95, polls * 0.3), message: "Working..." } });
});
await page.keyboard.press("/");
await page.keyboard.type("demo topic");
await page.keyboard.press("Enter");
await page.waitForTimeout(2600);
log("building:", await page.locator(".build-stage").textContent(), "|", await page.locator(".build-clock").textContent(),
  "| button:", await page.locator(".cmdbar-submit").textContent(), "disabled:", await page.locator(".cmdbar-submit").isDisabled());
await page.screenshot({ path: `${out}/island-building.png`, clip: { x: 300, y: 0, width: 840, height: 72 } });
log("errors:", errs);
await b.close();
