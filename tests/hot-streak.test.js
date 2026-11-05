// Winning waves quickly builds a streak that spins the main gear faster.
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

  const fresh = (level = 0) => page.evaluate((n) => {
    clearTimeout(rewardTimer); clearChests(); clearPaths();
    for (const id of ["reward-screen", "path-screen", "chest-screen", "build-bar", "pause-screen"]) document.getElementById(id).classList.add("hidden");
    gameState = "playing"; boss = null; wave = 3; waveTime = 5; nextWavePlan = null; wavePace = null; activeDeal = null; overdriveLeft = 0; frozenFor = 0; hotStreak = n;
    gearDropAt = NO_GEAR_DROP; treasureAt = NO_GEAR_DROP; clearTreasureGoblin(); playerPower = 1000; enemyPower = 1000; marchers = []; enemyBacklog = 0;
  }, level);
  const win = (time) => page.evaluate((t) => { const real = offerRewards; offerRewards = () => {}; waveTime = t; winWave(); offerRewards = real; return hotStreak; }, time);

  console.log("\nBuilding it");
  await check("a fast wave builds it, one level at a time, up to 5", async () => {
    await fresh();
    const levels = [];
    for (let i = 0; i < 7; i++) { await page.evaluate(() => { gameState = "playing"; boss = null; wave = 3; }); levels.push(await win(5)); }
    assert.deepEqual(levels, [1, 2, 3, 4, 5, 5, 5]);
  });
  await check("exactly 10 seconds still counts, and a moment later doesn't", async () => {
    await fresh(2);
    assert.equal(await win(10), 3);
    await fresh(2);
    assert.equal(await win(10.01), 0);
  });
  await check("a slow wave ends it and says so, but only if there was one", async () => {
    await fresh(4);
    assert.equal(await win(15), 0);
    assert.equal(await page.locator("#combo-toast").textContent(), "Hot streak lost");
    await fresh(0);
    await page.evaluate(() => { document.getElementById("combo-toast").textContent = "before"; });
    await win(15);
    assert.equal(await page.locator("#combo-toast").textContent(), "before");
  });
  await check("bosses and siege waves neither build nor break it", async () => {
    await fresh(3);
    const boss = await page.evaluate(() => { const real = showChests; showChests = () => {}; boss = { kind: BOSS_KINDS[0], hp: 0, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; waveTime = 60; winWave(); showChests = real; return hotStreak; });
    assert.equal(boss, 3, "slow boss");
    await fresh(3);
    await page.evaluate(() => { wavePace = WAVE_PACES.siege; });
    assert.equal(await win(40), 3, "slow siege");
    await fresh(3);
    await page.evaluate(() => { wavePace = WAVE_PACES.siege; });
    assert.equal(await win(5), 3, "fast siege doesn't build");
    await fresh(3);
    await page.evaluate(() => { wavePace = WAVE_PACES.rush; });
    assert.equal(await win(5), 4, "a rush wave does count");
  });
  await check("the win banner shows it from level 2", async () => {
    await fresh(0);
    await win(5);
    assert.equal(await page.locator("#wave-banner-text").textContent().catch(() => ""), "Victory!");
    await fresh(1);
    await win(5);
    assert.equal(await page.locator("#wave-banner-text").textContent().catch(() => ""), "Hot streak x2!");
  });

  console.log("\nWhat it does");
  const spin = (level, extra = "") => page.evaluate(([n, code]) => {
    hotStreak = n; new Function(code)();
    const driver = grid[DRIVER_ROW][DRIVER_COL];
    const before = driver.angle;
    updateDrivers(0.01);
    const moved = driver.angle - before;
    overdriveLeft = 0; frozenFor = 0;
    return moved;
  }, [level, extra]);
  await check("each level spins the main gear 5% faster", async () => {
    await fresh();
    const base = await spin(0);
    assert.ok(Math.abs((await spin(1)) / base - 1.05) < 1e-9);
    assert.ok(Math.abs((await spin(5)) / base - 1.25) < 1e-9);
  });
  await check("it stacks with Overdrive and frost", async () => {
    await fresh();
    const over = await spin(0, "overdriveLeft = 1;");
    assert.ok(Math.abs((await spin(5, "overdriveLeft = 1;")) / over - 1.25) < 1e-9);
    const cold = await spin(0, "frozenFor = 1;");
    assert.ok(Math.abs((await spin(5, "frozenFor = 1;")) / cold - 1.25) < 1e-9);
  });
  await check("it doesn't make the next waves bigger, which would cancel it out", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      placeGear("soldier"); markCombos();
      hotStreak = 0; const rate0 = soldiersPerSecond(); const size0 = waveStartEnemy(10);
      hotStreak = 5; const rate5 = soldiersPerSecond(); const size5 = waveStartEnemy(10);
      hotStreak = 0;
      return { rate0, rate5, size0, size5 };
    });
    assert.equal(r.rate0, r.rate5);
    assert.equal(r.size0, r.size5);
  });

  console.log("\nShowing it");
  await check("a status icon shows the level and explains it", async () => {
    await fresh(3);
    const r = await page.evaluate(() => statusChips().find((c) => c.name === "Hot streak"));
    assert.deepEqual([r.kind, r.count, r.text], ["good", 3, "Main gear 15% faster. Win waves within 10 seconds to keep it."]);
    await fresh(1);
    assert.equal(await page.evaluate(() => statusChips().find((c) => c.name === "Hot streak").count), null);
    await fresh(0);
    assert.equal(await page.evaluate(() => statusChips().some((c) => c.name === "Hot streak")), false);
  });
  const glow = () => page.evaluate(() => {
    save.lessMotion = true; drawBoard();
    const scale = boardCanvas.width / boardCssW;
    // All four sides, as the turning tooth can cover one of them.
    const ctx = boardCanvas.getContext("2d");
    const warmth = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy]) => {
      const x = (DRIVER_COL + 0.5 + dx * 0.62) * cellSize, y = (DRIVER_ROW + 0.5 + dy * 0.62) * cellSize;
      const d = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
      return d[0] - d[2];
    });
    save.lessMotion = false;
    return Math.max(...warmth);
  });
  await check("the main gear glows, and more with a longer streak", async () => {
    await fresh(0);
    await page.evaluate(() => { grid.forEach((row, r) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[r][c] = null; })); gameState = "paused"; });
    const none = await glow();
    await page.evaluate(() => { hotStreak = 1; });
    const low = await glow();
    await page.evaluate(() => { hotStreak = 5; });
    const high = await glow();
    assert.ok(low > none, `${none} then ${low}`);
    assert.ok(high >= low, `${low} then ${high}`);
    await page.locator("#board-canvas").screenshot({ path: path.join(scratch, "hot-streak.png") });
    assert.equal(await page.evaluate(() => { const c = boardCanvas.getContext("2d"); return c.globalAlpha; }), 1);
  });

  console.log("\nKeeping it");
  await check("it survives a reload, and older saves still load", async () => {
    await fresh(4);
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    assert.equal(snap.numbers.hotStreak, 4);
    assert.equal(await page.evaluate((d) => isValidRunSave(d), snap), true);
    assert.equal(await page.evaluate((d) => { hotStreak = 0; restoreRun(d); return hotStreak; }, snap), 4);
    delete snap.numbers.hotStreak;
    assert.equal(await page.evaluate((d) => isValidRunSave(d), snap), true);
    assert.equal(await page.evaluate((d) => { hotStreak = 3; restoreRun(d); return hotStreak; }, snap), 0);
  });
  await check("a new run starts with none", async () => {
    await fresh(5);
    assert.equal(await page.evaluate(() => { startChosenRun({ world: 0 }); return hotStreak; }), 0);
  });
  await check("reaching 5 earns the achievement, and it remembers the best", async () => {
    await fresh(4);
    const r = await page.evaluate(() => {
      delete save.achievements.streak5; save.stats.bestStreak = 4;
      const coins = save.coins;
      const real = offerRewards; offerRewards = () => {}; waveTime = 5; winWave();
      const got = { has: Boolean(save.achievements.streak5), paid: save.coins - coins };
      gameState = "playing"; boss = null; hotStreak = 0; waveTime = 5; winWave(); offerRewards = real;
      return { ...got, best: save.stats.bestStreak };
    });
    assert.deepEqual(r, { has: true, paid: 40, best: 5 });
  });

  console.log("\nExplaining it");
  await check("a tip explains it once there's something to see", async () => {
    const r = await page.evaluate(() => {
      const tip = TIPS.find((x) => x.id === "hotStreak");
      hotStreak = 1; const one = Boolean(tip.when());
      hotStreak = 2; const two = Boolean(tip.when());
      hotStreak = 0;
      return { one, two, urgent: tip.urgent };
    });
    assert.deepEqual(r, { one: false, two: true, urgent: true });
  });
  await check("everything has Thai, on the real status icon too", async () => {
    const list = await page.evaluate(() => [TIPS.find((x) => x.id === "hotStreak").text, "Hot streak", "Hot streak lost", "Hot streak x3!", "Main gear 15% faster. Win waves within 10 seconds to keep it.", "On fire!", "Reach a hot streak of 5", "Win a wave quickly to build a streak, and each level spins the main gear faster. A slow wave ends it, but bosses and siege waves don't count."]);
    await page.evaluate(() => { save.lang = "th"; writeSave(); });
    await page.goto(url);
    const left = await page.evaluate((texts) => texts.filter((x) => /[A-Za-z]{2}/.test(t(x))), list);
    assert.deepEqual(left, []);
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
