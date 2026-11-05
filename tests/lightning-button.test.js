// Tests and screenshots for the Lightning button.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), assert = require("assert");
const scratch = path.join(__dirname, "screenshots");
fs.mkdirSync(scratch, { recursive: true });
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text()); });
  await page.goto(url);
  await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
  await page.goto(url);
  await page.evaluate(() => { save.stats.waves = 100; for (const t of TIPS) save.tips[t.id] = true; writeSave(); document.getElementById("daily-screen").classList.add("hidden"); });
  await page.evaluate(() => startChosenRun({ world: 0 }));
  const hold = () => page.evaluate(() => { hitStop = 0; playerPower = 1000; enemyPower = 1000; });
  const label = () => page.locator("#strike-btn").textContent();
  // Waits for the game to really draw, however slow this machine is, rather than for a set time.
  const frames = () => page.evaluate(() => new Promise((done) => { let n = 0; const tick = () => (++n >= 3 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }));
  const settle = async () => { await hold(); await frames(); };

  await check("pressing the button strikes, and starts the recharge", async () => {
    await page.evaluate(() => { strikeCooldown = 0; });
    await settle();
    assert.equal(await label(), "Lightning!");
    const s0 = await page.evaluate(() => statValue("strikes"));
    await hold();
    await page.locator("#strike-btn").tap();
    assert.equal(await page.evaluate(() => statValue("strikes")), s0 + 1);
    await settle();
    assert.match(await label(), /^Lightning \ds$/);
    assert.equal(await page.locator("#strike-btn").isDisabled(), true);
  });
  await check("the recharge fills the button, then it's ready again", async () => {
    await page.evaluate(() => { strikeCooldown = 1; });
    await hold();
    await page.waitForFunction(() => strikeCooldown < 1 && parseInt(document.getElementById("strike-btn").style.getPropertyValue("--charge")) >= 45, null, { timeout: 3000 });
    const fill = await page.evaluate(() => document.getElementById("strike-btn").style.getPropertyValue("--charge"));
    console.log("        cooldown fill", fill, await page.evaluate(() => strikeCooldown));
    assert.ok(parseInt(fill) > 20 && parseInt(fill) < 90, fill);
    await page.screenshot({ path: path.join(scratch, "shot6-recharge.png") });
    await page.evaluate(() => { strikeCooldown = 0; });
    await hold();
    await page.waitForFunction(() => document.getElementById("strike-btn").classList.contains("ready"), null, { timeout: 3000 });
    assert.equal(await page.locator("#strike-btn").isDisabled(), false);
    await page.screenshot({ path: path.join(scratch, "shot6-ready.png") });
  });
  await check("tapping the battlefield no longer does anything", async () => {
    await page.evaluate(() => { strikeCooldown = 0; });
    const s0 = await page.evaluate(() => statValue("strikes"));
    const box = await page.locator("#battle-canvas").boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => { boss = { kind: BOSS_KINDS[3], hp: 1e6, maxHp: 1e6, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 3 }; });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await page.evaluate(() => statValue("strikes")), s0);
    assert.equal(await page.evaluate(() => boss.shield), 3);
  });
  await check("a raised shield turns it into Break shield, then back", async () => {
    await page.evaluate(() => { strikeCooldown = 1.5; });
    await settle();
    assert.equal(await label(), "Break shield: 3");
    assert.equal(await page.locator("#strike-btn").isDisabled(), false, "usable even while lightning recharges");
    await page.screenshot({ path: path.join(scratch, "shot6-shield.png") });
    const s0 = await page.evaluate(() => statValue("strikes"));
    await page.locator("#strike-btn").tap(); await hold();
    await page.locator("#strike-btn").tap(); await hold();
    await page.locator("#strike-btn").tap();
    assert.equal(await page.evaluate(() => boss.shield), 0);
    assert.equal(await page.evaluate(() => statValue("strikes")), s0, "breaking a shield isn't a strike");
    await page.evaluate(() => { strikeCooldown = 1.5; });
    await settle();
    assert.match(await label(), /^Lightning \ds$/);
  });
  await check("it says when to counter, and pressing then cancels the attack", async () => {
    await page.evaluate(() => { boss = { kind: BOSS_KINDS[0], hp: 1e6, maxHp: 1e6, attackIn: 0.95, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; strikeCooldown = 0; strikeHeld = 2; });
    await hold();
    await frames();
    assert.equal(await label(), "Strike now!");
    await page.screenshot({ path: path.join(scratch, "shot6-counter.png") });
    await page.locator("#strike-btn").tap();
    assert.ok(await page.evaluate(() => boss.attackIn > 7));
    assert.equal(await page.evaluate(() => statValue("counters")), 1);
    await page.evaluate(() => { boss = null; });
  });
  await check("the no-lightning deal shows on the button", async () => {
    await page.evaluate(() => { activeDeal = WAVE_DEALS.dark; strikeCooldown = 0; });
    await settle();
    assert.equal(await label(), "No lightning");
    assert.equal(await page.locator("#strike-btn").isDisabled(), true);
    await page.evaluate(() => { activeDeal = null; });
  });
  await check("the tutorial points at the button and no tip says to tap the battle", async () => {
    const r = await page.evaluate(() => ({ target: TIPS.find((t) => t.id === "strike").target, stale: TIPS.filter((t) => /tap the battle/i.test(t.text)).length }));
    assert.deepEqual(r, { target: "#strike-btn", stale: 0 });
  });
  await check("Overdrive and Rally still work", async () => {
    await page.evaluate(() => { overdriveCooldown = 0; overdriveLeft = 0; });
    await settle();
    await page.locator("#overdrive-btn").tap();
    assert.ok(await page.evaluate(() => overdriveLeft > 0));
    await hold();
    await page.locator("#rally-btn").tap();
    assert.equal(await page.evaluate(() => rallying), true);
    await hold();
    await page.locator("#rally-btn").tap();
    assert.equal(await page.evaluate(() => rallying), false);
  });

  // Long labels at every size.
  await page.evaluate(() => { armyRank = 2; wave = 40; });
  for (const [name, w, h] of [["phone", 390, 844], ["small", 320, 568], ["narrow", 360, 640], ["landscape", 844, 390]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    await page.evaluate(() => { hitStop = 0; playerPower = 90; enemyPower = 1e6; playerPower = 1e6 * 0.45; strikeCooldown = 1.8; overdriveCooldown = 25; rallying = false; updateTrainButton(); updateStrikeButton(); updateOverdriveButton(); updateRallyButton(); });
    await page.waitForTimeout(60);
    await page.screenshot({ path: path.join(scratch, `shot6-${name}.png`) });
    await check(`all five buttons fit and are big enough to press: ${name}`, async () => {
      const r = await page.evaluate(() => {
        const frame = document.getElementById("app-frame").getBoundingClientRect();
        const board = document.getElementById("board-canvas").getBoundingClientRect();
        const bad = [];
        for (const id of ["train-btn", "strike-btn", "overdrive-btn", "rally-btn"]) {
          const el = document.getElementById(id), q = el.getBoundingClientRect();
          if (q.left < frame.left - 1 || q.right > frame.right + 1 || q.bottom > frame.bottom + 1) bad.push(`${id} off screen`);
          if (q.height < 36 || q.width < 72) bad.push(`${id} too small ${q.width}x${q.height}`);
          if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) bad.push(`${id} text overflows`);
        }
        return { bad, cell: Math.round(cellSize), labels: ["train-btn", "strike-btn", "overdrive-btn", "rally-btn"].map((id) => document.getElementById(id).textContent) };
      });
      console.log("       ", name, "cell", r.cell, JSON.stringify(r.labels));
      assert.deepEqual(r.bad, []);
    });
  }
  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
