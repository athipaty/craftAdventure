// Two different special gears of the same level fuse into a new, stronger one.
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

  const lay = (cells) => page.evaluate((list) => {
    clearTimeout(rewardTimer);
    for (const id of ["reward-screen", "path-screen", "chest-screen", "build-bar", "pause-screen"]) document.getElementById(id).classList.add("hidden");
    gameState = "playing"; boss = null; runParts = {}; blockedCells.clear(); gearTray = []; drag = null; wave = 3; waveTime = 1; gearDropAt = NO_GEAR_DROP; treasureAt = NO_GEAR_DROP; hotStreak = 0; playerPower = 1000; enemyPower = 1000; marchers = []; enemyBacklog = 0;
    grid.forEach((row, r) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[r][c] = null; }));
    for (const [r, c, type, level = 1] of list) { const cell = freshCell(type); cell.level = level; grid[DRIVER_ROW + r][DRIVER_COL + c] = cell; }
    markCombos();
  }, cells);
  const at = (r, c) => page.evaluate(([a, b]) => { const x = grid[DRIVER_ROW + a][DRIVER_COL + b]; return x && [x.type, x.level]; }, [r, c]);
  const centre = (r, c) => page.evaluate(([a, b]) => { const q = boardCanvas.getBoundingClientRect(); return { x: q.left + (DRIVER_COL + b + 0.5) * cellSize, y: q.top + (DRIVER_ROW + a + 0.5) * cellSize }; }, [r, c]);
  const dragTo = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 }); await page.mouse.move(to.x, to.y, { steps: 3 }); await page.mouse.up(); };

  console.log("\nWhat can fuse");
  await check("every recipe works either way round, and makes its own gear", async () => {
    const r = await page.evaluate(() => FUSIONS.map((f) => { const a = freshCell(f.parts[0]), b = freshCell(f.parts[1]); return [fusionOf(a, b)?.gear, fusionOf(b, a)?.gear, f.gear, Boolean(GEAR_TYPES[f.gear])]; }));
    assert.equal(r.length, 4);
    for (const [one, two, want, exists] of r) { assert.equal(one, want); assert.equal(two, want); assert.equal(exists, true); }
  });
  await check("levels must match, and other pairs don't fuse", async () => {
    const r = await page.evaluate(() => {
      const make = (t, l = 1) => { const c = freshCell(t); c.level = l; return c; };
      const driver = make("big"); driver.driver = true;
      const same = make("big");
      return {
        levels: canFuse(make("big", 2), make("bomb", 1)),
        sameLevels: canFuse(make("big", 3), make("bomb", 3)),
        sameType: canFuse(make("big"), make("big")),
        plain: canFuse(make("soldier"), make("bomb")),
        noRecipe: canFuse(make("far"), make("lone")),
        driver: canFuse(make("big"), driver),
        itself: canFuse(same, same),
        empty: canFuse(make("big"), null),
        fused: canFuse(make("cannon"), make("bomb")),
      };
    });
    assert.deepEqual(r, { levels: false, sameLevels: true, sameType: false, plain: false, noRecipe: false, driver: false, itself: false, empty: false, fused: false });
  });

  console.log("\nFusing by hand");
  await check("dragging one onto the other fuses them at the target, freeing a cell", async () => {
    await lay([[0, 1, "big"], [1, 1, "bomb"]]);
    await dragTo(await centre(0, 1), await centre(1, 1));
    assert.deepEqual(await at(1, 1), ["cannon", 1]);
    assert.equal(await at(0, 1), null);
    assert.equal(await page.locator("#combo-toast").textContent(), "Fusion: Cannon gear!");
  });
  await check("the level carries over", async () => {
    await lay([[0, 1, "big", 3], [1, 1, "booster", 3]]);
    await dragTo(await centre(0, 1), await centre(1, 1));
    assert.deepEqual(await at(1, 1), ["dynamo", 3]);
  });
  await check("a gear from the tray can fuse too", async () => {
    await lay([[1, 1, "bomb"]]);
    await page.evaluate(() => { gearTray = [{ type: "far", level: 1 }]; renderGearTray(); });
    const slot = await page.evaluate(() => { const q = document.querySelector('.tray-slot[data-index="0"]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
    await dragTo(slot, await centre(1, 1));
    assert.deepEqual(await at(1, 1), ["comet", 1]);
    assert.equal(await page.evaluate(() => gearTray.length), 0);
  });
  await check("gears that can't fuse just swap, and matching ones still merge", async () => {
    await lay([[0, 1, "big", 2], [1, 1, "bomb", 1]]);
    await dragTo(await centre(0, 1), await centre(1, 1));
    assert.deepEqual([await at(0, 1), await at(1, 1)], [["bomb", 1], ["big", 2]]);
    await lay([[0, 1, "big"], [1, 1, "big"]]);
    await dragTo(await centre(0, 1), await centre(1, 1));
    assert.deepEqual(await at(1, 1), ["big", 2]);
    assert.equal(await at(0, 1), null);
  });
  await check("fused gears of the same kind merge up as usual", async () => {
    await lay([[0, 1, "cannon"], [1, 1, "cannon"]]);
    await dragTo(await centre(0, 1), await centre(1, 1));
    assert.deepEqual(await at(1, 1), ["cannon", 2]);
  });
  await check("the drag preview matches the real result", async () => {
    await lay([[0, 1, "big"], [0, 2, "bomb"], [0, 3, "soldier"]]);
    const r = await page.evaluate(() => {
      const from = grid[DRIVER_ROW][DRIVER_COL + 2];
      drag = { row: DRIVER_ROW, col: DRIVER_COL + 2, cell: from, x: 0, y: 0 };
      const target = { row: DRIVER_ROW, col: DRIVER_COL + 1, cell: grid[DRIVER_ROW][DRIVER_COL + 1] };
      const before = JSON.stringify(grid.map((row) => row.map((c) => c && c.type)));
      const predicted = previewDropRate(target);
      const unchanged = before === JSON.stringify(grid.map((row) => row.map((c) => c && c.type)));
      drag = null;
      grid[DRIVER_ROW][DRIVER_COL + 2] = null;
      fuseOnto(from, target.row, target.col);
      markCombos();
      return { predicted, actual: machineRate(), unchanged };
    });
    assert.equal(r.unchanged, true);
    assert.ok(Math.abs(r.predicted - r.actual) < 1e-9, JSON.stringify(r));
  });
  await check("the same preview works from the tray", async () => {
    await lay([[0, 1, "bomb"]]);
    const r = await page.evaluate(() => {
      const cell = freshCell("big");
      drag = { tray: 0, cell, row: -1, col: -1, x: 0, y: 0 };
      const target = { row: DRIVER_ROW, col: DRIVER_COL + 1, cell: grid[DRIVER_ROW][DRIVER_COL + 1] };
      const predicted = previewDropRate(target);
      const kept = grid[target.row][target.col].type;
      drag = null;
      fuseOnto(cell, target.row, target.col);
      markCombos();
      return { predicted, actual: machineRate(), kept };
    });
    assert.equal(r.kept, "bomb");
    assert.ok(Math.abs(r.predicted - r.actual) < 1e-9, JSON.stringify(r));
  });

  console.log("\nWhat they do");
  await check("each fused gear out-produces the two gears it came from", async () => {
    for (const [a, b, fused] of [["big", "bomb", "cannon"], ["far", "bomb", "comet"], ["lone", "big", "hermit"]]) {
      await lay([[0, 1, a], [0, 2, b]]);
      const parts = await page.evaluate(() => machineRate());
      await lay([[0, 1, fused]]);
      const one = await page.evaluate(() => machineRate());
      assert.ok(one > parts, `${fused}: ${parts} then ${one}`);
    }
  });
  await check("a Cannon really sends soldiers and blasts when it fills", async () => {
    await lay([[0, 1, "cannon"]]);
    const r = await page.evaluate(() => {
      const realS = sendSoldiers, realB = launchBomb; let soldiers = 0, bombs = 0;
      sendSoldiers = (n) => { soldiers += n; }; launchBomb = (n) => { bombs += n; };
      const cell = grid[DRIVER_ROW][DRIVER_COL + 1];
      hitGear({ row: DRIVER_ROW, col: DRIVER_COL + 1, spin: 1 }, GEAR_TYPES.cannon.hits);
      sendSoldiers = realS; launchBomb = realB;
      return { soldiers, bombs, ticks: cell.ticks };
    });
    assert.deepEqual(r, { soldiers: 6, bombs: 3, ticks: 0 });
  });
  await check("a Dynamo boosts its neighbours and restores the chain, and they glow", async () => {
    await lay([[0, 1, "dynamo"], [0, 2, "soldier"]]);
    const r = await page.evaluate(() => ({ boost: boostersTouching(DRIVER_ROW, DRIVER_COL + 2), glow: boostedGears().map((g) => g.col - DRIVER_COL), rateWith: machineRate() }));
    assert.equal(r.boost, 1);
    assert.ok(r.glow.includes(2));
    await lay([[0, 1, "big"], [0, 2, "soldier"]]);
    assert.ok(r.rateWith > await page.evaluate(() => machineRate()), "better than a plain Big gear");
  });
  await check("a Comet pays more far away, and a Hermit more with empty sides", async () => {
    const r = await page.evaluate(() => {
      const place = (dr, dc, t) => { grid[DRIVER_ROW + dr][DRIVER_COL + dc] = freshCell(t); };
      const pay = (dr, dc) => gearPlacePayout(DRIVER_ROW + dr, DRIVER_COL + dc);
      grid.forEach((row, a) => row.forEach((c, b) => { if (c && !c.driver) grid[a][b] = null; }));
      place(0, 1, "comet"); const near = pay(0, 1); grid[DRIVER_ROW][DRIVER_COL + 1] = null;
      place(0, 3, "comet"); const away = pay(0, 3); grid[DRIVER_ROW][DRIVER_COL + 3] = null;
      place(-3, -3, "hermit"); const corner = pay(-3, -3); grid[DRIVER_ROW - 3][DRIVER_COL - 3] = null;
      place(-1, -1, "hermit"); const open = pay(-1, -1); grid[DRIVER_ROW - 1][DRIVER_COL - 1] = null;
      return { near, away, corner, open };
    });
    assert.ok(r.away > r.near, JSON.stringify(r));
    assert.ok(r.open > r.corner, JSON.stringify(r));
  });
  await check("reward parts apply to the jobs a fused gear does", async () => {
    const r = await page.evaluate(() => {
      runParts = { heavyLoad: 1 }; const heavy = gearPartPayout("cannon");
      runParts = { demolition: 1 }; const blast = gearPartPayout("cannon");
      runParts = { heavyLoad: 1, demolition: 1 }; const both = gearPartPayout("cannon");
      const plain = gearPartPayout("soldier");
      const oldBig = gearPartPayout("big");
      runParts = {};
      return { heavy, blast, both, plain, oldBig };
    });
    assert.ok(Math.abs(r.heavy - 1.4) < 1e-9); assert.ok(Math.abs(r.blast - 1.5) < 1e-9); assert.ok(Math.abs(r.both - 2.1) < 1e-9);
    assert.equal(r.plain, 1); assert.ok(Math.abs(r.oldBig - 1.4) < 1e-9);
  });
  await check("the rewards still offered depend on the job, so fusing doesn't lock any out", async () => {
    await lay([[0, 1, "cannon"]]);
    const r = await page.evaluate(() => [boardHasGear("bomb"), boardHasGear("big"), boardHasGear("booster")]);
    assert.deepEqual(r, [true, true, false]);
    await lay([[0, 1, "dynamo"]]);
    assert.deepEqual(await page.evaluate(() => [boardHasGear("bomb"), boardHasGear("big"), boardHasGear("booster")]), [false, true, true]);
  });
  await check("fusing makes room under the special gear cap", async () => {
    await lay([[0, 1, "big"], [0, 2, "bomb"]]);
    const r = await page.evaluate(() => { const before = specialGearCount(); const from = grid[DRIVER_ROW][DRIVER_COL + 1]; grid[DRIVER_ROW][DRIVER_COL + 1] = null; fuseOnto(from, DRIVER_ROW, DRIVER_COL + 2); return [before, specialGearCount()]; });
    assert.deepEqual(r, [2, 1]);
  });

  console.log("\nCollecting and saving");
  await check("a new fusion goes in the book, shown as a mystery until then", async () => {
    await lay([[0, 1, "big"], [1, 1, "bomb"]]);
    await page.evaluate(() => { delete save.collection["gear:cannon"]; delete save.collection["page:gears"]; });
    const entry = await page.evaluate(() => bookPages().find((p) => p.id === "gears").entries.find((e) => e.id === "gear:cannon"));
    assert.equal(entry.name, "Cannon gear");
    assert.equal(await page.evaluate(() => bookKnows(bookPages()[2].entries.find((e) => e.id === "gear:cannon"))), false);
    await dragTo(await centre(0, 1), await centre(1, 1));
    assert.equal(await page.evaluate(() => Boolean(save.collection["gear:cannon"])), true);
  });
  await check("a fused gear survives a reload, on the board and in the tray", async () => {
    await lay([[0, 1, "comet", 2]]);
    await page.evaluate(() => { gearTray = [{ type: "hermit", level: 1 }]; });
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    assert.equal(await page.evaluate((d) => isValidRunSave(d), snap), true);
    const r = await page.evaluate((d) => { restoreRun(d); return { cell: [grid[DRIVER_ROW][DRIVER_COL + 1].type, grid[DRIVER_ROW][DRIVER_COL + 1].level], tray: gearTray.map((g) => g.type) }; }, snap);
    assert.deepEqual(r, { cell: ["comet", 2], tray: ["hermit"] });
  });
  await check("fusing 5 times earns the achievement", async () => {
    const r = await page.evaluate(() => { const c = save.coins; delete save.achievements.fusions5; save.stats.fusions = 4; recordStat("fusions"); return { has: Boolean(save.achievements.fusions5), paid: save.coins - c }; });
    assert.deepEqual(r, { has: true, paid: 40 });
  });

  console.log("\nOn the screen");
  await check("each fused gear has its own look and mark", async () => {
    const r = await page.evaluate(() => {
      const looks = FUSIONS.map((f) => gearIcon(f.gear).toDataURL());
      const marks = FUSIONS.map((f) => GEAR_TYPES[f.gear].mark);
      return { unique: new Set(looks).size, marks, painted: FUSIONS.every((f) => { const c = gearIcon(f.gear); return c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data[3] > 0; }) };
    });
    assert.deepEqual(r, { unique: 4, marks: ["CAN", "DYN", "COM", "HER"], painted: true });
  });
  await check("holding a gear rings what it can fuse with", async () => {
    await lay([[0, 1, "big"], [1, 1, "bomb"], [-1, 1, "soldier"]]);
    const from = await centre(0, 1);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 3, from.y + 26, { steps: 2 });
    await page.waitForTimeout(80);
    const r = await page.evaluate(() => {
      save.lessMotion = true; drawBoard(); save.lessMotion = false;
      const scale = boardCanvas.width / boardCssW;
      const ctx = boardCanvas.getContext("2d");
      const cx = (DRIVER_COL + 1 + 0.5) * cellSize, cy = (DRIVER_ROW + 1 + 0.5) * cellSize;
      let purple = 0;
      for (let a = 0; a < 360; a += 5) {
        const x = cx + Math.cos(a * Math.PI / 180) * cellSize * 0.49, y = cy + Math.sin(a * Math.PI / 180) * cellSize * 0.49;
        const d = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
        if (d[2] > 170 && d[1] < 190 && d[0] > 140) purple++;
      }
      return { purple };
    });
    await page.locator("#board-canvas").screenshot({ path: path.join(scratch, "gear-fusion-ring.png") });
    await page.mouse.up();
    assert.ok(r.purple >= 10, JSON.stringify(r));
  });
  await check("a tip points it out when two gears on the board can fuse", async () => {
    await lay([[0, 1, "big"], [1, 1, "soldier"]]);
    assert.equal(await page.evaluate(() => TIPS.find((x) => x.id === "fusion").when()), false);
    await lay([[0, 1, "big"], [1, 1, "bomb"]]);
    assert.equal(await page.evaluate(() => TIPS.find((x) => x.id === "fusion").when()), true);
    await lay([[0, 1, "big", 2], [1, 1, "bomb"]]);
    assert.equal(await page.evaluate(() => TIPS.find((x) => x.id === "fusion").when()), false, "different levels");
  });

  console.log("\nThai");
  await check("everything has Thai", async () => {
    const list = await page.evaluate(() => [...FUSIONS.flatMap((f) => [f.name, f.text]), TIPS.find((x) => x.id === "fusion").text, "Gear fusion", "Fusion: Cannon gear!", "Mad inventor", "Fuse gears 5 times", "Drag a special gear onto a different one of the same level. If it has a purple ring, they fuse into a new, stronger gear. Find them all for your collection."]);
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
