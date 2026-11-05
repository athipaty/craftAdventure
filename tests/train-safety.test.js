// Training spends soldiers, but can't leave the player one hit from losing.
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

  const fresh = (player, enemy, rank = 0) => page.evaluate(([p, e, r]) => {
    clearTimeout(rewardTimer);
    for (const id of ["reward-screen", "path-screen", "chest-screen", "build-bar", "pause-screen"]) document.getElementById(id).classList.add("hidden");
    gameState = "playing"; boss = null; armyRank = r; runParts = {}; playerPower = p; enemyPower = e; marchers = []; enemyBacklog = 0; wave = 5; waveTime = 1; gearDropAt = NO_GEAR_DROP; treasureAt = NO_GEAR_DROP;
    updateTrainButton();
  }, [player, enemy, rank]);
  const share = () => page.evaluate(() => playerPower / (playerPower + enemyPower));
  // The most soldiers that can be spent, for a player who only just qualifies.
  const onTheEdge = (extra) => page.evaluate((more) => {
    const enemy = 1000;
    const keep = (enemy * TRAIN_KEEP_SHARE) / (1 - TRAIN_KEEP_SHARE);
    return keep + trainCost() * armyStrength() + more;
  }, extra);

  console.log("\nThe rule");
  await check("it can be afforded only if the line stays above the margin", async () => {
    await fresh(1000, 1000);
    const ok = await onTheEdge(1);
    await fresh(ok, 1000);
    assert.equal(await page.evaluate(() => canTrain()), true, "just enough");
    const tooLow = await onTheEdge(-1);
    await fresh(tooLow, 1000);
    assert.equal(await page.evaluate(() => canTrain()), false, "just short");
  });
  await check("training never takes the share below 40%, at any rank or army size", async () => {
    const r = await page.evaluate(() => {
      const worst = [];
      for (let rank = 0; rank < ARMY_RANKS.length - 1; rank++) {
        for (const enemy of [20, 100, 1000, 25000, 400000]) {
          armyRank = rank;
          for (let player = 1; player < enemy * 6; player *= 1.13) {
            armyRank = rank; playerPower = player; enemyPower = enemy; gameState = "playing";
            if (canTrain()) {
              trainArmy();
              const left = playerPower / (playerPower + enemyPower);
              if (left < TRAIN_KEEP_SHARE - 1e-9) worst.push([rank, enemy, player, left]);
            }
          }
        }
      }
      armyRank = 0;
      return { worst, keep: TRAIN_KEEP_SHARE, line: LOSE_RATIO };
    });
    assert.deepEqual(r.worst, []);
    assert.ok(r.keep > r.line, "the margin is above the losing line");
  });
  await check("the button says how many more are needed, and is off until then", async () => {
    await fresh(1000, 1000);
    const need = await onTheEdge(-50);
    await fresh(need, 1000);
    assert.match(await page.locator("#train-btn").textContent(), /^Train Knight: need \d+ more$/);
    assert.equal(await page.locator("#train-btn").isDisabled(), true);
    await fresh(await onTheEdge(5), 1000);
    assert.equal(await page.locator("#train-btn").textContent(), "Train Knight: 30");
    assert.equal(await page.locator("#train-btn").isDisabled(), false);
  });
  await check("a real press pays the price and moves up a rank", async () => {
    await fresh(await onTheEdge(5), 1000);
    const before = await page.evaluate(() => playerPower);
    await page.evaluate(() => { document.getElementById("train-btn").click(); gameState = "paused"; });
    const r = await page.evaluate(() => ({ rank: armyRank, spent: playerPower }));
    assert.equal(r.rank, 1);
    assert.ok(Math.abs(before - r.spent - 30) < 1, `spent ${before - r.spent}`);
    assert.ok((await share()) >= 0.4 - 1e-9);
  });

  console.log("\nThe trap it closes");
  await check("training at the edge survives the next moments of a boss wave", async () => {
    // A boss wave at full pressure: this used to lose in under a second.
    await fresh(await onTheEdge(1), 1000);
    const r = await page.evaluate(() => {
      trainArmy();
      boss = { kind: BOSS_KINDS[0], hp: 1e6, maxHp: 1e6, attackIn: 99, hitFlash: 0, reinforcePerSec: bossReinforcePerSec(enemyPower), shield: 0 };
      const start = runTime;
      for (let i = 0; i < 60 && gameState === "playing"; i++) { hitStop = 0; update(0.05); }
      const out = { state: gameState, lasted: runTime - start };
      boss = null;
      return out;
    });
    assert.equal(r.state, "playing", `lost after ${r.lasted}s`);
  });
  await check("the old edge, right on the losing line, is refused", async () => {
    await fresh(1000, 1000);
    const old = await page.evaluate(() => (1000 * LOSE_RATIO) / (1 - LOSE_RATIO) + trainCost() * armyStrength() + 1);
    await fresh(old, 1000);
    assert.equal(await page.evaluate(() => canTrain()), false);
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
