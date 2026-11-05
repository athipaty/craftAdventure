// Tips explain things one at a time, rather than piling up in one fight.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), assert = require("assert");
const root = path.join(__dirname, "..", "public");
const scratch = path.join(__dirname, "screenshots");
fs.mkdirSync(scratch, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((q, s) => { const n = q.url.split("?")[0].replace(/^\/$/, "/index.html"); fs.readFile(path.join(root, n), (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { "content-type": types[path.extname(n)] || "application/octet-stream" }); s.end(d); } }); });
let passed = 0; const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log("  ok  ", name); }
  catch (e) { failures.push(name); console.log("  FAIL", name, "\n      ", e.message.split("\n").slice(0, 8).join("\n       ")); }
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
  await page.goto(url);
  await page.evaluate(() => { save.stats.waves = 100; for (const t of TIPS) save.tips[t.id] = true; writeSave(); });
  await page.goto(url);
  await page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); startChosenRun({ world: 0 }); });

  const fresh = () => page.evaluate(() => {
    clearTimeout(rewardTimer);
    for (const id of ["reward-screen", "path-screen", "chest-screen", "build-bar", "pause-screen", "tip-screen"]) document.getElementById(id).classList.add("hidden");
    for (const tip of TIPS) save.tips[tip.id] = true;
    openTip = null; gameState = "playing"; boss = null; wave = 3; waveTime = 3; runTime = 100; lastTipAt = 0; gearTray = []; gearDropAt = NO_GEAR_DROP; treasureAt = NO_GEAR_DROP; hotStreak = 0; playerPower = 1000; enemyPower = 1000; marchers = []; enemyBacklog = 0;
  });
  // Two tips ready at once, by their ids, and what comes up as time passes.
  const unseen = (ids) => page.evaluate((list) => { for (const id of list) delete save.tips[id]; }, ids);
  const show = () => page.evaluate(() => { gameState = "playing"; maybeShowTip(); const id = openTip?.id ?? null; if (openTip) { save.tips[openTip.id] = true; hideTip(); gameState = "playing"; } return id; });

  await check("urgent tips wait 8 seconds for each other", async () => {
    await fresh();
    await unseen(["boss", "rust"]);
    await page.evaluate(() => { boss = { kind: BOSS_KINDS[0], hp: 100, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; grid[DRIVER_ROW][DRIVER_COL + 1] = freshCell("soldier"); grid[DRIVER_ROW][DRIVER_COL + 1].rusted = true; });
    assert.equal(await show(), "boss");
    assert.equal(await show(), null, "right after");
    await page.evaluate(() => { runTime += 7.9; });
    assert.equal(await show(), null, "not quite");
    await page.evaluate(() => { runTime += 0.2; });
    assert.equal(await show(), "rust", "8 seconds on");
    await page.evaluate(() => { boss = null; grid[DRIVER_ROW][DRIVER_COL + 1] = null; });
  });
  await check("other tips wait 25 seconds", async () => {
    await fresh();
    await unseen(["strike"]);
    await page.evaluate(() => { waveTime = 9; lastTipAt = runTime; });
    assert.equal(await show(), null, "right after a tip");
    await page.evaluate(() => { runTime += 24.9; });
    assert.equal(await show(), null, "not quite");
    await page.evaluate(() => { runTime += 0.2; });
    assert.equal(await show(), "strike");
  });
  await check("a tip waiting its turn still comes, once", async () => {
    await fresh();
    await unseen(["boss", "rust", "counter"]);
    await page.evaluate(() => { boss = { kind: BOSS_KINDS[0], hp: 100, maxHp: 100, attackIn: 0.5, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; grid[DRIVER_ROW][DRIVER_COL + 1] = freshCell("soldier"); grid[DRIVER_ROW][DRIVER_COL + 1].rusted = true; });
    const got = [];
    for (let i = 0; i < 40; i++) { const id = await show(); if (id) got.push(id); await page.evaluate(() => { runTime += 1; }); }
    assert.equal(got.length, 3, got.join());
    assert.equal(new Set(got).size, 3);
    await page.evaluate(() => { boss = null; grid[DRIVER_ROW][DRIVER_COL + 1] = null; });
  });
  await check("the opening story leads straight into how to play", async () => {
    await fresh();
    await page.evaluate(() => { runTime = 0.5; waveTime = 0.5; lastTipAt = 0; wave = 1; currentEvent = null; currentDaily = null; currentWorld = 0; });
    await unseen(["story:forest", "start"]);
    assert.equal(await show(), "story:forest");
    assert.equal(await show(), "start", "no wait after the story");
    await page.evaluate(() => { runTime += 1; });
    await unseen(["boss"]);
    await page.evaluate(() => { boss = { kind: BOSS_KINDS[0], hp: 100, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; });
    assert.equal(await show(), null, "the next one waits");
    await page.evaluate(() => { boss = null; });
  });
  await check("a tip right at the start of play still starts the wait", async () => {
    await fresh();
    await unseen(["start", "boss"]);
    await page.evaluate(() => { runTime = 0; waveTime = 0.5; boss = null; });
    assert.equal(await show(), "start");
    await page.evaluate(() => { boss = { kind: BOSS_KINDS[0], hp: 100, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; });
    assert.equal(await show(), null);
    await page.evaluate(() => { boss = null; });
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
