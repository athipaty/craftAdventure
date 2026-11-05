// A rare goblin runs past with treasure: tap it before it escapes.
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
    gameState = "playing"; boss = null; gearTray = []; wave = 3; waveTime = 1; gearDropAt = NO_GEAR_DROP; treasureAt = NO_GEAR_DROP; clearTreasureGoblin();
    playerPower = 1000; enemyPower = 1000; marchers = []; enemyBacklog = 0; runBonusCoins = 0; runEasy = false;
    document.getElementById("pause-screen").classList.add("hidden");
  });
  // Decides the catch: the first number picks gear or coins, the second how many.
  const rigged = (rolls, fn) => page.evaluate(([r, code]) => {
    const keep = runRandom;
    runRandom = () => { const seq = [...r]; return () => seq.shift() ?? 0; };
    try { return new Function(code)(); } finally { runRandom = keep; }
  }, [rolls, fn]);

  console.log("\nWhen it comes");
  await check("about one wave in five has one, not the first wave or boss waves, in the right window", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const plans = [];
      for (let i = 0; i < 6000; i++) plans.push(planTreasureGoblin());
      const got = plans.filter((p) => p !== NO_GEAR_DROP);
      wave = 1; const first = Array.from({ length: 300 }, planTreasureGoblin).every((p) => p === NO_GEAR_DROP);
      wave = 5; boss = { hp: 1, maxHp: 1 }; const onBoss = Array.from({ length: 300 }, planTreasureGoblin).every((p) => p === NO_GEAR_DROP); boss = null; wave = 3;
      return { share: got.length / plans.length, min: Math.min(...got), max: Math.max(...got), first, onBoss };
    });
    assert.ok(r.share > 0.17 && r.share < 0.23, `share ${r.share}`);
    assert.ok(r.min >= 4 && r.max <= 9, `${r.min}..${r.max}`);
    assert.deepEqual([r.first, r.onBoss], [true, true]);
  });
  await check("a daily challenge has the same goblins for everyone", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const keep = currentDaily;
      currentDaily = { day: "2026-11-05" };
      const out = [];
      for (let w = 2; w < 60; w++) { wave = w; out.push(planTreasureGoblin() === planTreasureGoblin()); }
      currentDaily = keep; wave = 3;
      return out;
    });
    assert.ok(r.every(Boolean));
  });
  await check("it appears once when due, and not before", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      treasureAt = 5; waveTime = 4; updateTreasureGoblin(0.001);
      const early = Boolean(treasureGoblin);
      waveTime = 5; updateTreasureGoblin(0.001);
      const age = treasureGoblin?.age;
      const spent = treasureAt;
      return { early, spawned: age !== undefined, spent };
    });
    assert.deepEqual(r, { early: false, spawned: true, spent: -1 });
    assert.equal(await page.locator("#treasure-goblin").isVisible(), true);
    assert.equal(await page.locator("#treasure-goblin canvas").count(), 1);
  });

  console.log("\nRunning past");
  const spawn = () => page.evaluate(() => { spawnTreasureGoblin(); placeTreasureGoblin(); });
  await check("it runs from the enemy side to the player's, across the whole lane", async () => {
    await fresh();
    await spawn();
    const r = await page.evaluate(() => {
      const at = (age) => { treasureGoblin.age = age; return treasureGoblinPoint().x; };
      const first = at(0), mid = at(treasureGoblin.seconds / 2), last = at(treasureGoblin.seconds);
      treasureGoblin.age = 0;
      return { first, mid, last, left: laneRect.x, right: laneRect.x + laneRect.w };
    });
    assert.ok(r.first > r.right && r.last < r.left, JSON.stringify(r));
    assert.ok(r.mid < r.first && r.mid > r.last);
    await page.evaluate(() => { treasureGoblin.age = treasureGoblin.seconds * 0.45; placeTreasureGoblin(); });
    await page.waitForTimeout(40);
    await page.screenshot({ path: path.join(scratch, "treasure-goblin.png") });
  });
  await check("missing it costs nothing, and says it got away", async () => {
    await fresh();
    await spawn();
    const r = await page.evaluate(() => {
      updateTreasureGoblin(treasureGoblin.seconds - 0.1);
      const still = Boolean(treasureGoblin);
      updateTreasureGoblin(0.2);
      return { still, gone: treasureGoblin === null, coins: runBonusCoins, tray: gearTray.length, toast: document.getElementById("combo-toast").textContent };
    });
    assert.deepEqual(r, { still: true, gone: true, coins: 0, tray: 0, toast: "It got away!" });
    assert.equal(await page.locator("#treasure-goblin").isVisible(), false);
  });
  await check("it uses real time, so double speed doesn't shorten it", async () => {
    await fresh();
    await spawn();
    const r = await page.evaluate(() => { const keep = save.speed; save.speed = 2; const before = treasureGoblin.age; updateFx(1); const moved = treasureGoblin.age - before; save.speed = keep; return moved; });
    assert.ok(Math.abs(r - 1) < 1e-9, String(r));
  });
  await check("it waits for a pause or a tip, and can't be caught during one", async () => {
    await fresh();
    await spawn();
    const r = await page.evaluate(() => {
      const out = {};
      for (const state of ["paused", "tip"]) {
        gameState = state; const before = treasureGoblin.age;
        updateTreasureGoblin(1); catchTreasureGoblin();
        out[state] = { frozen: treasureGoblin?.age === before, coins: runBonusCoins };
      }
      gameState = "playing";
      return out;
    });
    assert.deepEqual(r, { paused: { frozen: true, coins: 0 }, tip: { frozen: true, coins: 0 } });
  });
  await check("it's gone when the wave ends", async () => {
    for (const state of ["choosing", "building", "gameover", "worldclear"]) {
      await fresh();
      await spawn();
      const r = await page.evaluate((st) => { gameState = st; updateTreasureGoblin(0.01); const left = treasureGoblin; gameState = "playing"; return left; }, state);
      assert.equal(r, null, state);
    }
  });
  await check("easy mode gives more time", async () => {
    await fresh();
    await page.evaluate(() => { runEasy = true; spawnTreasureGoblin(); });
    assert.equal(await page.evaluate(() => treasureGoblin.seconds), 6.5);
    await page.evaluate(() => { runEasy = false; });
  });

  console.log("\nCatching it");
  await check("a real tap on it catches it", async () => {
    await fresh();
    await spawn();
    const p = await page.evaluate(() => { treasureGoblin.age = treasureGoblin.seconds / 2; placeTreasureGoblin(); const b = document.getElementById("treasure-goblin").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; });
    assert.ok(p.w >= 44, "easy to hit");
    const before = await page.evaluate(() => statValue("goblins"));
    await page.mouse.click(p.x, p.y);
    const r = await page.evaluate(() => ({ gone: treasureGoblin === null, got: runBonusCoins + gearTray.length, stat: statValue("goblins") }));
    assert.equal(r.gone, true);
    assert.ok(r.got >= 1, "got something");
    assert.equal(r.stat, before + 1);
    assert.equal(await page.locator("#treasure-goblin").isVisible(), false);
  });
  await check("it can carry coins, from 5 to 10", async () => {
    await fresh();
    await spawn();
    const low = await rigged([0.5, 0], "catchTreasureGoblin(); return [runBonusCoins, gearTray.length, document.getElementById('combo-toast').textContent];");
    assert.deepEqual(low, [5, 0, "Treasure! +5 coins"]);
    await fresh();
    await spawn();
    assert.equal(await rigged([0.5, 0.999], "catchTreasureGoblin(); return runBonusCoins;"), 10);
  });
  await check("it can carry a gear, which flies to the tray", async () => {
    await page.waitForFunction(() => !document.querySelector(".gear-flyer"));
    await fresh();
    await spawn();
    const r = await rigged([0], "catchTreasureGoblin(); return { tray: gearTray.length, level: gearTray[0].level, coins: runBonusCoins, flyers: document.querySelectorAll('.gear-flyer').length };");
    assert.deepEqual(r, { tray: 1, level: 1, coins: 0, flyers: 1 });
  });
  await check("with a full tray it pays coins instead", async () => {
    await fresh();
    await page.evaluate(() => { gearTray = Array.from({ length: TRAY_SLOTS }, () => ({ type: "soldier", level: 1 })); });
    await spawn();
    const r = await rigged([0, 0], "catchTreasureGoblin(); return { tray: gearTray.length, coins: runBonusCoins };");
    assert.deepEqual(r, { tray: 5, coins: 5 });
  });
  await check("catching one twice in one go only pays once", async () => {
    await fresh();
    await spawn();
    const r = await rigged([0.5, 0], "catchTreasureGoblin(); catchTreasureGoblin(); return runBonusCoins;");
    assert.equal(r, 5);
  });
  await check("the coins really reach the player at the end of the run", async () => {
    await fresh();
    await spawn();
    const r = await rigged([0.5, 0], "const before = coinsForRun(); catchTreasureGoblin(); return coinsForRun() - before;");
    assert.ok(r >= 5, String(r));
  });
  await check("catching 10 earns the achievement", async () => {
    const r = await page.evaluate(() => { const coins = save.coins; delete save.achievements.goblins10; save.stats.goblins = 9; recordStat("goblins"); return { got: Boolean(save.achievements.goblins10), paid: save.coins - coins }; });
    assert.deepEqual(r, { got: true, paid: 40 });
  });

  console.log("\nReloading");
  await check("reloading can't bring one back or lose one still to come", async () => {
    await fresh();
    await page.evaluate(() => { treasureAt = 7; });
    let snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    assert.equal(snap.numbers.treasureAt, 7);
    assert.equal(await page.evaluate((d) => isValidRunSave(d), snap), true);
    assert.equal(await page.evaluate((d) => { treasureAt = -1; restoreRun(d); return treasureAt; }, snap), 7);
    await fresh();
    await spawn();
    snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    assert.equal(snap.numbers.treasureAt, -1, "spent once it has appeared");
    const r = await page.evaluate((d) => { restoreRun(d); return [treasureAt, treasureGoblin]; }, snap);
    assert.deepEqual(r, [-1, null]);
    assert.equal(await page.locator("#treasure-goblin").isVisible(), false);
  });
  await check("older saves still load", async () => {
    await fresh();
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    delete snap.numbers.treasureAt;
    assert.equal(await page.evaluate((d) => isValidRunSave(d), snap), true);
    assert.equal(await page.evaluate((d) => { treasureAt = 9; restoreRun(d); return treasureAt; }, snap), -1);
  });
  await check("a new run starts with no goblin", async () => {
    await fresh();
    await spawn();
    const r = await page.evaluate(() => { startChosenRun({ world: 0 }); return [treasureGoblin, treasureAt]; });
    assert.deepEqual(r, [null, -1]);
  });

  console.log("\nOn the screen");
  for (const [w, h] of [[320, 568], [390, 844]]) {
    await check(`it runs in the battle at ${w}x${h}, without widening the page`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      await fresh();
      await spawn();
      const r = await page.evaluate(() => {
        treasureGoblin.age = treasureGoblin.seconds / 2; placeTreasureGoblin();
        const b = document.getElementById("treasure-goblin").getBoundingClientRect();
        const lane = document.getElementById("battle-lane").getBoundingClientRect();
        return { overlaps: b.bottom > lane.top && b.top < lane.bottom, scroll: document.documentElement.scrollWidth - innerWidth, midX: b.left + b.width / 2, laneMid: lane.left + lane.width / 2 };
      });
      assert.equal(r.overlaps, true);
      assert.equal(r.scroll, 0);
      assert.ok(Math.abs(r.midX - r.laneMid) < 3, JSON.stringify(r));
      await page.evaluate(() => { treasureGoblin.age = 0; placeTreasureGoblin(); });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, "at the edge too");
      await page.evaluate(() => clearTreasureGoblin());
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await check("a tip stays on top of it, and taps go to the tip", async () => {
    await fresh();
    await spawn();
    const r = await page.evaluate(() => {
      const z = (id) => Number(getComputedStyle(document.getElementById(id)).zIndex);
      return { goblin: z("treasure-goblin"), tip: z("tip-screen") };
    });
    assert.ok(r.goblin < r.tip, JSON.stringify(r));
    await page.evaluate(() => clearTreasureGoblin());
  });
  await check("played for real: it comes when due, the tip explains it, then a tap catches it", async () => {
    await fresh();
    const stat = await page.evaluate(() => { delete save.tips.treasureGoblin; waveTime = 3; treasureAt = 3.05; return statValue("goblins"); });
    await page.waitForFunction(() => gameState === "tip" && openTip?.id === "treasureGoblin", null, { timeout: 5000 });
    assert.equal(await page.locator("#tip-screen").isVisible(), true);
    const shown = await page.evaluate(() => { const b = document.getElementById("treasure-goblin").getBoundingClientRect(); const lane = document.getElementById("battle-lane").getBoundingClientRect(); return b.left >= lane.left && b.right <= lane.right; });
    assert.equal(shown, true, "the goblin the tip points to is on the screen");
    await page.screenshot({ path: path.join(scratch, "treasure-goblin-tip.png") });
    await page.waitForTimeout(450);
    await page.evaluate(() => closeTip());
    assert.equal(await page.evaluate(() => gameState), "playing");
    assert.notEqual(await page.evaluate(() => treasureGoblin), null, "still there after the tip");
    const p = await page.evaluate(() => { const b = document.getElementById("treasure-goblin").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await page.mouse.click(p.x, p.y);
    assert.equal(await page.evaluate(() => statValue("goblins")), stat + 1);
    assert.equal(await page.evaluate(() => treasureGoblin), null);
  });
  await check("the first sighting explains it", async () => {
    await fresh();
    await spawn();
    const r = await page.evaluate(() => {
      const tip = TIPS.find((x) => x.id === "treasureGoblin");
      treasureGoblin.age = 0; const tooSoon = Boolean(tip.when());
      treasureGoblin.age = GOBLIN_TIP_AGE + 0.1; const shows = Boolean(tip.when());
      clearTreasureGoblin();
      return { tooSoon, shows, hides: Boolean(tip.when()), urgent: tip.urgent, target: tip.target };
    });
    assert.deepEqual(r, { tooSoon: false, shows: true, hides: false, urgent: true, target: "#treasure-goblin" });
  });

  console.log("\nThai");
  await check("everything it says has Thai", async () => {
    const tip = await page.evaluate(() => TIPS.find((x) => x.id === "treasureGoblin").text);
    await page.evaluate(() => { save.lang = "th"; writeSave(); });
    await page.goto(url);
    const left = await page.evaluate((text) => [text, "Treasure goblin", "Sometimes runs past carrying coins or a gear. Tap it before it escapes.", "It got away!", "Treasure! Free gear", "Treasure! +7 coins", "Gotcha!", "Catch 10 treasure goblins"].filter((x) => /[A-Za-z]/.test(t(x))), tip);
    assert.deepEqual(left, []);
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
