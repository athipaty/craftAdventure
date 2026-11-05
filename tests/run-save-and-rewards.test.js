const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const scratch = path.join(__dirname, "screenshots");
fs.mkdirSync(scratch, { recursive: true });
const root = path.join(__dirname, "..", "public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
    res.end(data);
  });
});

let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log("  ok  ", name); }
  catch (e) { failures.push(name); console.log("  FAIL", name, "\n      ", e.message.split("\n").slice(0, 6).join("\n       ")); }
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text()); });

  const visible = (sel) => page.locator(sel).isVisible();
  const reset = async () => {
    await page.goto(url);
    await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
    await page.goto(url);
    await page.evaluate(() => {
      save.stats.waves = 100; for (const t of TIPS) save.tips[t.id] = true;
      save.dailyClaimedOn = todayKey();
      writeSave();
      document.getElementById("daily-screen").classList.add("hidden");
    });
  };
  const reload = async () => {
    await page.reload();
    await page.evaluate(() => document.getElementById("daily-screen").classList.add("hidden"));
  };
  const snap = () => page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));

  console.log("\nRun save");
  await reset();
  await check("fresh game has no Continue button", async () => {
    assert.equal(await visible("#continue-btn"), false);
    assert.equal(await page.locator("#play-btn").textContent(), "Play game");
  });

  await page.click("#play-btn");
  await check("starting a run saves it straight away", async () => {
    assert.ok(await page.evaluate(() => localStorage.getItem("gearfight_run")));
  });

  // A rich mid-wave state: boss, rust, blocked cells, parts, marchers, rally.
  await page.evaluate(() => {
    wave = 10; bossesBeaten = 1; runTime = 123; armyRank = 1; peakRate = 9;
    placeGear("big"); placeGear("bomb"); placeGear("booster");
    placeGear("soldier").level = 3;
    const r = grid.flat().find((c) => c && !c.driver && c.type === "soldier"); r.rusted = true; r.ticks = 2;
    blockedCells.add("0,0");
    boss = { kind: BOSS_KINDS[1], hp: 500, maxHp: 900, attackIn: 3, hitFlash: 0, reinforcePerSec: 1.5, shield: 2 };
    marchers.push({ side: "enemy", value: 4, t: 0.5 });
    rallying = true; rallyReserve = 7; rallyHeld = 2;
    runParts = { staticCharge: 2, warChest: 1 };
    usedOverdrive = true; playerPower = 400; enemyPower = 300;
    gameState = "paused";
    saveRun();
    gameState = "playing";
    pauseGame();
  });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("gearfight_run")));
  await reload();
  await check("after closing, title offers Continue with world and wave", async () => {
    assert.equal(await visible("#continue-btn"), true);
    assert.equal(await page.locator("#continue-btn").textContent(), "Continue: Green Forest, wave 10");
    assert.equal(await page.locator("#play-btn").textContent(), "New game (ends this run)");
  });
  await page.screenshot({ path: path.join(scratch, "shot-title.png") });
  await page.click("#continue-btn");
  await check("continuing restores the exact run, paused", async () => {
    assert.equal(await visible("#pause-screen"), true);
    const after = await snap();
    assert.deepEqual(after.grid, before.grid);
    assert.deepEqual(after.numbers, before.numbers);
    assert.deepEqual(after.boss, before.boss);
    assert.deepEqual(after.parts, before.parts);
    assert.deepEqual(after.marchers, before.marchers);
    assert.deepEqual(after.blockedCells, before.blockedCells);
    assert.deepEqual(after.flags, before.flags);
    assert.equal(await page.locator("#wave-num").textContent(), "10");
  });
  await check("pause screen lists the run's parts", async () => {
    assert.equal(await page.locator("#pause-parts").textContent(), "This run: Static charge x2, War chest");
  });
  await page.screenshot({ path: path.join(scratch, "shot-pause.png") });
  await page.click("#resume-btn");
  await check("the game runs on after resuming", async () => {
    const t0 = await page.evaluate(() => { boss.attackIn = 99; return runTime; });
    await page.waitForTimeout(400);
    assert.ok((await page.evaluate(() => runTime)) > t0);
    assert.equal(await page.evaluate(() => gameState), "playing");
  });
  await check("autosave fires during play", async () => {
    await page.evaluate(() => { localStorage.removeItem("gearfight_run"); runSaveIn = 0.05; });
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => localStorage.getItem("gearfight_run")));
  });
  await check("hiding the page pauses and saves", async () => {
    await page.evaluate(() => {
      localStorage.removeItem("gearfight_run");
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      delete document.hidden;
    });
    assert.equal(await page.evaluate(() => gameState), "paused");
    assert.ok(await page.evaluate(() => localStorage.getItem("gearfight_run")));
  });

  await check("giving up a saved run pays its coins once and starts fresh", async () => {
    await reload();
    const coins0 = await page.evaluate(() => save.coins);
    const lvl0 = await page.evaluate(() => save.playerLevel);
    const expected = Math.round((9 * 2 + 1 * 10) * 1.25); // wave 10, 1 boss, War chest
    await page.click("#play-btn");
    assert.equal(await page.evaluate(() => wave), 1);
    assert.deepEqual(await page.evaluate(() => runParts), {});
    const extra = await page.evaluate(() => ({ coins: save.coins, ups: lastRunLevelUps, ach: Object.keys(save.achievements), toast: 0 }));
    const levelCoins = extra.ups.reduce((t, u) => t + u.coins, 0);
    console.log('        coins', extra.coins, 'run', expected, 'level-ups', levelCoins, 'achievements', extra.ach.join());
    const achCoins = await page.evaluate((ids) => ACHIEVEMENTS.filter((a) => ids.includes(a.id)).reduce((t, a) => t + a.coins, 0), extra.ach);
    assert.equal(extra.coins, coins0 + expected + levelCoins + achCoins);
    const fresh = await page.evaluate(() => JSON.parse(localStorage.getItem("gearfight_run")));
    assert.equal(fresh.numbers.wave, 1);
  });

  console.log("\nReward choice across a reload");
  await reset();
  await page.click("#play-btn");
  await page.evaluate(() => { playerPower = 1e6; });
  await page.waitForSelector("#reward-screen:not(.hidden)");
  const offered = await page.evaluate(() => offeredRewards);
  await reload();
  await page.click("#continue-btn");
  await page.waitForSelector("#reward-screen:not(.hidden)");
  await check("the same rewards come back, so reloading can't re-roll", async () => {
    assert.deepEqual(await page.evaluate(() => offeredRewards), offered);
    assert.equal(await page.locator(".reward-option").count(), offered.ids.length);
  });
  await page.waitForTimeout(500);
  await page.locator(".reward-option").first().click();
  await check("picking one starts the next wave", async () => {
    assert.equal(await page.evaluate(() => gameState), "playing");
    assert.equal(await page.evaluate(() => wave), 2);
    assert.equal(await page.evaluate(() => offeredRewards), null);
  });

  console.log("\nGame over");
  await check("losing clears the save, pays once, no Continue after reload", async () => {
    await page.evaluate(() => { enemyPower = 1e6; playerPower = 1; });
    await page.waitForSelector("#gameover-screen:not(.hidden)");
    assert.equal(await page.evaluate(() => localStorage.getItem("gearfight_run")), null);
    await reload();
    assert.equal(await visible("#continue-btn"), false);
  });

  console.log("\nWorld clear across a reload");
  await reset();
  await page.click("#play-btn");
  await page.evaluate(() => {
    wave = 15; bossesBeaten = 2;
    boss = { kind: BOSS_KINDS[0], hp: 0, maxHp: 1, attackIn: 9, hitFlash: 0, reinforcePerSec: 0, shield: 0 };
  });
  await page.waitForSelector("#world-clear-screen:not(.hidden)");
  const coinsAfterClear = await page.evaluate(() => save.coins);
  await reload();
  await page.click("#continue-btn");
  await check("world-clear screen returns and the prize isn't paid twice", async () => {
    assert.equal(await visible("#world-clear-screen"), true);
    assert.equal(await page.evaluate(() => save.coins), coinsAfterClear);
    assert.equal(await page.locator("#world-clear-coins").textContent(), "+100 coins");
  });
  await page.click("#keep-going-btn");
  await page.waitForSelector("#reward-screen:not(.hidden)");
  await check("Keep going still works after a reload", async () => {
    assert.equal(await page.evaluate(() => endless), true);
  });

  console.log("\nBad saves");
  for (const [name, value] of [
    ["broken JSON", "{oops"],
    ["old version", JSON.stringify({ version: 0 })],
    ["wrong board size", null],
  ]) {
    await check(`${name} is ignored`, async () => {
      await reset();
      await page.click("#play-btn");
      const v = value ?? await page.evaluate(() => { const s = runSnapshot(); s.grid.pop(); return JSON.stringify(s); });
      await page.evaluate((text) => { runBanked = true; localStorage.setItem("gearfight_run", text); }, v);
      await page.reload();
      assert.equal(await visible("#continue-btn"), false);
    });
  }

  console.log("\nRewards");
  await reset();
  await page.click("#play-btn");
  await check("every reward has a unique id, name and text", async () => {
    const r = await page.evaluate(() => ({ n: REWARDS.length, ids: new Set(REWARDS.map((x) => x.id)).size, ok: REWARDS.every((x) => x.id && x.name && x.text && (x.gear || x.apply || x.max)) }));
    console.log("        total rewards:", r.n);
    assert.equal(r.ids, r.n); assert.ok(r.ok);
  });
  await check("rarity odds: common > rare > epic; bosses are luckier; every offer has no repeats", async () => {
    const r = await page.evaluate(() => {
      placeGear("big"); placeGear("bomb"); placeGear("booster");
      const count = (lucky) => {
        const c = { common: 0, rare: 0, epic: 0 }, seen = new Set(); let dup = 0;
        for (let i = 0; i < 20000; i++) {
          const p = pickRewards(lucky);
          if (new Set(p).size !== p.length) dup++;
          for (const x of p.slice(1)) { c[rewardRarity(x)]++; seen.add(x.id); }
        }
        return { c, seen: seen.size, dup };
      };
      return { normal: count(false), lucky: count(true) };
    });
    console.log("        normal", JSON.stringify(r.normal.c), " boss", JSON.stringify(r.lucky.c));
    assert.ok(r.normal.c.common > r.normal.c.rare && r.normal.c.rare > r.normal.c.epic);
    assert.ok(r.lucky.c.epic > r.normal.c.epic * 1.5);
    assert.equal(r.normal.dup + r.lucky.dup, 0);
  });
  await check("max limits and availability are respected", async () => {
    const r = await page.evaluate(() => {
      const byId = (id) => REWARDS.find((x) => x.id === id);
      runParts.scrapDealer = 1;
      const a = rewardIsOpen(byId("scrapDealer"));
      runParts = {};
      armyRank = ARMY_RANKS.length - 1;
      const b = rewardIsOpen(byId("promotion")), c = rewardIsOpen(byId("drillManual"));
      armyRank = 0;
      currentWorld = 0;
      const d = rewardIsOpen(byId("piercing"));
      currentWorld = 1;
      const e = rewardIsOpen(byId("piercing"));
      currentWorld = 0;
      return [a, b, c, d, e];
    });
    assert.deepEqual(r, [false, false, false, false, true]);
  });
  await check("each effect does what its card says", async () => {
    const r = await page.evaluate(() => {
      const out = {};
      const take = (id) => chooseReward(REWARDS.find((x) => x.id === id));
      const fresh = () => { runParts = {}; armyRank = 0; createBoard(); };
      fresh();
      for (let i = 0; i < 12; i++) placeGear("soldier");
      const s0 = scrapRefund();
      runParts.scrapDealer = 1; out.scrap = [s0, scrapRefund()]; fresh();
      const cost0 = trainCost(); runParts.drillManual = 1; out.train = [cost0, trainCost()]; fresh();
      const rr = strikeRecharge(); runParts.stormEngine = 1; overdriveLeft = 1; out.storm = [rr, strikeRecharge()]; overdriveLeft = 0; fresh();
      const od = overdriveRecharge(); runParts.cooling = 1; out.cool = [od, overdriveRecharge()]; fresh();
      out.rally = [rallyBonus()]; runParts.warDrums = 1; out.rally.push(rallyBonus()); fresh();
      out.rust = [rustPerAttack(20)]; runParts.thickOil = 2; out.rust.push(rustPerAttack(20)); fresh();
      out.combo = [comboLinePayout(), comboBlockFill()]; runParts.patterns = 1; out.combo.push(comboLinePayout(), comboBlockFill()); fresh();
      // Big gear payout
      grid[DRIVER_ROW][DRIVER_COL + 1] = freshCell("big");
      const b0 = soldiersPerSecond(); runParts.heavyLoad = 1; out.big = soldiersPerSecond() / b0; fresh();
      grid[DRIVER_ROW][DRIVER_COL + 1] = freshCell("bomb");
      const m0 = soldiersPerSecond(); runParts.demolition = 1; out.bomb = soldiersPerSecond() / m0; fresh();
      // Booster
      grid[DRIVER_ROW][DRIVER_COL + 2] = freshCell("booster");
      const t0 = boostersTouching(DRIVER_ROW, DRIVER_COL + 1); runParts.turbo = 1; out.turbo = [t0, boostersTouching(DRIVER_ROW, DRIVER_COL + 1)]; fresh();
      // Chain
      for (let c = 0; c <= 2; c++) grid[0 + 3][DRIVER_COL + 1 + c] = grid[3][DRIVER_COL + 1 + c] || freshCell();
      const far = (l) => l.find((g) => g.col === DRIVER_COL + 3).power;
      const c0 = far(connectedGears(DRIVER_ROW, DRIVER_COL + 1, 1)); runParts.longChain = 1; out.chain = [c0, far(connectedGears(DRIVER_ROW, DRIVER_COL + 1, 1))]; fresh();
      // Boss damage
      boss = { kind: BOSS_KINDS[0], hp: 1000, maxHp: 1000, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0 };
      damageBoss(100); const h0 = boss.hp; runParts.bossHunter = 1; damageBoss(100); out.boss = [1000 - h0, h0 - boss.hp]; boss = null; fresh();
      // Coins
      wave = 11; bossesBeaten = 2; const coin0 = coinsForRun(); runParts.warChest = 1; out.coins = [coin0, coinsForRun()]; wave = 1; bossesBeaten = 0; fresh();
      // Blast cleaner
      grid[DRIVER_ROW][DRIVER_COL + 1].rusted = true; runParts.blastCleaner = 1; launchBomb(1); out.cleaned = !grid[DRIVER_ROW][DRIVER_COL + 1].rusted; marchers = []; fresh();
      // Charged strike fills connected gears
      strikeCooldown = 0; runParts.chargedStrike = 1; const cell = grid[DRIVER_ROW][DRIVER_COL + 1]; const tk = cell.ticks; strikeEnemy(); out.charged = cell.ticks - tk; marchers = []; fresh();
      // Forge bonus
      grid[DRIVER_ROW][DRIVER_COL + 2] = freshCell(); runParts.forgeBonus = 1; marchers = []; mergeGears(DRIVER_ROW, DRIVER_COL + 2, DRIVER_ROW, DRIVER_COL + 1); out.forge = marchers.filter((m) => m.side === "player").length; marchers = []; fresh();
      // One-offs through the real choice flow
      gameState = "choosing"; take("forgedGear"); out.forged = grid.flat().some((c) => c && !c.driver && c.level === 3); out.forgedListed = partCount("forgedGear");
      gameState = "choosing"; take("promotion"); out.rank = armyRank;
      gameState = "choosing"; const d0 = driverTurnsPerSec; take("clockwork"); out.clock = driverTurnsPerSec - d0; out.clockListed = partCount("clockwork");
      gameState = "choosing"; take("reinforcements");
      gameState = "choosing"; take("bigGear"); out.gearNotListed = partCount("bigGear");
      return out;
    });
    console.log("       ", JSON.stringify(r));
    assert.ok(r.scrap[1] > r.scrap[0]);
    assert.equal(r.train[1], Math.round(r.train[0] * 0.75));
    assert.equal(r.storm[1], r.storm[0] / 4);
    assert.ok(Math.abs(r.cool[1] - r.cool[0] * 0.8) < 1e-9);
    assert.deepEqual(r.rally, [1.5, 2]);
    assert.ok(r.rust[1] < r.rust[0] && r.rust[1] >= 1);
    assert.deepEqual(r.combo, [1.25, 1.25, 1.5, 1.5]);
    assert.ok(Math.abs(r.big - 1.4) < 1e-9);
    assert.ok(Math.abs(r.bomb - 1.5) < 1e-9);
    assert.deepEqual(r.turbo, [1, 1.5]);
    assert.ok(r.chain[1] > r.chain[0]);
    assert.ok(Math.abs(r.boss[1] - 125) < 1e-9 && Math.abs(r.boss[0] - 100) < 1e-9);
    assert.ok(r.coins[1] > r.coins[0]);
    assert.equal(r.cleaned, true);
    assert.equal(r.charged, 1);
    assert.equal(r.forge, 1);
    assert.equal(r.forged, true); assert.equal(r.forgedListed, 0);
    assert.equal(r.rank, 1);
    assert.ok(Math.abs(r.clock - 0.25) < 1e-9); assert.equal(r.clockListed, 1);
    assert.equal(r.gearNotListed, 0);
  });
  await check("Second wind saves you once, then the next loss ends the run", async () => {
    await page.evaluate(() => { runParts = { secondWind: 1 }; gameState = "playing"; boss = null; enemyPower = 1000; playerPower = 10; marchers = [{ side: "enemy", value: 5, t: 0 }]; });
    await page.waitForTimeout(150);
    const a = await page.evaluate(() => ({ s: gameState, p: partCount("secondWind"), enemies: marchers.filter((m) => m.side === "enemy" && m.value === 5).length }));
    assert.equal(a.s, "playing"); assert.equal(a.p, 0); assert.equal(a.enemies, 0);
    await page.evaluate(() => { enemyPower = 1000; playerPower = 10; });
    await page.waitForSelector("#gameover-screen:not(.hidden)");
  });

  console.log("\nLayout");
  const showCards = async () => {
    await page.evaluate(() => {
      clearTimeout(rewardTimer);
      document.getElementById("gameover-screen").classList.add("hidden");
      const pick = ["bigGear", "secondWind", "stormEngine", "chargedStrike"].map((id) => REWARDS.find((r) => r.id === id));
      showRewards("Boss defeated!", pick);
      clearTimeout(rewardTimer);
      document.getElementById("reward-screen").classList.remove("hidden");
    });
  };
  await showCards();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(scratch, "shot-rewards.png") });
  const fits = () => page.evaluate(() => {
    const root = document.getElementById("reward-screen").getBoundingClientRect();
    return [...document.querySelectorAll(".reward-option")].every((b) => {
      const r = b.getBoundingClientRect();
      return r.left >= root.left && r.right <= root.right && r.top >= root.top && r.bottom <= root.bottom && b.scrollWidth <= b.clientWidth + 1;
    });
  });
  await check("4 reward cards fit on a phone", async () => assert.equal(await fits(), true));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(scratch, "shot-rewards-small.png") });
  await check("4 reward cards fit on a small phone", async () => assert.equal(await fits(), true));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(scratch, "shot-rewards-landscape.png") });
  await check("4 reward cards fit in landscape", async () => assert.equal(await fits(), true));
  await page.setViewportSize({ width: 390, height: 844 });

  await check("no page errors in the whole session", async () => assert.deepEqual(errors, []));

  await browser.close();
  server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
