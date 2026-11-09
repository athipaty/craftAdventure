// Tests and screenshots for endgame and release features.
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
  catch (e) { failures.push(name); console.log("  FAIL", name, "\n      ", e.message.split("\n").slice(0, 7).join("\n       ")); }
}
(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true });
  const page = await ctx.newPage();
  // These tests aren't about routes, which would otherwise come up at random after a reward.
  page.on("domcontentloaded", () => page.evaluate(() => { pathChoiceDue = () => false; }).catch(() => {}));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404") && !m.text().includes("ERR_INTERNET_DISCONNECTED")) { const where = m.location().url; if (!where.endsWith("favicon.ico")) errors.push(m.text() + " @ " + where); } });
  const hideDaily = () => page.evaluate(() => { document.getElementById("daily-screen").classList.add("hidden"); document.getElementById("away-screen").classList.add("hidden"); });
  const reset = async (setup) => {
    await page.goto(url);
    await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
    await page.goto(url);
    await page.evaluate(() => { save.stats.waves = 100; for (const t of TIPS) save.tips[t.id] = true; writeSave(); });
    if (setup) await page.evaluate(setup);
    await hideDaily();
  };
  const reload = async () => { await page.reload(); await hideDaily(); };
  const start = (opts) => page.evaluate((o) => startChosenRun(o), opts);

  console.log("\nHarder levels");
  await reset(() => { save.worldsCleared.forest = true; writeSave(); });
  await check("Hard appears after a clear; Expert only after Hard", async () => {
    await page.click("#play-btn");
    assert.deepEqual(await page.locator(".world-level-btn").allTextContents(), ["Hard: enemies grow 25% faster · +25% coins"]);
    await page.evaluate(() => { save.worldLevels.forest = 2; openWorlds(); });
    assert.deepEqual(await page.locator(".world-level-btn").allTextContents(), ["Hard: enemies grow 25% faster \u2713", "Expert: enemies grow 25% faster, rust attacks on every wave · +50% coins"]);
    await page.screenshot({ path: path.join(scratch, "shot3-worlds.png") });
  });
  await page.locator(".world-level-btn").first().click();
  await check("Hard applies its rules, scale and coins", async () => {
    const r = await page.evaluate(() => {
      const scale = worldScale();
      wave = 11; bossesBeaten = 0; const coins = coinsForRun(); wave = 1;
      return { level: worldLevel, rules: runRules, scale, coins };
    });
    assert.equal(r.level, 1); assert.deepEqual(r.rules, ["swarm"]);
    assert.ok(Math.abs(r.scale - 1.59) < 1e-9); assert.equal(r.coins, 25);
  });
  await check("level survives a reload and pays its bigger prize once", async () => {
    await page.evaluate(() => saveRun());
    await reload();
    assert.equal(await page.locator("#continue-btn").textContent(), "Continue: Green Forest (Hard), wave 1");
    await page.click("#continue-btn");
    const r = await page.evaluate(() => ({ level: worldLevel, rules: runRules, scale: runCoinScale }));
    assert.deepEqual(r, { level: 1, rules: ["swarm"], scale: 1.25 });
    await page.click("#resume-btn");
    const c0 = await page.evaluate(() => { save.worldLevels.forest = 1; return save.coins; });
    await page.evaluate(() => { wave = 15; boss = { kind: bossKind("warlord"), hp: 0, maxHp: 1, attackIn: 9, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; });
    await page.waitForSelector("#world-clear-screen:not(.hidden)");
    const got = await page.evaluate(() => ({ title: document.getElementById("world-clear-title").textContent, tier: save.worldLevels.forest, stat: statValue("worldTier"), coins: save.coins }));
    assert.equal(got.title, "Green Forest (Hard) cleared!");
    assert.equal(got.tier, 2);
    assert.equal(got.stat, 2);
    assert.ok(got.coins >= c0 + 150, `coins ${got.coins} from ${c0}`);
    assert.equal(await page.locator("#world-clear-coins").textContent(), "+150 coins");
  });
  await check("bossy rule still ends each world on its final boss", async () => {
    await start({ world: 1, level: 1 });
    const r = await page.evaluate(() => ({ every: bossEvery(), final: isBossWave(20), four: isBossWave(4), plan: planWave(20).boss }));
    assert.deepEqual(r, { every: 4, final: true, four: true, plan: "wyrm" });
  });
  await check("endless waves stay short once the machine stops growing, and get tougher by growing faster", async () => {
    await start({ world: 3 });
    const r = await page.evaluate(() => {
      peakRate = 50; waveLead = 0;
      const perEnemy = WIN_RATIO / (1 - WIN_RATIO);
      const seconds = (w) => (waveStartEnemy(w) * perEnemy) / peakRate; // the best output's time to win it
      const before = { s30: seconds(30), growth: enemyGrowthPerSec(30, 0) };
      endless = true;
      const after = { s20: seconds(20), s30: seconds(30), s40: seconds(40), growth: enemyGrowthPerSec(30, 0) };
      endless = false;
      return { before, after };
    });
    assert.ok(r.after.s30 < r.before.s30 / 100, `capped: ${r.after.s30}s, was ${r.before.s30}s`);
    assert.ok(r.after.s40 > r.after.s30 && r.after.s40 < r.after.s30 * 4, `still a little bigger each wave: ${r.after.s30}s, ${r.after.s40}s`);
    assert.ok(r.after.growth > r.before.growth * 3, "the spared size makes the enemy grow faster");
  });
  await check("every world's every level has rules that exist", async () => {
    const bad = await page.evaluate(() => WORLDS.flatMap((w, i) => WORLD_LEVELS.flatMap((_, l) => levelRules(i, l).filter((r) => !RULES[r]))));
    assert.deepEqual(bad, []);
  });

  console.log("\nDaily challenge");
  await check("the same day gives everyone the same setup, waves and rewards", async () => {
    const r = await page.evaluate(() => {
      const a = makeDaily("2026-11-04"), b = makeDaily("2026-11-04");
      const days = new Set();
      for (let i = 1; i <= 28; i++) days.add(JSON.stringify(makeDaily(`2026-02-${String(i).padStart(2, "0")}`)));
      currentDaily = a; currentWorld = a.world; runRules = a.rules; endless = true; runParts = {};
      createBoard(); lastEventId = null;
      const plans1 = [3, 4, 7, 11, 12].map((w) => JSON.stringify(planWave(w)));
      lastEventId = null;
      const plans2 = [3, 4, 7, 11, 12].map((w) => JSON.stringify(planWave(w)));
      wave = 6;
      const rewards1 = pickRewards(false).map((x) => x.id), rewards2 = pickRewards(false).map((x) => x.id);
      rerollsLeft = 1; const rerolled = pickRewards(false).map((x) => x.id); rerollsLeft = 2;
      currentDaily = null; endless = false; wave = 1;
      return { same: JSON.stringify(a) === JSON.stringify(b), days: days.size, plans: JSON.stringify(plans1) === JSON.stringify(plans2), rewards: JSON.stringify(rewards1) === JSON.stringify(rewards2), rerollDiffers: JSON.stringify(rewards1) !== JSON.stringify(rerolled) };
    });
    console.log("       ", JSON.stringify(r));
    assert.equal(r.same, true); assert.ok(r.days >= 4); assert.equal(r.plans, true); assert.equal(r.rewards, true); assert.equal(r.rerollDiffers, true);
  });
  await reset(() => { save.worldsCleared.forest = true; writeSave(); });
  await page.click("#play-btn");
  await check("the worlds list leads with it, then the run is endless with its rules", async () => {
    assert.equal(await page.locator(".world-card b").first().textContent(), "Daily challenge");
    await page.locator(".world-card").first().click();
    const r = await page.evaluate(() => ({ daily: Boolean(currentDaily), endless, rules: runRules, want: makeDaily(todayKey()).rules, finalWave: isFinalWave(15), scale: worldScale() }));
    assert.equal(r.daily, true); assert.equal(r.endless, true); assert.deepEqual(r.rules, r.want); assert.equal(r.finalWave, false); assert.equal(r.scale, 1.55);
  });
  await check("the goal pays once, and survives a reload", async () => {
    const c0 = await page.evaluate(() => { wave = 9; playerPower = 1e7; enemyPower = 1; boss = null; return save.coins; });
    await page.waitForSelector("#reward-screen:not(.hidden)");
    assert.equal(await page.evaluate(() => wave), 10);
    const paid = await page.evaluate(() => { const c = save.coins; checkDailyGoal(); return { again: save.coins - c, goals: statValue("dailyGoals"), total: c }; });
    assert.equal(paid.again, 0); assert.equal(paid.goals, 1); assert.ok(paid.total >= c0 + 60);
    assert.equal(await page.evaluate(() => save.dailyChallengePaid), await page.evaluate(() => todayKey()));
    await reload();
    assert.equal(await page.locator("#continue-btn").textContent(), "Continue: Daily challenge, wave 10");
    await page.click("#continue-btn");
    await page.waitForSelector("#reward-screen:not(.hidden)");
    assert.equal(await page.evaluate(() => Boolean(currentDaily) && endless), true);
    await page.waitForTimeout(500);
    await page.click("#skip-btn");
    await page.evaluate(() => { wave = 11; playerPower = 1e7; enemyPower = 1; boss = null; });
    await page.waitForSelector("#reward-screen:not(.hidden)");
    assert.equal(await page.evaluate(() => statValue("dailyGoals")), 1); // the later wave didn't pay again
    await page.waitForTimeout(500);
    await page.click("#skip-btn");
  });
  await check("Game Over records today's best and shares the score", async () => {
    await page.evaluate(() => { boss = null; enemyPower = 1e7; playerPower = 1; });
    await page.waitForSelector("#gameover-screen:not(.hidden)");
    await hideDaily();
    assert.equal(await page.evaluate(() => dailyBestToday()), 12);
    assert.equal(await page.locator("#share-btn").isVisible(), true);
    await page.evaluate(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
    await page.click("#share-btn");
    await page.waitForFunction(() => document.getElementById("share-btn").textContent === "Copied!", null, { timeout: 5000 });
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(text, /^Gear Fight! daily challenge \d{4}-\d{2}-\d{2}: I reached wave 12\. Can you beat it\? http/);
    for (const [name, w, h] of [["phone", 390, 844], ["small", 320, 568], ["landscape", 844, 390]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(scratch, `shot3-gameover-${name}.png`) });
      const out = await page.evaluate(() => { const s = document.getElementById("gameover-screen").getBoundingClientRect(); return [...document.querySelectorAll("#gameover-screen h2, #gameover-screen p, #gameover-screen button, #run-stats")].filter((b) => { const q = b.getBoundingClientRect(); return q.height && (q.top < s.top - 1 || q.bottom > s.bottom + 1); }).map((b) => b.id || b.tagName); });
      assert.deepEqual(out, [], name);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await check("Try again repeats the daily; a world run isn't one", async () => {
    await page.click("#retry-btn");
    assert.equal(await page.evaluate(() => Boolean(currentDaily) && endless && wave === 1), true);
    await start({ world: 0 });
    assert.equal(await page.evaluate(() => currentDaily === null && !endless && runRules.length === 0), true);
  });

  console.log("\nAway earnings");
  await check("pays after a long gap, capped, and only once", async () => {
    await reset(() => { save.stats.runs = 2; save.playerLevel = 6; save.lastSeen = Date.now() - 2 * 3600000; localStorage.setItem("gearfight_save", JSON.stringify(save)); restoringBackup = true; });
    await page.reload();
    assert.equal(await page.locator("#away-screen").isVisible(), true);
    assert.equal(await page.locator("#away-coins").textContent(), "20");
    await page.screenshot({ path: path.join(scratch, "shot3-away.png") });
    assert.equal(await page.evaluate(() => save.coins), 20);
    await page.reload();
    assert.equal(await page.locator("#away-screen").isVisible(), false);
    assert.equal(await page.evaluate(() => save.coins), 20);
    await page.evaluate(() => { save.lastSeen = Date.now() - 100 * 3600000; localStorage.setItem("gearfight_save", JSON.stringify(save)); restoringBackup = true; });
    await page.reload();
    assert.equal(await page.locator("#away-coins").textContent(), "80");
    await page.click("#away-claim-btn");
    assert.equal(await page.locator("#away-screen").isVisible(), false);
  });
  await check("no pay for short gaps, new players, or a clock set backwards", async () => {
    const r = await page.evaluate(() => {
      const coins = () => { const c = save.coins; checkAwayEarnings(); document.getElementById("away-screen").classList.add("hidden"); return save.coins - c; };
      save.lastSeen = Date.now() - 10 * 60000; const short = coins();
      save.lastSeen = Date.now() + 3600000; const back = coins();
      save.lastSeen = Date.now() - 5 * 3600000; const runs = save.stats.runs; save.stats.runs = 0; const fresh = coins(); save.stats.runs = runs;
      return { short, back, fresh };
    });
    assert.deepEqual(r, { short: 0, back: 0, fresh: 0 });
  });

  console.log("\nHeroes");
  await reset(() => { save.owned["hero:archer"] = save.owned["hero:engineer"] = save.owned["hero:berserker"] = save.owned["hero:guardian"] = true; writeSave(); });
  await start({ world: 0 });
  await check("each hero's ability works", async () => {
    const r = await page.evaluate(() => {
      const out = {};
      save.hero = "knight"; out.knight = rallyFullSeconds(); save.hero = "archer"; out.archerRally = rallyFullSeconds();
      // Every third strike is triple.
      strikeCount = 0; const hits = [];
      for (let i = 0; i < 3; i++) { enemyPower = 1e6; strikeCooldown = 0; const e = enemyPower; strikeEnemy(); hits.push(e - enemyPower); }
      out.triple = hits[2] / hits[0];
      save.hero = "berserker"; marchers = []; overdriveLeft = 2; sendSoldiers(10); out.berserk = marchers.at(-1).value; overdriveLeft = 0; marchers = []; sendSoldiers(10); out.calm = marchers.at(-1).value; marchers = [];
      save.hero = "guardian"; rustBlocked = false; const c = grid[DRIVER_ROW][DRIVER_COL + 1];
      rustAttack(); out.blocked = !c.rusted; rustAttack(); out.second = Boolean(c.rusted); c.rusted = false;
      startWave(); out.resetOnWave = rustBlocked === false; boss = null; wavePace = null; enemyType = null;
      return out;
    });
    console.log("       ", JSON.stringify(r));
    assert.equal(r.knight, 3); assert.equal(r.archerRally, 5); assert.ok(Math.abs(r.triple - 3) < 1e-6);
    assert.equal(r.berserk, 20); assert.equal(r.calm, 10); assert.equal(r.blocked, true); assert.equal(r.second, true); assert.equal(r.resetOnWave, true);
  });
  await check("Engineer starts with a Booster", async () => {
    await page.evaluate(() => { save.hero = "engineer"; });
    await start({ world: 0 });
    assert.equal(await page.evaluate(() => boardHasGear("booster") && grid.flat().filter((c) => c && !c.driver).length === 2), true);
  });
  await check("heroes level up from waves won, speeding up the main gear", async () => {
    const r = await page.evaluate(() => {
      save.hero = "knight"; save.heroWaves.knight = 0;
      const a = heroLevel("knight"); save.heroWaves.knight = 10; const b = heroLevel("knight"); save.heroWaves.knight = 500; const c = heroLevel("knight");
      save.heroWaves.knight = 28;
      gameState = "title"; currentEvent = null; runBanked = false; startNewRun();
      const speed = driverTurnsPerSec;
      wave = 3; runStartWave = 1; bankRun();
      return { a, b, c, speed, after: save.heroWaves.knight, level: heroLevel("knight") };
    });
    assert.deepEqual([r.a, r.b, r.c], [1, 2, 5]);
    assert.ok(Math.abs(r.speed - 1.02) < 1e-9);
    assert.equal(r.after, 30); assert.equal(r.level, 3);
  });
  await check("Workshop shows hero levels", async () => {
    await page.evaluate(() => { document.getElementById("game-screen").classList.add("hidden"); openWorkshop(); });
    const text = await page.locator("#collection-list .upgrade span").first().textContent();
    assert.match(text, /Level 3 \(30\/60 waves\)$/);
    await page.screenshot({ path: path.join(scratch, "shot3-workshop.png") });
    await page.click("#workshop-close-btn");
    await page.evaluate(() => document.getElementById("game-screen").classList.remove("hidden"));
  });

  console.log("\nNew gears");
  await reset();
  await start({ world: 0 });
  await check("Far and Lone gears pay for their position", async () => {
    const r = await page.evaluate(() => {
      const place = (type, r, c) => { grid[r][c] = freshCell(type); };
      createBoard();
      place("far", DRIVER_ROW, DRIVER_COL + 3);
      const far3 = gearPlacePayout(DRIVER_ROW, DRIVER_COL + 3);
      grid[DRIVER_ROW][DRIVER_COL + 3] = null;
      place("far", DRIVER_ROW - 1, DRIVER_COL);
      const far1 = gearPlacePayout(DRIVER_ROW - 1, DRIVER_COL);
      createBoard();
      place("lone", 0, 0); const corner = gearPlacePayout(0, 0);
      place("lone", DRIVER_ROW - 1, DRIVER_COL); const open = gearPlacePayout(DRIVER_ROW - 1, DRIVER_COL);
      place("soldier", DRIVER_ROW - 2, DRIVER_COL); const closer = gearPlacePayout(DRIVER_ROW - 1, DRIVER_COL);
      // Real payouts and the output estimate agree.
      createBoard(); grid[DRIVER_ROW][DRIVER_COL + 1] = freshCell("far"); const near = soldiersPerSecond();
      grid[DRIVER_ROW][DRIVER_COL + 2] = freshCell("far"); const two = soldiersPerSecond();
      marchers = []; grid[DRIVER_ROW][DRIVER_COL + 2].ticks = 3.5;
      hitGear({ row: DRIVER_ROW, col: DRIVER_COL + 2, spin: 1 }, 1); const sent = marchers.at(-1)?.value; marchers = [];
      createBoard();
      return { far3, far1, corner, open, closer, near, two, sent };
    });
    console.log("       ", JSON.stringify(r));
    assert.equal(r.far3, 1.5); assert.equal(r.far1, 1);
    assert.equal(r.corner, 2); assert.equal(r.open, 2.5); assert.equal(r.closer, 2);
    assert.ok(r.two > r.near); assert.equal(r.sent, 1.25);
  });
  await check("they merge, save, and can be offered", async () => {
    const r = await page.evaluate(() => {
      const offered = REWARDS.filter(rewardIsOpen).map((x) => x.id);
      grid[DRIVER_ROW - 1][DRIVER_COL] = freshCell("far"); grid[DRIVER_ROW - 2][DRIVER_COL] = freshCell("far");
      grid[DRIVER_ROW + 1][DRIVER_COL] = freshCell("lone");
      const can = canMerge(grid[DRIVER_ROW - 1][DRIVER_COL], grid[DRIVER_ROW - 2][DRIVER_COL]);
      const snap = JSON.parse(JSON.stringify(runSnapshot()));
      return { far: offered.includes("farGear"), lone: offered.includes("loneGear"), can, valid: isValidRunSave(snap) };
    });
    assert.deepEqual(r, { far: true, lone: true, can: true, valid: true });
    await page.evaluate(() => { handleResize(); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(scratch, "shot3-gears.png") });
    await page.evaluate(() => { createBoard(); });
  });

  console.log("\nFinal bosses");
  await reset();
  await start({ world: 0 });
  await check("each world ends on its own boss, named on the reward screen", async () => {
    const r = await page.evaluate(() => WORLDS.map((w, i) => {
      currentWorld = i; const p = planWave(w.finalWave); wave = w.finalWave; const t = nextWaveText(p); wave = 1;
      return [p.boss, t];
    }));
    console.log("       ", JSON.stringify(r.map((x) => x[1])));
    assert.deepEqual(r.map((x) => x[0]), ["warlord", "wyrm", "queen", "magma"]);
    assert.ok(r.every((x) => x[1].includes("Final boss")));
    await page.evaluate(() => { currentWorld = 0; });
  });
  await check("endless and weekly runs don't use them", async () => {
    const r = await page.evaluate(() => {
      endless = true; const a = planWave(15).boss; endless = false;
      currentEvent = WEEKLY_EVENTS[0]; const b = planWave(15).boss; currentEvent = null;
      return { a, b, ids: ["warlord", "wyrm", "queen", "magma"] };
    });
    assert.ok(!r.ids.includes(r.a)); assert.ok(!r.ids.includes(r.b));
  });
  await check("each final attack does its thing", async () => {
    const r = await page.evaluate(() => {
      const out = {};
      const setBoss = (id) => { boss = { kind: bossKind(id), hp: 100, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; };
      setBoss("warlord"); enemyPower = 100; bossAttack(); out.warlord = enemyPower;
      setBoss("wyrm"); const c = grid[DRIVER_ROW][DRIVER_COL + 1]; c.ticks = 2; bossAttack(); out.wyrm = c.ticks;
      setBoss("queen"); frozenFor = 0; bossAttack(); out.queen = frozenFor; frozenFor = 0;
      setBoss("magma");
      const gears = () => grid.flat().filter((x) => x && !x.driver).length;
      const small = gears(); bossAttack(); out.magmaSmall = gears() === small;
      for (let i = 0; i < 8; i++) placeGear("soldier");
      grid.flat().forEach((x) => { if (x && !x.driver) x.level = 3; });
      const weak = placeGear("soldier"); const before = gears(); bossAttack();
      out.magmaBig = before - gears(); out.weakGone = !grid.flat().includes(weak);
      boss = null; createBoard();
      return out;
    });
    assert.ok(Math.abs(r.warlord - 112) < 1e-9); assert.equal(r.wyrm, 1); assert.equal(r.queen, 5);
    assert.equal(r.magmaSmall, true); assert.equal(r.magmaBig, 1); assert.equal(r.weakGone, true);
  });
  await page.evaluate(() => { wave = 15; peakRate = 20; boss = { kind: bossKind("warlord"), hp: 900, maxHp: 900, attackIn: 99, hitFlash: 0, reinforcePerSec: 1, shield: 0 }; playerPower = 400; enemyPower = 350; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(scratch, "shot3-boss.png"), clip: { x: 0, y: 0, width: 390, height: 260 } });
  await page.evaluate(() => { boss = null; });

  console.log("\nWave pacing");
  await reset();
  await start({ world: 0 });
  await check("rush is smaller and siege is bigger; siege pays coins; both show on the reward screen", async () => {
    const r = await page.evaluate(() => {
      peakRate = 10; wave = 8;
      nextWavePlan = { enemy: "goblin", event: null, pace: null }; startWave(); const plain = enemyPower;
      const rushText = nextWaveText({ enemy: "goblin", event: null, pace: "rush" });
      nextWavePlan = { enemy: "goblin", event: null, pace: "rush" }; startWave(); const rush = enemyPower; const rushLead = playerPower / enemyPower;
      const siegeText = nextWaveText({ enemy: "goblin", event: null, pace: "siege" });
      nextWavePlan = { enemy: "goblin", event: null, pace: "siege" }; startWave(); const siege = enemyPower;
      const snap = JSON.parse(JSON.stringify(runSnapshot()));
      return { plain, rush, rushLead, siege, rushText, siegeText, savedPace: snap.wavePace };
    });
    console.log("       ", r.rushText, "|", r.siegeText);
    assert.ok(Math.abs(r.rush / r.plain - 0.55) < 1e-6); assert.ok(Math.abs(r.siege / r.plain - 1.5) < 1e-6);
    assert.equal(r.savedPace, "siege");
    assert.match(r.rushText, /Rush wave/); assert.match(r.siegeText, /Siege wave/);
    await page.evaluate(() => { playerPower = 1e9; });
    await page.waitForSelector("#reward-screen:not(.hidden)");
    const after = await page.evaluate(() => ({ bonus: runBonusCoins, pace: wavePace }));
    assert.equal(after.bonus, 5); assert.equal(after.pace, null);
  });
  await check("waves really do vary in length", async () => {
    const r = await page.evaluate(() => {
      let rush = 0, siege = 0, plain = 0;
      for (let i = 0; i < 2000; i++) { const p = planWave(7); if (p.pace === "rush") rush++; else if (p.pace === "siege") siege++; else plain++; lastEventId = null; }
      return { rush, siege, plain };
    });
    console.log("       ", JSON.stringify(r));
    assert.ok(r.rush > 200 && r.siege > 200 && r.plain > 500);
  });

  console.log("\nBackup");
  await reset(() => { save.coins = 1234; save.playerLevel = 7; save.worldsCleared.forest = true; bestWave = 22; localStorage.setItem("gearfight_best_wave", "22"); writeSave(); });
  let backup;
  await check("backup screen holds everything, and copies and downloads", async () => {
    await page.evaluate(() => openMore()); await page.click("#title-backup-btn");
    backup = await page.locator("#backup-text").inputValue();
    const d = JSON.parse(backup);
    assert.equal(d.format, "gearfight_backup"); assert.equal(d.save.coins, 1234); assert.equal(d.bestWave, 22);
    await page.screenshot({ path: path.join(scratch, "shot3-backup.png") });
    await page.click("#copy-backup-btn");
    assert.equal(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).save.coins, 1234);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#download-backup-btn")]);
    assert.match(download.suggestedFilename(), /^gear-fight-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const saved = path.join(scratch, "backup-test.json");
    await download.saveAs(saved);
    assert.equal(JSON.parse(fs.readFileSync(saved, "utf8")).save.coins, 1234);
  });
  await check("bad text is refused and changes nothing", async () => {
    for (const bad of ["hello", "{}", JSON.stringify({ format: "gearfight_backup", version: 1, save: {} }), JSON.stringify({ format: "other", version: 1, save: { coins: 1 } })]) {
      await page.fill("#backup-text", bad);
      await page.click("#restore-btn");
      await page.click("#restore-btn");
      assert.match(await page.locator("#backup-message").textContent(), /isn't a Gear Fight backup/);
    }
    assert.equal(await page.evaluate(() => save.coins), 1234);
  });
  await check("restoring on a fresh device brings everything back, after asking twice", async () => {
    await reset();
    assert.equal(await page.evaluate(() => save.coins), 0);
    await page.evaluate(() => openMore()); await page.click("#title-backup-btn");
    await page.fill("#backup-text", backup);
    await page.click("#restore-btn");
    assert.equal(await page.locator("#restore-btn").textContent(), "Tap again to replace your progress");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("gearfight_save")).coins), 0);
    await Promise.all([page.waitForLoadState("load"), page.click("#restore-btn")]);
    await page.waitForFunction(() => typeof save !== "undefined" && save.coins === 1234);
    const r = await page.evaluate(() => ({ coins: save.coins, level: save.playerLevel, best: bestWave, forest: save.worldsCleared.forest }));
    assert.deepEqual(r, { coins: 1234, level: 7, best: 22, forest: true });
  });
  await check("a backup taken mid-run brings the run back too", async () => {
    await hideDaily();
    await start({ world: 0 });
    await page.evaluate(() => { wave = 5; saveRun(); });
    const text = await page.evaluate(() => backupText());
    await reset();
    await page.evaluate((t) => { document.getElementById("backup-text").value = t; }, text);
    await page.evaluate(() => { openBackup; document.getElementById("backup-screen").classList.remove("hidden"); });
    await page.click("#restore-btn");
    await Promise.all([page.waitForLoadState("load"), page.click("#restore-btn")]);
    await page.waitForFunction(() => typeof savedRun !== "undefined" && savedRun?.numbers.wave === 5);
  });
  await check("the play record notes where runs end, on this device only", async () => {
    await reset();
    await start({ world: 0 });
    await page.evaluate(() => { wave = 7; enemyPower = 1e6; playerPower = 1; boss = null; });
    await page.waitForSelector("#gameover-screen:not(.hidden)");
    await hideDaily();
    const r = await page.evaluate(() => ({ f: save.funnel, inBackup: JSON.parse(backupText()).save.funnel }));
    assert.deepEqual(r.f, { forest: { 7: 1 } });
    assert.deepEqual(r.inBackup, r.f);
    const source = fs.readFileSync(path.join(root, "game.js"), "utf8");
    // The only thing that ever leaves the device is a duel's ghost record: no play record, no save.
    assert.ok(!/sendBeacon|XMLHttpRequest|WebSocket/.test(source), "game.js must not send data anywhere else");
    assert.equal(source.match(/fetch\(/g).length, 1, "one fetch, for ghosts");
    assert.match(source, /async function fetchWithTimeout[\s\S]{0,300}?fetch\(/);
    assert.ok(!/fetchWithTimeout\([^)]*(save|funnel|backup)/i.test(source));
  });

  console.log("\nOffline");
  await check("the game opens and plays with no connection", async () => {
    await reset();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 }).catch(() => {});
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
    await page.waitForFunction(async () => { const c = await caches.open("gearfight-v1"); return (await c.keys()).length >= 7; });
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => typeof save !== "undefined");
    await hideDaily();
    await page.click("#play-btn");
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => gameState), "playing");
    assert.ok(await page.evaluate(() => runTime > 0));
    await ctx.setOffline(false);
  });

  await check("no page errors in the whole session", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
