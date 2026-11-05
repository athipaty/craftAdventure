// Pausing in the break, Rally wording and the status row.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), assert = require("assert");
const root = path.join(__dirname, "..", "public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((q, s) => { const n = q.url.split("?")[0].replace(/^\/$/, "/index.html"); fs.readFile(path.join(root, n), (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { "Content-Type": types[path.extname(n)] || "text/plain" }); s.end(d); }); });
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
  const hide = () => page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); });
  await page.goto(url);
  await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
  await page.goto(url);
  await page.evaluate(() => { save.stats.waves = 100; for (const t of TIPS) save.tips[t.id] = true; writeSave(); });
  await hide();
  await page.evaluate(() => startChosenRun({ world: 0 }));

  const startBreak = () => page.evaluate(() => { for (let i = 0; i < 3; i++) placeGear("soldier"); nextWavePlan = { enemy: "goblin", event: null, pace: null, deal: null }; startBuildBreak(5); });
  await check("Pause works during the break, and Resume goes back to the break", async () => {
    await startBreak();
    await page.click("#pause-btn");
    assert.equal(await page.evaluate(() => gameState), "paused");
    assert.equal(await page.locator("#pause-screen").isVisible(), true);
    const left = await page.evaluate(() => buildLeft);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => buildLeft), left, "the countdown stops while paused");
    await page.click("#resume-btn");
    assert.equal(await page.evaluate(() => gameState), "building");
    assert.equal(await page.evaluate(() => buildLeft > 0 && nextWavePlan !== null), true, "the wave hasn't started");
    assert.equal(await page.locator("#build-bar").isVisible(), true);
  });
  await check("a break that was paused comes back paused after closing the game", async () => {
    await page.click("#pause-btn");
    await page.evaluate(() => saveRun());
    await page.reload(); await hide();
    await page.click("#continue-btn");
    assert.equal(await page.evaluate(() => gameState), "paused");
    await page.click("#resume-btn");
    assert.equal(await page.evaluate(() => gameState), "building");
    assert.equal(await page.locator("#build-bar").isVisible(), true);
    await page.click("#build-start-btn");
    assert.equal(await page.evaluate(() => gameState), "playing");
  });
  await check("Pause in a wave still resumes into the wave", async () => {
    await page.evaluate(() => { playerPower = 1000; enemyPower = 1000; });
    await page.click("#pause-btn");
    await page.click("#resume-btn");
    assert.equal(await page.evaluate(() => gameState), "playing");
  });
  await check("Restart from a paused break starts cleanly", async () => {
    await startBreak();
    await page.click("#pause-btn");
    await page.click("#restart-btn");
    const r = await page.evaluate(() => ({ state: gameState, wave, flag: pausedFromBuild }));
    assert.deepEqual(r, { state: "playing", wave: 1, flag: false });
    assert.equal(await page.locator("#build-bar").isVisible(), false);
  });
  await check("Rally wording no longer promises a number of seconds", async () => {
    const r = await page.evaluate(() => { openGuide(); const text = document.getElementById("guide-list").textContent; document.getElementById("guide-screen").classList.add("hidden"); return { guide: /Holds arriving soldiers back\. When the button says Charge!/.test(text), tip: TIPS.find((t) => t.id === "rally").text.includes("5 seconds") }; });
    assert.deepEqual(r, { guide: true, tip: false });
  });
  await check("the button really does say Charge! when each hero's Rally is full", async () => {
    for (const [hero, seconds] of [["knight", 3], ["archer", 5]]) {
      const label = await page.evaluate(([h, s]) => { save.hero = h; rallying = true; rallyHeld = s + 0.01; updateRallyButton(); const full = document.getElementById("rally-btn").textContent; rallyHeld = s - 0.5; updateRallyButton(); const before = document.getElementById("rally-btn").textContent; rallying = false; rallyHeld = 0; save.hero = "knight"; return { full, before }; }, [hero, seconds]);
      assert.match(label.full, /^Charge! /); assert.match(label.before, /^Charge \d/);
    }
  });
  await check("the Rally button shows how full it is, and only says Charge! at 100%", async () => {
    const read = (held) => page.evaluate((h) => {
      save.hero = "archer"; rallying = true; rallyHeld = h; rallyReserve = 10; updateRallyButton();
      const b = document.getElementById("rally-btn");
      const out = { label: b.textContent, fill: b.style.getPropertyValue("--charge"), full: b.classList.contains("full") };
      rallying = false; rallyHeld = 0; rallyReserve = 0; save.hero = "knight"; updateRallyButton();
      return out;
    }, held);
    assert.deepEqual(await read(0), { label: "Charge 0%", fill: "0%", full: false });
    assert.deepEqual(await read(2.5), { label: "Charge 50%", fill: "50%", full: false });
    const almost = await read(4.99);
    assert.equal(almost.label, "Charge 99%"); assert.equal(almost.full, false);
    const done = await read(5);
    assert.match(done.label, /^Charge! \d+$/); assert.equal(done.fill, "100%"); assert.equal(done.full, true);
  });
  await check("status icons put what matters first, and all of them fit", async () => {
    await page.evaluate(() => { playerPower = 1000; enemyPower = 1000; frozenFor = 3; activeDeal = WAVE_DEALS.army; wavePace = WAVE_PACES.rush; overdriveLeft = 3; rallying = true; runParts = { staticCharge: 2, warChest: 1, cooling: 1, longChain: 1, bossHunter: 1, warDrums: 1, patterns: 1, stormEngine: 1, turbo: 1, thickOil: 1, forgeBonus: 1 }; });
    for (const [w, h] of [[390, 844], [320, 568], [844, 390]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      await page.evaluate(() => { hitStop = 0; playerPower = 1000; enemyPower = 1000; lastStatusKey = ""; updateStatusRow(); });
      const r = await page.evaluate(() => {
        const box = document.getElementById("status-row");
        const chips = [...document.querySelectorAll(".status-chip")].map((c) => c.textContent);
        return { fits: box.scrollHeight <= box.clientHeight, chips, total: statusChips().length };
      });
      const frozenIcon = await page.evaluate(() => STATUS_ICONS.frozen);
      assert.equal(r.fits, true, `${w}x${h} overflows`);
      assert.equal(r.chips[0], frozenIcon, `${w}x${h} first icon`);
      assert.equal(r.chips.length, r.total, `${w}x${h} shows them all`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await check("newest rewards show first", async () => {
    await page.evaluate(() => { frozenFor = 0; activeDeal = null; wavePace = null; overdriveLeft = 0; rallying = false; runParts = { cooling: 1, warChest: 1 }; playerPower = 1000; enemyPower = 1000; });
    await page.waitForTimeout(120);
    const icons = await page.evaluate(() => [REWARD_ICONS.warChest, REWARD_ICONS.cooling]);
    assert.deepEqual(await page.locator(".status-chip").allTextContents(), icons);
  });
  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
