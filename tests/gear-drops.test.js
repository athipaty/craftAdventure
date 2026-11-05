// Free gears dropped by monsters and bosses.
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

  // Holds the fight still: only the code under test changes anything.
  const fresh = () => page.evaluate(() => {
    gameState = "playing"; boss = null; clearLootDrop(); wave = 3; waveTime = 10; gearDropAt = 5; lastLootDropAt = runTime;
    playerPower = 1000; enemyPower = 1000; marchers = []; enemyBacklog = 0; gearsBought = 0;
    grid.forEach((row, r) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[r][c] = null; }));
  });
  const gears = () => page.evaluate(() => grid.flat().filter((c) => c && !c.driver).map((c) => c.level));

  console.log("\nOn normal waves");
  await check("a wave's gear drops on the first hit after it's due, and only once", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      waveTime = 4; maybeDropLoot(100, 100);
      const early = Boolean(lootDrop);
      waveTime = 5; maybeDropLoot(100, 100);
      const due = lootDrop?.gearLevel;
      const spent = gearDropAt;
      clearLootDrop(); lastLootDropAt = runTime; maybeDropLoot(100, 100);
      return { early, due, spent, again: Boolean(lootDrop) };
    });
    assert.deepEqual(r, { early: false, due: 1, spent: -1, again: false });
  });
  await check("tapping it adds a gear for free, and doesn't raise the price", async () => {
    await fresh();
    await page.evaluate(() => { maybeDropLoot(195, 150); });
    const before = await page.evaluate(() => ({ cost: gearCost(), power: playerPower }));
    assert.equal(await page.locator("#loot-drop").isVisible(), true);
    assert.equal(await page.locator("#loot-drop-amount").textContent(), "Free!");
    await page.screenshot({ path: path.join(scratch, "gear-drop.png") });
    await page.evaluate(() => document.getElementById("loot-drop").click());
    assert.deepEqual(await gears(), [1]);
    const after = await page.evaluate(() => ({ cost: gearCost(), bought: gearsBought, gone: lootDrop === null }));
    assert.deepEqual(after, { cost: before.cost, bought: 0, gone: true });
    assert.equal(await page.locator("#loot-drop").isVisible(), false);
  });
  await check("missing it costs nothing: it goes away with no gear", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      maybeDropLoot(100, 100);
      lootDrop.age = GEAR_DROP_LIFETIME - 0.01;
      updateFx(0.001); const stillThere = Boolean(lootDrop);
      updateFx(0.05);
      return { stillThere, gone: lootDrop === null, power: playerPower };
    });
    assert.deepEqual(r, { stillThere: true, gone: true, power: 1000 });
    assert.deepEqual(await gears(), []);
  });
  await check("a gear takes over from coins waiting to be tapped", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      showLootDrop({ x: 50, y: 50, age: 0, life: LOOT_DROP_LIFETIME, coins: 2 });
      maybeDropLoot(100, 100);
      return { level: lootDrop.gearLevel, coins: lootDrop.coins };
    });
    assert.equal(r.level, 1); assert.equal(r.coins, undefined);
    const coin = await page.evaluate(() => {
      clearLootDrop();
      showLootDrop({ x: 50, y: 50, age: 0, life: LOOT_DROP_LIFETIME, coins: 2 });
      const before = runBonusCoins; collectLootDrop();
      return { gained: runBonusCoins - before, text: document.getElementById("loot-drop-icon").textContent };
    });
    assert.equal(coin.gained, 2, "coins still work");
    assert.deepEqual(await gears(), []);
  });
  await check("nothing drops on a full board, and one waiting goes away when it fills", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const fill = () => { while (bestEmptyCell()) placeGear("soldier"); };
      maybeDropLoot(100, 100);
      const dropped = Boolean(lootDrop);
      fill();
      updateFx(0.01);
      const cleared = lootDrop === null;
      gearDropAt = 5; lastLootDropAt = runTime;
      maybeDropLoot(100, 100);
      return { dropped, cleared, onFull: Boolean(lootDrop), stillDue: gearDropAt };
    });
    assert.deepEqual(r, { dropped: true, cleared: true, onFull: false, stillDue: 5 });
  });
  await check("about a third of waves have one, none on wave 1 or boss waves, in the right window", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const plans = [];
      boss = null; wave = 5;
      for (let i = 0; i < 4000; i++) plans.push(planGearDrop());
      const got = plans.filter((p) => p !== NO_GEAR_DROP);
      wave = 1; const first = planGearDrop();
      wave = 5; boss = { hp: 1, maxHp: 1 }; const onBoss = planGearDrop(); boss = null;
      return { share: got.length / plans.length, min: Math.min(...got), max: Math.max(...got), first, onBoss };
    });
    assert.ok(r.share > 0.3 && r.share < 0.4, `share ${r.share}`);
    assert.ok(r.min >= 4 && r.max <= 14, `${r.min}..${r.max}`);
    assert.equal(r.first, -1); assert.equal(r.onBoss, -1);
  });
  await check("a daily challenge drops the same for everyone", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const keep = currentDaily;
      currentDaily = { day: "2026-11-05" }; wave = 7;
      const plans = Array.from({ length: 3 }, () => planGearDrop());
      currentDaily = keep;
      return plans;
    });
    assert.equal(r[0], r[1]); assert.equal(r[1], r[2]);
  });

  console.log("\nFrom bosses");
  const bossAt = (share) => page.evaluate((s) => { boss = { kind: BOSS_KINDS[0], hp: 100 * s, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; gearDropAt = NO_GEAR_DROP; lastLootDropAt = runTime; maybeDropLoot(100, 100); return lootDrop?.gearLevel ?? 0; }, share);
  await check("a boss drops a level 2 gear at half health, and only one", async () => {
    await fresh();
    assert.equal(await bossAt(0.51), 0, "above half");
    await page.evaluate(() => { boss = null; });
    assert.equal(await bossAt(0.5), 2, "at half");
    assert.equal(await page.locator("#loot-drop-amount").textContent(), "Level 2!");
    await page.evaluate(() => document.getElementById("loot-drop").click());
    assert.deepEqual(await gears(), [2]);
    const again = await page.evaluate(() => { boss.hp = 10; lastLootDropAt = runTime; maybeDropLoot(100, 100); const got = Boolean(lootDrop); boss = null; return got; });
    assert.equal(again, false);
  });

  console.log("\nReloading");
  await check("reloading can't drop the same gear again", async () => {
    await fresh();
    await page.evaluate(() => { maybeDropLoot(100, 100); clearLootDrop(); boss = { kind: BOSS_KINDS[0], hp: 40, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0, gearDropped: true }; });
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    assert.equal(snap.numbers.gearDropAt, -1);
    assert.equal(snap.boss.gearDropped, true);
    assert.equal(await page.evaluate((d) => isValidRunSave(d), snap), true);
    const r = await page.evaluate((d) => { gearDropAt = 5; boss = null; restoreRun(d); lastLootDropAt = runTime; maybeDropLoot(100, 100); const out = { at: gearDropAt, dropped: boss.gearDropped, loot: Boolean(lootDrop) }; boss = null; return out; }, snap);
    assert.deepEqual(r, { at: -1, dropped: true, loot: false });
  });
  await check("a due gear survives a reload, and older saves still load", async () => {
    await fresh();
    const snap = await page.evaluate(() => { gearDropAt = 9; return JSON.parse(JSON.stringify(runSnapshot())); });
    assert.equal(await page.evaluate((d) => { restoreRun(d); return gearDropAt; }, snap), 9);
    delete snap.numbers.gearDropAt;
    assert.equal(await page.evaluate((d) => isValidRunSave(d), snap), true);
    assert.equal(await page.evaluate((d) => { restoreRun(d); return gearDropAt; }, snap), -1);
  });

  console.log("\nIn a real wave");
  await check("playing a wave for real drops one, and a click collects it", async () => {
    await fresh();
    await page.evaluate(() => { gearDropAt = waveTime; playerPower = 1000; enemyPower = 1000; sendMarcher("player", 1); });
    await page.locator("#loot-drop.gear").waitFor({ state: "visible", timeout: 6000 });
    const box = await page.locator("#loot-drop").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // it bobs, so it never holds still for locator.click
    assert.equal((await gears()).length >= 1, true);
    await page.waitForTimeout(100);
    assert.equal(await page.locator("#loot-drop").isVisible(), false);
  });

  console.log("\nExplaining it");
  await check("the guide and the first drop explain it, in English and Thai", async () => {
    const r = await page.evaluate(() => {
      const tip = TIPS.find((t) => t.id === "gearDrop");
      lootDrop = { gearLevel: 1 }; const shows = Boolean(tip.when()); lootDrop = null; const hides = Boolean(tip.when());
      return { shows, hides, target: tip.target, text: tip.text };
    });
    assert.deepEqual([r.shows, r.hides, r.target], [true, false, "#loot-drop"]);
    await page.evaluate(() => { save.lang = "th"; writeSave(); });
    await page.goto(url);
    const left = await page.evaluate((text) => ["Free gear", "Free gear!", "Free!", "Level 2!", text, "Monsters sometimes drop one at the front line, and every boss drops a level 2 gear at half health. Tap it before it disappears."].filter((x) => /[A-Za-z]{3}/.test(t(x))), r.text);
    assert.deepEqual(left, []);
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
