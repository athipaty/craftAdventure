// Ghost duels: fighting the record of another player's duel, from the ghost server.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), assert = require("assert");
const { makeServer } = require("../server/server");
const { memoryStore } = require("../server/ghosts");
const { ghostName } = require("../server/names");
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

const OTHER = "abcdef0123456789";
const otherGhost = {
  player: OTHER, power: 1,
  rounds: [
    { start: 10, soldiers: Array(60).fill(1.5), hits: [[1, 3], [20, 4]] },
    { start: 12, soldiers: Array(30).fill(2), hits: [] },
  ],
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  const store = memoryStore();
  const ghosts = makeServer(store);
  await new Promise((r) => ghosts.listen(0, r));
  const ghostUrl = `http://localhost:${ghosts.address().port}`;
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const hide = () => page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); });
  const setUp = async (server = ghostUrl) => {
    await page.goto(url);
    await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
    await page.goto(url);
    await page.evaluate((s) => { save.stats.waves = 100; for (const t of TIPS) save.tips[t.id] = true; writeSave(); if (s) localStorage.setItem(GHOST_SERVER_KEY, s); }, server);
    await page.goto(url);
    await hide();
  };
  const winRound = () => page.evaluate(() => { playerPower = 1e6; enemyPower = 1; });
  const takeReward = async () => {
    await page.waitForSelector("#reward-screen:not(.hidden)");
    await page.waitForFunction(() => performance.now() - rewardOpenedAt >= REWARD_CLICK_DELAY_MS);
    await page.locator(".reward-option").first().click();
    await page.waitForFunction(() => gameState === "playing" || gameState === "building");
    await page.evaluate(() => { if (gameState === "building") beginWave(); });
  };
  const playDuelToTheEnd = async () => {
    await page.evaluate(() => { for (let i = 0; i < 100; i++) update(0.05); });
    await winRound();
    await takeReward();
    await page.evaluate(() => { for (let i = 0; i < 100; i++) update(0.05); });
    await winRound();
    await page.waitForSelector("#duel-screen:not(.hidden)");
  };

  console.log("\nWithout a server");
  await check("the local copy shows no ghost button", async () => {
    await setUp(null);
    assert.equal(await page.evaluate(() => ghostServer()), null);
    assert.equal(await page.locator("#ghost-btn").isVisible(), false);
    assert.equal(await page.locator("#duel-btn").isVisible(), true);
  });

  console.log("\nWith a server and no ghosts yet");
  await check("the button waits, looking for ghosts", async () => {
    await setUp();
    await page.waitForFunction(() => !ghostFetching);
    assert.equal(await page.locator("#ghost-btn").isVisible(), true);
    assert.equal(await page.locator("#ghost-btn").isDisabled(), true);
    assert.match(await page.locator("#ghost-btn").textContent(), /looking for ghosts/);
  });
  await check("a finished rival duel is sent as a ghost, named from the player's id", async () => {
    await page.locator("#duel-btn").click();
    await playDuelToTheEnd();
    await page.waitForFunction(() => !ghostUploading && readStored(GHOST_QUEUE_KEY, []).length === 0);
    assert.equal(await store.count(), 1);
    const id = await page.evaluate(() => save.playerId);
    assert.match(id, /^[0-9a-f]{16}$/);
    assert.equal(await page.evaluate(() => ghostName(save.playerId)), ghostName(id));
    const mine = await store.match(1, "nobody");
    assert.equal(mine.player, id);
    assert.equal(mine.rounds.length, 2);
    assert.ok(mine.power > 0);
    assert.ok(mine.rounds[0].soldiers.length >= 3 && mine.rounds[0].soldiers.some((n) => n > 0), JSON.stringify(mine.rounds[0].soldiers));
  });
  await check("a player is never shown their own ghost", async () => {
    await page.locator("#duel-home-btn").click();
    await page.waitForFunction(() => !ghostFetching);
    assert.equal(await page.evaluate(() => storedGhost()), null);
  });

  console.log("\nA ghost duel");
  await check("another player's ghost is fetched ahead and named on the button", async () => {
    await store.add(require("../server/ghosts").checkGhost(otherGhost));
    await page.evaluate(() => updateDuelButton());
    await page.waitForFunction(() => Boolean(storedGhost()));
    await page.evaluate(() => updateDuelButton());
    assert.equal(await page.locator("#ghost-btn").isDisabled(), false);
    assert.equal(await page.locator("#ghost-btn").textContent(), `\u{1F47B} Ghost duel: ${ghostName(OTHER)}`);
    await page.screenshot({ path: path.join(scratch, "ghost-title.png") });
  });
  await check("fights the way the ghost did: its soldiers each second, and its hits on time", async () => {
    // Read storage in the same tick as the click: the next ghost is fetched right after, and with
    // only one other ghost on this server it can come straight back.
    const stored = await page.evaluate(() => { document.getElementById("ghost-btn").click(); return storedGhost(); });
    const start = await page.evaluate((stored) => ({ name: duel.rival.name, ghost: Boolean(duel.ghost), enemy: enemyPower, mine: playerPower, stored }), stored);
    assert.equal(start.name, ghostName(OTHER));
    assert.ok(start.ghost);
    assert.ok(Math.abs(start.enemy - 10) < 0.1, `enemy ${start.enemy}`);
    assert.ok(Math.abs(start.mine - 10) < 0.1, `mine ${start.mine}`);
    assert.equal(start.stored, null, "used up");
    const sent = await page.evaluate(() => {
      const before = enemyBacklog + marchers.filter((m) => m.side === "enemy").reduce((s, m) => s + m.value, 0) + enemyPower;
      playerPower = 1000; enemyPower = 1000;
      for (let i = 0; i < 18; i++) update(0.05); // 0.9 seconds: before the first hit
      const powerBefore = playerPower;
      for (let i = 0; i < 4; i++) update(0.05); // past 1 second: the 3-soldier hit lands
      return { hitTaken: powerBefore - playerPower, ghostHit: duel.ghostHit, left: duel.roundLeft };
    });
    assert.equal(sent.ghostHit, 1);
    assert.ok(sent.hitTaken > 2.5, `hit ${sent.hitTaken}`);
    const flow = await page.evaluate(() => {
      let sent = 0;
      const send = sendMarcher;
      sendMarcher = (side, value, t) => { if (side === "enemy") sent += value; send(side, value, t); };
      const before = enemyBacklog;
      for (let i = 0; i < 20; i++) update(0.05);
      sendMarcher = send;
      return sent + enemyBacklog - before;
    });
    assert.ok(flow > 1.2 && flow < 1.8, `one second of the ghost sent ${flow}, its record says 1.5`);
    await page.screenshot({ path: path.join(scratch, "ghost-duel.png") });
  });
  await check("a round past the ghost's record replays its last round, stronger", async () => {
    const scale = await page.evaluate(() => { const r = duel.round; duel.round = 3; const g = ghostRound(); duel.round = r; return [g.scale, g.round.start]; });
    assert.deepEqual(scale, [1.2, 12]);
    const late = await page.evaluate(() => ghostSoldiersAt(duel.ghost.rounds[1], 45));
    assert.equal(late, 2);
  });
  await check("restarting from the pause menu keeps the same ghost", async () => {
    await page.evaluate(() => pauseGame());
    await page.locator("#restart-btn").click();
    assert.equal(await page.evaluate(() => duel.ghost && duel.rival.name), ghostName(OTHER));
    assert.equal(await page.evaluate(() => duel.round), 1);
  });
  await check("winning pays ghost coins, leaves the rival ladder alone, and says what a ghost is", async () => {
    const before = await page.evaluate(() => ({ coins: save.coins, level: rivalLevel() }));
    await playDuelToTheEnd();
    assert.equal(await page.evaluate(() => save.coins), before.coins + 30);
    assert.equal(await page.evaluate(() => rivalLevel()), before.level);
    assert.match(await page.locator("#duel-result-next").textContent(), /real player's machine/);
    await page.screenshot({ path: path.join(scratch, "ghost-won.png") });
  });

  console.log("\nWhen the server can't be reached");
  await check("a finished duel waits in the queue, and goes once the server answers", async () => {
    await setUp("http://localhost:1");
    await page.locator("#duel-btn").click();
    await playDuelToTheEnd();
    await page.waitForFunction(() => !ghostUploading);
    assert.equal(await page.evaluate(() => readStored(GHOST_QUEUE_KEY, []).length), 1);
    const count = await store.count();
    await page.evaluate((s) => localStorage.setItem(GHOST_SERVER_KEY, s), ghostUrl);
    await page.evaluate(() => flushGhostUploads());
    await page.waitForFunction(() => !ghostUploading && readStored(GHOST_QUEUE_KEY, []).length === 0);
    assert.equal(await store.count(), count + 1);
  });
  await check("a broken ghost kept from before is ignored", async () => {
    await page.evaluate(() => localStorage.setItem(GHOST_KEY, JSON.stringify({ name: "x", rounds: [{ start: -1 }] })));
    assert.equal(await page.evaluate(() => storedGhost()), null);
  });

  assert.deepEqual(errors, []);
  console.log(`\n${passed} passed, ${failures.length} failed`);
  await browser.close();
  server.close();
  ghosts.close();
  process.exit(failures.length ? 1 : 0);
})();
