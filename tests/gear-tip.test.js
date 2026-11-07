// A tap or a long hold on a board gear explains it, including its recipe.
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
    gameState = "playing"; boss = null; gearTray = []; wave = 3; waveTime = 10; gearDropAt = -1;
    playerPower = 1000; enemyPower = 1000; marchers = []; enemyBacklog = 0; drag = null; save.collection = {};
    document.getElementById("gear-tip").classList.add("hidden");
    grid.forEach((row, r) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[r][c] = null; }));
  });
  const put = (type, level = 1) => page.evaluate(({ type, level }) => {
    const cell = freshCell(type); cell.level = level;
    grid[DRIVER_ROW][DRIVER_COL + 1] = cell;
  }, { type, level });
  const cellBox = async (row, col) => page.evaluate(({ row, col }) => {
    const rect = boardCanvas.getBoundingClientRect();
    return { x: rect.left + (col + 0.5) * cellSize, y: rect.top + (row + 0.5) * cellSize };
  }, { row, col });
  const theGearBox = () => page.evaluate(() => ({ row: DRIVER_ROW, col: DRIVER_COL + 1 })).then(({ row, col }) => cellBox(row, col));
  const tap = async (box, holdMs = 60) => { await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.waitForTimeout(holdMs); await page.mouse.up(); await page.waitForTimeout(30); };

  await check("a quick tap explains the gear, and changes nothing", async () => {
    await fresh();
    await put("soldier", 2);
    const box = await theGearBox();
    await tap(box);
    assert.equal(await page.locator("#gear-tip").isVisible(), true);
    const r = await page.evaluate(() => ({
      name: document.getElementById("gear-tip-name").textContent,
      text: document.getElementById("gear-tip-text").textContent,
      level: grid[DRIVER_ROW][DRIVER_COL + 1].level,
      type: grid[DRIVER_ROW][DRIVER_COL + 1].type,
    }));
    assert.deepEqual(r, { name: "Normal gear", text: "Fills in 4 hits, then sends 1 soldier. Merge two matching gears to level them up.", level: 2, type: "soldier" });
  });

  await check("a tap on a fused gear shows what it's made from", async () => {
    await fresh();
    await put("cannon");
    await tap(await theGearBox());
    const r = await page.evaluate(() => ({
      name: document.getElementById("gear-tip-name").textContent,
      hasMadeFrom: document.getElementById("gear-tip-recipe").textContent.includes("Made from"),
      equationIcons: document.querySelectorAll("#gear-tip-recipe .book-equation .book-mini-art").length,
    }));
    assert.deepEqual(r, { name: "Cannon gear", hasMadeFrom: true, equationIcons: 3 });
  });

  await check("a tap on a base special names the partner it needs, not just the result", async () => {
    await fresh();
    await page.evaluate(() => { for (const id of ["bomb", "cannon", "booster", "dynamo", "lone", "hermit", "ice", "blizzard"]) save.collection[`gear:${id}`] = true; });
    await put("big");
    await tap(await theGearBox());
    const r = await page.evaluate(() => {
      const recipe = document.getElementById("gear-tip-recipe");
      return { hasFusesInto: recipe.textContent.includes("Fuses into"), rows: recipe.querySelectorAll(".book-used-in-row").length, bomb: recipe.textContent.includes("Bomb gear"), cannon: recipe.textContent.includes("Cannon gear") };
    });
    assert.deepEqual(r, { hasFusesInto: true, rows: 4, bomb: true, cannon: true });
  });

  await check("unfound gears stay masked, not spoiled", async () => {
    await fresh();
    await put("big");
    await tap(await theGearBox());
    const text = await page.evaluate(() => document.getElementById("gear-tip-recipe").textContent);
    assert.ok(text.includes("???"), text);
  });

  await check("dragging to an empty cell still works, and shows no tip", async () => {
    await fresh();
    await put("soldier", 1);
    const from = await theGearBox();
    const empty = await page.evaluate(() => { for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!grid[r][c]) return { r, c }; });
    const to = await cellBox(empty.r, empty.c);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(({ r, c }) => Boolean(grid[r][c]), empty), true);
    assert.equal(await page.locator("#gear-tip").isVisible(), false);
  });

  await check("holding it still explains it too, without needing to release", async () => {
    await fresh();
    await put("booster");
    const box = await theGearBox();
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.waitForTimeout(550);
    assert.equal(await page.locator("#gear-tip").isVisible(), true);
    await page.mouse.up();
  });

  await check("it closes on its own, and the next press clears a stale one", async () => {
    await fresh();
    await put("soldier", 2);
    await tap(await theGearBox());
    assert.equal(await page.locator("#gear-tip").isVisible(), true);
    await page.waitForTimeout(4200);
    assert.equal(await page.locator("#gear-tip").isVisible(), false);
  });

  await check("fits at a small phone width", async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    await fresh();
    await put("big");
    await tap(await theGearBox());
    await page.screenshot({ path: path.join(scratch, "gear-tip-small.png") });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(overflow, false);
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await check("explains itself in Thai too", async () => {
    await page.evaluate(() => { save.lang = "th"; writeSave(); });
    await page.goto(url);
    await page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); startChosenRun({ world: 0 }); });
    await fresh();
    await put("cannon");
    await tap(await theGearBox());
    const left = await page.evaluate(() => /[A-Za-z]{3}/.test(document.getElementById("gear-tip").textContent.replace(/[A-Za-z]{1,4}:\/\/[^\s]+/g, "")));
    assert.equal(left, false);
    await page.evaluate(() => { save.lang = "en"; writeSave(); });
    await page.goto(url);
    await page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); startChosenRun({ world: 0 }); });
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
