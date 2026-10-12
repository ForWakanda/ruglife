// Headless-Chrome smoke: drives the BUILT client against a RUNNING server and plays a table and the practice game to GLOBAL ALERT by
// clicking only what the page offers (the client renders view.legal; the clicker never reads the rules).
//
//   npm run build && PORT=18795 npm run server &            # the server serves packages/client/dist
//   node scripts/smoke.mjs http://localhost:18795            # exit 0 = both games reached GLOBAL ALERT with 0 console/page errors
//
// Needs playwright-core (not a dependency of the repo) and a Chrome binary:
//   PLAYWRIGHT_DIR=<dir with node_modules/playwright-core>   default: resolved from this repo
//   CHROME=/usr/bin/google-chrome                            default
//   SMOKE_SHOTS=<dir>                                        optional: screenshots at each stage
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:18795";
const pwDir = process.env.PLAYWRIGHT_DIR;
const require = createRequire(pwDir ? join(pwDir, "package.json") : import.meta.url);
const { chromium } = require("playwright-core");
const shots = process.env.SMOKE_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
page.on("requestfailed", (r) => { if (!r.url().includes("mypinata")) errors.push(`request: ${r.url()} ${r.failure()?.errorText}`); });

let shot = 0;
const snap = async (name) => { if (shots) await page.screenshot({ path: join(shots, `${String(++shot).padStart(2, "0")}-${name}.png`) }); };
const clickText = async (text, { exact = false, timeout = 0 } = {}) => {
  const loc = page.getByRole("button", { name: text, exact });
  if (timeout) { await loc.first().click({ timeout }); return true; }
  const n = await loc.count();
  if (!n) return false;
  const b = loc.first();
  if (!(await b.isEnabled())) return false;
  await b.click();
  return true;
};

/** One scripted click: a prompt first, then the big buttons, then a playable card, then the turn-ending buttons. Returns what it clicked. */
async function step(seen) {
  if (await page.locator(".globalalert").count()) return "GLOBAL ALERT";
  const modal = page.locator(".overlay .modal");
  if (await modal.count()) {
    const title = (await modal.locator("h2").first().textContent().catch(() => "")) ?? "";
    seen.add(`modal: ${title.trim()}`);
    // the sealed Rug: pull it once per game, keep otherwise — both branches get exercised across the two games
    if (await clickText("PULL THE RUG")) return "rug: pull";
    if (await clickText(/^I'm in for/)) return "help: accept";
    if (await clickText(/^Keep these/)) return "airdrop: keep";
    if (await clickText("Accept", { exact: true })) return "trade: accept";
    if (await clickText(/^Keep$/)) return "rug: keep";
    const opts = modal.locator("button.btn:not(.ghost)");
    const n = await opts.count();
    if (n) { const i = Math.floor(Math.random() * n); const t = await opts.nth(i).textContent(); await opts.nth(i).click(); return `choice: ${t?.trim()}`; }
    await clickText("Never mind");
    return "modal: dismissed";
  }
  const phase = (await page.locator(".phase").first().textContent().catch(() => null))?.trim();
  if (phase) seen.add(`phase: ${phase}`);
  for (const t of ["Deal", "Start trouble", "Fight!"]) if (await clickText(t, { exact: true })) return t;
  const cards = page.locator(".hand .handrow .card.click");
  const n = await cards.count();
  if (n) { const i = Math.floor(Math.random() * n); const name = await cards.nth(i).locator(".name").textContent(); await cards.nth(i).click(); return `card: ${name?.trim()}`; }
  if (Math.random() < 0.5 && (await clickText("Ask for help"))) return "ask for help";
  for (const t of ["Grab a bag", "Pass", "End turn"]) if (await clickText(t, { exact: true })) return t;
  return null;
}

async function playOut(label, maxClicks) {
  const seen = new Set();
  let clicks = 0, idle = 0;
  const started = Date.now();
  while (clicks < maxClicks && Date.now() - started < 240_000) {
    const did = await step(seen);
    if (did === "GLOBAL ALERT") { log(`${label}: GLOBAL ALERT after ${clicks} clicks`); return { ok: true, clicks, seen }; }
    if (did) { clicks++; idle = 0; if (clicks % 25 === 0) log(`${label}: ${clicks} clicks, last: ${did}`); await page.waitForTimeout(120); }
    else { idle++; await page.waitForTimeout(250); if (idle === 240) log(`${label}: 60 s with nothing to click (phase ${[...seen].filter((s) => s.startsWith("phase")).pop()})`); }
  }
  return { ok: false, clicks, seen };
}

let ok = true;
try {
  // 1. a table: open it, sit with a loaner, two bots, deal, play to the end
  await page.goto(`${base}/#/`, { waitUntil: "networkidle" });
  await snap("lobby");
  await page.getByPlaceholder("table name").fill("Smoke table");
  await clickText("Open", { exact: true, timeout: 10_000 });
  await page.waitForTimeout(500);
  if (!(await clickText("Open", { exact: true }))) {} // a lobby row "Open" (seated) — ignore if absent
  await clickText("Sit with a loaner", { timeout: 10_000 });
  await page.waitForTimeout(400);
  await clickText("Add a bot", { timeout: 10_000 }); await page.waitForTimeout(300);
  await clickText("Add a bot", { timeout: 10_000 }); await page.waitForTimeout(300);
  await snap("pregame");
  await clickText("Deal", { exact: true, timeout: 10_000 });
  await page.waitForTimeout(800);
  await snap("dealt");
  const t = await playOut("table", 600);
  await snap("table-end");
  log("table saw:", [...t.seen].join(" · "));
  if (!t.ok) { ok = false; log("table: did NOT reach GLOBAL ALERT"); }

  // 2. practice: the stacked deal and the coach; all six milestones must tick
  await page.goto(`${base}/#/practice`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await snap("practice");
  const p = await playOut("practice", 900);
  await snap("practice-end");
  const coach = (await page.locator(".coach .step").first().textContent().catch(() => "")) ?? "";
  const ticked = (coach.match(/☑/g) ?? []).length;
  log(`practice milestones: ${ticked}/6 — ${coach.trim()}`);
  log("practice saw:", [...p.seen].join(" · "));
  if (!p.ok) { ok = false; log("practice: did NOT reach GLOBAL ALERT"); }
  if (ticked < 6) { ok = false; log("practice: not every milestone ticked"); }
} catch (e) {
  ok = false;
  log("smoke threw:", e.message);
  await snap("error");
} finally {
  await browser.close();
}
if (errors.length) { ok = false; log(`${errors.length} browser error(s):`); for (const e of errors.slice(0, 20)) log("  ", e); }
log(ok ? "SMOKE OK" : "SMOKE FAILED");
process.exit(ok ? 0 : 1);
