// After the first wave the player picks a build: the plan for the whole run.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), assert = require("assert");
const root = path.join(__dirname, "..", "public");
const scratch = path.join(__dirname, "screenshots");
fs.mkdirSync(scratch, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((q, s) => { const n = q.url.split("?")[0].replace(/^\/$/, "/index.html"); if (n === "/sw.js") { s.writeHead(404); s.end(); return; } fs.readFile(path.join(root, n), (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { "content-type": types[path.extname(n)] || "application/octet-stream" }); s.end(d); } }); });
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
  const setUp = async (waves = 100) => {
    await page.goto(url);
    await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
    await page.goto(url);
    await page.evaluate((n) => { save.stats.waves = n; for (const t of TIPS) save.tips[t.id] = true; writeSave(); }, waves);
    await page.goto(url);
    await hide();
    await page.evaluate(() => startChosenRun({ world: 0 }));
  };
  // Wins wave 1 for real, then takes the first reward on offer.
  const winFirstWave = async () => {
    await page.evaluate(() => { playerPower = 1e6; enemyPower = 1; });
    await page.waitForSelector("#reward-screen:not(.hidden)");
    await page.waitForTimeout(500);
    await page.locator(".reward-option").first().click();
  };
  const opened = () => page.waitForFunction(() => performance.now() - rewardOpenedAt >= REWARD_CLICK_DELAY_MS);

  console.log("\nWhen it comes");
  await check("after the first wave's reward, three builds to choose from", async () => {
    await setUp();
    await winFirstWave();
    assert.equal(await page.evaluate(() => gameState), "plan");
    assert.equal(await page.locator("#build-screen").isVisible(), true);
    assert.equal(await page.locator(".build-card").count(), 3);
    const ids = await page.evaluate(() => offeredBuilds);
    assert.equal(new Set(ids).size, 3);
    assert.ok(await page.evaluate((list) => list.every((id) => id in BUILDS), ids));
    await page.screenshot({ path: path.join(scratch, "builds.png") });
  });
  await check("only once a run, and not for a new player", async () => {
    await page.evaluate(() => chooseBuild(offeredBuilds[0]));
    assert.equal(await page.evaluate(() => buildChoiceDue()), false);
    await setUp(5);
    await winFirstWave();
    assert.notEqual(await page.evaluate(() => gameState), "plan");
    assert.equal(await page.evaluate(() => runBuild), null);
  });
  await check("a new run forgets the last build", async () => {
    await setUp();
    await page.evaluate(() => { runBuild = "storm"; startChosenRun({ world: 0 }); });
    assert.equal(await page.evaluate(() => runBuild), null);
  });
  await check("the same three for everyone on the same daily", async () => {
    await setUp();
    const r = await page.evaluate(() => {
      const day = makeDaily(todayKey());
      const once = () => { startChosenRun({ world: day.world, daily: day }); return pickBuilds(); };
      return [once(), once()];
    });
    assert.deepEqual(r[0], r[1]);
  });

  console.log("\nPicking one");
  await check("each card shows its name, perk, cost and starting gear, and tapping it picks it", async () => {
    await setUp();
    await winFirstWave();
    const r = await page.evaluate(() => [...document.querySelectorAll(".build-card")].map((c) => [...c.querySelectorAll("b, span:not(.emoji-icon)")].map((x) => x.textContent)));
    const want = await page.evaluate(() => offeredBuilds.map((id) => [BUILDS[id].name, BUILDS[id].perk, BUILDS[id].cost, BUILDS[id].start]));
    assert.deepEqual(r, want);
    await opened();
    const first = await page.evaluate(() => offeredBuilds[0]);
    await page.locator(".build-card").first().click();
    assert.equal(await page.evaluate(() => runBuild), first);
    assert.equal(await page.locator("#build-screen").isVisible(), false);
    assert.notEqual(await page.evaluate(() => gameState), "plan");
  });
  await check("each build hands over its starting gear", async () => {
    await setUp();
    for (const [id, want] of [["combo", [["soldier", 2], ["soldier", 2]]], ["bomb", [["bomb", 1]]], ["engine", [["booster", 1]]], ["storm", [["spark", 1]]]]) {
      const tray = await page.evaluate((b) => { clearBuilds(); gearTray = []; gameState = "plan"; offeredBuilds = [b]; chooseBuild(b); return gearTray.map((g) => [g.type, g.level]); }, id);
      assert.deepEqual(tray, want, id);
    }
  });
  await check("a reload brings the same choice back", async () => {
    await setUp();
    await winFirstWave();
    const ids = await page.evaluate(() => { saveRun(); return offeredBuilds; });
    await page.reload();
    await hide();
    await page.click("#continue-btn");
    await page.waitForSelector("#build-screen:not(.hidden)");
    assert.deepEqual(await page.evaluate(() => offeredBuilds), ids);
    await opened();
    await page.locator(".build-card").nth(1).click();
    await page.evaluate(() => saveRun());
    await page.reload();
    await hide();
    await page.click("#continue-btn");
    assert.equal(await page.evaluate(() => runBuild), ids[1]);
  });

  console.log("\nWhat they do");
  await check("each perk and cost is what its card says", async () => {
    await setUp();
    const r = await page.evaluate(() => {
      const read = () => ({ soldier: gearPartPayout("soldier"), bomb: gearPartPayout("bomb"), big: gearPartPayout("big"), lightning: strikeRecharge(), overdrive: overdriveRecharge(), combo: comboLinePayout(3) });
      const as = (id) => { const speed = driverTurnsPerSec; clearBuilds(); if (id) chooseBuild(id); const out = { ...read(), speed: driverTurnsPerSec / speed }; driverTurnsPerSec = speed; return out; };
      const plain = as(null);
      const out = {};
      for (const id of Object.keys(BUILDS)) out[id] = as(id);
      return { plain, ...out };
    });
    const ratio = (id, key) => Math.round((r[id][key] / r.plain[key]) * 100) / 100;
    assert.equal(ratio("combo", "lightning"), 1.3);
    assert.equal(r.combo.combo, 1.5, "a 3-line pays +50% instead of +25%");
    assert.equal(ratio("bomb", "bomb"), 1.5);
    assert.equal(ratio("bomb", "soldier"), 0.8);
    assert.equal(ratio("bomb", "big"), 1, "only normal gears pay less");
    assert.equal(r.engine.speed, 1.2);
    assert.equal(ratio("engine", "overdrive"), 1.5);
    assert.equal(ratio("storm", "lightning"), 0.85);
    assert.equal(ratio("storm", "soldier"), 0.8);
  });
  await check("Storm caller's Lightning hits 30% harder, and Twin strike doubles it", async () => {
    await setUp();
    const r = await page.evaluate(() => {
      gameState = "playing"; boss = null;
      const hit = () => { strikeCooldown = 0; enemyPower = 1e9; strikeEnemy(); return 1e9 - enemyPower; };
      clearBuilds(); const plain = hit();
      runBuild = "storm"; const storm = hit();
      runParts.twinStrike = 1; const twin = hit();
      delete runParts.twinStrike; clearBuilds();
      return [storm / plain, twin / plain].map((x) => Math.round(x * 100) / 100);
    });
    assert.deepEqual(r, [1.3, 2.6]);
  });
  await check("its own rewards come up more often, and its epic only for it, from wave 8", async () => {
    await setUp();
    const r = await page.evaluate(() => {
      const count = (id, build, w) => {
        clearBuilds(); runBuild = build; wave = w; let n = 0;
        for (let i = 0; i < 300; i++) { rerollsLeft = i; if (pickRewards(false).some((x) => x.id === id)) n++; }
        return n;
      };
      runParts = {}; grid[DRIVER_ROW][DRIVER_COL + 1] = freshCell("soldier"); grid[DRIVER_ROW][DRIVER_COL + 1].level = 2;
      const out = { cooling: [count("cooling", null, 9), count("cooling", "storm", 9)], epic: [count("twinStrike", "storm", 7), count("twinStrike", "storm", 9), count("twinStrike", "combo", 9), count("twinStrike", null, 9)] };
      clearBuilds();
      return out;
    });
    assert.ok(r.cooling[1] > r.cooling[0] * 1.5, `favoured ${r.cooling}`);
    assert.equal(r.epic[0], 0, "not before wave 8");
    assert.ok(r.epic[1] > 0, "its own build");
    assert.deepEqual(r.epic.slice(2), [0, 0], "no other build, and not without one");
  });
  await check("Combo engine pays 5% more for every combo on the board", async () => {
    await setUp();
    const r = await page.evaluate(() => {
      grid.forEach((row, rr) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[rr][c] = null; }));
      for (const c of [0, 1, 2]) { const cell = freshCell("soldier"); cell.level = 2; grid[0][c] = cell; }
      for (const c of [0, 1, 2]) { const cell = freshCell("big"); cell.level = 2; grid[6][c] = cell; }
      updateCombos();
      runParts.comboEngine = 1;
      const out = gearPartPayout("big");
      delete runParts.comboEngine;
      return out;
    });
    assert.equal(Math.round(r * 100) / 100, 1.1);
  });
  await check("Perpetual motion: each working Booster speeds the main gear by 5%", async () => {
    await setUp();
    const r = await page.evaluate(() => {
      grid.forEach((row, rr) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[rr][c] = null; }));
      grid[0][0] = freshCell("booster"); grid[0][2] = freshCell("engine"); grid[0][4] = freshCell("booster"); grid[0][4].rusted = true;
      const before = buildSpin();
      runParts.perpetual = 1;
      const after = buildSpin();
      delete runParts.perpetual;
      return [before, Math.round(after * 100) / 100];
    });
    assert.deepEqual(r, [1, 1.1]);
  });
  await check("Chain blast hits the gears touching a bomb, but never sets off another blast", async () => {
    await setUp();
    const r = await page.evaluate(() => {
      grid.forEach((row, rr) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[rr][c] = null; }));
      grid[0][1] = freshCell("bomb"); grid[0][0] = freshCell("soldier"); grid[0][2] = freshCell("bomb"); grid[1][1] = freshCell("big");
      runParts.chainBlast = 1;
      hitGear({ row: 0, col: 1, spin: 0 }, GEAR_TYPES.bomb.hits);
      delete runParts.chainBlast;
      return [grid[0][0].ticks, grid[0][2].ticks, grid[1][1].ticks, grid[0][1].ticks];
    });
    assert.deepEqual(r, [1, 0, 1, 0]);
  });

  console.log("\nOn screen");
  await check("the build shows in the status row, and the guide explains every build", async () => {
    await setUp();
    await page.evaluate(() => { runBuild = "engine"; updateStatusRow(); });
    assert.ok(await page.evaluate(() => [...document.querySelectorAll("#status-chips .status-chip")].some((c) => c.dataset.name === "Gear engine")));
    const guide = await page.evaluate(() => guideSections().find(([title]) => title === "Builds")[1].map((row) => row[0]));
    const names = await page.evaluate(() => Object.values(BUILDS).map((b) => b.name));
    assert.deepEqual(guide.slice(1), names);
  });
  for (const [w, h] of [[320, 568], [360, 640], [390, 844], [844, 390]]) {
    await check(`all three cards fit at ${w}x${h}`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate(() => showBuilds(["combo", "storm", "bomb"]));
      const r = await page.evaluate(() => {
        const screen = document.getElementById("build-screen").getBoundingClientRect();
        const cards = [...document.querySelectorAll(".build-card")].map((c) => c.getBoundingClientRect());
        const clipped = [...document.querySelectorAll(".build-card span, .build-card b")].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent);
        return { inside: cards.every((c) => c.top >= screen.top && c.bottom <= screen.bottom && c.left >= screen.left && c.right <= screen.right), clipped };
      });
      assert.equal(r.inside, true);
      assert.deepEqual(r.clipped, []);
      await page.screenshot({ path: path.join(scratch, `builds-${w}x${h}.png`) });
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });

  console.log("\nThai");
  await check("everything has Thai, on the real screen too", async () => {
    await setUp();
    const list = await page.evaluate(() => {
      const out = ["Choose your build", "Your plan for this run", FEATURE_NEWS.builds, "Build: Storm caller!"];
      for (const b of Object.values(BUILDS)) out.push(b.name, b.perk, b.cost, b.start, b.text);
      for (const r of REWARDS.filter((x) => x.build)) out.push(r.name, r.text, REWARD_CHANGES[r.id].label);
      return out;
    });
    await page.evaluate(() => { save.lang = "th"; writeSave(); });
    await page.goto(url);
    await hide();
    const left = await page.evaluate((texts) => texts.filter((x) => /[A-Za-z]{2}/.test(t(x))), list);
    assert.deepEqual(left, []);
    await page.evaluate(() => { startChosenRun({ world: 0 }); showBuilds(["combo", "engine", "storm"]); });
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(scratch, "builds-th.png") });
    const shown = await page.evaluate(() => [...document.querySelectorAll("#build-screen h2, #build-screen p, .build-card b, .build-card span:not(.emoji-icon)")].map((x) => x.textContent).filter((x) => /[A-Za-z]{3}/.test(x)));
    assert.deepEqual(shown, []);
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
