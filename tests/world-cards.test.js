// The world cards tease what's ahead, and reveal it as the player gets there.
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

  const open = (setup) => page.evaluate((code) => {
    save.worldsCleared = {}; save.worldBest = {}; save.worldStars = {}; save.worldLevels = {};
    new Function(code)();
    document.getElementById("worlds-screen").classList.add("hidden");
    openWorlds();
  }, setup);
  const cards = () => page.evaluate(() => [...document.querySelectorAll("#worlds-list .world-card:not(.weekly)")].map((c) => ({
    name: c.querySelector("b").textContent,
    number: c.querySelector(".world-number").textContent,
    teaser: c.querySelector(".world-teaser").textContent,
    detail: c.querySelector(".world-detail").textContent,
    locked: c.disabled,
    next: c.classList.contains("next"),
    mark: c.querySelector("em").textContent,
    bossName: c.querySelector(".world-boss small").textContent,
    bossHidden: c.querySelector(".world-boss .world-art").classList.contains("unknown"),
    foes: [...c.querySelectorAll(".world-foes .world-art")].map((f) => !f.classList.contains("unknown")),
    prize: c.querySelector(".world-prize").textContent,
    painted: (() => { const x = c.querySelector(".world-scene"); const d = x.getContext("2d").getImageData(x.width / 2, x.height / 2, 1, 1).data; return d[3] > 0; })(),
  })));

  console.log("\nA new player");
  await check("the first world is open and calling, the rest are mysteries", async () => {
    await open("");
    const c = await cards();
    assert.equal(c.length, 4);
    assert.deepEqual(c.map((x) => x.name), ["Green Forest", "???", "???", "???"]);
    assert.deepEqual(c.map((x) => x.locked), [false, true, true, true]);
    assert.deepEqual(c.map((x) => x.next), [true, false, false, false]);
    assert.equal(c[0].mark, "New!");
    assert.equal(c[1].mark, "\u{1F512}");
    assert.equal(c[1].detail, "Locked: clear Green Forest");
    assert.equal(c[2].detail, "Locked: clear World 2");
    assert.ok(c.every((x) => x.painted), "every card has its scene");
    assert.ok(c.every((x) => x.teaser.length > 10), "every card has a teaser");
    assert.ok(c.every((x) => x.bossHidden && x.bossName === "???"), "no boss is shown yet");
    assert.ok(c.every((x) => /Prize: \d+ coins/.test(x.prize)));
    await page.screenshot({ path: path.join(scratch, "world-cards-new.png") });
  });
  await check("a locked world's secrets aren't in the card", async () => {
    await open("");
    const text = await page.evaluate(() => [...document.querySelectorAll(".world-card.locked")].map((c) => c.textContent).join(" "));
    for (const secret of ["Sun Desert", "Frozen Peaks", "Lava Core", "Sand Wyrm", "Frost Queen", "Magma King"]) {
      assert.ok(!text.includes(secret), secret);
    }
  });

  console.log("\nGetting further");
  await check("enemies are revealed by reaching the wave they join", async () => {
    await open("save.worldBest = { forest: 5 };");
    let c = await cards();
    assert.deepEqual(c[0].foes, [true, false], "wave 5: goblins yes, runners from wave 6 no");
    assert.equal(c[0].mark, "");
    await open("save.worldBest = { forest: 6 };");
    c = await cards();
    assert.deepEqual(c[0].foes, [true, true]);
    assert.equal(c[0].detail, "Final boss on wave 15, best wave 6");
  });
  await check("beating a world reveals its boss, opens the next, and moves the spotlight", async () => {
    await open("save.worldsCleared = { forest: true }; save.worldBest = { forest: 15 }; save.worldStars = { forest: [true, false, false] };");
    const c = await cards();
    assert.equal(c[0].bossName, "Goblin Warlord");
    assert.equal(c[0].bossHidden, false);
    assert.equal(c[0].mark, "\u2713");
    assert.ok(!c[0].prize.includes("Prize"), "no prize left to win");
    assert.ok(c[0].prize.includes("\u2605\u2606\u2606"));
    assert.deepEqual(c.map((x) => x.next), [false, true, false, false]);
    assert.equal(c[1].name, "Sun Desert");
    assert.equal(c[1].mark, "New!");
    assert.equal(c[1].bossHidden, true);
    assert.equal(await page.locator("#worlds-progress").textContent(), "Worlds cleared: 1/4, stars: 1/12");
    assert.equal(await page.locator(".world-card:not(.weekly) .world-goal").first().textContent(), "Next star: No Overdrive");
    assert.equal(await page.locator(".world-card.locked .world-goal").count(), 0, "a locked world names no goal");
    await page.screenshot({ path: path.join(scratch, "world-cards-mid.png") });
  });
  await check("with everything beaten nothing is calling or hidden", async () => {
    await open("for (const w of WORLDS) { save.worldsCleared[w.id] = true; save.worldBest[w.id] = w.finalWave; }");
    const c = await cards();
    assert.ok(c.every((x) => !x.next && !x.locked && !x.bossHidden && x.foes.every(Boolean)));
    await open("for (const w of WORLDS) { save.worldsCleared[w.id] = true; save.worldStars[w.id] = [true, true, true]; }");
    assert.equal(await page.locator(".world-card:not(.weekly) .world-goal").count(), 0, "nothing left to earn");
  });

  console.log("\nUsing it");
  await check("tapping an open world starts it, a locked one does nothing", async () => {
    await open("save.worldsCleared = { forest: true };");
    assert.equal(await page.locator(".world-card.locked").first().isDisabled(), true);
    await page.locator(".world-card.next").click();
    assert.equal(await page.evaluate(() => WORLDS[currentWorld].id), "desert");
    await page.evaluate(() => { gameState = "title"; document.getElementById("game-screen").classList.add("hidden"); });
  });
  await check("each world's art comes from its own theme, drawn only once", async () => {
    await open("");
    const r = await page.evaluate(() => {
      const pixel = (i) => { const x = document.querySelectorAll("#worlds-list .world-scene")[i]; const d = x.getContext("2d").getImageData(2, 2, 1, 1).data; return [d[0], d[1], d[2]].join(); };
      return [0, 1, 2, 3].map(pixel);
    });
    assert.equal(new Set(r).size, 4, r.join(" | "));
  });
  for (const [w, h] of [[320, 568], [360, 640], [390, 844]]) {
    await check(`cards stay readable at ${w}x${h}: no clipped words, and the boss clears them`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await open("save.worldsCleared = { forest: true, desert: true }; save.worldBest = { forest: 15, desert: 20 };");
      await page.waitForTimeout(100);
      const r = await page.evaluate(() => [...document.querySelectorAll("#worlds-list .world-card:not(.weekly)")].map((c) => {
        const card = c.getBoundingClientRect();
        const boss = c.querySelector(".world-boss").getBoundingClientRect();
        const clipped = [...c.querySelectorAll(".world-words > *")].filter((x) => { const q = x.getBoundingClientRect(); return q.right > card.right + 1 || q.bottom > card.bottom + 1; }).length;
        const overlap = [...c.querySelectorAll(".world-teaser, .world-detail, .world-prize, .world-foes, .world-goal")].filter((x) => {
          const range = document.createRange(); range.selectNodeContents(x);
          const q = range.getBoundingClientRect();
          return q.width > 0 && q.right > boss.left + 1 && q.bottom > boss.top + 1 && q.top < boss.bottom - 1;
        }).length;
        return { clipped, overlap, height: Math.round(card.height), inside: boss.bottom <= card.bottom + 1 };
      }));
      assert.deepEqual(r.filter((x) => x.clipped || x.overlap || !x.inside), [], JSON.stringify(r));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(scratch, `world-cards-${w}.png`) });
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });

  console.log("\nThai");
  await check("everything on the cards has Thai", async () => {
    await page.evaluate(() => { save.lang = "th"; writeSave(); });
    await page.goto(url);
    const left = await page.evaluate(() => {
      const texts = ["New!", "World 2", "Prize: 100 coins", "Worlds cleared: 1/4, stars: 3/12", "Final boss on wave 15", "Final boss on wave 15, best wave 6", "Locked: clear World 2", "Locked: clear Green Forest", "Next star: No Overdrive", "Next star: Clear the world", "Next star: 8 gears or fewer", ...Object.values(WORLD_STORIES).map((w) => w.teaser), ...Object.values(FINAL_BOSSES).map((b) => b.name)];
      return texts.filter((x) => /[A-Za-z]/.test(t(x)));
    });
    assert.deepEqual(left, []);
    await page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); save.worldsCleared.forest = true; openWorlds(); });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(scratch, "world-cards-th.png") });
    const shown = await page.evaluate(() => [...document.querySelectorAll(".world-number, .world-teaser, .world-detail, .world-prize span, #worlds-progress")].map((x) => x.textContent).filter((x) => /[A-Za-z]{3}/.test(x)));
    assert.deepEqual(shown, []);
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
