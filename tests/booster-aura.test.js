// A booster's aura shows exactly which gears are getting its extra.
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

  // A row out from the main gear: driver, then whatever's passed.
  const lay = (cells) => page.evaluate((list) => {
    gameState = "paused"; boss = null; runParts = {}; blockedCells.clear();
    grid.forEach((row, r) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[r][c] = null; }));
    for (const [r, c, type, level = 1, rusted = false] of list) { const cell = freshCell(type); cell.level = level; cell.rusted = rusted; grid[DRIVER_ROW + r][DRIVER_COL + c] = cell; }
    markCombos();
  }, cells);
  const boosted = () => page.evaluate(() => boostedGears().map((g) => [g.row - DRIVER_ROW, g.col - DRIVER_COL, g.boost]).sort());

  console.log("\nWhich gears glow");
  await check("a gear touching a joined booster glows, and the booster itself doesn't", async () => {
    await lay([[0, 1, "booster"], [0, 2, "soldier"]]);
    assert.deepEqual(await boosted(), [[0, 2, 1]]);
  });
  await check("a gear with no booster beside it doesn't glow", async () => {
    await lay([[0, 1, "soldier"], [0, 2, "soldier"]]);
    assert.deepEqual(await boosted(), []);
  });
  await check("a gear cut off from the chain doesn't glow, because it gets nothing", async () => {
    await lay([[-3, -3, "booster"], [-3, -2, "soldier"]]);
    assert.deepEqual(await boosted(), []);
  });
  await check("a rusted booster or a rusted gear doesn't glow", async () => {
    await lay([[0, 1, "soldier"], [1, 1, "booster", 1, true]]);
    assert.deepEqual(await boosted(), [], "rusted booster");
    await lay([[0, 1, "booster"], [0, 2, "soldier", 1, true]]);
    assert.deepEqual(await boosted(), [], "rusted gear");
  });
  await check("every kind of gear that fills can glow, and a second booster doesn't", async () => {
    await lay([[0, 1, "booster"], [0, 2, "big"], [1, 1, "bomb"], [-1, 1, "booster"]]);
    assert.deepEqual((await boosted()).map((g) => g.slice(0, 2)).sort(), [[0, 2], [1, 1]].sort());
  });
  await check("the numbers match what the gear really gets, and grow with more boost", async () => {
    await lay([[0, 1, "booster"], [0, 2, "soldier"]]);
    const one = await page.evaluate(() => boostedGears()[0].boost);
    await lay([[0, 1, "booster", 2], [0, 2, "soldier"]]);
    const two = await page.evaluate(() => boostedGears()[0].boost);
    await page.evaluate(() => { runParts = { turbo: 1 }; });
    const turbo = await page.evaluate(() => boostedGears()[0].boost);
    assert.deepEqual([one, two, turbo], [1, 2, 3]);
    const same = await page.evaluate(() => { runParts = {}; return boostedGears()[0].boost === boostersTouching(DRIVER_ROW, DRIVER_COL + 2); });
    assert.equal(same, true);
  });

  console.log("\nOn the screen");
  const stillBoard = () => page.evaluate(() => { document.getElementById("reward-screen").classList.add("hidden"); save.lessMotion = true; drawBoard(); });
  // A pixel in the gap around a gear, where only the aura can show.
  const aura = (r, c) => page.evaluate(([row, col]) => {
    const scale = boardCanvas.width / boardCssW;
    const x = (DRIVER_COL + col + 0.5) * cellSize;
    const y = (DRIVER_ROW + row + 0.5) * cellSize - cellSize * 0.56;
    const d = boardCanvas.getContext("2d").getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
    return d[1] - d[0];
  }, [r, c]);
  await check("the aura really is drawn around a boosted gear, and not around others", async () => {
    await lay([[0, 1, "booster"], [0, 2, "soldier"], [2, 3, "soldier"]]);
    await stillBoard();
    const on = await aura(0, 2);
    const off = await aura(2, 3);
    assert.ok(on > off + 40, `boosted ${on}, plain ${off}`);
    await page.locator("#board-canvas").screenshot({ path: path.join(scratch, "booster-aura.png") });
  });
  await check("a stronger booster glows brighter", async () => {
    await lay([[0, 1, "booster"], [0, 2, "soldier"]]);
    await stillBoard();
    const weak = await aura(0, 2);
    await page.evaluate(() => { runParts = { turbo: 2 }; });
    await lay([[0, 1, "booster", 2], [0, 2, "soldier"]]);
    await page.evaluate(() => { runParts = { turbo: 2 }; });
    await stillBoard();
    const strong = await aura(0, 2);
    assert.ok(strong > weak, `${weak} then ${strong}`);
    await page.evaluate(() => { runParts = {}; });
  });
  await check("it leaves nothing behind for what's drawn next", async () => {
    await lay([[0, 1, "booster"], [0, 2, "soldier"]]);
    await stillBoard();
    assert.equal(await page.evaluate(() => boardCanvas.getContext("2d").globalAlpha), 1);
  });
  await check("a full board of auras stays cheap to draw", async () => {
    const r = await page.evaluate(() => {
      save.lessMotion = false;
      grid.forEach((row, a) => row.forEach((cell, b) => { if (!cell?.driver) grid[a][b] = freshCell((a + b) % 2 ? "booster" : "soldier"); }));
      markCombos();
      const start = performance.now();
      for (let i = 0; i < 100; i++) drawBoostAuras(boardCtx);
      const each = (performance.now() - start) / 100;
      return { each, gears: boostedGears().length };
    });
    assert.ok(r.gears >= 20, `gears ${r.gears}`);
    assert.ok(r.each < 4, `${r.each} ms a frame`);
    console.log("        auras", JSON.stringify(r));
  });

  console.log("\nThai");
  await check("the booster's new text has Thai", async () => {
    await page.evaluate(() => { save.lang = "th"; writeSave(); });
    await page.goto(url);
    assert.equal(await page.evaluate(() => /[A-Za-z]{3}/.test(t("Gears touching it get an extra 25% per hit, and glow green"))), false);
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
