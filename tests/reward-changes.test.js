// Each reward's card says what it changes, from what to what, and it's true.
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

  const setUp = () => page.evaluate(() => {
    clearTimeout(rewardTimer);
    document.getElementById("reward-screen").classList.add("hidden");
    gameState = "paused"; boss = null; runParts = {}; armyRank = 0; nextWaveBonus = 0; waveLead = WAVE_START_LEAD; driverTurnsPerSec = DRIVER_BASE_TURNS_PER_SEC; blockedCells.clear();
    grid.forEach((row, r) => row.forEach((cell, c) => { if (cell && !cell.driver) grid[r][c] = null; }));
    placeGear("soldier"); placeGear("soldier"); placeGear("big"); placeGear("bomb"); placeGear("booster");
    markCombos();
  });

  console.log("\nWhat the cards say");
  await check("every reward has a change, and it really is a change", async () => {
    await setUp();
    const r = await page.evaluate(() => REWARDS.map((x) => ({ id: x.id, c: rewardChange(x) })));
    assert.deepEqual(r.filter((x) => !x.c).map((x) => x.id), [], "no change at all");
    assert.deepEqual(r.filter((x) => x.c.from === x.c.to).map((x) => [x.id, x.c]), [], "from and to the same");
  });
  await check("taking each reward for real lands on the card's number", async () => {
    await setUp();
    const parts = await page.evaluate(() => REWARDS.filter((x) => !x.gear && x.id !== "forgedGear").map((x) => x.id));
    for (const id of parts) {
      await setUp();
      const r = await page.evaluate((rid) => {
        const reward = REWARDS.find((x) => x.id === rid);
        const before = rewardChange(reward);
        if (!reward.oneOff) runParts[rid] = partCount(rid) + 1;
        reward.apply?.();
        const nowCard = REWARD_CHANGES[rid];
        return { promised: before.to, now: nowCard.show(nowCard.value()) };
      }, id);
      assert.equal(r.now, r.promised, id);
    }
  });
  await check("a new gear's card matches the machine once it's placed", async () => {
    const ids = await page.evaluate(() => REWARDS.filter((x) => x.gear || x.id === "forgedGear").map((x) => x.id));
    for (const id of ids) {
      await setUp();
      const r = await page.evaluate((rid) => {
        const reward = REWARDS.find((x) => x.id === rid);
        const before = rewardChange(reward);
        const gearsBefore = grid.flat().filter((c) => c).length;
        const rateBefore = machineRate();
        if (reward.gear) placeGear(reward.gear); else reward.apply();
        markCombos();
        const gearsNow = grid.flat().filter((c) => c && !c.driver).length;
        return { before, rate: formatRate(machineRate()), gearsNow, gearsBefore, rateBefore };
      }, id);
      const actual = r.before.label === "Soldiers per second" ? r.rate : String(r.gearsNow);
      assert.equal(actual, r.before.to, id);
    }
  });
  await check("working out a card changes nothing in the game", async () => {
    await setUp();
    const r = await page.evaluate(() => {
      const state = () => JSON.stringify([runParts, grid.flat().map((c) => c && [c.type, c.level, c.comboBlock, c.comboRing]), overdriveLeft, armyRank, waveLead, driverTurnsPerSec, nextWaveBonus]);
      runParts.staticCharge = 1;
      const before = state();
      for (const x of REWARDS) rewardChange(x);
      return { same: before === state(), parts: Object.keys(runParts) };
    });
    assert.equal(r.same, true);
    assert.deepEqual(r.parts, ["staticCharge"]);
  });
  await check("the numbers grow as a reward stacks", async () => {
    await setUp();
    const r = await page.evaluate(() => {
      const card = () => rewardChange(REWARDS.find((x) => x.id === "staticCharge"));
      const first = card();
      runParts.staticCharge = 1;
      const second = card();
      runParts = {};
      return { first, second };
    });
    assert.deepEqual([r.first.from, r.first.to, r.second.from, r.second.to], ["100%", "130%", "130%", "160%"]);
  });
  await check("known cards read as expected", async () => {
    await setUp();
    const r = await page.evaluate(() => Object.fromEntries(["bossHunter", "warChest", "drillManual", "fireproof", "chargedStrike", "promotion", "thickOil", "warDrums"].map((id) => { const c = rewardChange(REWARDS.find((x) => x.id === id)); return [id, `${c.from}>${c.to}`]; })));
    assert.deepEqual(r, { bossHunter: "100%>125%", warChest: "100%>125%", drillManual: "30>23", fireproof: "2>1", chargedStrike: "Off>On", promotion: "Recruit>Knight", thickOil: "25%>20%", warDrums: "150%>200%" });
  });

  console.log("\nOn the screen");
  const showAll = async (ids) => {
    await page.evaluate((list) => { showRewards("Choose a reward", list.map((id) => REWARDS.find((x) => x.id === id))); }, ids);
    await page.waitForSelector("#reward-screen:not(.hidden)");
  };
  const fits = async (lang) => {
    for (const [w, h] of [[320, 568], [360, 640], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      await setUp();
      await showAll(["stormEngine", "reinforcements", "longChain", "secondWind"]);
      const r = await page.evaluate(() => {
        const root = document.getElementById("app-frame").getBoundingClientRect();
        const cards = [...document.querySelectorAll(".reward-option")];
        const all = [...cards, ...document.querySelectorAll("#reroll-btn, #skip-btn, #reward-title")].filter((b) => b.offsetParent);
        return {
          visible: cards.filter((b) => b.offsetParent && b.querySelector(".reward-change").getBoundingClientRect().height > 0).length,
          bad: all.filter((b) => { const q = b.getBoundingClientRect(); return !(q.left >= root.left && q.right <= root.right && q.top >= root.top && q.bottom <= root.bottom); }).map((b) => b.id || b.className),
        };
      });
      await page.screenshot({ path: path.join(scratch, `reward-changes-${w}-${lang}.png`) });
      assert.equal(r.visible, 4, `${w}x${h} cards shown`);
      assert.deepEqual(r.bad, [], `${w}x${h}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  };
  await check("the card shows the label, both numbers and an arrow, and picking it still works", async () => {
    await setUp();
    await showAll(["staticCharge", "bossHunter", "bigGear"]);
    const r = await page.evaluate(() => [...document.querySelectorAll(".reward-change")].map((x) => x.textContent));
    assert.equal(r.length, 3);
    assert.equal(r[0], "Lightning power100%\u2192130%");
    await page.screenshot({ path: path.join(scratch, "reward-changes.png") });
    await page.waitForTimeout(450);
    await page.locator(".reward-option").first().click();
    assert.equal(await page.evaluate(() => partCount("staticCharge")), 1);
  });
  await check("four of the longest cards fit on every phone size", () => fits("en"));

  console.log("\nThai");
  await check("every label and value on every card has Thai", async () => {
    await setUp();
    const list = await page.evaluate(() => { const out = []; for (const x of REWARDS) { const c = rewardChange(x); out.push(c.label, c.from, c.to); } return [...new Set(out)]; });
    await page.evaluate(() => { save.lang = "th"; writeSave(); });
    await page.goto(url);
    const left = await page.evaluate((texts) => texts.filter((x) => /[A-Za-z]/.test(t(x))), list);
    assert.deepEqual(left, []);
  });
  await check("in Thai, the longest cards still fit, and show Thai", async () => {
    await page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); startChosenRun({ world: 0 }); });
    assert.equal(await page.evaluate(() => currentLang), "th");
    await fits("th");
    const row = await page.locator(".reward-change").first().textContent();
    assert.ok(!/[A-Za-z]{3}/.test(row), row);
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
