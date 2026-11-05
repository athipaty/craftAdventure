// Beat a boss, pick a chest, and see what the others held.
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
    clearTimeout(rewardTimer); clearChests(); clearPaths();
    for (const id of ["reward-screen", "path-screen", "chest-screen", "build-bar", "pause-screen", "world-clear-screen"]) document.getElementById(id)?.classList.add("hidden");
    gameState = "playing"; boss = null; gearTray = []; wave = 5; waveTime = 1; runBonusCoins = 0; gearDropAt = NO_GEAR_DROP; treasureAt = NO_GEAR_DROP; clearTreasureGoblin();
    nextWavePlan = null; activeDeal = null; dealAccepted = false; wavePace = null; waveEvent = null; marchers = []; enemyBacklog = 0; playerPower = 1000; enemyPower = 1000;
  });
  const openNow = (prizes, picked = null) => page.evaluate(([p, k]) => { showChests(p, k, 0); rewardOpenedAt = performance.now() - 1000; }, [prizes, picked]);
  const visible = () => page.waitForSelector("#chest-screen:not(.hidden)");
  const bossWin = () => page.evaluate(() => { boss = { kind: BOSS_KINDS[0], hp: 0, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; winWave(); return gameState; });

  console.log("\nWhen they come");
  await check("beating a boss brings the chests after the victory moment", async () => {
    await fresh();
    assert.equal(await bossWin(), "chest");
    assert.equal(await page.locator("#chest-screen").isVisible(), false, "the armies react first");
    await visible();
    assert.equal(await page.locator(".chest-card").count(), 3);
    assert.equal(await page.locator("#reward-screen").isVisible(), false);
    assert.equal(await page.locator("#chest-continue-btn").isVisible(), false, "nothing to carry on from yet");
    assert.equal(await page.locator(".chest-card.open").count(), 0, "all closed");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(scratch, "boss-chests-closed.png") });
  });
  await check("a normal wave has none, and a world's final boss goes to its own screen", async () => {
    await fresh();
    assert.equal(await page.evaluate(() => { winWave(); return gameState; }), "choosing");
    await fresh();
    const r = await page.evaluate(() => { wave = finalWaveNumber(); boss = { kind: FINAL_BOSSES.forest, hp: 0, maxHp: 100, attackIn: 99, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; winWave(); return gameState; });
    assert.equal(r, "worldclear");
  });

  console.log("\nWhat's inside");
  await check("mostly coins, with rare big prizes, at the right odds", async () => {
    await fresh();
    const r = await page.evaluate(() => { const n = {}; for (let i = 0; i < 20000; i++) for (const id of pickChestPrizes()) n[id] = (n[id] || 0) + 1; return n; });
    const share = (id) => r[id] / 60000;
    assert.ok(Math.abs(share("coins") - 0.5) < 0.02, String(share("coins")));
    assert.ok(Math.abs(share("moreCoins") - 0.25) < 0.02);
    assert.ok(Math.abs(share("gear") - 0.15) < 0.015);
    assert.ok(Math.abs(share("bigGear") - 0.07) < 0.01);
    assert.ok(Math.abs(share("jackpot") - 0.03) < 0.01);
  });
  await check("a daily challenge has the same chests for everyone", async () => {
    await fresh();
    const r = await page.evaluate(() => { const keep = currentDaily; currentDaily = { day: "2026-11-05" }; const out = []; for (let w = 2; w < 40; w++) { wave = w; out.push(JSON.stringify(pickChestPrizes()) === JSON.stringify(pickChestPrizes())); } currentDaily = keep; wave = 5; return out; });
    assert.ok(r.every(Boolean));
  });

  console.log("\nPicking one");
  await check("a real tap pays that prize, then every chest opens to show what was missed", async () => {
    await fresh();
    await openNow(["moreCoins", "jackpot", "coins"]);
    await visible();
    await page.locator(".chest-card").nth(0).click();
    assert.equal(await page.evaluate(() => runBonusCoins), 30, "paid at once");
    assert.equal(await page.locator(".chest-card.shaking").count(), 1);
    await page.waitForSelector(".chest-card.open");
    assert.deepEqual(await page.locator(".chest-card span").allTextContents(), ["+30 coins", "+75 coins", "+15 coins"]);
    assert.equal(await page.locator(".chest-card.chosen").count(), 1);
    assert.equal(await page.locator(".chest-card.missed").count(), 2);
    assert.equal(await page.locator(".chest-card.rare").count(), 1, "the jackpot stands out");
    assert.equal(await page.locator("#chest-continue-btn").isVisible(), true);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(scratch, "boss-chests-open.png") });
  });
  await check("a chest can't be picked twice, and another can't be picked after", async () => {
    await fresh();
    await openNow(["coins", "jackpot", "coins"]);
    const r = await page.evaluate(() => { pickChest(0); pickChest(0); pickChest(1); return { coins: runBonusCoins, picked: chestPicked }; });
    assert.deepEqual(r, { coins: 15, picked: 0 });
  });
  await check("a stray tap right as they open doesn't pick", async () => {
    await fresh();
    await page.evaluate(() => { showChests(["coins", "coins", "coins"], null, 0); document.querySelector(".chest-card").click(); });
    assert.equal(await page.evaluate(() => chestPicked), null);
  });
  await check("a gear prize flies to the tray at its level", async () => {
    await page.waitForFunction(() => !document.querySelector(".gear-flyer"));
    await fresh();
    await openNow(["bigGear", "coins", "coins"]);
    const r = await page.evaluate(() => { pickChest(0); return { tray: gearTray.map((g) => g.level), coins: runBonusCoins, flyers: document.querySelectorAll(".gear-flyer").length }; });
    assert.deepEqual(r, { tray: [3], coins: 0, flyers: 1 });
  });
  await check("a gear prize with a full tray pays coins instead", async () => {
    await fresh();
    await page.evaluate(() => { gearTray = Array.from({ length: TRAY_SLOTS }, () => ({ type: "soldier", level: 1 })); });
    await openNow(["gear", "coins", "coins"]);
    const r = await page.evaluate(() => { pickChest(0); return { tray: gearTray.length, coins: runBonusCoins, toast: document.getElementById("combo-toast").textContent }; });
    assert.deepEqual(r, { tray: 5, coins: 20, toast: "Tray full: +20 coins" });
  });
  await check("coins from a chest reach the player at the end of the run", async () => {
    await fresh();
    await openNow(["jackpot", "coins", "coins"]);
    const r = await page.evaluate(() => { const before = coinsForRun(); pickChest(0); return coinsForRun() - before; });
    assert.ok(r >= 75, String(r));
  });
  await check("carrying on leads to the boss's lucky rewards, and only after picking", async () => {
    await fresh();
    await openNow(["coins", "coins", "coins"]);
    assert.equal(await page.evaluate(() => { leaveChests(); return gameState; }), "chest", "not before picking");
    await page.evaluate(() => pickChest(0));
    await page.waitForSelector(".chest-card.open");
    const r = await page.evaluate(() => { const real = offerRewards; let got = null; offerRewards = (t, l) => { got = [t, l]; }; document.getElementById("chest-continue-btn").click(); offerRewards = real; return { got, prizes: chestPrizes }; });
    assert.deepEqual(r, { got: ["Boss defeated!", true], prizes: null });
    assert.equal(await page.locator("#chest-screen").isVisible(), false);
  });
  await check("played through for real, it ends on the reward screen", async () => {
    await fresh();
    await bossWin();
    await visible();
    await page.evaluate(() => { rewardOpenedAt = performance.now() - 1000; });
    await page.locator(".chest-card").nth(1).click();
    await page.locator("#chest-continue-btn").click();
    await page.waitForSelector("#reward-screen:not(.hidden)");
    assert.equal(await page.evaluate(() => [gameState, offeredRewards.lucky].join()), "choosing,true");
    assert.equal(await page.locator("#reward-title").textContent(), "Boss defeated!");
  });
  await check("opening 10 earns the achievement", async () => {
    const r = await page.evaluate(() => { const c = save.coins; delete save.achievements.chests10; save.stats.chests = 9; recordStat("chests"); return { got: Boolean(save.achievements.chests10), paid: save.coins - c }; });
    assert.deepEqual(r, { got: true, paid: 40 });
  });

  console.log("\nReloading");
  const reloadWith = (snap) => page.evaluate((d) => { clearChests(); gameState = "title"; savedRun = d; continueRun(); return { state: gameState, prizes: chestPrizes, picked: chestPicked, coins: runBonusCoins }; }, snap);
  await check("reloading before picking brings the same chests back", async () => {
    await fresh();
    await openNow(["jackpot", "gear", "coins"]);
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    assert.equal(snap.state, "chest");
    assert.equal(await page.evaluate((d) => isValidRunSave(d), snap), true);
    const r = await reloadWith(snap);
    assert.deepEqual(r.prizes, ["jackpot", "gear", "coins"]);
    assert.equal(r.state, "chest");
    assert.equal(r.picked, null);
    await visible();
    assert.equal(await page.locator(".chest-card.open").count(), 0);
  });
  await check("reloading after picking can't pay twice, and shows what was inside", async () => {
    await fresh();
    await openNow(["jackpot", "gear", "coins"]);
    const snap = await page.evaluate(() => { pickChest(0); return JSON.parse(JSON.stringify(runSnapshot())); });
    assert.equal(snap.numbers.runBonusCoins, 75);
    const r = await reloadWith(snap);
    assert.deepEqual([r.picked, r.coins], [0, 75]);
    await visible();
    assert.equal(await page.locator(".chest-card.open").count(), 3);
    assert.equal(await page.evaluate(() => { pickChest(1); return runBonusCoins; }), 75);
    await page.evaluate(() => leaveChests());
    assert.equal(await page.evaluate(() => gameState), "choosing");
  });
  await check("bad or older saves are handled", async () => {
    await fresh();
    await openNow(["coins", "coins", "coins"]);
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    for (const prizes of [["nonsense", "coins", "coins"], ["coins"], null]) {
      const bad = JSON.parse(JSON.stringify(snap)); bad.chests.prizes = prizes;
      assert.equal(await page.evaluate((d) => isValidRunSave(d), bad), false, JSON.stringify(prizes));
    }
    await fresh();
    const old = await page.evaluate(() => JSON.parse(JSON.stringify(runSnapshot())));
    delete old.chests;
    assert.equal(await page.evaluate((d) => isValidRunSave(d), old), true);
  });
  await check("a new run starts clean, and a late timer can't reopen them", async () => {
    await fresh();
    await page.evaluate(() => { showChests(["coins", "coins", "coins"], null, 60); startChosenRun({ world: 0 }); });
    await page.waitForTimeout(120);
    assert.equal(await page.locator("#chest-screen").isVisible(), false);
    assert.deepEqual(await page.evaluate(() => [chestPrizes, chestPicked]), [null, null]);
  });

  console.log("\nOn the screen");
  await check("closed and open chests are really drawn, and differ", async () => {
    const r = await page.evaluate(() => {
      const data = (c) => c.toDataURL();
      const shut = chestIcon(false, false), open = chestIcon(true, false), rare = chestIcon(true, true);
      const painted = shut.getContext("2d").getImageData(shut.width / 2, shut.height * 0.7, 1, 1).data[3] > 0;
      return { painted, different: new Set([data(shut), data(open), data(rare)]).size };
    });
    assert.deepEqual(r, { painted: true, different: 3 });
  });
  for (const [w, h] of [[320, 568], [360, 640], [390, 844], [844, 390]]) {
    await check(`chests and the button fit at ${w}x${h}`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(120);
      await fresh();
      await openNow(["bigGear", "jackpot", "moreCoins"], 0);
      await visible();
      await page.waitForTimeout(350);
      const r = await page.evaluate(() => {
        const root = document.getElementById("chest-screen").getBoundingClientRect();
        const cards = [...document.querySelectorAll(".chest-card")];
        const all = [...cards, document.getElementById("chest-title"), document.getElementById("chest-continue-btn")];
        return { off: all.filter((b) => { const q = b.getBoundingClientRect(); return q.top < root.top || q.bottom > root.bottom || q.left < root.left || q.right > root.right; }).length, clipped: cards.filter((c) => c.scrollWidth > c.clientWidth + 1).length, tall: cards.every((c) => c.getBoundingClientRect().height >= 44) };
      });
      assert.deepEqual(r, { off: 0, clipped: 0, tall: true });
      await page.screenshot({ path: path.join(scratch, `boss-chests-${w}.png`) });
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });

  console.log("\nThai");
  await check("everything has Thai, on the real screen too", async () => {
    await page.evaluate(() => { clearChests(); save.lang = "th"; writeSave(); });
    await page.goto(url);
    const left = await page.evaluate(() => ["Pick a chest!", "Boss treasure!", "Boss chests", "Continue", "+30 coins", "Level 3 gear", "Tray full: +20 coins", "Treasure hunter", "Open 10 boss chests", "Beat a boss and pick one of three chests for coins or a strong gear. The others open too, so you'll see what you missed."].filter((x) => /[A-Za-z]/.test(t(x))));
    assert.deepEqual(left, []);
    await page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); startChosenRun({ world: 0 }); showChests(["bigGear", "jackpot", "moreCoins"], 0, 0); });
    await visible();
    await page.waitForTimeout(350);
    const shown = await page.evaluate(() => [...document.querySelectorAll("#chest-title, .chest-card span, #chest-continue-btn")].map((x) => x.textContent).filter((x) => /[A-Za-z]{3}/.test(x)));
    assert.deepEqual(shown, []);
    await page.screenshot({ path: path.join(scratch, "boss-chests-th.png") });
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
