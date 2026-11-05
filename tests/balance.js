// Two bots: "simple" collects drops and strikes. "smart" also merges and holds lightning to counter.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((q, s) => { const n = q.url.split("?")[0].replace(/^\/$/, "/index.html"); if (n === "/sw.js") { s.writeHead(404); s.end(); return; } fs.readFile(path.join(root, n), (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { "Content-Type": types[path.extname(n)] || "text/plain" }); s.end(d); }); });
const bot = ({ world, level, runs, upgrades, easy, smart }) => {
  requestAnimationFrame = () => 0;
  save.muted = true; save.stats.waves = 100; save.easy = Boolean(easy);
  for (const t of TIPS) save.tips[t.id] = true;
  for (const u of UPGRADES) save.upgrades[u.id] = Math.round(u.costs.length * (upgrades || 0));
  writeSave = () => {}; showToast = () => {}; spawnParticle = () => {}; spawnFaller = () => {}; spawnConfetti = () => {}; saveRun = () => {}; announce = () => {};
  const steps = (r, c) => Math.abs(r - DRIVER_ROW) + Math.abs(c - DRIVER_COL);
  const merge = () => {
    const gears = [];
    grid.forEach((row, r) => row.forEach((cell, c) => { if (cell && !cell.driver && cell.level < MAX_GEAR_LEVEL) gears.push({ r, c, cell }); }));
    gears.sort((a, b) => a.cell.level - b.cell.level || steps(b.r, b.c) - steps(a.r, a.c));
    for (const from of gears) for (const to of gears) {
      if (from !== to && canMerge(from.cell, to.cell) && steps(to.r, to.c) < steps(from.r, from.c)) { mergeGears(from.r, from.c, to.r, to.c); return true; }
    }
    return false;
  };
  const out = { waves: [], clears: 0, mins: [], waveSecs: [], peak: [], levels: [] };
  for (let i = 0; i < runs; i++) {
    gameState = "title"; startChosenRun({ world, level: level || 0 });
    let ticks = 0, last = wave, lastT = 0; const dt = 0.05, limit = 25 * 60 / dt;
    while (ticks++ < limit) {
      if (gameState === "choosing") { const o = offeredRewards.ids.map((id) => REWARDS.find((r) => r.id === id)); clearTimeout(rewardTimer); document.getElementById("reward-screen").classList.add("hidden"); chooseReward(o[Math.floor(Math.random() * o.length)]); continue; }
      if (gameState === "building") { beginWave(); continue; }
      if (gameState !== "playing") break;
      if (canTrain() && Math.random() < 0.02) trainArmy();
      while (gearTray.length && bestEmptyCell()) { const spot = bestEmptyCell(); placeTrayGear(0, spot.row, spot.col); }
      if (overdriveReady()) activateOverdrive();
      if (smart) {
        if (ticks % 10 === 0) merge();
        // Holds lightning for a boss's glow, otherwise uses it when ready.
        const glow = boss && boss.attackIn < BOSS_WARNING_SECONDS;
        const soon = boss && boss.attackIn < BOSS_WARNING_SECONDS + COUNTER_HOLD_SECONDS + 0.3;
        if (glow || !soon) strikeEnemy();
      } else strikeEnemy();
      if (ticks % 30 === 0) for (const c of grid.flat()) if (c?.rusted) c.rusted = false;
      if (boss?.shield > 0) boss.shield = 0;
      hitStop = 0;
      update(dt);
      if (wave !== last) { out.waveSecs.push(runTime - lastT); lastT = runTime; last = wave; }
    }
    out.waves.push(wave); out.mins.push(runTime / 60); out.peak.push(peakRate);
    out.levels.push(Math.max(...grid.flat().filter((c) => c && !c.driver).map((c) => c.level), 0));
    if (gameState === "worldclear") out.clears++;
    runBanked = true;
  }
  return out;
};
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
(async () => {
  await new Promise((r) => server.listen(0, r));
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.goto(`http://localhost:${server.address().port}/`);
  await p.evaluate(() => { for (const id of ["daily-screen", "away-screen"]) document.getElementById(id).classList.add("hidden"); });
  const names = ["Forest", "Desert", "Peaks", "Lava"], lv = ["Normal", "Hard", "Expert"];
  for (const cfg of JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, "balance-plan.json"), "utf8"))) {
    const r = await p.evaluate(bot, { runs: 6, ...cfg });
    console.log(`${cfg.smart ? "smart " : "simple"} ${names[cfg.world].padEnd(6)} ${cfg.easy ? "Easy  " : lv[cfg.level || 0].padEnd(6)} upgrades ${String(Math.round((cfg.upgrades || 0) * 100)).padStart(3)}%: cleared ${r.clears}/6, median wave ${med(r.waves)}, ${med(r.mins).toFixed(1)} min, wave ${med(r.waveSecs).toFixed(0)}s, top gear L${med(r.levels)}`);
  }
  await b.close(); server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
