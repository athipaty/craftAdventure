// Everything starts as a silhouette, and fills in when the player first meets it.
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

  const wipe = () => page.evaluate(() => {
    save.collection = {};
    announcements.length = 0;
    document.getElementById("book-screen").classList.add("hidden");
    clearTimeout(rewardTimer); clearChests(); clearPaths();
    for (const id of ["reward-screen", "path-screen", "chest-screen", "build-bar", "pause-screen"]) document.getElementById(id).classList.add("hidden");
    gameState = "playing"; boss = null; gearTray = []; wave = 3; waveTime = 1; nextWavePlan = null; gearDropAt = NO_GEAR_DROP; treasureAt = NO_GEAR_DROP; clearTreasureGoblin(); playerPower = 1000; enemyPower = 1000; marchers = []; enemyBacklog = 0;
    grid.forEach((row, r) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[r][c] = null; }));
  });
  const known = (id) => page.evaluate((x) => Boolean(save.collection[x]), id);

  console.log("\nWhat's in it");
  await check("every enemy, boss, gear and reward has exactly one entry, with words and art", async () => {
    const r = await page.evaluate(() => {
      const pages = bookPages();
      const entries = pages.flatMap((p) => p.entries);
      const ids = entries.map((e) => e.id);
      return {
        pages: pages.map((p) => [p.id, p.entries.length]),
        unique: new Set(ids).size === ids.length,
        blank: entries.filter((e) => !e.name || !e.text).map((e) => e.id),
        noArt: entries.filter((e) => !e.icon()).map((e) => e.id),
        ranks: ENEMY_RANKS.length, types: Object.keys(ENEMY_NOTES).length, bosses: BOSS_KINDS.length + Object.keys(FINAL_BOSSES).length,
        rewards: REWARDS.filter((x) => !x.gear).length, gears: REWARDS.filter((x) => x.gear).length,
        typesCovered: Object.values(ENEMY_TYPES).filter((x) => x.look).every((x) => ids.includes(`enemy:${x.id}`)),
      };
    });
    assert.equal(r.unique, true);
    assert.deepEqual(r.blank, []);
    assert.deepEqual(r.noArt, []);
    assert.equal(r.typesCovered, true);
    assert.deepEqual(r.pages, [["enemies", r.ranks + r.types + 1], ["bosses", r.bosses], ["gears", r.gears + 1], ["rewards", r.rewards]]);
  });
  await check("a new player starts with just the basics known", async () => {
    await wipe();
    const r = await page.evaluate(() => ({ known: bookPages().flatMap((p) => p.entries).filter(bookKnows).map((e) => e.id).sort(), totals: bookTotals() }));
    assert.deepEqual(r.known, ["enemy:e0", "gear:soldier"]);
    assert.equal(r.totals.have, 2);
  });

  console.log("\nFinding things");
  await check("a wave's enemy, and a boss, are found when their wave starts", async () => {
    await wipe();
    await page.evaluate(() => { nextWavePlan = { enemy: "brute", event: null, pace: null, deal: null }; beginWave(); });
    assert.equal(await known("enemy:brute"), true);
    await wipe();
    await page.evaluate(() => { wave = 5; nextWavePlan = { boss: "wall" }; beginWave(); });
    assert.equal(await known("boss:wall"), true);
    await page.evaluate(() => { boss = null; });
  });
  await check("a stronger enemy rank is found when it arrives", async () => {
    await wipe();
    await page.evaluate(() => { wave = 8; nextWavePlan = { enemy: "goblin" }; beginWave(); });
    assert.equal(await known("enemy:e1"), true);
    assert.equal(await known("enemy:e2"), false);
  });
  await check("a gear is found when it reaches the board, not while it waits in the tray", async () => {
    await wipe();
    await page.evaluate(() => { gearTray = [{ type: "big", level: 1 }]; });
    assert.equal(await known("gear:big"), false);
    await page.evaluate(() => placeTrayGear(0, 0, 0));
    assert.equal(await known("gear:big"), true);
    await wipe();
    await page.evaluate(() => placeGear("lone"));
    assert.equal(await known("gear:lone"), true);
  });
  await check("a reward is found when it's chosen, and a gear reward counts as the gear", async () => {
    await wipe();
    await page.evaluate(() => { gameState = "choosing"; chooseReward(REWARDS.find((x) => x.id === "staticCharge")); });
    assert.equal(await known("reward:staticCharge"), true);
    await wipe();
    await page.evaluate(() => { gameState = "choosing"; chooseReward(REWARDS.find((x) => x.id === "farGear")); });
    assert.equal(await known("gear:far"), true);
  });
  await check("the treasure goblin is found when it appears", async () => {
    await wipe();
    await page.evaluate(() => spawnTreasureGoblin());
    assert.equal(await known("enemy:treasure"), true);
    await page.evaluate(() => clearTreasureGoblin());
  });
  await check("each find is announced once, and nothing for the basics or nonsense", async () => {
    await wipe();
    const r = await page.evaluate(() => {
      const real = announce; const said = [];
      announce = (x) => said.push(x);
      discover("enemy:brute"); discover("enemy:brute"); discover("enemy:e0"); discover("gear:soldier"); discover("gear:nonsense");
      announce = real;
      return { said, keys: Object.keys(save.collection) };
    });
    assert.deepEqual(r, { said: ["New in the book: Armoured brutes!"], keys: ["enemy:brute"] });
  });

  console.log("\nFinishing a page");
  const finish = (pageId, leave = 0) => page.evaluate(([p, n]) => {
    const real = announce; const said = []; announce = (x) => said.push(x);
    const before = save.coins;
    const entries = bookPages().find((x) => x.id === p).entries.filter((e) => !e.starter);
    for (const e of entries.slice(0, entries.length - n)) discover(e.id);
    announce = real;
    return { paid: save.coins - before, said: said.filter((x) => x.startsWith("Page")), done: Boolean(save.collection["page:" + p]) };
  }, [pageId, leave]);
  await check("nearly finished pays nothing; the last one pays once, and says so", async () => {
    await wipe();
    assert.deepEqual(await finish("bosses", 1), { paid: 0, said: [], done: false });
    assert.deepEqual(await finish("bosses"), { paid: 100, said: ["Page complete: Bosses! +100 coins"], done: true });
    assert.deepEqual(await finish("bosses"), { paid: 0, said: [], done: true });
  });
  await check("each page has its own prize, and a page with a starter can finish", async () => {
    await wipe();
    assert.equal((await finish("enemies")).paid, 50);
    assert.equal((await finish("gears")).paid, 50);
    assert.equal((await finish("rewards")).paid, 100);
    const t = await page.evaluate(() => bookTotals());
    assert.equal(t.have, t.total - (await page.evaluate(() => bookPages()[1].entries.length)));
  });
  await check("it's kept after a reload, and a damaged save can't break it", async () => {
    await wipe();
    await page.evaluate(() => { discover("enemy:imp"); writeSave(); });
    const stored = await page.evaluate(() => { const s = loadSave(); return s.collection["enemy:imp"]; });
    assert.equal(stored, true);
    const r = await page.evaluate(() => {
      const raw = localStorage.getItem(SAVE_KEY);
      const results = [];
      for (const bad of [null, "nope", 7, [1, 2]]) {
        const d = JSON.parse(raw); d.collection = bad;
        localStorage.setItem(SAVE_KEY, JSON.stringify(d));
        results.push(JSON.stringify(loadSave().collection));
      }
      const d = JSON.parse(raw); delete d.collection;
      localStorage.setItem(SAVE_KEY, JSON.stringify(d));
      results.push(JSON.stringify(loadSave().collection));
      localStorage.setItem(SAVE_KEY, raw);
      return results;
    });
    assert.deepEqual(r, ["{}", "{}", "{}", "{}", "{}"]);
  });

  console.log("\nThe screen");
  await page.evaluate(() => { gameState = "title"; document.getElementById("game-screen").classList.add("hidden"); document.getElementById("title-screen").classList.remove("hidden"); });
  await check("the title button shows the count and opens the book", async () => {
    await wipe();
    await page.evaluate(() => { gameState = "title"; document.getElementById("game-screen").classList.add("hidden"); document.getElementById("title-screen").classList.remove("hidden"); discover("enemy:imp"); updateBookButton(); });
    const t = await page.evaluate(() => bookTotals());
    assert.equal(await page.locator("#title-book-btn").textContent(), `Collection: 3 / ${t.total}`);
    await page.locator("#title-book-btn").click();
    assert.equal(await page.locator("#book-screen").isVisible(), true);
    assert.equal(await page.locator(".book-tab").count(), 4);
  });
  await check("found entries show art and a name; the rest are hidden, and give nothing away", async () => {
    await page.evaluate(() => openBook(0));
    const r = await page.evaluate(() => {
      const entries = [...document.querySelectorAll(".book-entry")];
      const hidden = entries.filter((e) => e.classList.contains("unknown"));
      return { total: entries.length, hidden: hidden.length, names: hidden.map((e) => e.textContent).filter((x) => x !== "???"), filter: hidden[0] && getComputedStyle(hidden[0].querySelector("canvas, .emoji-icon")).filter, shown: entries.filter((e) => !e.classList.contains("unknown")).map((e) => e.textContent) };
    });
    assert.deepEqual(r.names, []);
    assert.equal(r.hidden, r.total - 2);
    assert.ok(r.filter.includes("brightness(0)"), r.filter);
    assert.ok(r.shown.includes("Goblins") && r.shown.includes("Fire imps"), r.shown.join());
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(scratch, "collection-book.png") });
  });
  await check("tapping a found entry explains it; tapping a hidden one keeps the secret", async () => {
    await page.evaluate(() => openBook(0));
    await page.locator(".book-entry", { hasText: "Fire imps" }).click();
    assert.match(await page.locator("#book-detail").textContent(), /^Fire impsBurn away gear progress/);
    await page.locator(".book-entry.unknown").first().click();
    assert.equal(await page.locator("#book-detail").textContent(), "???Not found yet. Keep playing to discover it.");
    assert.equal(await page.locator(".book-entry.selected").count(), 1);
  });
  await check("the tabs change page, with its own progress and prize", async () => {
    await page.evaluate(() => openBook(0));
    await page.locator(".book-tab", { hasText: "Bosses" }).click();
    assert.equal(await page.locator("#book-prize").textContent(), "Complete this page: +100 coins");
    const n = await page.evaluate(() => bookPages()[1].entries.length);
    assert.equal(await page.locator("#book-progress-text").textContent(), `0 / ${n}`);
    assert.equal(await page.locator(".book-entry").count(), n);
    assert.equal(await page.locator(".book-tab.active").textContent(), "Bosses");
    await page.evaluate(() => { for (const e of bookPages()[1].entries) save.collection[e.id] = true; save.collection["page:bosses"] = true; openBook(1); });
    assert.equal(await page.locator("#book-prize").textContent(), "Page complete! +100 coins earned");
    assert.equal(await page.locator("#book-progress-text").textContent(), `${n} / ${n}`);
    assert.equal(await page.locator(".book-entry.unknown").count(), 0);
  });
  await check("Back closes it", async () => {
    await page.locator("#book-close-btn").click();
    assert.equal(await page.locator("#book-screen").isVisible(), false);
  });
  for (const [w, h] of [[320, 568], [360, 640], [390, 844], [844, 390]]) {
    await check(`it fits at ${w}x${h}, even the longest page, and the title still fits`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(120);
      const title = await page.evaluate(() => { document.getElementById("book-screen").classList.add("hidden"); const q = document.getElementById("title-book-btn").getBoundingClientRect(); return q.bottom <= innerHeight && q.right <= innerWidth && q.left >= 0; });
      assert.equal(title, true, "title button on screen");
      await page.evaluate(() => openBook(3));
      await page.waitForTimeout(80);
      const r = await page.evaluate(() => {
        const root = document.getElementById("book-screen").getBoundingClientRect();
        const off = ["book-tabs", "book-progress", "book-prize", "book-grid", "book-detail", "book-close-btn"].filter((id) => { const q = document.getElementById(id).getBoundingClientRect(); return q.top < root.top - 1 || q.bottom > root.bottom + 1 || q.left < root.left - 1 || q.right > root.right + 1; });
        const grid = document.getElementById("book-grid");
        return { off, scrolls: grid.scrollHeight > grid.clientHeight, gridH: grid.clientHeight, wide: document.documentElement.scrollWidth - innerWidth };
      });
      assert.deepEqual(r.off, []);
      assert.equal(r.wide, 0);
      assert.ok(r.gridH >= 60, `grid ${r.gridH}`);
      await page.screenshot({ path: path.join(scratch, `collection-book-${w}.png`) });
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });

  console.log("\nThai");
  await check("everything has Thai, on the real screen too", async () => {
    const list = await page.evaluate(() => { const out = ["Collection", "Tap an entry", "Keep playing to find the rest.", "You've found everything on this page.", "Not found yet. Keep playing to discover it.", "Collection: 3 / 80", "New in the book: Fire imps!", "Page complete: Bosses! +100 coins", "Page complete! +100 coins earned", "Complete this page: +50 coins"]; for (const p of bookPages()) { out.push(p.name); for (const e of p.entries) out.push(e.name, e.text); } return [...new Set(out)]; });
    await page.evaluate(() => { save.lang = "th"; writeSave(); });
    await page.goto(url);
    const left = await page.evaluate((texts) => texts.filter((x) => /[A-Za-z]{2}/.test(t(x))), list);
    assert.deepEqual(left, []);
    await page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); openBook(0); });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(scratch, "collection-book-th.png") });
    const shown = await page.evaluate(() => [...document.querySelectorAll("#book-screen h2, .book-tab, #book-prize, .book-entry small, #book-detail b, #book-detail span")].map((x) => x.textContent).filter((x) => /[A-Za-z]{3}/.test(x)));
    assert.deepEqual(shown, []);
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
