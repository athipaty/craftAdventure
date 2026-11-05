// Tests and screenshots for the gameplay improvements.
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
  catch (e) { failures.push(name); console.log("  FAIL", name, "\n      ", e.message.split("\n").slice(0, 6).join("\n       ")); }
}
(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  // These tests aren't about routes, which would otherwise come up at random after a reward.
  page.on("domcontentloaded", () => page.evaluate(() => { pathChoiceDue = () => false; }).catch(() => {}));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text()); });
  const reset = async () => {
    await page.goto(url);
    await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
    await page.goto(url);
    await page.evaluate(() => {
      save.stats.waves = 100; for (const t of TIPS) save.tips[t.id] = true;
      writeSave();
      document.getElementById("daily-screen").classList.add("hidden");
    });
  };
  const toRewards = async () => {
    await page.evaluate(() => { boss = null; playerPower = 1e7; enemyPower = 1; });
    await page.waitForSelector("#reward-screen:not(.hidden)");
    await page.waitForTimeout(500);
  };

  console.log("\nNext-wave preview");
  await reset();
  await page.click("#play-btn");
  await check("the preview always matches the wave that follows", async () => {
    const bad = await page.evaluate(() => {
      const out = [];
      for (const w of [0, 1, 2, 3]) {
        currentWorld = w;
        for (let i = 0; i < 300; i++) {
          wave = 2 + (i % 24); boss = null; enemyType = null; waveEvent = null; blockedCells.clear();
          nextWavePlan = planWave(wave);
          const plan = nextWavePlan;
          const text = nextWaveText(plan);
          startWave();
          if (plan.boss && (!boss || boss.kind.id !== plan.boss || !text.includes(boss.kind.name))) out.push(["boss", w, wave, text]);
          if (!plan.boss && boss) out.push(["unexpected boss", w, wave]);
          if (plan.enemy && plan.enemy !== "goblin" && (enemyType?.id !== plan.enemy || !text.includes(enemyType.name))) out.push(["enemy", w, wave, text]);
          if (plan.event && (waveEvent?.id !== plan.event || !text.includes(waveEvent.name))) out.push(["event", w, wave, text]);
          if (isBossWave(wave) !== Boolean(plan.boss)) out.push(["boss wave", w, wave]);
          boss = null; enemyType = null; waveEvent = null; blockedCells.clear(); eventReinforcePerSec = 0; enemyReinforcePerSec = 0;
        }
      }
      currentWorld = 0; wave = 1;
      return out;
    });
    assert.deepEqual(bad.slice(0, 5), []);
  });
  await check("boss kinds still follow the old order, and final bosses are named", async () => {
    const r = await page.evaluate(() => {
      currentWorld = 1;
      const a = planWave(5).boss, b = planWave(10).boss;
      wave = finalWaveNumber();
      const t = nextWaveText(planWave(wave));
      currentWorld = 0; wave = 1;
      return { a, b, t };
    });
    assert.equal(r.a, "wall"); assert.equal(r.b, "scramble");
    assert.ok(r.t.includes("Final boss"), r.t);
  });
  await reset();
  await page.click("#play-btn");
  await toRewards();
  await check("the reward screen shows the next wave", async () => {
    const t = await page.locator("#reward-next").textContent();
    assert.ok(t.startsWith("Next: "), t);
  });

  console.log("\nReroll and skip");
  await check("reroll gives new choices, is limited, and blocks at zero", async () => {
    const before = await page.evaluate(() => [...offeredRewards.ids]);
    await page.click("#reroll-btn");
    const after = await page.evaluate(() => [...offeredRewards.ids]);
    assert.equal(after.filter((id) => before.includes(id)).length, 0);
    assert.equal(await page.locator("#reroll-btn").textContent(), "Reroll (1 left)");
    await page.click("#reroll-btn");
    assert.equal(await page.locator("#reroll-btn").textContent(), "Reroll (0 left)");
    assert.equal(await page.locator("#reroll-btn").isDisabled(), true);
    assert.equal(await page.evaluate(() => rerollsLeft), 0);
  });
  await check("rerolls and rerolled choices survive a reload", async () => {
    const offered = await page.evaluate(() => offeredRewards);
    const plan = await page.evaluate(() => nextWavePlan);
    await page.reload();
    await page.evaluate(() => document.getElementById("daily-screen").classList.add("hidden"));
    await page.click("#continue-btn");
    await page.waitForSelector("#reward-screen:not(.hidden)");
    assert.deepEqual(await page.evaluate(() => offeredRewards), offered);
    assert.deepEqual(await page.evaluate(() => nextWavePlan), plan);
    assert.equal(await page.evaluate(() => rerollsLeft), 0);
    await page.waitForTimeout(500);
  });
  await check("skip pays coins, gives no reward and starts the wave", async () => {
    const c0 = await page.evaluate(() => save.coins);
    const parts0 = await page.evaluate(() => JSON.stringify(runParts));
    const gears0 = await page.evaluate(() => grid.flat().filter(Boolean).length);
    await page.click("#skip-btn");
    assert.equal(await page.evaluate(() => save.coins), c0 + 3);
    assert.equal(await page.evaluate(() => JSON.stringify(runParts)), parts0);
    assert.equal(await page.evaluate(() => grid.flat().filter(Boolean).length), gears0);
    assert.equal(await page.evaluate(() => gameState), "playing");
    assert.equal(await page.evaluate(() => wave), 2);
  });
  await check("an old save without the new fields still continues", async () => {
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("gearfight_run"));
      delete s.nextPlan; delete s.numbers.rerollsLeft; delete s.numbers.runStartWave;
      runBanked = true;
      localStorage.setItem("gearfight_run", JSON.stringify(s));
    });
    await page.reload();
    await page.evaluate(() => document.getElementById("daily-screen").classList.add("hidden"));
    await page.click("#continue-btn");
    assert.equal(await page.evaluate(() => rerollsLeft), 2);
    assert.equal(await page.evaluate(() => runStartWave), 1);
  });

  console.log("\nButtons and popups");
  await reset();
  await page.click("#play-btn");
  await check("Train explains what's missing", async () => {
    await page.evaluate(() => { gameState = "paused"; playerPower = 1; enemyPower = 100; updateTrainButton(); });
    assert.match(await page.locator("#train-btn").textContent(), /^Train Knight: need \d+ more$/);
    await page.evaluate(() => { gameState = "playing"; playerPower = 1000; enemyPower = 1000; });
  });
  await check("popups no longer overlap the top bar", async () => {
    await page.evaluate(() => { for (let i = 0; i < 1; i++) announce("Quest done! +15 coins"); });
    await page.waitForSelector("#announcement:not(.hidden)");
    const r = await page.evaluate(() => {
      const a = document.getElementById("announcement").getBoundingClientRect();
      const hud = document.getElementById("hud").getBoundingClientRect();
      const board = document.getElementById("board-canvas").getBoundingClientRect();
      const train = document.getElementById("train-btn").getBoundingClientRect();
      return { overlapHud: a.top < hud.bottom, overlapBoard: a.top < board.bottom, overlapTrain: a.top < train.bottom };
    });
    assert.deepEqual(r, { overlapHud: false, overlapBoard: false, overlapTrain: false });
  });

  console.log("\nVibration");
  await check("buzz vibrates, is throttled and can be turned off", async () => {
    const r = await page.evaluate(() => {
      const calls = [];
      Object.defineProperty(navigator, "vibrate", { value: (p) => { calls.push(p); return true; }, configurable: true });
      Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: true }, configurable: true });
      lastBuzzAt = 0; save.vibrate = true;
      buzz(10); buzz(10);
      const throttled = calls.length;
      lastBuzzAt = 0; save.vibrate = false; buzz(10);
      const off = calls.length;
      save.vibrate = true; lastBuzzAt = 0;
      strikeCooldown = 0; strikeEnemy();
      return { throttled, off, afterStrike: calls.length };
    });
    assert.deepEqual(r, { throttled: 1, off: 1, afterStrike: 2 });
  });

  console.log("\n2x speed");
  await check("2x runs the game twice as fast and remembers the choice", async () => {
    const measure = () => page.evaluate(() => new Promise((done) => {
      playerPower = 1000; enemyPower = 1000;
      const real = update; let steps = 0, frames = 0;
      update = (dt) => { steps++; playerPower = 1000; enemyPower = 1000; real(dt); };
      const tick = () => { if (++frames < 30) requestAnimationFrame(tick); else { update = real; done(steps / frames); } };
      requestAnimationFrame(tick);
    }));
    const normal = await measure();
    await page.click("#speed-btn");
    const fast = await measure();
    console.log("        rule steps per frame: 1x", normal.toFixed(2), " 2x", fast.toFixed(2));
    assert.ok(normal > 0.7 && normal <= 1.05 && fast / normal > 1.7);
    assert.equal(await page.locator("#speed-btn").textContent(), "2x");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("gearfight_save")).speed), 2);
    await page.click("#speed-btn");
  });

  console.log("\nHead start");
  await reset();
  await check("cleared worlds offer it, uncleared ones don't", async () => {
    await page.evaluate(() => { save.worldsCleared.forest = true; writeSave(); });
    await page.click("#play-btn");
    assert.equal(await page.locator(".world-head-start").count(), 1);
    assert.equal(await page.locator(".world-head-start").textContent(), "Start Green Forest at wave 6");
    await page.screenshot({ path: path.join(scratch, "shot-worlds.png") });
  });
  await page.locator(".world-head-start").click();
  await check("it starts at wave 6 with extra gears and a contested wave", async () => {
    const r = await page.evaluate(() => ({ wave, gears: grid.flat().filter((c) => c && !c.driver).length, ratio: playerPower / (playerPower + enemyPower), start: runStartWave, state: gameState }));
    console.log("       ", JSON.stringify(r));
    assert.equal(r.wave, 6); assert.equal(r.gears, 7); assert.equal(r.start, 6); assert.equal(r.state, "playing");
    assert.ok(r.ratio > 0.3 && r.ratio < 0.7);
  });
  await check("skipped waves pay no coins or XP, and survive a reload", async () => {
    await page.evaluate(() => { saveRun(); });
    await page.reload();
    await page.evaluate(() => document.getElementById("daily-screen").classList.add("hidden"));
    await page.click("#continue-btn");
    assert.equal(await page.evaluate(() => runStartWave), 6);
    assert.equal(await page.evaluate(() => coinsForRun()), 0);
    await page.evaluate(() => { wave = 8; });
    assert.equal(await page.evaluate(() => coinsForRun()), 4);
    await page.evaluate(() => { wave = 6; });
  });
  await check("the next run after a head start begins at wave 1", async () => {
    await page.click("#restart-btn");
    assert.equal(await page.evaluate(() => wave), 1);
    assert.equal(await page.evaluate(() => runStartWave), 1);
  });

  await check("the world list scrolls with every world cleared, on a small phone", async () => {
    await reset();
    await page.evaluate(() => { for (const w of WORLDS) save.worldsCleared[w.id] = true; writeSave(); });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.click("#play-btn");
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(scratch, "shot-worlds-small.png") });
    const r = await page.evaluate(() => {
      const list = document.getElementById("worlds-list");
      const back = document.getElementById("worlds-close-btn").getBoundingClientRect();
      const heights = [...list.children].map((c) => [c.scrollHeight, c.clientHeight]);
      return { scrolls: list.scrollHeight > list.clientHeight, backOk: back.bottom <= innerHeight, squashed: heights.filter(([a, b]) => a > b + 1).length, head: list.querySelectorAll(".world-head-start").length };
    });
    assert.deepEqual(r, { scrolls: true, backOk: true, squashed: 0, head: 4 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click("#worlds-close-btn");
    await page.click("#play-btn");
    await page.locator(".world-card").nth(1).click();
  });

  console.log("\nRun recap");
  await check("Game Over shows the build", async () => {
    await page.evaluate(() => { placeGear("soldier").level = 4; placeGear("big"); runParts = { staticCharge: 2, warChest: 1, cooling: 1, longChain: 1, bossHunter: 1, warDrums: 1, patterns: 1 }; wave = 12; bossesBeaten = 2; enemyPower = 1e6; playerPower = 1; });
    await page.waitForSelector("#gameover-screen:not(.hidden)");
    assert.equal(await page.locator("#run-build-gears").textContent(), "3 gears, top level 4");
    const parts = await page.locator("#run-build-parts").textContent();
    assert.ok(parts.startsWith("Rewards: ") && parts.endsWith("+2 more"), parts);
    await page.evaluate(() => document.getElementById("daily-screen").classList.add("hidden"));
    await page.screenshot({ path: path.join(scratch, "shot-gameover.png") });
    for (const [name, w, h] of [["phone", 390, 844], ["small", 320, 568], ["landscape", 844, 390]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(scratch, `shot-gameover-${name}.png`) });
      const out = await page.evaluate(() => { const s = document.getElementById("gameover-screen").getBoundingClientRect(); return [...document.querySelectorAll("#gameover-screen h2, #gameover-screen p, #gameover-screen button, #run-stats")].filter((b) => { const q = b.getBoundingClientRect(); return q.height && (q.top < s.top - 1 || q.bottom > s.bottom + 1); }).map((b) => b.id || b.tagName); });
      assert.deepEqual(out, [], name);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });

  console.log("\nCrowd");
  await reset();
  await page.click("#play-btn");
  await check("crowd grows with the army, stays clear of the fighter, and is cheap to draw", async () => {
    const r = await page.evaluate(() => {
      const calls = [];
      const fake = { drawImage: (s, x) => calls.push(x) };
      const sizes = [0, 1, 3, 20, 650, 1e6].map((n) => { calls.length = 0; drawCrowd(fake, 200, 16, -1, CROWD_FIRST_GAP, fighterLook(), n, 80, false); return calls.length; });
      calls.length = 0;
      drawCrowd(fake, 300, 16, -1, CROWD_FIRST_GAP, fighterLook(), 1e6, 80, false);
      const nearest = Math.max(...calls) + CROWD_SPRITE_SIZE * CROWD_SCALE / 2;
      calls.length = 0;
      drawCrowd(fake, 40, 16, -1, CROWD_FIRST_GAP, fighterLook(), 1e6, 80, false);
      const pastEdge = calls.length;
      playerPower = 650; enemyPower = 500;
      const t0 = performance.now();
      for (let i = 0; i < 2000; i++) drawBattle();
      const ms = (performance.now() - t0) / 2000;
      return { sizes, nearest, pastEdge, ms };
    });
    console.log("       ", JSON.stringify(r));
    assert.deepEqual(r.sizes, [0, 1, 2, 4, 9, 10]);
    assert.ok(r.nearest <= 300 - 10, "crowd reaches the fighter");
    assert.equal(r.pastEdge, 0);
    assert.ok(r.ms < 4, `drawBattle took ${r.ms}ms`);
  });
  await page.evaluate(() => {
    wave = 9; armyRank = 1; peakRate = 30;
    for (let i = 0; i < 10; i++) placeGear("soldier");
    startWave(); playerPower = enemyPower * 1.4;
    setInterval(() => { playerPower = enemyPower * 1.4; }, 100);
  });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(scratch, "shot-crowd.png"), clip: { x: 0, y: 0, width: 390, height: 260 } });

  console.log("\nMusic");
  await reset();
  await check("each world's song has valid notes and tempo", async () => {
    const ok = await page.evaluate(() => SONGS.length === WORLDS.length && SONGS.every((s) => s.notes.length === 32 && s.bass.length === 4 && s.bpm > 0));
    assert.equal(ok, true);
  });
  await page.click("#play-btn");
  await check("music plays in a run, stops on pause, mute and the Music switch", async () => {
    const r = await page.evaluate(async () => {
      ensureAudio(); await audioCtx.resume();
      let notes = 0;
      const real = musicNote;
      musicNote = (...a) => { notes++; real(...a); };
      const wait = (ms) => new Promise((f) => setTimeout(f, ms));
      playerPower = 1000; enemyPower = 1000;
      const out = { state: audioCtx.state };
      const count = async () => { notes = 0; await wait(700); return notes; };
      out.playing = await count();
      playerPower = 1000; enemyPower = 1000;
      save.music = false; out.switchedOff = await count(); save.music = true;
      playerPower = 1000; enemyPower = 1000;
      save.muted = true; out.muted = await count(); save.muted = false;
      playerPower = 1000; enemyPower = 1000;
      pauseGame(); out.paused = await count(); resumeGame();
      return out;
    });
    console.log("       ", JSON.stringify(r));
    assert.equal(r.state, "running");
    assert.ok(r.playing > 0); assert.equal(r.switchedOff, 0); assert.equal(r.muted, 0); assert.equal(r.paused, 0);
  });

  console.log("\nLayout");
  const showCards = async () => {
    await page.evaluate(() => {
      clearTimeout(rewardTimer);
      document.getElementById("gameover-screen").classList.add("hidden");
      gameState = "playing"; boss = null; wave = 5; currentWorld = 1; nextWavePlan = null; rerollsLeft = 2;
      showRewards("Boss defeated!", ["bigGear", "secondWind", "stormEngine", "chargedStrike"].map((id) => REWARDS.find((r) => r.id === id)));
      clearTimeout(rewardTimer);
      document.getElementById("reward-screen").classList.remove("hidden");
    });
    await page.waitForTimeout(350);
  };
  const fits = () => page.evaluate(() => {
    const root = document.getElementById("reward-screen").getBoundingClientRect();
    return [...document.querySelectorAll(".reward-option, #reroll-btn, #skip-btn, #reward-title, #reward-next")].filter((b) => {
      const r = b.getBoundingClientRect();
      return !(r.left >= root.left && r.right <= root.right && r.top >= root.top && r.bottom <= root.bottom);
    }).map((b) => b.id || b.className);
  });
  await showCards();
  const sizes = [["phone", 390, 844], ["small", 320, 568], ["landscape", 844, 390]];
  for (const [name, w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(scratch, `shot2-rewards-${name}.png`) });
    await check(`reward screen fits: ${name}`, async () => assert.deepEqual(await fits(), []));
  }
  await page.evaluate(() => { document.getElementById("reward-screen").classList.add("hidden"); clearTimeout(rewardTimer); gameState = "playing"; boss = null; wave = 40; armyRank = 2; playerPower = 1e6; enemyPower = 5e6; save.speed = 2; updateSettingButtons(); playerPower = 9e4; enemyPower = 9e4; });
  for (const [name, w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    await check(`top bar and buttons fit: ${name}`, async () => {
      const r = await page.evaluate(() => {
        const frame = document.getElementById("app-frame").getBoundingClientRect();
        const hud = document.getElementById("hud");
        return { hud: hud.scrollWidth <= hud.clientWidth + 1, right: document.getElementById("pause-btn").getBoundingClientRect().right <= frame.right + 1 };
      });
      assert.deepEqual(r, { hud: true, right: true });
    });
    await page.screenshot({ path: path.join(scratch, `shot2-game-${name}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => { save.speed = 1; updateSettingButtons(); gameState = "playing"; Object.defineProperty(navigator, "vibrate", { value: () => true, configurable: true }); updateSettingButtons(); runParts = { staticCharge: 2, warChest: 1, cooling: 1, longChain: 1, bossHunter: 1, warDrums: 1 }; pauseGame(); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(scratch, "shot2-pause-small.png") });
  await check("pause screen fits on a small phone", async () => {
    const r = await page.evaluate(() => { const s = document.getElementById("pause-screen").getBoundingClientRect(); return [...document.querySelectorAll("#resume-btn, #restart-btn, #music-btn, #vibrate-btn, #pause-parts")].filter((b) => { const q = b.getBoundingClientRect(); return q.top < s.top || q.bottom > s.bottom; }).map((b) => b.id); });
    assert.deepEqual(r, []);
  });

  await check("no page errors in the whole session", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
