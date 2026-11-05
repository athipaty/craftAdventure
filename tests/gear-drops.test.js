// Gears only come from drops: monsters and bosses drop them onto the board.
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
  const fresh = (dropAt = -1) => page.evaluate((at) => {
    gameState = "playing"; boss = null; gearTray = []; wave = 3; waveTime = 10; gearDropAt = at;
    playerPower = 1000; enemyPower = 1000; marchers = []; enemyBacklog = 0; blockedCells.clear(); drag = null;
    grid.forEach((row, r) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[r][c] = null; }));
  }, dropAt);
  const GEAR_NAMES = ["soldier", "big", "booster", "bomb", "far", "lone"];
  const gears = () => page.evaluate(() => grid.flat().filter((c) => c && !c.driver).map((c) => c.level));
  const tray = () => page.evaluate(() => gearTray.map((g) => g.level));
  const stock = (...levels) => page.evaluate((ls) => { gearTray = ls.map((level) => ({ type: "soldier", level })); renderGearTray(); }, levels);
  const slotAt = (i) => page.evaluate((n) => { const b = document.querySelector(`.tray-slot[data-index="${n}"]`).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, i);
  const cellAtPage = (row, col) => page.evaluate(([r, c]) => { const b = boardCanvas.getBoundingClientRect(); return { x: b.left + (c + 0.5) * cellSize, y: b.top + (r + 0.5) * cellSize }; }, [row, col]);
  const dragTo = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 }); await page.mouse.move(to.x, to.y, { steps: 3 }); await page.mouse.up(); };

  console.log("\nDropping");
  await check("a wave's gear goes to the tray on the first hit after it's due, and only once", async () => {
    await fresh(5);
    const r = await page.evaluate(() => {
      waveTime = 4; maybeDropGear();
      const early = gearTray.length;
      waveTime = 5; maybeDropGear();
      const due = gearTray.map((g) => g.level);
      const spent = gearDropAt;
      maybeDropGear();
      return { early, due, spent, again: gearTray.length };
    });
    assert.deepEqual(r, { early: 0, due: [1], spent: -1, again: 1 });
  });
  await check("it flies there, shows in its slot when it lands, and costs nothing", async () => {
    await page.waitForFunction(() => !document.querySelector(".gear-flyer")); // the last test's
    await fresh(5);
    await page.evaluate(() => maybeDropGear());
    assert.equal(await page.locator(".gear-flyer").count(), 1);
    assert.equal(await page.locator(".tray-slot.arriving").count(), 1);
    await page.waitForFunction(() => gearTray[0] && !gearTray[0].arriving);
    await page.waitForFunction(() => !document.querySelector(".gear-flyer"));
    await page.waitForFunction(() => !document.querySelector(".tray-slot.arriving"));
    assert.equal(await page.locator(".tray-slot.full .art-icon").count(), 1);
    assert.equal(await page.evaluate(() => playerPower >= 1000), true);
    await page.screenshot({ path: path.join(scratch, "gear-tray.png") });
  });
  await check("it can't be picked up mid-flight", async () => {
    await fresh();
    await page.evaluate(() => { gearTray = [{ type: "soldier", level: 1, arriving: true }]; renderGearTray(); });
    const p = await slotAt(0);
    await page.mouse.click(p.x, p.y);
    assert.deepEqual(await gears(), []);
    assert.equal((await tray()).length, 1);
  });
  await check("it waits with no timer, and stays when the wave ends", async () => {
    await fresh();
    await stock(1);
    const r = await page.evaluate(() => { for (let i = 0; i < 300; i++) updateFx(0.5); gameState = "choosing"; updateFx(0.1); const left = gearTray.length; gameState = "playing"; return left; });
    assert.equal(r, 1);
  });
  await check("a full tray holds the next gear back instead of losing it", async () => {
    await fresh(5);
    await stock(1, 1, 1, 1, 1);
    const r = await page.evaluate(() => {
      maybeDropGear();
      const held = { n: gearTray.length, at: gearDropAt };
      gearTray.pop();
      maybeDropGear();
      return { held, after: gearTray.length, at: gearDropAt };
    });
    assert.deepEqual(r, { held: { n: 5, at: 5 }, after: 5, at: -1 });
  });
  await check("every normal wave has one, boss waves wait for the boss, in the right window", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const plans = [];
      boss = null; wave = 5;
      for (let i = 0; i < 2000; i++) plans.push(planGearDrop());
      wave = 5; boss = { hp: 1, maxHp: 1 }; const onBoss = planGearDrop(); boss = null;
      return { none: plans.filter((p) => p === NO_GEAR_DROP).length, min: Math.min(...plans), max: Math.max(...plans), onBoss };
    });
    assert.equal(r.none, 0);
    assert.ok(r.min >= 3 && r.max <= 8, `${r.min}..${r.max}`);
    assert.equal(r.onBoss, -1);
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

  console.log("\nFrom the tray to the board");
  await check("dragging puts it on the cell it was dropped on", async () => {
    await fresh();
    await stock(1);
    await dragTo(await slotAt(0), await cellAtPage(1, 1));
    assert.equal(await page.evaluate(() => grid[1][1]?.level), 1);
    assert.deepEqual(await tray(), []);
  });
  await check("the held gear shows as a faded slot, and follows on the effects layer", async () => {
    await fresh();
    await stock(1);
    const from = await slotAt(0), to = await cellAtPage(1, 1);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.waitForFunction(() => document.querySelector(".tray-slot.held"));
    const r = await page.evaluate(() => ({ x: Math.round(drag.x), tray: drag.tray, scrap: document.getElementById("scrap-zone").classList.contains("hidden") }));
    await page.screenshot({ path: path.join(scratch, "gear-tray-drag.png") });
    await page.mouse.up();
    assert.equal(r.tray, 0);
    assert.equal(r.scrap, true, "no scrapping from the tray");
  });
  await check("dropping it on a matching gear merges them", async () => {
    await fresh();
    await stock(1);
    await page.evaluate(() => { grid[1][1] = freshCell("soldier"); });
    await dragTo(await slotAt(0), await cellAtPage(1, 1));
    assert.equal(await page.evaluate(() => grid[1][1].level), 2);
    assert.deepEqual(await tray(), []);
  });
  await check("anywhere it can't go, it stays in the tray", async () => {
    await fresh();
    await stock(1);
    await page.evaluate(() => { const c = freshCell("soldier"); c.level = 3; grid[1][1] = c; blockedCells.add("2,2"); });
    await dragTo(await slotAt(0), await cellAtPage(1, 1));
    assert.equal(await page.evaluate(() => grid[1][1].level), 3, "a different gear");
    await dragTo(await slotAt(0), await cellAtPage(2, 2));
    assert.equal(await page.evaluate(() => grid[2][2]), null, "a blocked cell");
    await dragTo(await slotAt(0), await page.evaluate(() => { const b = boardCanvas.getBoundingClientRect(); return { x: b.left + (DRIVER_COL + 0.5) * cellSize, y: b.top + (DRIVER_ROW + 0.5) * cellSize }; }));
    const off = await slotAt(0);
    await dragTo(off, { x: off.x + 100, y: off.y + 60 });
    assert.deepEqual(await tray(), [1]);
    assert.equal(await page.evaluate(() => drag), null);
  });
  await check("a tap places it where a new gear would go", async () => {
    await fresh();
    await stock(1, 2);
    const spot = await page.evaluate(() => bestEmptyCell());
    const p = await slotAt(1);
    await page.mouse.click(p.x, p.y);
    assert.equal(await page.evaluate(({ row, col }) => grid[row][col]?.level, spot), 2);
    assert.deepEqual(await tray(), [1], "the other one stays");
  });
  await check("a tap with a full board leaves it in the tray", async () => {
    await fresh();
    await stock(1);
    await page.evaluate(() => { while (bestEmptyCell()) placeGear("bomb"); });
    const p = await slotAt(0);
    await page.mouse.click(p.x, p.y);
    assert.deepEqual(await tray(), [1]);
  });
  await check("it can be placed during the break too", async () => {
    await fresh();
    await stock(1);
    await page.evaluate(() => { gameState = "building"; });
    const p = await slotAt(0);
    await page.mouse.click(p.x, p.y);
    const r = await page.evaluate(() => ({ left: gearTray.length, n: grid.flat().filter((c) => c && !c.driver).length }));
    await page.evaluate(() => { gameState = "playing"; });
    assert.deepEqual(r, { left: 0, n: 1 });
  });

  console.log("\nFrom bosses");
  const bossAt = (share) => page.evaluate((s) => { boss = { kind: BOSS_KINDS[0], hp: 100 * s, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; gearDropAt = NO_GEAR_DROP; maybeDropGear(); return gearTray.map((g) => g.level); }, share);
  await check("a boss drops a level 2 gear at half health, and only one", async () => {
    await fresh();
    assert.deepEqual(await bossAt(0.51), [], "above half");
    await page.evaluate(() => { boss = null; });
    assert.deepEqual(await bossAt(0.5), [2], "at half");
    const again = await page.evaluate(() => { boss.hp = 10; maybeDropGear(); const n = gearTray.length; boss = null; return n; });
    assert.equal(again, 1);
  });
  await check("a few drops are special gears, and the rest are soldier gears", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const count = {};
      for (let i = 0; i < 20000; i++) { const type = droppedGearType(); count[type] = (count[type] || 0) + 1; }
      return count;
    });
    const special = (20000 - r.soldier) / 20000;
    assert.ok(special > 0.13 && special < 0.17, `share ${special}`);
    for (const type of ["big", "booster", "bomb", "far", "lone"]) assert.ok(r[type] > 0, `never dropped ${type}`);
    assert.deepEqual(Object.keys(r).filter((type) => !GEAR_NAMES.includes(type)), []);
  });
  await check("a special drop goes into the tray and works from there", async () => {
    await fresh(5);
    const keep = await page.evaluate(() => { window.keepRandom = runRandom; runRandom = () => { const seq = [0, 0]; return () => seq.shift() ?? 0; }; maybeDropGear(); runRandom = window.keepRandom; return gearTray.map((g) => g.type); });
    assert.deepEqual(keep, ["big"]);
    await page.waitForFunction(() => !gearTray[0].arriving);
    await dragTo(await slotAt(0), await cellAtPage(1, 1));
    assert.equal(await page.evaluate(() => grid[1][1]?.type), "big");
  });
  await check("gears not unlocked yet don't drop", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const waves = save.stats.waves;
      save.stats.waves = 0;
      const seen = new Set();
      for (let i = 0; i < 20000; i++) seen.add(droppedGearType());
      save.stats.waves = waves;
      return [...seen];
    });
    assert.ok(!r.includes("far") && !r.includes("lone"), r.join());
  });
  await check("no special drops past the cap, counting the tray; Bomb Week stays all bombs", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const many = (n) => { const seen = new Set(); for (let i = 0; i < n; i++) seen.add(droppedGearType()); return [...seen]; };
      gearTray = Array.from({ length: specialGearCap() }, () => ({ type: "big", level: 1 }));
      const capped = many(5000);
      const offered = canOfferSpecialGear();
      gearTray = [];
      const keep = currentEvent;
      currentEvent = WEEKLY_EVENTS.find((e) => e.id === "bombs");
      const bombs = many(5000);
      currentEvent = keep;
      return { capped, offered, bombs };
    });
    assert.deepEqual(r, { capped: ["soldier"], offered: false, bombs: ["bomb"] });
  });
  await check("a daily challenge drops the same type for everyone", async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const keep = currentDaily;
      currentDaily = { day: "2026-11-05" };
      const types = [];
      for (let w = 1; w <= 200; w++) { wave = w; const once = droppedGearType(); if (droppedGearType() !== once) types.push(w); }
      currentDaily = keep; wave = 3;
      return types;
    });
    assert.deepEqual(r, []);
  });
  await check("a full tray keeps a boss's gear for later", async () => {
    await fresh();
    await stock(1, 1, 1, 1, 1);
    const r = await page.evaluate(() => {
      boss = { kind: BOSS_KINDS[0], hp: 10, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0 };
      maybeDropGear();
      const held = boss.gearDropped;
      gearTray.pop(); maybeDropGear();
      const out = { held: Boolean(held), got: gearTray.at(-1).level };
      boss = null;
      return out;
    });
    assert.deepEqual(r, { held: false, got: 2 });
  });

  console.log("\nNo more buying");
  await check("the Buy button and its upgrades are gone, and an old save with them still loads", async () => {
    await fresh();
    const gone = await page.evaluate(() => ({
      button: document.getElementById("buy-gear-btn"),
      reward: REWARDS.some((x) => x.id === "cheaperGears"),
      upgrade: UPGRADES.some((x) => x.id === "discount"),
      quest: QUEST_KINDS.some((x) => x.kind === "buys"),
      event: WEEKLY_EVENTS.some((x) => x.id === "bargain"),
      rule: "pricy" in RULES,
    }));
    assert.deepEqual(gone, { button: null, reward: false, upgrade: false, quest: false, event: false, rule: false });
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    Object.assign(snap.numbers, { gearsBought: 7, gearPriceScale: 0.8 });
    snap.rules = ["pricy", "rusty"];
    const r = await page.evaluate((d) => { const ok = isValidRunSave(d); restoreRun(d); return { ok, rules: runRules, text: rulesText(runRules) }; }, snap);
    assert.equal(r.ok, true);
    assert.deepEqual(r.rules, ["rusty"]);
    assert.ok(!r.text.includes("undefined"), r.text);
    await page.evaluate(() => { runRules = []; });
  });
  await check("an old daily quest to buy gears is dropped, not left impossible", async () => {
    const r = await page.evaluate(() => isValidQuest({ kind: "buys", target: 8, reward: 10, progress: 0, done: false }));
    assert.equal(r, false);
  });
  await check("scrapping pays more with a bigger machine", async () => {
    await fresh();
    const r = await page.evaluate(() => { const small = scrapRefund(); for (let i = 0; i < 12; i++) placeGear("soldier"); return { small, big: scrapRefund() }; });
    assert.ok(r.big > r.small, JSON.stringify(r));
  });

  console.log("\nReloading");
  await check("gears in the tray survive a reload, without being dropped twice", async () => {
    await fresh();
    await page.evaluate(() => { gearTray = [{ type: "soldier", level: 1, arriving: true }, { type: "bomb", level: 2 }]; boss = { kind: BOSS_KINDS[0], hp: 40, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0, gearDropped: true }; });
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    assert.deepEqual(snap.tray, [{ type: "soldier", level: 1 }, { type: "bomb", level: 2 }]);
    assert.equal(snap.numbers.gearDropAt, -1);
    assert.equal(await page.evaluate((d) => isValidRunSave(d), snap), true);
    const r = await page.evaluate((d) => { gearTray = []; gearDropAt = 5; boss = null; restoreRun(d); maybeDropGear(); const out = { at: gearDropAt, n: gearTray.length, type: gearTray[1].type, level: gearTray[1].level }; boss = null; return out; }, snap);
    assert.deepEqual(r, { at: -1, n: 2, type: "bomb", level: 2 });
  });
  await check("a due gear survives a reload, and older saves still load", async () => {
    await fresh(9);
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    assert.equal(await page.evaluate((d) => { restoreRun(d); return gearDropAt; }, snap), 9);
    delete snap.numbers.gearDropAt;
    delete snap.tray;
    assert.equal(await page.evaluate((d) => isValidRunSave(d), snap), true);
    assert.deepEqual(await page.evaluate((d) => { restoreRun(d); return [gearDropAt, gearTray.length]; }, snap), [-1, 0]);
  });
  await check("a bad tray in a save is cleaned up, and a new run starts empty", async () => {
    await fresh();
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    snap.tray = [{ type: "nonsense", level: 1 }, { type: "soldier", level: 99 }, null, { type: "soldier", level: 1 }];
    assert.deepEqual(await page.evaluate((d) => { restoreRun(d); return gearTray; }, snap), [{ type: "soldier", level: 1 }]);
  });

  console.log("\nIn a real wave");
  await check("playing a wave for real sends one to the tray, and dragging it works", async () => {
    await fresh(3);
    await page.evaluate(() => { waveTime = 3; sendMarcher("player", 1); });
    await page.waitForFunction(() => gearTray.length > 0 && !gearTray[0].arriving, null, { timeout: 8000 });
    await dragTo(await slotAt(0), await cellAtPage(0, 6));
    assert.equal(await page.evaluate(() => grid[0][6]?.level), 1);
  });

  console.log("\nFitting on the screen");
  for (const [w, h] of [[320, 568], [360, 640], [390, 844], [430, 932]]) {
    await check(`the tray fits between the board and the buttons at ${w}x${h}`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      await fresh();
      await stock(1, 2, 1, 1, 1);
      await page.waitForTimeout(50);
      const r = await page.evaluate(() => {
        const box = (id) => document.getElementById(id).getBoundingClientRect();
        const tray = box("gear-tray"), board = box("board-canvas"), row = box("action-row");
        const slots = [...document.querySelectorAll(".tray-slot")].map((s) => s.getBoundingClientRect());
        return { overBoard: tray.top < board.bottom - 1, overRow: tray.bottom > row.top + 1, inside: slots.every((s) => s.left >= 0 && s.right <= innerWidth), slot: slots[0].width, cell: cellSize, scroll: document.documentElement.scrollWidth - innerWidth, n: slots.length };
      });
      assert.equal(r.overBoard, false); assert.equal(r.overRow, false); assert.equal(r.inside, true);
      assert.equal(r.scroll, 0); assert.equal(r.n, 5);
      assert.ok(r.slot >= 38, `slot ${r.slot}`);
      assert.ok(r.cell >= 30, `cell ${r.cell}`);
      await page.screenshot({ path: path.join(scratch, `gear-tray-${w}.png`) });
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });

  console.log("\nExplaining it");
  await check("the guide and the first drop explain it, in English and Thai", async () => {
    const r = await page.evaluate(() => {
      const tip = TIPS.find((t) => t.id === "gearDrop");
      gearTray = [{ type: "soldier", level: 1 }]; const shows = Boolean(tip.when()); gearTray = []; const hides = Boolean(tip.when());
      return { shows, hides, target: tip.target, text: tip.text };
    });
    assert.deepEqual([r.shows, r.hides, r.target], [true, false, "#gear-tray"]);
    await page.evaluate(() => { save.lang = "th"; writeSave(); });
    await page.goto(url);
    const left = await page.evaluate((text) => ["Free gear", text, "The only way to get more gears. Monsters drop them into the tray below the board, and every boss drops a level 2 gear at half health. A few are special gears. Drag one onto the board, or tap it."].filter((x) => /[A-Za-z]{3}/.test(t(x))), r.text);
    assert.deepEqual(left, []);
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
