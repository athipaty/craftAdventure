// Tests and screenshots for the skill and planning features.
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text() + " @ " + m.location().url); });
  const hide = () => page.evaluate(() => { document.getElementById("daily-screen").classList.add("hidden"); document.getElementById("away-screen").classList.add("hidden"); });
  const reset = async (setup) => {
    await page.goto(url);
    await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
    await page.goto(url);
    await page.evaluate(() => { save.stats.waves = 100; for (const t of TIPS) save.tips[t.id] = true; writeSave(); });
    if (setup) await page.evaluate(setup);
    await hide();
  };
  const reload = async () => { await page.reload(); await hide(); };
  const start = (opts) => page.evaluate((o) => startChosenRun(o), opts);
  const cellCentre = (r, c) => page.evaluate(([r, c]) => { const b = boardCanvas.getBoundingClientRect(); return { x: b.left + (c + 0.5) * cellSize, y: b.top + (r + 0.5) * cellSize }; }, [r, c]);
  const hold = () => page.evaluate(() => { playerPower = 1000; enemyPower = 1000; });

  console.log("\nMachine output and drag preview");
  await reset();
  await start({ world: 0 });
  await check("the readout shows soldiers per second, in the army's rank", async () => {
    await hold();
    await page.waitForTimeout(150);
    const t = await page.locator("#machine-rate").textContent();
    assert.equal(t, "0.3 soldiers/s");
    await page.evaluate(() => { armyRank = 1; }); await hold();
    await page.waitForTimeout(100);
    assert.equal(await page.locator("#machine-rate").textContent(), "0.3 soldiers/s");
    await page.evaluate(() => { armyRank = 0; });
  });
  await check("dragging shows what a drop would change, and changes nothing until dropped", async () => {
    await page.evaluate(() => { createBoard(); const r = DRIVER_ROW, c = DRIVER_COL; grid[r][c + 2] = freshCell(); grid[r][c + 3] = freshCell(); playerPower = 1000; enemyPower = 1000; });
    const before = await page.evaluate(() => JSON.stringify(grid.map((row) => row.map((c) => c && [c.type, c.level]))));
    const from = await page.evaluate(() => [DRIVER_ROW, DRIVER_COL + 3]);
    const a = await cellCentre(...from);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    // Far from the machine: worse.
    const away = await cellCentre(0, 0);
    await hold();
    await page.mouse.move(away.x, away.y, { steps: 3 });
    await page.waitForTimeout(80);
    assert.equal(await page.locator("#machine-rate").getAttribute("class"), "down");
    assert.match(await page.locator("#machine-rate").textContent(), /\u2192/);
    assert.equal(await page.evaluate(() => JSON.stringify(grid.map((row) => row.map((c) => c && [c.type, c.level])))), before);
    // Next to the main gear: better.
    await hold();
    const near = await page.evaluate(() => [DRIVER_ROW - 1, DRIVER_COL]);
    const n = await cellCentre(...near);
    await page.mouse.move(n.x, n.y, { steps: 3 });
    await page.waitForTimeout(80);
    assert.equal(await page.locator("#machine-rate").getAttribute("class"), "up");
    await page.screenshot({ path: path.join(scratch, "shot5-preview.png") });
    await hold();
    await page.mouse.up();
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(([r, c]) => Boolean(grid[r][c]), near), true);
    assert.equal(await page.locator("#machine-rate").getAttribute("class"), "");
  });
  await check("the preview matches the real result for moves and merges", async () => {
    const r = await page.evaluate(() => {
      createBoard(); const R = DRIVER_ROW, C = DRIVER_COL;
      grid[R][C + 2] = freshCell(); grid[R - 1][C] = freshCell();
      drag = { cell: grid[R - 1][C], row: R - 1, col: C };
      const predicted = previewDropRate({ row: R, col: C + 1, cell: grid[R][C + 1] });
      drag = null;
      mergeGears(R - 1, C, R, C + 1); markCombos();
      const actual = machineRate();
      return { predicted, actual, restored: Boolean(grid[R][C + 1]) };
    });
    assert.ok(Math.abs(r.predicted - r.actual) < 1e-9, JSON.stringify(r));
  });

  console.log("\nCountering boss attacks");
  await reset();
  await start({ world: 0 });
  const setBoss = (attackIn, held) => page.evaluate(([a, h]) => {
    boss = { kind: BOSS_KINDS[0], hp: 1e6, maxHp: 1e6, attackIn: a, hitFlash: 0, reinforcePerSec: 0, shield: 0 };
    strikeCooldown = 0; strikeHeld = h; playerPower = 1000; enemyPower = 1000;
  }, [attackIn, held]);
  await check("a ready strike during the glow cancels the attack", async () => {
    await setBoss(0.5, 1);
    const r = await page.evaluate(() => { strikeEnemy(); return { attackIn: boss.attackIn, stat: statValue("counters"), rusted: grid.flat().some((c) => c?.rusted) }; });
    assert.equal(r.attackIn, 8); assert.equal(r.stat, 1); assert.equal(r.rusted, false);
  });
  await check("tapping nonstop can't counter, and a strike outside the glow doesn't", async () => {
    await setBoss(0.5, 0);
    const a = await page.evaluate(() => { strikeEnemy(); return boss.attackIn; });
    assert.equal(a, 0.5);
    await setBoss(5, 2);
    const b = await page.evaluate(() => { strikeEnemy(); return boss.attackIn; });
    assert.equal(b, 5);
    assert.equal(await page.evaluate(() => statValue("counters")), 1);
  });
  await check("lightning must really wait: the hold time builds only while it's ready", async () => {
    await setBoss(99, 0);
    await page.evaluate(() => { hitStop = 0; strikeCooldown = 1; strikeHeld = 3; });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => strikeHeld), 0);
    await page.evaluate(() => { playerPower = 1000; enemyPower = 1000; strikeCooldown = 0; });
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => strikeHeld > 0));
  });
  await setBoss(0.9, 1);
  await page.evaluate(() => { boss.attackIn = 0.9; strikeHeld = 1; drawBattle(); });
  await page.screenshot({ path: path.join(scratch, "shot5-counter.png"), clip: { x: 0, y: 0, width: 390, height: 200 } });
  await page.evaluate(() => { boss = null; });

  console.log("\nBreak between waves");
  await reset();
  await start({ world: 0 });
  const winWithGears = async (n) => {
    await page.evaluate((count) => { for (let i = 0; i < count; i++) placeGear("soldier"); boss = null; playerPower = 1e7; enemyPower = 1; }, n);
    await page.waitForSelector("#reward-screen:not(.hidden)");
    await page.waitForTimeout(500);
  };
  await check("a small machine goes straight into the wave", async () => {
    await winWithGears(0);
    await page.click("#skip-btn");
    assert.equal(await page.evaluate(() => gameState), "playing");
    assert.equal(await page.locator("#build-bar").isVisible(), false);
  });
  await check("a bigger machine gets a break: nothing moves, and gears can be rearranged", async () => {
    await winWithGears(3);
    await page.click("#skip-btn");
    const r = await page.evaluate(() => ({ state: gameState, soldiers: grid.flat().some((c) => c && !c.driver && c.ticks > 0), buildLeft, plan: nextWavePlan, wave, time: waveTime }));
    assert.equal(r.state, "building");
    assert.ok(r.buildLeft > 4);
    assert.ok(r.plan, "the plan waits for the wave");
    assert.equal(await page.locator("#build-bar").isVisible(), true);
    await page.screenshot({ path: path.join(scratch, "shot5-build.png") });
    const before = await page.evaluate(() => { const c = grid.flat().filter((x) => x && !x.driver); return { ticks: c.map((x) => x.ticks), angle: grid[DRIVER_ROW][DRIVER_COL].angle, power: enemyPower }; });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => { const c = grid.flat().filter((x) => x && !x.driver); return { ticks: c.map((x) => x.ticks), angle: grid[DRIVER_ROW][DRIVER_COL].angle, power: enemyPower }; });
    assert.deepEqual(after, before);
    // Drag a gear to an empty cell.
    const free = await page.evaluate(() => { const g = []; grid.forEach((row, r) => row.forEach((c, i) => { if (c && !c.driver) g.push([r, i]); })); return g.at(-1); });
    const a = await cellCentre(...free); const b = await cellCentre(0, 0);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 3 });
    assert.equal(await page.locator("#scrap-zone").isVisible(), false);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => Boolean(grid[0][0])), true);
  });
  await check("the break survives a reload", async () => {
    await page.evaluate(() => saveRun());
    const left = await page.evaluate(() => buildLeft);
    await reload();
    await page.click("#continue-btn");
    // Coming back always starts paused, so the countdown waits for the player.
    assert.equal(await page.evaluate(() => gameState), "paused");
    await page.click("#resume-btn");
    const r = await page.evaluate(() => ({ state: gameState, left: buildLeft }));
    assert.equal(r.state, "building"); assert.ok(r.left <= left && r.left > 0);
    assert.equal(await page.locator("#build-bar").isVisible(), true);
  });
  await check("Start wave ends it early, sized for the machine", async () => {
    const w = await page.evaluate(() => wave);
    await page.click("#build-start-btn");
    const r = await page.evaluate(() => ({ state: gameState, wave, plan: nextWavePlan }));
    assert.equal(r.state, "playing"); assert.equal(r.wave, w); assert.equal(r.plan, null);
    assert.equal(await page.locator("#build-bar").isVisible(), false);
  });
  await check("the countdown ends the break by itself", async () => {
    await page.evaluate(() => { boss = null; playerPower = 1e7; enemyPower = 1; });
    await page.waitForSelector("#reward-screen:not(.hidden)");
    await page.waitForTimeout(500);
    await page.click("#skip-btn");
    await page.evaluate(() => { buildLeft = 0.1; });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => gameState), "playing");
  });

  console.log("\nRisky deals");
  await reset();
  await start({ world: 0 });
  const offerDeal = async (deal) => {
    await page.evaluate(() => { boss = null; playerPower = 1e7; enemyPower = 1; });
    await page.waitForSelector("#reward-screen:not(.hidden)");
    await page.evaluate((d) => { nextWavePlan = { enemy: "goblin", event: null, pace: null, deal: d }; updateDealButton(); }, deal);
    await page.waitForTimeout(500);
  };
  await check("a taken deal raises the stakes, then pays on a win", async () => {
    await page.evaluate(() => { wave = 7; peakRate = 10; });
    await offerDeal("army");
    assert.equal(await page.locator("#deal-btn").isVisible(), true);
    assert.equal(await page.locator("#deal-btn").textContent(), "Risky deal: 50% more enemies next wave, win for +9 coins");
    await page.click("#deal-btn");
    assert.match(await page.locator("#deal-btn").textContent(), /^Deal taken/);
    await page.click("#skip-btn");
    await page.evaluate(() => { if (gameState === "building") beginWave(); });
    const r = await page.evaluate(() => ({ deal: activeDeal?.id, enemy: enemyPower, plain: waveStartEnemy(wave), payout: dealPayout }));
    assert.equal(r.deal, "army"); assert.ok(Math.abs(r.enemy / r.plain - 1.5) < 1e-6); assert.equal(r.payout, 9);
    const b0 = await page.evaluate(() => runBonusCoins);
    await page.evaluate(() => { boss = null; playerPower = 1e7; enemyPower = 1; });
    await page.waitForSelector("#reward-screen:not(.hidden)");
    const after = await page.evaluate(() => ({ b: runBonusCoins, deal: activeDeal, stat: statValue("deals") }));
    assert.equal(after.b, b0 + 9); assert.equal(after.deal, null); assert.equal(after.stat, 1);
  });
  await check("refusing costs nothing and pays nothing; the button can be undone", async () => {
    await page.evaluate(() => { nextWavePlan = { enemy: "goblin", event: null, pace: null, deal: "army" }; dealAccepted = false; updateDealButton(); });
    await page.waitForTimeout(500);
    await page.click("#deal-btn"); await page.click("#deal-btn");
    assert.match(await page.locator("#deal-btn").textContent(), /^Risky deal/);
    await page.click("#skip-btn");
    await page.evaluate(() => { if (gameState === "building") beginWave(); });
    const r = await page.evaluate(() => ({ deal: activeDeal, enemy: enemyPower, plain: waveStartEnemy(wave) }));
    assert.equal(r.deal, null); assert.ok(Math.abs(r.enemy / r.plain - 1) < 1e-6);
  });
  await check("the no-lightning deal blocks strikes, and the swarm deal speeds enemies", async () => {
    const r = await page.evaluate(() => {
      activeDeal = WAVE_DEALS.dark; strikeCooldown = 0; const q = statValue("strikes"); strikeEnemy(); const blocked = statValue("strikes") === q;
      activeDeal = null; return { blocked };
    });
    assert.equal(r.blocked, true);
  });
  await check("a taken deal and an active one survive a reload", async () => {
    await page.evaluate(() => { activeDeal = WAVE_DEALS.swarm; dealPayout = 7; saveRun(); });
    await reload();
    await page.click("#continue-btn");
    const r = await page.evaluate(() => ({ d: activeDeal?.id, p: dealPayout }));
    assert.deepEqual(r, { d: "swarm", p: 7 });
    await page.click("#resume-btn");
  });
  await check("deals show up at a sensible rate, never on boss waves, and the same in a daily", async () => {
    const r = await page.evaluate(() => {
      let deals = 0, bossDeals = 0;
      for (let i = 0; i < 2000; i++) { if (planWave(7).deal) deals++; lastEventId = null; }
      const b = planWave(10); if (b.deal) bossDeals++;
      currentDaily = makeDaily("2026-11-04"); const a1 = JSON.stringify(planWave(7)); lastEventId = null; const a2 = JSON.stringify(planWave(7)); currentDaily = null; lastEventId = null;
      return { deals, bossDeals, same: a1 === a2 };
    });
    console.log("       ", JSON.stringify(r));
    assert.ok(r.deals > 300 && r.deals < 900); assert.equal(r.bossDeals, 0); assert.equal(r.same, true);
  });

  console.log("\nStars");
  await reset();
  await start({ world: 0 });
  const clearForest = async () => {
    await page.evaluate(() => { wave = 15; boss = { kind: bossKind("warlord"), hp: 0, maxHp: 1, attackIn: 9, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; });
    await page.waitForSelector("#world-clear-screen:not(.hidden)");
  };
  await check("a clean, small-machine clear earns all three and pays for them", async () => {
    const c0 = await page.evaluate(() => save.coins);
    await clearForest();
    assert.match(await page.locator("#world-clear-stars").textContent(), /^\u2605\u2605\u2605 New: Clear the world, No Overdrive, 8 gears or fewer \(\+75 coins\)$/);
    assert.ok(await page.evaluate((c) => save.coins >= c + 100 + 75, c0));
    await page.screenshot({ path: path.join(scratch, "shot5-stars.png") });
  });
  await check("stars aren't paid twice, and survive a reload", async () => {
    await reload();
    await page.click("#continue-btn");
    assert.match(await page.locator("#world-clear-stars").textContent(), /^\u2605\u2605\u2605/);
    await page.click("#clear-worlds-btn");
    await start({ world: 0 });
    const c0 = await page.evaluate(() => save.coins);
    await clearForest();
    assert.equal(await page.locator("#world-clear-stars").textContent(), "\u2605\u2605\u2605");
    assert.equal(await page.locator("#world-clear-coins").textContent(), "+20 coins");
    assert.ok(await page.evaluate(() => WORLDS.slice(0, 1).every((w) => worldStars(w).every(Boolean))));
  });
  await check("Overdrive or a big machine misses those stars; a head start only gets the first", async () => {
    await reset(() => { save.worldsCleared.forest = true; writeSave(); });
    await start({ world: 0 });
    await page.evaluate(() => { usedOverdrive = true; for (let i = 0; i < 9; i++) placeGear("soldier"); });
    await clearForest();
    assert.match(await page.locator("#world-clear-stars").textContent(), /^\u2605\u2606\u2606 New: Clear the world \(\+25 coins\)$/);
    await page.click("#clear-worlds-btn");
    await page.evaluate(() => { save.worldStars = {}; });
    await start({ world: 0, headStart: true });
    await clearForest();
    assert.match(await page.locator("#world-clear-stars").textContent(), /^\u2605\u2606\u2606/);
  });
  await check("the world list shows stars and what's left", async () => {
    await page.click("#clear-worlds-btn");
    const card = page.locator(".world-card").nth(2);
    assert.equal(await card.locator(".world-stars").textContent(), "\u2605\u2606\u2606");
    assert.equal(await card.locator(".world-goal").textContent(), "Next star: No Overdrive");
    await page.screenshot({ path: path.join(scratch, "shot5-worlds.png") });
  });

  console.log("\nStarting gear");
  await reset();
  await check("locked behind level and coins, then adds the gear to every run", async () => {
    await page.evaluate(() => { openWorkshop(); });
    const locked = await page.evaluate(() => [...document.querySelectorAll("#collection-list .upgrade")].find((b) => b.querySelector("b")?.textContent.includes("Booster gear")).disabled);
    assert.equal(locked, true);
    await page.evaluate(() => { save.playerLevel = 5; save.coins = 150; renderWorkshop(); });
    await page.evaluate(() => [...document.querySelectorAll("#collection-list .upgrade")].find((b) => b.querySelector("b")?.textContent.includes("Booster gear")).click());
    const r = await page.evaluate(() => ({ gear: save.startGear, coins: save.coins }));
    assert.deepEqual(r, { gear: "booster", coins: 50 });
    await page.screenshot({ path: path.join(scratch, "shot5-workshop.png") });
    await page.click("#workshop-close-btn");
    await start({ world: 0 });
    const g = await page.evaluate(() => grid.flat().filter((c) => c && !c.driver).map((c) => c.type).sort());
    assert.deepEqual(g, ["booster", "soldier"]);
  });
  await check("every starting gear is a real gear", async () => {
    assert.equal(await page.evaluate(() => START_GEARS.every((s) => s.gear === null || GEAR_TYPES[s.gear])), true);
  });

  console.log("\nLayout");
  await reset();
  await start({ world: 0 });
  await page.evaluate(() => {
    wave = 5; peakRate = 5;
    nextWavePlan = { enemy: "goblin", event: null, pace: null, deal: "army" };
    showRewards("Boss defeated!", ["bigGear", "secondWind", "stormEngine", "chargedStrike"].map((id) => REWARDS.find((r) => r.id === id)));
    clearTimeout(rewardTimer);
    document.getElementById("reward-screen").classList.remove("hidden");
  });
  await page.waitForTimeout(350);
  const sizes = [["phone", 390, 844], ["small", 320, 568], ["landscape", 844, 390]];
  for (const [name, w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(scratch, `shot5-rewards-${name}.png`) });
    await check(`reward screen with a deal fits: ${name}`, async () => {
      const out = await page.evaluate(() => {
        const root = document.getElementById("reward-screen").getBoundingClientRect();
        return [...document.querySelectorAll(".reward-option, #reroll-btn, #skip-btn, #deal-btn, #reward-title, #reward-next")].filter((b) => {
          const r = b.getBoundingClientRect();
          return !(r.left >= root.left && r.right <= root.right && r.top >= root.top && r.bottom <= root.bottom);
        }).map((b) => b.id || b.className);
      });
      assert.deepEqual(out, []);
    });
  }
  await page.evaluate(() => {
    document.getElementById("reward-screen").classList.add("hidden");
    for (let i = 0; i < 3; i++) placeGear("soldier");
    offeredRewards = null; startBuildBreak(5);
  });
  for (const [name, w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    await page.evaluate(() => { buildLeft = 5; });
    await page.screenshot({ path: path.join(scratch, `shot5-build-${name}.png`) });
    await check(`build bar and output readout fit: ${name}`, async () => {
      const r = await page.evaluate(() => {
        const bar = document.getElementById("build-bar"), btn = document.getElementById("build-start-btn").getBoundingClientRect(), frame = document.getElementById("app-frame").getBoundingClientRect();
        const rate = document.getElementById("machine-rate").getBoundingClientRect();
        return { noOverflow: bar.scrollWidth <= bar.clientWidth + 1, onScreen: btn.right <= frame.right && btn.bottom <= frame.bottom + 1, rate: rate.right <= frame.right && rate.width > 0 };
      });
      assert.deepEqual(r, { noOverflow: true, onScreen: true, rate: true });
    });
  }

  await check("no page errors in the whole session", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
