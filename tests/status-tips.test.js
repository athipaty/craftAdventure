// Every status icon on show, and what each one means on hover or a tap.
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
  const errors = [];

  async function open(options, setup = () => {}) {
    const page = await (await browser.newContext(options)).newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.evaluate(() => { restoringBackup = true; localStorage.clear(); });
    await page.goto(url);
    await page.evaluate(setup);
    await page.evaluate(() => { save.stats.waves = 100; for (const t of TIPS) save.tips[t.id] = true; writeSave(); });
    await page.goto(url);
    await page.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); startChosenRun({ world: 0 }); });
    await page.evaluate(() => { waveTime = 0; playerPower = 1000; enemyPower = 1000; });
    return page;
  }
  const refresh = (page, parts, more = () => {}) => page.evaluate(([p, m]) => {
    runParts = p; playerPower = 1000; enemyPower = 1000; hitStop = 0;
    new Function(m)();
    lastStatusKey = ""; updateStatusRow();
  }, [parts, `(${more})()`]);
  const everyPart = () => Object.fromEntries(REWARDS.filter((r) => !r.oneOff).map((r) => [r.id, r.max > 1 ? 2 : 1]));
  const everyEffect = () => { frozenFor = 99; activeDeal = WAVE_DEALS.army; wavePace = WAVE_PACES.siege; overdriveLeft = 99; rallying = true; waveEvent = WAVE_EVENTS.find((e) => e.id === "double"); save.hero = "guardian"; rustBlocked = false; };
  const hoverChip = async (page, index) => {
    const box = await page.locator(".status-chip").nth(index).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    return page.locator("#status-tip");
  };

  console.log("\nEvery icon on show");
  const page = await open({ viewport: { width: 390, height: 844 } });
  await check("a ×2 badge doesn't push the other icons out", async () => {
    await refresh(page, { staticCharge: 2, warChest: 1, cooling: 1 });
    assert.equal(await page.locator(".status-chip").count(), 3);
    assert.equal(await page.getByText(/^\+\d+$/).count(), 0);
  });
  const parts = await page.evaluate(everyPart);
  for (const [name, w, h] of [["phone", 390, 844], ["small", 320, 568], ["landscape", 844, 390]]) {
    await check(`every effect and reward at once all fit: ${name}`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      await refresh(page, parts, everyEffect);
      const r = await page.evaluate(() => {
        const box = document.getElementById("status-row");
        const lane = document.getElementById("battle-lane").getBoundingClientRect();
        const row = box.getBoundingClientRect();
        const chips = [...document.querySelectorAll(".status-chip")];
        const size = chips[0].getBoundingClientRect().width;
        const lastBottom = Math.max(...chips.map((c) => c.getBoundingClientRect().bottom));
        return { fits: box.scrollHeight <= box.clientHeight, shown: chips.length, total: statusChips().length, counted: chips.filter((c) => /^\+/.test(c.textContent)).length, clearOfLane: row.bottom <= lane.top + 1 || row.top >= lane.bottom - 1 || row.right <= lane.left + 1 || row.left >= lane.right - 1, inside: lastBottom <= row.bottom + 1, right: chips.every((c) => c.getBoundingClientRect().right <= row.right + 1), size };
      });
      console.log("       ", name, r.shown, "chips at", r.size, "px");
      assert.equal(r.fits, true, "fits"); assert.equal(r.inside, true, "inside"); assert.equal(r.right, true, "right"); assert.equal(r.clearOfLane, true, "clear of the battle");
      assert.equal(r.shown, r.total); assert.equal(r.counted, 0);
      await page.screenshot({ path: path.join(scratch, `status-all-${name}.png`) });
    });
  }
  await check("turning the phone sizes the chips again", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => { const b = document.getElementById("status-row"); return b.scrollHeight <= b.clientHeight; }), true);
  });

  console.log("\nTooltips");
  await check("every icon explains itself", async () => {
    const r = await page.evaluate(() => statusChips().filter((c) => !c.name || !c.text || c.name === c.text).map((c) => c.icon));
    assert.deepEqual(r, []);
    assert.equal(await page.locator(".status-chip").count() > 30, true);
    assert.deepEqual(await page.evaluate(() => REWARDS.filter((r) => !r.oneOff && !(r.id in REWARD_ICONS) && !r.gear).map((r) => r.id)), []);
  });
  await check("hovering shows what the icon means, and leaving hides it", async () => {
    await refresh(page, { staticCharge: 2, warChest: 1 }, () => { frozenFor = 0; activeDeal = null; wavePace = null; overdriveLeft = 0; rallying = false; waveEvent = null; save.hero = "knight"; });
    const tip = await hoverChip(page, 0);
    await tip.waitFor({ state: "visible", timeout: 1000 });
    assert.equal(await page.locator("#status-tip-name").textContent(), "War chest");
    assert.equal(await page.locator("#status-tip-text").textContent(), "Earn 25% more coins from this run");
    await hoverChip(page, 1);
    assert.equal(await page.locator("#status-tip-name").textContent(), "Static charge x2");
    await page.screenshot({ path: path.join(scratch, "status-tip-hover.png") });
    await page.mouse.move(195, 500);
    assert.equal(await tip.isVisible(), false);
  });
  await check("the tooltip stays on screen, even for the last icon", async () => {
    await refresh(page, parts);
    for (const index of [0, await page.locator(".status-chip").count() - 1]) {
      const tip = await hoverChip(page, index);
      await tip.waitFor({ state: "visible", timeout: 1000 });
      const box = await tip.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844, JSON.stringify(box));
      await page.mouse.move(195, 500);
    }
  });
  await check("the tooltip closes when its icon goes away", async () => {
    await refresh(page, { warChest: 1 });
    const tip = await hoverChip(page, 0);
    await tip.waitFor({ state: "visible", timeout: 1000 });
    await refresh(page, {});
    assert.equal(await tip.isVisible(), false);
    await page.mouse.move(195, 500);
  });
  await check("the row still lets a gear underneath be dragged", async () => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(150);
    await refresh(page, parts);
    const r = await page.evaluate(() => {
      const chip = document.querySelector(".status-chip").getBoundingClientRect();
      const under = document.elementFromPoint(chip.left + 4, chip.top + 4);
      return { id: under?.id, ptr: getComputedStyle(document.getElementById("status-row")).pointerEvents };
    });
    assert.equal(r.ptr, "none");
    assert.notEqual(r.id, "status-row");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
  });
  await check("no tooltip pops up while dragging a gear", async () => {
    await refresh(page, { warChest: 1 });
    const start = await page.evaluate(() => {
      const rect = boardCanvas.getBoundingClientRect();
      for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
        const c = grid[row][col];
        if (c && !c.driver) return { x: rect.left + (col + 0.5) * cellSize, y: rect.top + (row + 0.5) * cellSize };
      }
      return null;
    });
    assert.ok(start, "there's a gear to drag");
    const chip = await page.locator(".status-chip").first().boundingBox();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => Boolean(drag)), true, "the drag started");
    await page.mouse.move(chip.x + 5, chip.y + 5, { steps: 4 });
    assert.equal(await page.locator("#status-tip").isVisible(), false);
    await page.mouse.up();
  });

  console.log("\nOn a phone");
  const phone = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await check("a tap shows the meaning, then it goes away", async () => {
    await refresh(phone, { warChest: 1 });
    const box = await phone.locator(".status-chip").first().boundingBox();
    await phone.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await phone.locator("#status-tip").waitFor({ state: "visible", timeout: 1000 });
    assert.equal(await phone.locator("#status-tip-name").textContent(), "War chest");
    await phone.waitForTimeout(3200);
    assert.equal(await phone.locator("#status-tip").isVisible(), false);
  });

  console.log("\nIn Thai");
  const thai = await open({ viewport: { width: 390, height: 844 } }, () => { save.lang = "th"; writeSave(); });
  await check("tooltips are translated, and nothing is left in English", async () => {
    await refresh(thai, await thai.evaluate(everyPart), everyEffect);
    const left = await thai.evaluate(() => statusChips().flatMap((c) => [c.name, c.text]).filter((text) => /[A-Za-z]{3}/.test(t(text))));
    assert.deepEqual(left, []);
    const tip = await hoverChip(thai, 0);
    await tip.waitFor({ state: "visible", timeout: 1000 });
    assert.equal(/[A-Za-z]{3}/.test(await tip.textContent()), false);
    await thai.screenshot({ path: path.join(scratch, "status-tip-thai.png") });
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
