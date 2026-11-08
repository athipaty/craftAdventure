// Rival duel: a new mode of rounds against a computer rival, beside the usual waves.
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
  const setUp = async (waves = 100, extra = () => {}) => {
    await page.goto(url);
    await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
    await page.goto(url);
    await page.evaluate((n) => { save.stats.waves = n; for (const t of TIPS) save.tips[t.id] = true; writeSave(); }, waves);
    await page.evaluate(extra);
    await page.goto(url);
    await hide();
  };
  // Pushes the line all the way, as if the player had won the round.
  const winRound = () => page.evaluate(() => { playerPower = 1e6; enemyPower = 1; });
  const loseRound = () => page.evaluate(() => { playerPower = 1; enemyPower = 1e6; });
  const takeReward = async () => {
    await page.waitForSelector("#reward-screen:not(.hidden)");
    await page.waitForFunction(() => performance.now() - rewardOpenedAt >= REWARD_CLICK_DELAY_MS);
    await page.locator(".reward-option").first().click();
    await page.waitForFunction(() => gameState === "playing" || gameState === "building");
    await page.evaluate(() => { if (gameState === "building") beginWave(); });
  };

  console.log("\nOn the title screen");
  await check("hidden from a brand new player", async () => {
    await setUp(0);
    assert.equal(await page.locator("#duel-btn").isVisible(), false);
  });
  await check("shown once the basics are known, naming the first rival", async () => {
    await setUp();
    assert.equal(await page.locator("#duel-btn").isVisible(), true);
    assert.match(await page.locator("#duel-btn").textContent(), /Rival duel: Rusty Rex/);
    await page.screenshot({ path: path.join(scratch, "duel-title.png") });
  });

  console.log("\nA match");
  await check("starts round 1 with a small machine and a rival as strong as it", async () => {
    await page.locator("#duel-btn").click();
    const state = await page.evaluate(() => ({ state: gameState, round: duel.round, gears: grid.flat().filter((c) => c && !c.driver).length, rate: duel.rate, mine: soldiersPerSecond(), even: playerPower === enemyPower }));
    assert.equal(state.state, "playing");
    assert.equal(state.round, 1);
    assert.ok(state.gears >= 3, `gears ${state.gears}`);
    assert.ok(Math.abs(state.rate - state.mine) < 1e-9, `rival ${state.rate} vs ${state.mine}`);
    assert.ok(state.even);
    assert.equal(await page.locator("#duel-indicator").isVisible(), true);
    assert.equal(await page.locator("#wave-indicator").isVisible(), false);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(scratch, "duel-round.png") });
  });
  await check("the rival's army keeps coming, and the clock runs down", async () => {
    const before = await page.evaluate(() => duel.roundLeft);
    await page.evaluate(() => { for (let i = 0; i < 40; i++) update(0.05); });
    const after = await page.evaluate(() => ({ left: duel.roundLeft, enemy: marchers.some((m) => m.side === "enemy") || enemyPower > 0 }));
    assert.ok(after.left < before - 1.5, `${before} -> ${after.left}`);
    assert.ok(after.enemy);
    assert.match(await page.locator("#duel-clock").textContent(), /^\d+s$/);
  });
  await check("winning a round offers a reward and tells what the rival picked", async () => {
    await page.evaluate(() => { window.roundOneRate = duel.rate; });
    await winRound();
    await page.waitForSelector("#reward-screen:not(.hidden)");
    assert.equal(await page.locator("#reward-title").textContent(), "Round 1 won!");
    assert.match(await page.locator("#reward-next").textContent(), /Rusty Rex picked: .+\. You 1 - 0 rival/);
    assert.equal(await page.locator("#deal-btn").isVisible(), false);
    await page.screenshot({ path: path.join(scratch, "duel-reward.png") });
  });
  await check("the rival comes back stronger for round 2, and no build or route choice gets in the way", async () => {
    const rateBefore = await page.evaluate(() => window.roundOneRate);
    await takeReward();
    const state = await page.evaluate(() => ({ round: duel.round, wave, rate: duel.rate, left: duel.roundLeft, build: runBuild }));
    assert.equal(state.round, 2);
    assert.equal(state.wave, 2);
    assert.ok(state.rate > rateBefore);
    assert.ok(state.left > 59);
    assert.equal(state.build, null);
    assert.equal(await page.locator("#duel-round").textContent(), "Round 2");
  });
  await check("when time runs out, the side holding more of the line wins the round", async () => {
    await page.evaluate(() => { duel.roundLeft = 0.01; playerPower = 40; enemyPower = 60; });
    await page.waitForSelector("#reward-screen:not(.hidden)");
    assert.equal(await page.locator("#reward-title").textContent(), "Round 2 lost");
    assert.deepEqual(await page.evaluate(() => [duel.you, duel.them]), [1, 1]);
    await takeReward();
  });
  await check("two rounds won ends the match, pays coins and brings on the next rival", async () => {
    const coins = await page.evaluate(() => save.coins);
    await winRound();
    await page.waitForSelector("#duel-screen:not(.hidden)");
    assert.equal(await page.evaluate(() => gameState), "duelover");
    assert.equal(await page.locator("#duel-result-title").textContent(), "You won the duel!");
    assert.equal(await page.locator("#duel-result-score").textContent(), "You 2 - 1 Rusty Rex");
    assert.equal(await page.evaluate(() => save.coins), coins + 30);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(SAVE_KEY)).rivalLevel), 2);
    assert.equal(await page.locator("#duel-again-btn").textContent(), "Next rival");
    await page.screenshot({ path: path.join(scratch, "duel-won.png") });
  });
  await check("Next rival starts a fresh match against a tougher one", async () => {
    await page.locator("#duel-again-btn").click();
    const state = await page.evaluate(() => ({ level: duel.level, name: duel.rival.name, you: duel.you, rate: duel.rate, mine: soldiersPerSecond() }));
    assert.equal(state.level, 2);
    assert.equal(state.name, "Sprocket Sue");
    assert.equal(state.you, 0);
    assert.ok(state.rate > state.mine * 1.05);
  });
  await check("losing the match keeps the same rival and pays for rounds won", async () => {
    const coins = await page.evaluate(() => save.coins);
    await loseRound();
    await takeReward();
    await loseRound();
    await page.waitForSelector("#duel-screen:not(.hidden)");
    assert.equal(await page.locator("#duel-again-btn").textContent(), "Rematch");
    assert.equal(await page.evaluate(() => save.coins), coins);
    assert.equal(await page.evaluate(() => rivalLevel()), 2);
    await page.locator("#duel-home-btn").click();
    assert.equal(await page.locator("#title-screen").isVisible(), true);
    assert.match(await page.locator("#duel-btn").textContent(), /Sprocket Sue/);
  });

  console.log("\nAlongside the usual game");
  await check("a duel leaves a saved run alone, so Continue still finds it", async () => {
    await setUp();
    await page.evaluate(() => startChosenRun({ world: 0 }));
    await page.evaluate(() => { wave = 4; saveRun(); pauseGame(); goHome(); });
    const saved = await page.evaluate(() => localStorage.getItem(RUN_SAVE_KEY));
    assert.ok(saved);
    await page.locator("#duel-btn").click();
    await page.evaluate(() => { for (let i = 0; i < 100; i++) update(0.05); leavingPage(); });
    await page.evaluate(() => pauseGame());
    assert.equal(await page.locator("#home-btn").textContent(), "Leave the duel");
    await page.locator("#home-btn").click();
    assert.equal(await page.evaluate(() => localStorage.getItem(RUN_SAVE_KEY)), saved);
    assert.equal(await page.locator("#continue-btn").isVisible(), true);
    await page.locator("#continue-btn").click();
    assert.equal(await page.evaluate(() => [duel, wave]).then(([d, w]) => d === null && w === 4), true);
    assert.equal(await page.locator("#wave-indicator").isVisible(), true);
  });
  await check("the pause menu restarts the duel, not a run", async () => {
    await setUp();
    await page.locator("#duel-btn").click();
    await winRound();
    await takeReward();
    await page.evaluate(() => pauseGame());
    await page.locator("#restart-btn").click();
    assert.deepEqual(await page.evaluate(() => [Boolean(duel), duel.round, duel.you, gameState]), [true, 1, 0, "playing"]);
  });
  await check("in Thai too", async () => {
    await setUp(100, () => { save.lang = "th"; writeSave(); });
    assert.match(await page.locator("#duel-btn").textContent(), /ดวลคู่แข่ง/);
    await page.locator("#duel-btn").click();
    await page.waitForTimeout(300);
    assert.match(await page.locator("#duel-round").textContent(), /รอบ 1/);
  });

  assert.deepEqual(errors, []);
  console.log(`\n${passed} passed, ${failures.length} failed`);
  await browser.close();
  server.close();
  process.exit(failures.length ? 1 : 0);
})();
