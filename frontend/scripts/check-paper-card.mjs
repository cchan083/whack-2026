// Paper card checks: click a dot -> card with the right paper and arXiv link;
// link and Cmd/Ctrl-click open arXiv in a new tab; Esc / pan close it; stars still select gaps.
//   node scripts/check-paper-card.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
const [base = "http://localhost:5173", out = "."] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
// Don't actually load arxiv.org: answer new-tab requests locally.
await ctx.route("https://arxiv.org/**", (r) => r.fulfill({ body: "<title>arXiv stub</title>", contentType: "text/html" }));
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const log = (...a) => console.log(...a);

await page.goto(`${base}/#wildfire`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelector("#map-heading")?.textContent === "wildfire");
await page.waitForTimeout(800);

// Screen position of point k in trace t (4 = Topic A dots, 1 = other papers).
const at = (t, k = 0) => page.evaluate(({ t, k }) => {
  const gd = document.querySelector(".js-plotly-plot");
  const tr = gd._fullData[t], xa = gd._fullLayout.xaxis, ya = gd._fullLayout.yaxis, r = gd.getBoundingClientRect();
  return { x: r.left + xa._offset + xa.l2p(tr.x[k]), y: r.top + ya._offset + ya.l2p(tr.y[k]), id: tr.customdata[k][3] };
}, { t, k });

const a = await at(4, 0);
await page.mouse.move(a.x, a.y);
await page.waitForTimeout(150);
log("hover hint:", (await page.locator(".hoverlayer").textContent()).includes("Click for details"));
await page.mouse.click(a.x, a.y);
await page.waitForTimeout(250);
const card = page.locator(".paper-card");
log("card open:", await card.count(), "| title:", (await card.locator(".paper-card-title").textContent()).slice(0, 60));
log("link:", await card.getByRole("link", { name: /Open on arXiv/ }).getAttribute("href"), "| expected id", a.id);
log("meta:", await card.locator(".paper-card-meta").textContent());
log("focus on link:", await page.evaluate(() => document.activeElement?.textContent?.trim().startsWith("Open on arXiv")));
log("dot ringed:", await page.evaluate(() => document.querySelector(".js-plotly-plot").data[10].x.length));
await page.screenshot({ path: `${out}/paper-card.png` });

// Clicking the link opens arXiv in a new tab.
const [tab] = await Promise.all([ctx.waitForEvent("page"), card.getByRole("link", { name: /Open on arXiv/ }).click()]);
await tab.waitForLoadState();
log("link opened tab:", tab.url());
await tab.close();

await page.keyboard.press("Escape");
log("Esc closes:", (await card.count()) === 0, "| ring cleared:", await page.evaluate(() => document.querySelector(".js-plotly-plot").data[10].x.length === 0));

// Cmd/Ctrl-click goes straight to arXiv, no card.
const o = await at(1, 5);
const [tab2] = await Promise.all([ctx.waitForEvent("page"), page.mouse.move(o.x, o.y).then(async () => {
  await page.keyboard.down("Meta"); await page.mouse.click(o.x, o.y); await page.keyboard.up("Meta");
})]);
await tab2.waitForLoadState();
log("cmd-click tab:", tab2.url(), "| expected", o.id, "| card:", await card.count());
await tab2.close();

// Pan closes the card.
await page.mouse.click(a.x, a.y);
await page.waitForTimeout(200);
await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(760, 480, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(300);
log("pan closes:", (await card.count()) === 0);

// Stars still select gaps.
const star = await page.evaluate(() => {
  const gd = document.querySelector(".js-plotly-plot"); const t = gd._fullData[7];
  const xa = gd._fullLayout.xaxis, ya = gd._fullLayout.yaxis, r = gd.getBoundingClientRect();
  return { x: r.left + xa._offset + xa.l2p(t.x[3]), y: r.top + ya._offset + ya.l2p(t.y[3]) };
});
await page.mouse.click(star.x, star.y);
await page.waitForTimeout(1200); // let the fly-to finish
log("star selects gap 4:", await page.evaluate(() => document.querySelector('.gap-row[aria-current="true"]')?.dataset.index === "3"), "| card:", await card.count());

// Near the right edge the card flips to stay inside the map.
const edge = await page.evaluate(() => {
  const gd = document.querySelector(".js-plotly-plot"); const xa = gd._fullLayout.xaxis, ya = gd._fullLayout.yaxis, r = gd.getBoundingClientRect();
  let best = null;
  for (const t of [1, 4, 5]) gd._fullData[t].x.forEach((x, k) => {
    const px = r.left + xa._offset + xa.l2p(x), py = r.top + ya._offset + ya.l2p(gd._fullData[t].y[k]);
    if (px < r.right - 30 && py > r.top + 200 && py < r.bottom - 220 && (!best || px > best.x)) best = { x: px, y: py };
  });
  return { ...best, right: r.right };
});
await page.mouse.click(edge.x, edge.y);
await page.waitForTimeout(250);
const cb = await card.boundingBox();
log("edge card inside map:", cb && cb.x + cb.width <= edge.right, `(card right ${Math.round(cb?.x + cb?.width)} <= map right ${Math.round(edge.right)})`);
await page.screenshot({ path: `${out}/paper-card-edge.png` });
await page.keyboard.press("Escape");

// Mobile tap.
const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const mp = await m.newPage();
await mp.goto(`${base}/#wildfire`, { waitUntil: "networkidle" });
await mp.waitForFunction(() => document.querySelector("#map-heading")?.textContent === "wildfire");
await mp.waitForTimeout(800);
const ma = await mp.evaluate(() => {
  const gd = document.querySelector(".js-plotly-plot"); const t = gd._fullData[4];
  const xa = gd._fullLayout.xaxis, ya = gd._fullLayout.yaxis, r = gd.getBoundingClientRect();
  return { x: r.left + xa._offset + xa.l2p(t.x[0]), y: r.top + ya._offset + ya.l2p(t.y[0]) };
});
await mp.touchscreen.tap(ma.x, ma.y);
await mp.waitForTimeout(400);
log("mobile tap opens card:", await mp.locator(".paper-card").count());
await mp.screenshot({ path: `${out}/paper-card-mobile.png` });
await m.close();

log("errors:", errs);
await b.close();
