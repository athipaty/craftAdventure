// Tests and screenshots for language, guide, status, easy mode and the rest.
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
  catch (e) { failures.push(name); console.log("  FAIL", name, "\n      ", e.message.split("\n").slice(0, 12).join("\n       ")); }
}
(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.stack).replace(/\s+/g, " ").slice(0, 400)));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text() + " @ " + m.location().url); });
  const hide = () => page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); });
  const reset = async (setup) => {
    await page.goto(url);
    await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
    await page.goto(url);
    await page.evaluate(() => { for (const t of TIPS) save.tips[t.id] = true; writeSave(); });
    if (setup) await page.evaluate(setup);
    await hide();
  };
  const start = (o) => page.evaluate((x) => startChosenRun(x), o);
  const fitsCheck = (ids) => page.evaluate((list) => {
    const f = document.getElementById("app-frame").getBoundingClientRect();
    return list.filter((id) => { const q = document.querySelector(id)?.getBoundingClientRect(); return q && q.height && (q.left < f.left - 1 || q.right > f.right + 1 || q.top < f.top - 1 || q.bottom > f.bottom + 1); });
  }, ids);

  console.log("\nStatus labels");
  await reset(() => { save.stats.waves = 100; writeSave(); });
  await start({ world: 0 });
  await check("active effects and rewards show, and go away when they end", async () => {
    await page.evaluate(() => { runParts = { staticCharge: 2, warChest: 1, cooling: 1, longChain: 1, secondWind: 1 }; overdriveLeft = 3; frozenFor = 2; rallying = true; activeDeal = WAVE_DEALS.army; wavePace = WAVE_PACES.rush; playerPower = 1000; enemyPower = 1000; });
    await page.waitForTimeout(120);
    const chips = await page.locator(".status-chip").allTextContents();
    console.log("       ", JSON.stringify(chips));
    for (const want of [/^Overdrive \ds$/, /^Frozen \ds$/, /^Rally ready$/, /^Deal: 50% more enemies$/, /^Rush wave$/, /^Second wind$/, /^\+\d+ more$/]) assert.ok(chips.some((c) => want.test(c)), String(want));
    await page.screenshot({ path: path.join(scratch, "shot7-status.png") });
    const overlaps = await page.evaluate(() => { const lane = document.getElementById("battle-lane").getBoundingClientRect(), row = document.getElementById("status-row").getBoundingClientRect(); return row.top < lane.bottom - 1; });
    assert.equal(overlaps, false, "status covers the battle");
    const ptr = await page.evaluate(() => getComputedStyle(document.getElementById("status-row")).pointerEvents);
    assert.equal(ptr, "none");
    await page.evaluate(() => { runParts = {}; overdriveLeft = 0; frozenFor = 0; rallying = false; activeDeal = null; wavePace = null; playerPower = 1000; enemyPower = 1000; });
    await page.waitForTimeout(120);
    assert.deepEqual(await page.locator(".status-chip").allTextContents(), []);
  });

  console.log("\nFirst five minutes");
  await reset();
  await start({ world: 0 });
  await check("a brand new player sees only the basics", async () => {
    const r = await page.evaluate(() => ({ rally: !document.getElementById("rally-btn").classList.contains("hidden"), train: !document.getElementById("train-btn").classList.contains("hidden"), speed: !document.getElementById("speed-btn").classList.contains("hidden"), rare: REWARDS.filter(rewardIsOpen).filter((x) => x.rarity).length, far: REWARDS.filter(rewardIsOpen).some((x) => x.id === "farGear"), deal: (() => { for (let i = 0; i < 300; i++) if (planWave(7).deal) return true; return false; })() }));
    assert.deepEqual(r, { rally: false, train: false, speed: false, rare: 0, far: false, deal: false });
    await page.screenshot({ path: path.join(scratch, "shot7-new-player.png") });
  });
  await check("features arrive one at a time, with a notice", async () => {
    const r = await page.evaluate(() => {
      const seen = [];
      const realAnnounce = announce; announce = (x) => seen.push(x);
      for (let w = 1; w <= 10; w++) { save.stats.waves = w; announceNewFeatures(); }
      announce = realAnnounce;
      return seen;
    });
    assert.deepEqual(r, ["New: Rerolls and skips!", "New: Rare rewards!", "New: Rally!", "New: Training!", "New: 2x speed!", "New: Far and Lone gears!", "New: Risky deals!"]);
  });
  await check("the buttons come back, and tips only appear once a feature is there", async () => {
    const r = await page.evaluate(() => {
      save.stats.waves = 0; delete save.tips.rally;
      const lockedTip = TIPS.find((x) => x.id === "rally");
      const a = !TIP_FEATURES[lockedTip.id] || featureOn(TIP_FEATURES[lockedTip.id]);
      save.stats.waves = 100; updateFeatureButtons();
      const b = featureOn("rally");
      return { a, b, rally: !document.getElementById("rally-btn").classList.contains("hidden"), train: !document.getElementById("train-btn").classList.contains("hidden") };
    });
    assert.deepEqual(r, { a: false, b: true, rally: true, train: true });
  });

  console.log("\nEasy mode");
  await reset(() => { save.stats.waves = 100; save.worldsCleared.forest = true; writeSave(); });
  await check("the toggle is on the world list, and makes runs easier for fewer coins", async () => {
    await page.click("#play-btn");
    await page.locator(".world-easy-btn").click();
    assert.equal(await page.locator(".world-easy-btn").textContent(), "Easy mode: on");
    await page.screenshot({ path: path.join(scratch, "shot7-worlds.png") });
    await page.locator(".world-card", { hasText: "Green Forest" }).click();
    const r = await page.evaluate(() => { wave = 11; bossesBeaten = 0; const coins = coinsForRun(); peakRate = 20; const easy = { easy: runEasy, scale: worldScale(), size: waveStartEnemy(11), weak: bossWeakening(), coins }; wave = 1; return easy; });
    assert.equal(r.easy, true); assert.ok(Math.abs(r.scale - 1.47) < 1e-9); assert.equal(r.coins, 15); assert.ok(Math.abs(r.weak - 0.65) < 1e-9);
  });
  await check("Easy clears count, but only the first star; it survives a reload", async () => {
    await page.evaluate(() => saveRun());
    await page.reload(); await hide();
    assert.equal(await page.locator("#continue-btn").textContent(), "Continue: Green Forest (Easy), wave 1");
    await page.click("#continue-btn");
    assert.equal(await page.evaluate(() => runEasy), true);
    await page.click("#resume-btn");
    await page.evaluate(() => { wave = 15; boss = { kind: bossKind("warlord"), hp: 0, maxHp: 1, attackIn: 9, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; });
    await page.waitForSelector("#world-clear-screen:not(.hidden)");
    assert.match(await page.locator("#world-clear-stars").textContent(), /^\u2605\u2606\u2606/);
    assert.equal(await page.evaluate(() => Boolean(save.worldsCleared.forest)), true);
  });
  await check("Easy never applies to Hard, the daily or the weekly", async () => {
    await page.evaluate(() => { save.easy = true; });
    for (const o of [{ world: 0, level: 1 }]) { await start(o); assert.equal(await page.evaluate(() => runEasy), false); }
    await page.evaluate(() => startChosenRun({ world: 0, daily: makeDaily(todayKey()) }));
    assert.equal(await page.evaluate(() => runEasy), false);
    await page.evaluate(() => startChosenRun({ world: 0, event: WEEKLY_EVENTS[0] }));
    assert.equal(await page.evaluate(() => runEasy), false);
    await page.evaluate(() => { save.easy = false; });
  });

  console.log("\nStories");
  await reset(() => { delete save.tips["story:forest"]; writeSave(); });
  await check("a world's story shows first, once; its ending shows on the first clear", async () => {
    await start({ world: 0 });
    await page.waitForSelector("#tip-screen:not(.hidden)");
    assert.match(await page.locator("#tip-text").textContent(), /^Goblins have overrun/);
    await page.waitForTimeout(450);
    await page.click("#tip-ok-btn");
    await page.evaluate(() => { for (const x of TIPS) save.tips[x.id] = true; wave = 15; boss = { kind: bossKind("warlord"), hp: 0, maxHp: 1, attackIn: 9, hitFlash: 0, reinforcePerSec: 0, shield: 0 }; });
    await page.waitForSelector("#world-clear-screen:not(.hidden)");
    assert.match(await page.locator("#world-clear-story").textContent(), /^The forest is safe/);
    await page.screenshot({ path: path.join(scratch, "shot7-outro.png") });
  });
  await check("every boss has a taunt, shown as the fight starts", async () => {
    const r = await page.evaluate(() => [...BOSS_KINDS, ...Object.values(FINAL_BOSSES)].filter((k) => !BOSS_TAUNTS[k.id]).map((k) => k.id));
    assert.deepEqual(r, []);
    await reset(() => { save.stats.waves = 100; writeSave(); });
    await start({ world: 0 });
    const said = await page.evaluate(() => { const real = announce; let got = ""; announce = (x) => { got = x; }; wave = 5; nextWavePlan = { boss: "rust" }; gameState = "building"; beginWave(); announce = real; boss = null; return got; });
    assert.equal(said, "Your gears will crumble to dust!");
  });

  console.log("\nGuide and trophies");
  await reset(() => { save.stats.waves = 12; save.playSeconds = 7500; save.stats.bosses = 3; writeSave(); });
  await check("More holds everything, and the guide explains the words players ask about", async () => {
    await page.click("#title-more-btn");
    await page.screenshot({ path: path.join(scratch, "shot7-more.png") });
    await page.click("#guide-btn");
    const text = await page.locator("#guide-list").textContent();
    for (const word of ["Far gear", "Lone gear", "Tight chain", "Forged gear", "A free level 3 gear", "Merge", "Combo", "Lightning", "Magma King", "Armoured brutes"]) assert.ok(text.includes(word), word);
    await page.screenshot({ path: path.join(scratch, "shot7-guide.png") });
    const n = await page.evaluate(() => REWARDS.filter((r) => !r.gear).length);
    assert.ok((await page.locator(".guide-row").count()) > n);
    await page.click("#guide-close-btn");
  });
  await check("the trophy room shows lifetime progress", async () => {
    await page.click("#trophy-btn");
    const text = await page.locator("#trophy-list").textContent();
    for (const part of ["Waves won12", "Bosses beaten3", "Time played2h 5m", "World stars0 / 12", "KnightLevel 1", "Green Forest\u2606\u2606\u2606"]) assert.ok(text.includes(part), part);
    await page.screenshot({ path: path.join(scratch, "shot7-trophies.png") });
    await page.click("#trophy-close-btn");
  });
  await check("display settings work and are remembered", async () => {
    await page.click("#big-text-btn"); await page.click("#color-blind-btn"); await page.click("#less-motion-btn");
    const r = await page.evaluate(() => { const c = document.documentElement.classList; return { big: c.contains("big-text"), less: c.contains("less-motion"), blind: save.colorBlind }; });
    assert.deepEqual(r, { big: true, less: true, blind: true });
    await page.reload(); await hide();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("big-text") && save.lessMotion && save.colorBlind), true);
    await start({ world: 0 });
    await page.evaluate(() => { screenShake = 9; hitStop = 1; playerPower = 1000; enemyPower = 1000; });
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => [screenShake, hitStop, particles.length && 0]), [0, 0, 0]);
    for (const [w, h] of [[390, 844], [320, 568]]) {
      await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(150);
      assert.deepEqual(await fitsCheck(["#buy-gear-btn", "#strike-btn", "#rally-btn", "#pause-btn"]), [], `big text ${w}`);
    }
    await page.screenshot({ path: path.join(scratch, "shot7-bigtext-small.png") });
    await page.setViewportSize({ width: 390, height: 844 });
  });

  console.log("\nThai");
  await reset(() => { save.stats.waves = 100; save.owned["hero:archer"] = true; writeSave(); });
  await check("switching language works and is remembered", async () => {
    await page.click("#title-more-btn");
    assert.equal(await page.locator("#language-btn").textContent(), "Language: English");
    await Promise.all([page.waitForLoadState("load"), page.click("#language-btn")]);
    await page.waitForFunction(() => typeof currentLang !== "undefined" && currentLang === "th");
    await hide();
    assert.equal(await page.locator("#play-btn").textContent(), "เล่นเกม");
    await page.screenshot({ path: path.join(scratch, "shot7-th-title.png") });
  });
  // Everything in the game's own tables must have Thai.
  await check("every name and description in the game has Thai", async () => {
    const missing = await page.evaluate(() => {
      const texts = [];
      const add = (...x) => texts.push(...x.filter(Boolean));
      for (const r of REWARDS) add(r.name, r.text);
      for (const a of ACHIEVEMENTS) add(a.name, a.text);
      for (const u of UPGRADES) add(u.name, u.text);
      for (const x of [...HEROES, ...ARMY_SKINS, ...GEAR_SKINS, ...START_GEARS, ...WEEKLY_EVENTS, ...WAVE_EVENTS, ...WORLDS, ...BOSS_KINDS, ...Object.values(FINAL_BOSSES), ...Object.values(WAVE_PACES), ...Object.values(ENEMY_TYPES)]) add(x.name, x.text);
      for (const x of [...ARMY_RANKS, ...ENEMY_RANKS]) add(x.name, x.plural);
      for (const x of PLAYER_TITLES) add(x.name);
      for (const x of TIPS) add(x.text);
      for (const x of Object.values(WAVE_DEALS)) add(x.text);
      for (const x of Object.values(RULES)) add(x);
      for (const x of Object.values(NEXT_WAVE_HINTS)) add(x);
      for (const x of Object.values(BOSS_TAUNTS)) add(x);
      for (const x of Object.values(WORLD_STORIES)) add(x.intro, x.outro);
      for (const x of Object.values(FEATURE_NEWS)) add(x);
      for (const [title, rows] of guideSections()) { add(title); for (const [a, b] of rows) add(a, b); }
      for (const k of QUEST_KINDS) add(k.text(k.kind === "rank" ? 1 : 3));
      return [...new Set(texts)].filter((x) => /[A-Za-z]/.test(translate(x)) && !/Gear Fight/.test(x) && /[A-Za-z]{2}/.test(translate(x).replace(/XP/g, "")));
    });
    assert.deepEqual(missing, []);
  });
  const latin = () => page.evaluate(() => {
    const out = new Set();
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === Node.TEXT_NODE) { if (/[A-Za-z]{2}/.test(c.nodeValue.replace(/Gear|Fight!?|XP|English|II/g, ""))) out.add(c.nodeValue.trim()); }
        else if (c.nodeType === Node.ELEMENT_NODE && c.tagName !== "SCRIPT" && c.tagName !== "TEXTAREA" && !c.classList.contains("hidden")) walk(c);
      }
    };
    walk(document.getElementById("app-frame"));
    return [...out];
  });
  await check("no English left on the screens, in play", async () => {
    const seen = {};
    const look = async (name) => { const l = await latin(); if (l.length) seen[name] = l; };
    await look("title");
    await page.click("#title-more-btn"); await look("more");
    await page.click("#guide-btn"); await look("guide"); await page.screenshot({ path: path.join(scratch, "shot7-th-guide.png") }); await page.click("#guide-close-btn");
    await page.click("#trophy-btn"); await look("trophies"); await page.click("#trophy-close-btn");
    await page.click("#title-backup-btn"); await look("backup"); await page.click("#backup-close-btn"); await page.click("#more-close-btn");
    await page.evaluate(() => openWorkshop()); await look("workshop"); await page.screenshot({ path: path.join(scratch, "shot7-th-workshop.png") }); await page.click("#workshop-close-btn");
    await page.evaluate(() => openQuests()); await look("quests"); await page.click("#quests-close-btn");
    await page.evaluate(() => { save.worldsCleared.forest = true; save.worldLevels.forest = 2; openWorlds(); }); await look("worlds"); await page.screenshot({ path: path.join(scratch, "shot7-th-worlds.png") });
    await page.locator(".world-card").nth(2).click();
    await page.evaluate(() => { runParts = { staticCharge: 2 }; overdriveLeft = 3; frozenFor = 2; rallying = true; activeDeal = WAVE_DEALS.army; wavePace = WAVE_PACES.rush; playerPower = 1000; enemyPower = 1000; });
    await page.waitForTimeout(150); await look("playing"); await page.screenshot({ path: path.join(scratch, "shot7-th-playing.png") });
    await page.evaluate(() => { overdriveLeft = 0; frozenFor = 0; rallying = false; activeDeal = null; wavePace = null; pauseGame(); }); await look("paused"); await page.click("#resume-btn");
    await page.evaluate(() => { wave = 6; boss = null; playerPower = 1e7; enemyPower = 1; });
    await page.waitForSelector("#reward-screen:not(.hidden)");
    await page.evaluate(() => { nextWavePlan = { enemy: "brute", event: null, pace: "siege", deal: "dark" }; document.getElementById("reward-next").textContent = nextWaveText(nextWavePlan); updateDealButton(); });
    await page.waitForTimeout(500); await look("rewards"); await page.screenshot({ path: path.join(scratch, "shot7-th-rewards.png") });
    await page.click("#skip-btn");
    await page.evaluate(() => { for (let i = 0; i < 3; i++) placeGear("soldier"); });
    await page.evaluate(() => { if (gameState === "building") beginWave(); wave = 15; boss = { kind: bossKind("warlord"), hp: 500, maxHp: 900, attackIn: 9, hitFlash: 0, reinforcePerSec: 0, shield: 2 }; playerPower = 1000; enemyPower = 1000; });
    await page.waitForTimeout(150); await look("boss"); await page.screenshot({ path: path.join(scratch, "shot7-th-boss.png") });
    await page.evaluate(() => { boss = null; enemyPower = 1e7; playerPower = 1; });
    await page.waitForSelector("#gameover-screen:not(.hidden)"); await hide();
    await look("gameover"); await page.screenshot({ path: path.join(scratch, "shot7-th-gameover.png") });
    assert.deepEqual(seen, {});
  });
  await check("canvas text is translated, and game logic isn't affected", async () => {
    const r = await page.evaluate(() => { const c = document.createElement("canvas").getContext("2d"); const seen = []; const orig = c.fillText; return { boss: t("FINAL BOSS: GOBLIN WARLORD 3379"), rally: t("RALLY 12"), pct: t("25%"), name: REWARDS[0].name }; });
    assert.equal(r.boss, "บอสสุดท้าย: จอมทัพก็อบลิน 3379"); assert.equal(r.rally, "รวมพล 12"); assert.equal(r.pct, "25%"); assert.equal(r.name, "Big gear");
  });
  await check("Thai fits at small sizes, and labels aren't rewritten every frame", async () => {
    await page.evaluate(() => { restoringBackup = false; });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.click("#retry-btn").catch(() => {});
    await page.evaluate(() => { gameState = "playing"; document.getElementById("gameover-screen").classList.add("hidden"); playerPower = 1000; enemyPower = 1000; });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(scratch, "shot7-th-small.png") });
    const bad = await page.evaluate(() => ["buy-gear-btn", "train-btn", "strike-btn", "overdrive-btn", "rally-btn"].filter((id) => { const el = document.getElementById(id); return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1; }));
    assert.deepEqual(bad, []);
    const changes = await page.evaluate(() => new Promise((done) => {
      let n = 0; const o = new MutationObserver((r) => { n += r.length; });
      o.observe(document.getElementById("main-actions"), { subtree: true, childList: true, characterData: true });
      playerPower = 1000; enemyPower = 1000;
      setTimeout(() => { o.disconnect(); done(n); }, 500);
    }));
    assert.ok(changes <= 4, `${changes} changes in half a second`);
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
