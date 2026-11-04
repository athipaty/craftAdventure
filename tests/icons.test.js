// Tests and screenshots for icons in the guide, on rewards and on buttons.
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
  catch (e) { failures.push(name); console.log("  FAIL", name, "\n      ", e.message.split("\n").slice(0, 10).join("\n       ")); }
}
(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.stack).slice(0, 300)));
  await page.goto(url);
  await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
  await page.goto(url);
  await page.evaluate(() => { save.stats.waves = 100; for (const t of TIPS) save.tips[t.id] = true; writeSave(); for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); });

  // Opened before any run, when the board has no size yet.
  await page.evaluate(() => openGuide());
  await check("every guide row has a picture, even before the first run", async () => {
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".guide-row")];
      const blank = (c) => !c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
      return {
        rows: rows.length,
        missing: rows.filter((row) => !row.querySelector(".art-icon, .emoji-icon")).map((row) => row.textContent.slice(0, 30)),
        blank: rows.filter((row) => { const c = row.querySelector("canvas"); return c && blank(c); }).map((row) => row.querySelector("b").textContent),
        emptyEmoji: rows.filter((row) => { const e = row.querySelector(".emoji-icon"); return e && !e.textContent.trim(); }).length,
        cell: cellSize,
      };
    });
    console.log("        rows", r.rows);
    assert.deepEqual(r.missing, []); assert.deepEqual(r.blank, []); assert.equal(r.emptyEmoji, 0);
    assert.equal(r.cell, 0, "drawing icons must not change the board size");
  });
  await check("every non-gear reward has its own icon", async () => {
    const r = await page.evaluate(() => {
      const plain = REWARDS.filter((x) => !x.gear);
      const icons = plain.map((x) => REWARD_ICONS[x.id]);
      return { missing: plain.filter((x) => !REWARD_ICONS[x.id]).map((x) => x.id), dupes: icons.length - new Set(icons).size, stale: Object.keys(REWARD_ICONS).filter((id) => !plain.some((x) => x.id === id)) };
    });
    assert.deepEqual(r, { missing: [], dupes: 0, stale: [] });
  });
  const shoot = async (name, scrollTo) => {
    if (scrollTo) await page.evaluate((title) => { const h = [...document.querySelectorAll("#guide-list h3")].find((x) => x.textContent === title); h.scrollIntoView(); }, scrollTo);
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(scratch, name) });
  };
  await shoot("shot8-guide-gears.png");
  await shoot("shot8-guide-rewards.png", "Rewards");
  await shoot("shot8-guide-enemies.png", "Enemies");
  await shoot("shot8-guide-bosses.png", "Bosses");
  await check("guide text still fits beside the pictures on a small phone", async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(100);
    const bad = await page.evaluate(() => [...document.querySelectorAll(".guide-row")].filter((r) => r.scrollWidth > r.clientWidth + 1).map((r) => r.textContent.slice(0, 30)));
    assert.deepEqual(bad, []);
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await page.click("#guide-close-btn");

  await page.evaluate(() => startChosenRun({ world: 0 }));
  await page.evaluate(() => {
    nextWavePlan = { enemy: "goblin", event: null, pace: null, deal: "army" };
    showRewards("Boss defeated!", ["farGear", "secondWind", "stormEngine", "warChest"].map((id) => REWARDS.find((r) => r.id === id)));
    clearTimeout(rewardTimer);
    document.getElementById("reward-screen").classList.remove("hidden");
  });
  await page.waitForTimeout(350);
  await check("reward cards show the matching pictures", async () => {
    const r = await page.evaluate(() => [...document.querySelectorAll(".reward-option")].map((b) => [b.querySelector("canvas") ? "art" : b.querySelector(".emoji-icon")?.textContent]));
    assert.deepEqual(r.map((x) => x[0]), ["art", "\u{1F4A8}", "\u{1F329}\uFE0F", "\u{1F4B0}"]);
  });
  for (const [name, w, h] of [["phone", 390, 844], ["small", 320, 568], ["landscape", 844, 390]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(scratch, `shot8-rewards-${name}.png`) });
    await check(`reward screen still fits: ${name}`, async () => {
      const out = await page.evaluate(() => {
        const root = document.getElementById("reward-screen").getBoundingClientRect();
        return [...document.querySelectorAll(".reward-option, #reroll-btn, #skip-btn, #deal-btn, #reward-guide-btn, #reward-title, #reward-next")].filter((b) => { const q = b.getBoundingClientRect(); return !(q.left >= root.left && q.right <= root.right && q.top >= root.top && q.bottom <= root.bottom); }).map((b) => b.id || b.className);
      });
      assert.deepEqual(out, []);
    });
  }
  await page.evaluate(() => { document.getElementById("reward-screen").classList.add("hidden"); clearTimeout(rewardTimer); offeredRewards = null; gameState = "playing"; armyRank = 1; gearsBought = 8; playerPower = 1000; enemyPower = 1000; strikeCooldown = 1.5; });
  for (const [name, w, h] of [["phone", 390, 844], ["small", 320, 568], ["landscape", 844, 390]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(220);
    await page.evaluate(() => { hitStop = 0; playerPower = 1000; enemyPower = 1000; strikeCooldown = 1.5; });
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(scratch, `shot8-buttons-${name}.png`) });
    await check(`ability buttons with icons still fit: ${name}`, async () => {
      const bad = await page.evaluate(() => ["buy-gear-btn", "train-btn", "strike-btn", "overdrive-btn", "rally-btn"].filter((id) => { const el = document.getElementById(id); return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1; }));
      assert.deepEqual(bad, []);
    });
  }
  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
