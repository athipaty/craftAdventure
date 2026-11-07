// Every few waves the player picks a route for the next one.
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

  const fresh = (w = 6) => page.evaluate((n) => {
    clearTimeout(rewardTimer);
    for (const id of ["reward-screen", "path-screen", "build-bar", "pause-screen"]) document.getElementById(id).classList.add("hidden");
    gameState = "playing"; boss = null; gearTray = []; wave = n; waveTime = 1; gearDropAt = NO_GEAR_DROP; treasureAt = NO_GEAR_DROP; clearTreasureGoblin(); clearPaths();
    nextWavePlan = { enemy: "goblin", event: null, pace: null, deal: null }; activeDeal = null; dealAccepted = false; wavePace = null; waveEvent = null; runBonusCoins = 0; marchers = []; enemyBacklog = 0;
    playerPower = 1000; enemyPower = 1000;
    grid.forEach((row, r) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[r][c] = null; }));
  }, w);
  const opened = () => page.waitForFunction(() => performance.now() - rewardOpenedAt >= REWARD_CLICK_DELAY_MS);

  console.log("\nWhen it comes");
  await check("it comes after the reward from wave 3, and then not again for 3 waves", async () => {
    const due = (setup) => page.evaluate((code) => new Function(code + "; return pathChoiceDue();")(), setup);
    await fresh(2); assert.equal(await due(""), false, "too early");
    await fresh(3); assert.equal(await due(""), true, "wave 3");
    await fresh(6); assert.equal(await due("lastPathWave = 4"), false, "too soon");
    await fresh(7); assert.equal(await due("lastPathWave = 4"), true, "3 waves on");
  });
  await check("it stays clear of anything already changing the wave", async () => {
    for (const [what, plan] of [["boss", { boss: "rust" }], ["event", { enemy: "goblin", event: "x" }], ["pace", { enemy: "brute", pace: "rush" }], ["deal", { enemy: "goblin", deal: "army" }]]) {
      await fresh();
      assert.equal(await page.evaluate((p) => { nextWavePlan = p; return pathChoiceDue(); }, plan), false, what);
    }
  });
  await check("picking a reward leads to it, and without one due goes straight to the wave", async () => {
    await fresh(6);
    await page.evaluate(() => { offeredRewards = { ids: [] }; gameState = "choosing"; chooseReward(REWARDS.find((x) => x.id === "fasterGear")); });
    assert.equal(await page.evaluate(() => gameState), "path");
    assert.equal(await page.locator("#path-screen").isVisible(), true);
    assert.equal(await page.locator("#reward-screen").isVisible(), false);
    await page.screenshot({ path: path.join(scratch, "choose-your-path.png") });
    await fresh(2);
    // The build is picked after the first wave, so this run already has one.
    await page.evaluate(() => { runBuild = "combo"; gameState = "choosing"; chooseReward(REWARDS.find((x) => x.id === "fasterGear")); });
    assert.equal(await page.evaluate(() => gameState), "playing");
    assert.equal(await page.locator("#path-screen").isVisible(), false);
  });
  await check("skipping the reward leads to it too", async () => {
    await fresh(6);
    await page.evaluate(() => { gameState = "choosing"; chooseReward(null); });
    assert.equal(await page.evaluate(() => gameState), "path");
  });

  console.log("\nThe choice");
  await check("before wave 8 there's no elite wave, but still a choice", async () => {
    await fresh(7);
    const r = await page.evaluate(() => Array.from({ length: 200 }, pickPaths));
    assert.ok(r.every((ids) => !ids.includes("elite") && ids.length === 3 && ids[0] === "safe"), JSON.stringify(r[0]));
    await fresh(8);
    assert.ok(await page.evaluate(() => Array.from({ length: 200 }, pickPaths).flat().includes("elite")), "from wave 8");
  });
  await check("with a full tray early on, the safe road and one other are still offered", async () => {
    await fresh(4);
    const r = await page.evaluate(() => { gearTray = Array.from({ length: TRAY_SLOTS }, () => ({ type: "soldier", level: 1 })); const out = pickPaths(); gearTray = []; return out; });
    assert.deepEqual(r, ["safe", "treasure"]);
  });
  await check("always the safe road and two others, all different", async () => {
    await fresh(9);
    const r = await page.evaluate(() => Array.from({ length: 300 }, pickPaths));
    assert.ok(r.every((ids) => ids.length === 3 && ids[0] === "safe" && new Set(ids).size === 3), "shape");
    const seen = new Set(r.flat());
    assert.deepEqual([...seen].sort(), ["elite", "safe", "supply", "treasure"]);
  });
  await check("no free gear offered with a full tray", async () => {
    await fresh();
    const r = await page.evaluate(() => { gearTray = Array.from({ length: TRAY_SLOTS }, () => ({ type: "soldier", level: 1 })); const out = Array.from({ length: 200 }, pickPaths); gearTray = []; return out.flat(); });
    assert.ok(!r.includes("supply"));
  });
  await check("a daily challenge offers the same for everyone", async () => {
    await fresh();
    const r = await page.evaluate(() => { const keep = currentDaily; currentDaily = { day: "2026-11-05" }; const out = []; for (let w = 3; w < 60; w++) { wave = w; out.push(JSON.stringify(pickPaths()) === JSON.stringify(pickPaths())); } currentDaily = keep; wave = 6; return out; });
    assert.ok(r.every(Boolean));
  });
  await check("the cards show a name, risk and reward, and tapping one picks it", async () => {
    await fresh();
    await page.evaluate(() => showPaths(["safe", "elite", "supply"]));
    const cards = await page.evaluate(() => [...document.querySelectorAll(".path-card")].map((c) => [c.querySelector("b").textContent, c.querySelector(".path-risk").textContent, c.querySelector(".path-reward").textContent, Boolean(c.querySelector(".emoji-icon"))]));
    assert.deepEqual(cards[1], ["Elite ambush", "40% more enemies", "Win for better reward choices", true]);
    assert.equal(cards.length, 3);
    assert.match(await page.locator("#path-next").textContent(), /^Next: /);
    await opened();
    await page.locator(".path-card.elite").click();
    const r = await page.evaluate(() => ({ state: gameState, next: activePath?.id ?? nextPath?.id, last: lastPathWave, wave, offered: offeredPaths }));
    assert.equal(r.next, "elite");
    assert.equal(r.last, r.wave);
    assert.equal(r.offered, null);
    assert.equal(await page.locator("#path-screen").isVisible(), false);
  });
  await check("a stray tap right as it opens doesn't pick", async () => {
    await fresh();
    await page.evaluate(() => { showPaths(["safe", "elite", "supply"]); document.querySelector(".path-card.elite").click(); });
    assert.equal(await page.evaluate(() => gameState), "path");
  });

  console.log("\nWhat each one does");
  const startOn = (id) => page.evaluate((p) => {
    const base = waveStartEnemy(wave);
    choosePath(p);
    if (gameState === "building") beginWave();
    return { ratio: enemyPower / base, goblinAt: treasureAt, active: activePath.id, tray: gearTray.map((g) => g.level), state: gameState };
  }, id);
  await check("the safe road changes nothing", async () => {
    await fresh();
    const r = await startOn("safe");
    assert.ok(Math.abs(r.ratio - 1) < 1e-9, String(r.ratio));
    assert.deepEqual(r.tray, []);
    const w = await page.evaluate(() => { enemyPower = 1000; playerPower = 9000; const before = runBonusCoins; return before; });
    assert.equal(w, 0);
  });
  await check("an elite wave has 40% more enemies, and winning it gives lucky rewards", async () => {
    await fresh();
    const r = await startOn("elite");
    assert.ok(Math.abs(r.ratio - 1.4) < 1e-9, String(r.ratio));
    const won = await page.evaluate(() => {
      const real = offerRewards; let got = null;
      offerRewards = (title, lucky) => { got = { title, lucky }; };
      winWave();
      offerRewards = real;
      return { got, active: activePath };
    });
    assert.deepEqual(won, { got: { title: "Elite beaten!", lucky: true }, active: null });
  });
  await check("after a normal wave the rewards aren't lucky", async () => {
    await fresh();
    await startOn("safe");
    const r = await page.evaluate(() => { const real = offerRewards; let got = null; offerRewards = (title, lucky) => { got = { title, lucky }; }; winWave(); offerRewards = real; return got; });
    assert.equal(r.lucky, false);
    assert.match(r.title, /^Wave \d+ won!$/);
  });
  await check("the treasure trail brings a goblin, faster enemies, and coins for winning", async () => {
    await fresh();
    const r = await startOn("treasure");
    assert.equal(r.goblinAt, 4);
    const grown = await page.evaluate(() => {
      const rate = () => { enemyPower = 1000; playerPower = 1000; marchers = []; enemyBacklog = 0; const before = enemyPower + enemyBacklog; return before; };
      rate();
      return activePath.growth;
    });
    assert.equal(grown, 1.25);
    const won = await page.evaluate(() => { const real = offerRewards; offerRewards = () => {}; const before = runBonusCoins; winWave(); offerRewards = real; return runBonusCoins - before; });
    assert.equal(won, 10);
  });
  await check("the growth really speeds the enemy up", async () => {
    const measure = (id) => page.evaluate((p) => {
      gameState = "playing"; wavePace = null; activeDeal = null; activePath = PATHS[p]; waveTime = 5; enemyPower = 1000; playerPower = 1000; enemyBacklog = 0; marchers = [];
      const before = enemyPower + enemyBacklog;
      update(0.05);
      const moved = enemyPower + enemyBacklog - before + marchers.filter((m) => m.side === "enemy").reduce((sum, m) => sum + m.value, 0);
      activePath = null;
      return moved;
    }, id);
    await fresh();
    const plain = await measure("safe");
    await fresh();
    const fast = await measure("treasure");
    assert.ok(plain > 0, `plain ${plain}`);
    assert.ok(Math.abs(fast / plain - 1.25) < 0.02, `${plain} vs ${fast}`);
  });
  await check("the supply camp gives a level 2 gear now, with 20% more enemies", async () => {
    await fresh();
    const r = await startOn("supply");
    assert.ok(Math.abs(r.ratio - 1.2) < 1e-9, String(r.ratio));
    assert.deepEqual(r.tray, [2]);
    assert.equal(await page.evaluate(() => { for (const g of gearTray) g.arriving = false; return gearTray[0].type; }), "soldier");
  });
  await check("the wave's route shows as a status icon with its risk, and goes when it ends", async () => {
    await fresh();
    await startOn("elite");
    const r = await page.evaluate(() => statusChips().find((c) => c.name === "Elite ambush"));
    assert.equal(r.text, "40% more enemies");
    await fresh();
    await startOn("safe");
    assert.equal(await page.evaluate(() => statusChips().some((c) => c.name === "Safe road")), false);
  });
  await check("a machine big enough for a break still gets it, and the route waits for the wave", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      for (let i = 0; i < BUILD_MIN_GEARS; i++) placeGear("soldier");
      choosePath("elite");
      const during = { state: gameState, next: nextPath?.id, active: activePath };
      beginWave();
      return { during, active: activePath.id, next: nextPath };
    });
    assert.deepEqual(r, { during: { state: "building", next: "elite", active: null }, active: "elite", next: null });
  });

  console.log("\nReloading");
  await check("a reload brings the same choice back, so it can't be re-rolled", async () => {
    await fresh();
    await page.evaluate(() => showPaths(["safe", "treasure", "elite"]));
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    assert.equal(snap.state, "path");
    assert.equal(await page.evaluate((d) => isValidRunSave(d), snap), true);
    await page.evaluate((d) => { document.getElementById("path-screen").classList.add("hidden"); offeredPaths = null; gameState = "playing"; savedRun = d; continueRun(); }, snap);
    assert.equal(await page.evaluate(() => gameState), "path");
    assert.deepEqual(await page.evaluate(() => offeredPaths), ["safe", "treasure", "elite"]);
    assert.equal(await page.locator(".path-card").count(), 3);
    assert.equal(await page.locator("#path-screen").isVisible(), true);
  });
  await check("the chosen route survives a reload, before and during its wave", async () => {
    await fresh();
    await page.evaluate(() => { nextPath = PATHS.elite; lastPathWave = 6; gameState = "building"; buildLeft = 5; });
    let snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    assert.deepEqual(await page.evaluate((d) => { restoreRun(d); return [nextPath?.id, lastPathWave]; }, snap), ["elite", 6]);
    await fresh();
    await page.evaluate(() => { activePath = PATHS.treasure; });
    snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    assert.equal(await page.evaluate((d) => { restoreRun(d); return activePath?.id; }, snap), "treasure");
    await page.evaluate(() => { document.getElementById("pause-screen").classList.add("hidden"); });
  });
  await check("bad or older saves are handled", async () => {
    await fresh();
    await page.evaluate(() => showPaths(["safe", "elite", "supply"]));
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    const bad = JSON.parse(JSON.stringify(snap)); bad.paths.offered = ["nonsense"];
    assert.equal(await page.evaluate((d) => isValidRunSave(d), bad), false, "unknown route");
    const empty = JSON.parse(JSON.stringify(snap)); empty.paths.offered = [];
    assert.equal(await page.evaluate((d) => isValidRunSave(d), empty), false, "no routes");
    await fresh();
    const old = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    delete old.paths; delete old.numbers.lastPathWave;
    assert.equal(await page.evaluate((d) => isValidRunSave(d), old), true, "older save");
    assert.deepEqual(await page.evaluate((d) => { restoreRun(d); return [nextPath, activePath, lastPathWave]; }, old), [null, null, 0]);
    await page.evaluate(() => { document.getElementById("pause-screen").classList.add("hidden"); });
  });
  await check("a new run starts clean", async () => {
    await fresh();
    await page.evaluate(() => { showPaths(["safe", "elite", "supply"]); lastPathWave = 9; activePath = PATHS.elite; nextPath = PATHS.elite; startChosenRun({ world: 0 }); });
    assert.deepEqual(await page.evaluate(() => [offeredPaths, nextPath, activePath, lastPathWave]), [null, null, null, 0]);
    assert.equal(await page.locator("#path-screen").isVisible(), false);
  });

  console.log("\nOn the screen");
  for (const [w, h] of [[320, 568], [360, 640], [390, 844], [844, 390]]) {
    await check(`all three cards fit at ${w}x${h}`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(100);
      await fresh();
      await page.evaluate(() => showPaths(["safe", "treasure", "elite"]));
      const bad = await page.evaluate(() => {
        const root = document.getElementById("path-screen").getBoundingClientRect();
        const cards = [...document.querySelectorAll(".path-card")];
        return { off: [...cards, document.querySelector("#path-screen h2"), document.getElementById("path-next")].filter((b) => { const q = b.getBoundingClientRect(); return q.top < root.top || q.bottom > root.bottom || q.left < root.left || q.right > root.right; }).length, small: cards.filter((c) => c.getBoundingClientRect().height < 44).length };
      });
      assert.deepEqual(bad, { off: 0, small: 0 });
      await page.waitForTimeout(350); // it fades in
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("path-screen")).opacity), "1");
      assert.equal(await page.evaluate(() => { const c = document.querySelector(".path-card").getBoundingClientRect(); return document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2).closest(".path-card") !== null; }), true, "the cards are on top");
      await page.screenshot({ path: path.join(scratch, `choose-your-path-${w}.png`) });
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });

  console.log("\nThai");
  await check("everything has Thai, on the real screen too", async () => {
    await page.evaluate(() => { save.lang = "th"; writeSave(); });
    await page.goto(url);
    const left = await page.evaluate(() => {
      const texts = ["Choose your path", "Elite beaten!", "Path won! +10 coins", "Every few waves, pick a route for the next one. Danger brings better rewards, or take the safe road."];
      for (const p of Object.values(PATHS)) texts.push(p.name, p.risk, p.reward);
      return texts.filter((x) => /[A-Za-z]/.test(t(x)));
    });
    assert.deepEqual(left, []);
    await page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); startChosenRun({ world: 0 }); wave = 6; nextWavePlan = { enemy: "goblin" }; showPaths(["safe", "treasure", "elite"]); });
    await page.waitForTimeout(100);
    const shown = await page.evaluate(() => [...document.querySelectorAll("#path-screen h2, .path-card b, .path-card span:not(.emoji-icon)")].map((x) => x.textContent).filter((x) => /[A-Za-z]{3}/.test(x)));
    assert.deepEqual(shown, []);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(scratch, "choose-your-path-th.png") });
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
