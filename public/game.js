"use strict";

// =====================================================================
// Gear Fight! — tap a gear to tick it forward one tooth; any same-number
// gear it touches meshes with it and ticks too (alternating spin
// direction with each hop through the connected cluster, like a real
// gear train), so one tap can chain-react through a whole cluster at
// once. A gear fires once it's been ticked enough times, paying out
// into a tug-of-war army battle against a steadily-growing enemy.
// Two independent systems tied together by one number:
//   - the board (grid[][]) is the gear-mesh puzzle
//   - the battle (playerPower/enemyPower) is a simple push-the-line meter
// Everything here is client-only — no backend, no login. Progress within
// a run isn't persisted (a run is a few minutes), only the best wave
// reached, via localStorage.
// =====================================================================

const COLS = 6;
const ROWS = 7;
const BASE_POWER = 6;
const WIN_RATIO = 0.82; // playerPower share of the total needed to take the wave
const LOSE_RATIO = 0.12; // playerPower share at/below which the enemy overruns you
const POP_DURATION = 0.22; // seconds a firing gear takes to shrink away before respawning
const JACKPOT_CHANCE = 0.025; // odds a freshly spawned gear is a star "jackpot" tile
const MULT_CHANCE = 0.06; // odds a freshly spawned (non-jackpot) gear also carries a multiplier
const JACKPOT_TICKS = 6; // ticks a jackpot gear needs to fire
const TOOTH_COUNT = 10; // teeth drawn per gear — also one tick's worth of visual spin
const TICK_ANGLE = (Math.PI * 2) / TOOTH_COUNT;

const VALUE_PALETTE = {
  1: { fill: "#5fb3e0", stroke: "#2f6f94", hub: "#89cdf0" },
  2: { fill: "#6fcf6f", stroke: "#357a35", hub: "#9fe39f" },
  3: { fill: "#e0c355", stroke: "#8a6a1c", hub: "#f0dd8a" },
  4: { fill: "#e08a4b", stroke: "#8a4f1c", hub: "#f0ae7c" },
  5: { fill: "#c15fd0", stroke: "#6e2f78", hub: "#dd94e8" },
  6: { fill: "#e0586f", stroke: "#8a2436", hub: "#f08b9c" },
};
const JACKPOT_PALETTE = { fill: "#ffd24d", stroke: "#a66a00", hub: "#fff0b0" };

function cellColor(cell) {
  return cell.value === "J" ? JACKPOT_PALETTE : VALUE_PALETTE[cell.value] || VALUE_PALETTE[1];
}

// How many ticks a gear needs to fire. Jackpots use a fixed count since
// their "value" field is the non-numeric mesh key "J", not a tick count.
function ticksRequired(cell) {
  return cell.value === "J" ? JACKPOT_TICKS : cell.value;
}

// How many distinct gear values are in play — starts easy (lots of
// mesh clusters) and widens as the wave climbs (smaller clusters, but
// each gear takes more ticks to fire so it's worth more), capped at the
// size of VALUE_PALETTE.
function valuePoolSize(wave) {
  return Math.min(6, 3 + Math.floor((wave - 1) / 2));
}

// The enemy's own army grows on its own the whole time you're playing —
// this is the "clock" that makes a wave eventually come to a head one
// way or the other even if you stall. Scales up per wave so later waves
// genuinely demand faster/bigger chain reactions, not just more taps.
function enemyGrowthPerSec(wave) {
  return 0.45 * Math.pow(1.13, wave - 1);
}

function randomCellValue(wave) {
  if (Math.random() < JACKPOT_CHANCE) return { value: "J", mult: null };
  const pool = valuePoolSize(wave);
  const value = 1 + Math.floor(Math.random() * pool);
  let mult = null;
  if (Math.random() < MULT_CHANCE) {
    const r = Math.random();
    mult = r < 0.6 ? 1.5 : r < 0.9 ? 2 : 3;
  }
  return { value, mult };
}

// Reward for one gear firing. Jackpots pay a flat multiple on top since
// they're rare and slower to spin up; any multiplier badge stacks.
function singleReward(cell) {
  const req = ticksRequired(cell);
  let base = Math.round(req * 1.3);
  if (cell.value === "J") base *= 3;
  return Math.max(1, Math.round(base * (cell.mult || 1)));
}

// =====================================================================
// State
// =====================================================================

let boardCanvas, boardCtx, battleCanvas, battleCtx;
let abilityKnightBtn, abilityGearBtn, abilityLightningBtn;
let abilityKnightCost, abilityGearCost, abilityLightningCost;
let boardCssW = 0, boardCssH = 0, cellSize = 0;
let battleCssW = 0, battleCssH = 0;

// grid[row][col] = { value, mult, ticks, ticksAnim, spinTarget, spinAnim,
//                     flash, popping, popT } | null
let grid = [];
let boardBusy = false; // true while a fire/respawn animation is resolving — input ignored
let pendingFireResolve = null; // [{row,col}, ...] cells popping after the current tap's cluster fired

let gameState = "title"; // "title" | "playing" | "gameover"
let wave = 1;
let playerPower = BASE_POWER;
let enemyPower = BASE_POWER;
let totalArmyScore = 0;
let bestWave = Number(localStorage.getItem("gearfight_best_wave") || 1);

function freshCell(wave) {
  const cell = randomCellValue(wave);
  cell.ticks = 0;
  cell.ticksAnim = 0;
  cell.spinTarget = 0;
  cell.spinAnim = 0;
  cell.flash = 0;
  cell.popping = false;
  cell.popT = 0;
  return cell;
}

// =====================================================================
// Board logic
// =====================================================================

function createBoard() {
  grid = [];
  for (let row = 0; row < ROWS; row++) {
    const r = [];
    for (let col = 0; col < COLS; col++) r.push(freshCell(wave));
    grid.push(r);
  }
}

// Tapping (row, col) ticks it, and that tick meshes through every
// orthogonally-connected gear sharing the same value — the whole
// cluster moves together, alternating spin direction with each hop
// away from the tapped gear, same as a real gear train.
function tickCluster(row, col) {
  const origin = grid[row][col];
  if (!origin) return;
  const key = origin.value;
  const visited = new Map();
  const queue = [{ row, col, depth: 0 }];
  visited.set(`${row},${col}`, 0);
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cell = grid[cur.row][cur.col];
    const sign = cur.depth % 2 === 0 ? 1 : -1;
    cell.ticks += 1;
    cell.spinTarget += sign;
    cell.flash = 1;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dr, dc] of dirs) {
      const nr = cur.row + dr;
      const nc = cur.col + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const k = `${nr},${nc}`;
      if (visited.has(k)) continue;
      const neighbor = grid[nr][nc];
      if (!neighbor || neighbor.value !== key) continue;
      visited.set(k, cur.depth + 1);
      queue.push({ row: nr, col: nc, depth: cur.depth + 1 });
    }
  }
  playTickSound(queue.length);
  resolveFires(queue);
}

// Pays out and starts the pop/respawn animation for a list of gears that
// have already reached their threshold — shared by the normal tap path
// (resolveFires below) and the ability buttons, which force a gear (or
// the whole board) to completion directly rather than via ticking.
function fireCells(firing) {
  if (firing.length === 0) return;

  let total = 0;
  for (const f of firing) total += singleReward(f.cell);
  if (firing.length >= 2) total = Math.round(total * (1 + 0.2 * (firing.length - 1)));

  playerPower += total;
  totalArmyScore += total;
  showToast(`+${total}${firing.length >= 2 ? ` COMBO x${firing.length}!` : ""}`);
  playMatchSound(firing.length);

  for (const f of firing) {
    f.cell.popping = true;
    f.cell.popT = 0;
  }
  boardBusy = true;
  pendingFireResolve = firing.map((f) => ({ row: f.row, col: f.col }));
}

// Only cells actually ticked this tap could have just reached their
// threshold, so we only need to check those rather than the whole board.
function resolveFires(tickedCells) {
  const firing = [];
  for (const p of tickedCells) {
    const cell = grid[p.row][p.col];
    if (cell.ticks >= ticksRequired(cell)) firing.push({ row: p.row, col: p.col, cell });
  }
  fireCells(firing);
}

// =====================================================================
// Abilities — spend banked Army score (totalArmyScore) for an instant
// effect. Costs scale with wave so they stay a situational boost rather
// than a way to trivialize later waves. Each pays for itself only
// partially on average (see singleReward), so there's no infinite loop
// to be had — spending is a deliberate trade, not free value.
// =====================================================================

function knightCost() {
  return Math.round(10 + wave * 4);
}
function gearCost() {
  return Math.round(12 + wave * 4);
}
function lightningCost() {
  return Math.round(22 + wave * 7);
}

function canAfford(cost) {
  return !boardBusy && gameState === "playing" && totalArmyScore >= cost;
}

// Converts banked score directly into battle power — the "cash in points
// for a push" option, for when the board isn't giving you a good match
// but the tug-of-war needs it right now.
function useTrainKnight() {
  const cost = knightCost();
  if (!canAfford(cost)) return;
  totalArmyScore -= cost;
  const bonus = Math.round(cost * 0.8);
  playerPower += bonus;
  showToast(`+${bonus} Knight!`);
  playMatchSound(2);
}

// Instantly completes whichever gear on the board is closest to firing —
// skips the wait on a cluster that's already most of the way there,
// paying out its normal reward (including any multiplier/jackpot bonus).
function useBuyGear() {
  const cost = gearCost();
  if (!canAfford(cost)) return;
  let best = null;
  let bestRatio = -1;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell || cell.popping) continue;
      const ratio = cell.ticks / ticksRequired(cell);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = { row, col, cell };
      }
    }
  }
  if (!best) return;
  totalArmyScore -= cost;
  best.cell.ticks = ticksRequired(best.cell);
  fireCells([best]);
}

// Strikes every gear on the board for one tick at once — the "ultimate":
// expensive, but on a board with several clusters already primed it can
// set off a huge simultaneous combo.
function useLightning() {
  const cost = lightningCost();
  if (!canAfford(cost)) return;
  totalArmyScore -= cost;
  const firing = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell) continue;
      cell.ticks += 1;
      cell.spinTarget += 1;
      cell.flash = 1;
      if (cell.ticks >= ticksRequired(cell)) firing.push({ row, col, cell });
    }
  }
  playTickSound(ROWS * COLS);
  fireCells(firing);
}

// Keeps each ability button's cost label and enabled state current —
// cheap enough (3 buttons) to just do every frame alongside the HUD text.
function updateAbilityButtons() {
  const specs = [
    [abilityKnightBtn, abilityKnightCost, knightCost],
    [abilityGearBtn, abilityGearCost, gearCost],
    [abilityLightningBtn, abilityLightningCost, lightningCost],
  ];
  for (const [btn, costEl, costFn] of specs) {
    if (!btn) continue;
    const cost = costFn();
    costEl.textContent = `\u{1FA99} ${cost}`;
    btn.disabled = !canAfford(cost);
  }
}

// =====================================================================
// Input — tap a gear to tick its mesh cluster
// =====================================================================

function cellAt(clientX, clientY) {
  const rect = boardCanvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const col = Math.floor(x / cellSize);
  const row = Math.floor(y / cellSize);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  return { row, col };
}

function onPointerDown(e) {
  ensureAudio();
  if (boardBusy || gameState !== "playing") return;
  const pos = cellAt(e.clientX, e.clientY);
  if (!pos || !grid[pos.row][pos.col]) return;
  e.preventDefault();
  tickCluster(pos.row, pos.col);
}

function wireBoardInput() {
  boardCanvas.addEventListener("pointerdown", onPointerDown);
  boardCanvas.addEventListener("contextmenu", (e) => e.preventDefault());
}

// =====================================================================
// Update loop
// =====================================================================

function updatePops(dt) {
  if (!pendingFireResolve) return;
  let stillPopping = false;
  for (const p of pendingFireResolve) {
    const cell = grid[p.row][p.col];
    if (!cell || !cell.popping) continue;
    cell.popT += dt / POP_DURATION;
    if (cell.popT >= 1) {
      grid[p.row][p.col] = freshCell(wave);
    } else {
      stillPopping = true;
    }
  }
  if (!stillPopping) {
    pendingFireResolve = null;
    boardBusy = false;
  }
}

// Eases each gear's progress ring and decorative spin toward their
// targets — frame-rate independent so the motion doesn't track
// framerate (the whole reason the enemy in the old game sped up on a
// stall was a per-frame-not-per-time increment; not repeating that here).
function updateGearAnim(dt) {
  const k = Math.min(1, 1 - Math.pow(0.00003, dt));
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell) continue;
      cell.ticksAnim += (cell.ticks - cell.ticksAnim) * k;
      cell.spinAnim += (cell.spinTarget - cell.spinAnim) * k;
      if (cell.flash > 0) cell.flash = Math.max(0, cell.flash - dt / 0.4);
    }
  }
}

function winWave() {
  wave += 1;
  if (wave > bestWave) {
    bestWave = wave;
    localStorage.setItem("gearfight_best_wave", String(bestWave));
  }
  showWaveBanner(`Wave ${wave}!`);
  playWinSound();
  // Keep some momentum into the next wave, but reset the balance of
  // power so the new wave actually starts contested instead of already won.
  playerPower = Math.max(BASE_POWER, playerPower * 0.45);
  enemyPower = BASE_POWER * Math.pow(1.07, wave - 1);
}

function gameOver() {
  gameState = "gameover";
  document.getElementById("final-wave").textContent = wave;
  document.getElementById("gameover-screen").classList.remove("hidden");
  playLoseSound();
}

function update(dt) {
  if (gameState !== "playing") return;
  updatePops(dt);
  updateGearAnim(dt);

  enemyPower += enemyGrowthPerSec(wave) * dt;
  const total = playerPower + enemyPower;
  const ratio = total > 0 ? playerPower / total : 0.5;
  if (ratio >= WIN_RATIO) winWave();
  else if (ratio <= LOSE_RATIO) gameOver();

  document.getElementById("wave-num").textContent = wave;
  document.getElementById("army-score").textContent = Math.round(totalArmyScore);
  updateAbilityButtons();
}

// =====================================================================
// Rendering
// =====================================================================

function roundRectFill(ctx, x, y, w, h, r, fill) {
  if (w <= 0 || h <= 0) return;
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawGearShape(ctx, cx, cy, rOuter, rInner, teeth, fill, stroke) {
  ctx.beginPath();
  const step = (Math.PI * 2) / (teeth * 2);
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = i * step;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function drawGearCell(ctx, cx, cy, size, cell) {
  const req = ticksRequired(cell);
  const popScale = cell.popping ? Math.max(0, 1 - cell.popT) : 1;
  const flashBoost = 1 + cell.flash * 0.12;
  const r = size * 0.42 * popScale * flashBoost;
  if (r <= 0) return;
  const palette = cellColor(cell);

  // The gear body itself visibly spins — alternating direction through a
  // meshed cluster, same as real gear teeth — purely cosmetic; it never
  // resets, so repeated taps keep it turning rather than snapping back.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cell.spinAnim * TICK_ANGLE);
  if (cell.flash > 0) {
    ctx.shadowColor = "#ffcc33";
    ctx.shadowBlur = size * 0.3 * cell.flash;
  }
  drawGearShape(ctx, 0, 0, r, r * 0.8, TOOTH_COUNT, palette.fill, palette.stroke);
  ctx.restore();

  ctx.beginPath();
  ctx.fillStyle = palette.hub;
  ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2);
  ctx.fill();

  // Progress ring — how close this gear is to firing. Decoupled from the
  // decorative spin above so "about to fire" always reads as "ring is
  // nearly full," regardless of which way the gear has been spun.
  const progress = Math.max(0, Math.min(1, cell.ticksAnim / req));
  if (progress > 0) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, size * 0.06);
    ctx.strokeStyle = "#fff6c8";
    ctx.lineCap = "round";
    const start = -Math.PI / 2;
    ctx.arc(cx, cy, r * 0.74, start, start + progress * Math.PI * 2);
    ctx.stroke();
  }

  if (cell.mult) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, size * 0.04);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "#1c130a";
  ctx.font = `800 ${Math.round(r * 0.72)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const remaining = Math.max(0, req - cell.ticks);
  ctx.fillText(cell.value === "J" ? "★" : String(remaining), cx, cy + 1);

  if (cell.mult) {
    ctx.font = `700 ${Math.round(size * 0.15)}px system-ui, sans-serif`;
    ctx.fillStyle = "#3a2414";
    ctx.fillText(`×${cell.mult}`, cx, cy + r + size * 0.14);
  }
}

// Thin connecting rods between adjacent same-value gears — these are
// what's actually meshed, so a tap on any one of them ticks the whole
// connected group. Drawn under the gears, always visible (not just while
// interacting), since this is the core thing the player needs to read.
function drawMeshLines(ctx) {
  ctx.strokeStyle = "rgba(255, 246, 200, 0.22)";
  ctx.lineWidth = Math.max(2, cellSize * 0.07);
  ctx.lineCap = "round";
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell) continue;
      const cx = col * cellSize + cellSize / 2;
      const cy = row * cellSize + cellSize / 2;
      const right = col + 1 < COLS ? grid[row][col + 1] : null;
      if (right && right.value === cell.value) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + cellSize, cy);
        ctx.stroke();
      }
      const down = row + 1 < ROWS ? grid[row + 1][col] : null;
      if (down && down.value === cell.value) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + cellSize);
        ctx.stroke();
      }
    }
  }
}

function drawBoard() {
  // grid isn't populated until startNewRun()/createBoard() runs (on Play).
  // A stray resize event before that — the address bar collapsing, a
  // rotation, anything — can still set up boardCtx/boardCssW via
  // layoutBoardCanvas() while the title screen is still showing, so guard
  // on the grid itself too rather than just the canvas being ready.
  if (!boardCtx || boardCssW <= 0 || grid.length < ROWS) return;
  const ctx = boardCtx;
  ctx.clearRect(0, 0, boardCssW, boardCssH);
  roundRectFill(ctx, 0, 0, boardCssW, boardCssH, 14, "#3a2414");

  drawMeshLines(ctx);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell) continue;
      const cx = col * cellSize + cellSize / 2;
      const cy = row * cellSize + cellSize / 2;
      drawGearCell(ctx, cx, cy, cellSize, cell);
    }
  }
}

function drawArmyIcon(ctx, x, y, color) {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = "#fdf0d8";
  ctx.arc(x, y - 7, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawArmyRow(ctx, xStart, xEnd, y, power, color, dir) {
  const n = Math.min(10, Math.max(1, Math.round(power / 3)));
  const span = Math.abs(xEnd - xStart) * 0.9;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = dir === 1 ? xStart + t * span : xEnd - t * span;
    const bob = Math.sin(performance.now() / 260 + i) * 2;
    drawArmyIcon(ctx, x, y + bob, color);
  }
}

function drawBattle() {
  if (!battleCtx || battleCssW <= 0) return;
  const ctx = battleCtx;
  ctx.clearRect(0, 0, battleCssW, battleCssH);

  const padding = 16;
  const barY = battleCssH * 0.78;
  const barH = 10;
  const x0 = padding;
  const x1 = battleCssW - padding;
  const total = playerPower + enemyPower;
  const ratio = total > 0 ? playerPower / total : 0.5;
  const markerX = x0 + (x1 - x0) * ratio;

  roundRectFill(ctx, x0, barY, x1 - x0, barH, barH / 2, "#1c130a");
  roundRectFill(ctx, x0, barY, markerX - x0, barH, barH / 2, "#3a7ddb");
  roundRectFill(ctx, markerX, barY, x1 - markerX, barH, barH / 2, "#d8432f");

  ctx.beginPath();
  ctx.fillStyle = "#ffcc33";
  ctx.arc(markerX, barY + barH / 2, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#3a2414";
  ctx.stroke();

  drawArmyRow(ctx, x0, markerX, battleCssH * 0.42, playerPower, "#3a7ddb", 1);
  drawArmyRow(ctx, markerX, x1, battleCssH * 0.42, enemyPower, "#d8432f", -1);

  ctx.font = "700 13px system-ui, sans-serif";
  ctx.fillStyle = "#fdf6e8";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(Math.round(playerPower)), x0, 14);
  ctx.textAlign = "right";
  ctx.fillText(String(Math.round(enemyPower)), x1, 14);
}

// =====================================================================
// Sound — tiny WebAudio synth, no assets
// =====================================================================

let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}

function beep(freq, duration, type, gainPeak) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || "sine";
  osc.frequency.value = freq;
  const t0 = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak || 0.22, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(t0 + duration + 0.02);
}

function playTickSound(clusterSize) {
  beep(520 + Math.min(clusterSize, 8) * 30, 0.06, "square", 0.1);
}

function playMatchSound(n) {
  beep(440 + Math.min(n, 8) * 40, 0.18, "triangle", 0.2);
}

function playWinSound() {
  beep(523, 0.12, "square", 0.2);
  setTimeout(() => beep(659, 0.12, "square", 0.2), 110);
  setTimeout(() => beep(784, 0.22, "square", 0.22), 220);
}

function playLoseSound() {
  beep(220, 0.3, "sawtooth", 0.2);
  setTimeout(() => beep(160, 0.4, "sawtooth", 0.2), 150);
}

// =====================================================================
// UI helpers
// =====================================================================

function showToast(text) {
  const el = document.getElementById("combo-toast");
  el.textContent = text;
  el.classList.remove("hidden");
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), 650);
}

function showWaveBanner(text) {
  const el = document.getElementById("wave-banner");
  const txt = document.getElementById("wave-banner-text");
  txt.textContent = text;
  el.classList.remove("hidden");
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  clearTimeout(showWaveBanner._t);
  showWaveBanner._t = setTimeout(() => el.classList.add("hidden"), 1300);
}

// =====================================================================
// Layout / resize
// =====================================================================

function fitCanvasDPR(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function layoutBoardCanvas() {
  const wrap = document.getElementById("board-wrap");
  const rect = wrap.getBoundingClientRect();
  let w = Math.max(120, rect.width - 16);
  let h = w * (ROWS / COLS);
  if (h > rect.height - 16) {
    h = Math.max(120, rect.height - 16);
    w = h * (COLS / ROWS);
  }
  boardCssW = w;
  boardCssH = h;
  cellSize = boardCssW / COLS;
  boardCtx = fitCanvasDPR(boardCanvas, boardCssW, boardCssH);
}

function layoutBattleCanvas() {
  const rect = document.getElementById("battle-lane").getBoundingClientRect();
  battleCssW = Math.max(1, rect.width);
  battleCssH = Math.max(1, rect.height);
  battleCtx = fitCanvasDPR(battleCanvas, battleCssW, battleCssH);
}

function handleResize() {
  layoutBoardCanvas();
  layoutBattleCanvas();
}

// =====================================================================
// Game lifecycle / boot
// =====================================================================

function startNewRun() {
  wave = 1;
  playerPower = BASE_POWER;
  enemyPower = BASE_POWER;
  totalArmyScore = 0;
  boardBusy = false;
  pendingFireResolve = null;
  createBoard();

  document.getElementById("title-screen").classList.add("hidden");
  document.getElementById("gameover-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  gameState = "playing";
  handleResize();
}

let lastTime = 0;
function loop(now) {
  const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
  lastTime = now;
  update(dt);
  drawBoard();
  drawBattle();
  requestAnimationFrame(loop);
}

function init() {
  boardCanvas = document.getElementById("board-canvas");
  battleCanvas = document.getElementById("battle-canvas");

  if (bestWave > 1) {
    document.getElementById("best-wave").textContent = bestWave;
    document.getElementById("best-line").classList.remove("hidden");
  }

  document.getElementById("play-btn").addEventListener("click", startNewRun);
  document.getElementById("retry-btn").addEventListener("click", startNewRun);
  document.getElementById("restart-btn").addEventListener("click", startNewRun);

  abilityKnightBtn = document.getElementById("ability-knight");
  abilityGearBtn = document.getElementById("ability-gear");
  abilityLightningBtn = document.getElementById("ability-lightning");
  abilityKnightCost = document.getElementById("knight-cost");
  abilityGearCost = document.getElementById("gear-cost");
  abilityLightningCost = document.getElementById("lightning-cost");
  abilityKnightBtn.addEventListener("click", () => { ensureAudio(); useTrainKnight(); });
  abilityGearBtn.addEventListener("click", () => { ensureAudio(); useBuyGear(); });
  abilityLightningBtn.addEventListener("click", () => { ensureAudio(); useLightning(); });

  wireBoardInput();
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);

  requestAnimationFrame(loop);
}

document.addEventListener("DOMContentLoaded", init);
