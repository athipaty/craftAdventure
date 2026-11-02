"use strict";

// =====================================================================
// Gear Fight! — drag through adjacent same-number gears to clear them;
// each clear feeds a tug-of-war army battle against a steadily-growing
// enemy. Two independent systems tied together by one number:
//   - the board (grid[][], chain[]) is a match-style puzzle
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
const POP_DURATION = 0.22; // seconds a cleared gear takes to shrink away
const JACKPOT_CHANCE = 0.025; // odds a freshly spawned gear is a star "jackpot" tile
const MULT_CHANCE = 0.06; // odds a freshly spawned (non-jackpot) gear also carries a multiplier

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

// How many distinct gear values are in play — starts easy (lots of
// matches) and widens as the wave climbs (harder to find a match, but
// chains are worth more), capped at the size of VALUE_PALETTE.
function valuePoolSize(wave) {
  return Math.min(6, 3 + Math.floor((wave - 1) / 2));
}

// The enemy's own army grows on its own the whole time you're playing —
// this is the "clock" that makes a wave eventually come to a head one
// way or the other even if you stall. Scales up per wave so later waves
// genuinely demand bigger/faster chains, not just more of the same.
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

// Reward for clearing a chain of `items` (all sharing the same value).
// Longer chains pay off super-linearly so going out of your way to
// extend one is worth it; jackpot ("J") chains pay a flat multiple on
// top since they're rare; any multiplier badges in the chain stack.
function computeReward(items) {
  const n = items.length;
  let base = Math.round(Math.pow(n, 1.3));
  if (items[0].value === "J") base *= 4;
  const multProduct = items.reduce((p, c) => p * (c.mult || 1), 1);
  return Math.max(1, Math.round(base * multProduct));
}

// =====================================================================
// State
// =====================================================================

let boardCanvas, boardCtx, battleCanvas, battleCtx;
let boardCssW = 0, boardCssH = 0, cellSize = 0;
let battleCssW = 0, battleCssH = 0;

let grid = []; // grid[row][col] = { value, mult, animRow, popping, popT } | null
let chain = []; // [{row, col}, ...] currently being dragged out
let dragging = false;
let boardBusy = false; // true while a clear/fall animation is resolving — input ignored
let pendingResolve = false; // waiting for all popping cells to finish before gravity runs
let fallingActive = false;

let gameState = "title"; // "title" | "playing" | "gameover"
let wave = 1;
let playerPower = BASE_POWER;
let enemyPower = BASE_POWER;
let totalArmyScore = 0;
let bestWave = Number(localStorage.getItem("gearfight_best_wave") || 1);

// =====================================================================
// Board logic
// =====================================================================

function createBoard() {
  grid = [];
  for (let row = 0; row < ROWS; row++) grid.push(new Array(COLS).fill(null));
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = randomCellValue(wave);
      cell.animRow = row;
      grid[row][col] = cell;
    }
  }
  ensureSolvable();
}

function hasAnyMove() {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell) continue;
      if (col + 1 < COLS && grid[row][col + 1] && grid[row][col + 1].value === cell.value) return true;
      if (row + 1 < ROWS && grid[row + 1][col] && grid[row + 1][col].value === cell.value) return true;
    }
  }
  return false;
}

function ensureSolvable() {
  let attempts = 0;
  while (!hasAnyMove() && attempts < 20) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = randomCellValue(wave);
        cell.animRow = row;
        grid[row][col] = cell;
      }
    }
    attempts++;
  }
}

function isAdjacent(a, b) {
  return (a.row === b.row && Math.abs(a.col - b.col) === 1) || (a.col === b.col && Math.abs(a.row - b.row) === 1);
}

function commitChain(cells) {
  const items = cells.map((p) => grid[p.row][p.col]);
  const reward = computeReward(items);
  playerPower += reward;
  totalArmyScore += reward;
  showToast(`+${reward}${items.length >= 5 ? " COMBO!" : ""}`);
  playMatchSound(items.length);
  for (const p of cells) {
    grid[p.row][p.col].popping = true;
    grid[p.row][p.col].popT = 0;
  }
  boardBusy = true;
  pendingResolve = true;
}

function resolveGravity() {
  for (let col = 0; col < COLS; col++) {
    const existing = [];
    for (let row = ROWS - 1; row >= 0; row--) {
      if (grid[row][col]) existing.push(grid[row][col]);
    }
    let newAbove = 0;
    for (let row = ROWS - 1, i = 0; row >= 0; row--, i++) {
      if (i < existing.length) {
        grid[row][col] = existing[i];
      } else {
        newAbove += 1;
        const cell = randomCellValue(wave);
        cell.animRow = -newAbove;
        grid[row][col] = cell;
      }
    }
  }
  fallingActive = true;
}

// =====================================================================
// Input — drag through adjacent same-value gears
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
  dragging = true;
  chain = [pos];
  if (boardCanvas.setPointerCapture) {
    try { boardCanvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
}

function onPointerMove(e) {
  if (!dragging) return;
  const pos = cellAt(e.clientX, e.clientY);
  if (!pos) return;
  const last = chain[chain.length - 1];
  if (pos.row === last.row && pos.col === last.col) return;

  // Dragging back onto the previous gear in the chain un-selects the tip —
  // lets you correct course without having to release and start over.
  if (chain.length > 1) {
    const prev = chain[chain.length - 2];
    if (pos.row === prev.row && pos.col === prev.col) {
      chain.pop();
      return;
    }
  }

  const cell = grid[pos.row][pos.col];
  if (!cell) return;
  if (chain.some((c) => c.row === pos.row && c.col === pos.col)) return;
  if (!isAdjacent(last, pos)) return;
  const key = grid[chain[0].row][chain[0].col].value;
  if (cell.value !== key) return;

  chain.push(pos);
  playTickSound();
}

function endDrag() {
  if (!dragging) return;
  dragging = false;
  if (chain.length >= 2) commitChain(chain);
  chain = [];
}

function wireBoardInput() {
  boardCanvas.addEventListener("pointerdown", onPointerDown);
  boardCanvas.addEventListener("pointermove", onPointerMove);
  boardCanvas.addEventListener("pointerup", endDrag);
  boardCanvas.addEventListener("pointercancel", endDrag);
  boardCanvas.addEventListener("pointerleave", (e) => {
    if (dragging && e.buttons === 0) endDrag();
  });
  boardCanvas.addEventListener("contextmenu", (e) => e.preventDefault());
}

// =====================================================================
// Update loop
// =====================================================================

function updatePops(dt) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (cell && cell.popping) {
        cell.popT += dt / POP_DURATION;
        if (cell.popT >= 1) grid[row][col] = null;
      }
    }
  }
  if (pendingResolve) {
    let stillPopping = false;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (grid[row][col] && grid[row][col].popping) stillPopping = true;
      }
    }
    if (!stillPopping) {
      pendingResolve = false;
      resolveGravity();
    }
  }
}

function updateFalling(dt) {
  let anyFalling = false;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell) continue;
      if (cell.animRow === undefined) cell.animRow = row;
      const diff = row - cell.animRow;
      if (Math.abs(diff) > 0.01) {
        // Exponential ease, driven by elapsed time rather than a fixed
        // per-frame increment, so the fall speed doesn't track framerate.
        const k = Math.min(1, 1 - Math.pow(0.00002, dt));
        cell.animRow += diff * k;
        anyFalling = true;
      } else {
        cell.animRow = row;
      }
    }
  }
  if (fallingActive && !anyFalling) {
    fallingActive = false;
    boardBusy = false;
    ensureSolvable();
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
  updateFalling(dt);

  enemyPower += enemyGrowthPerSec(wave) * dt;
  const total = playerPower + enemyPower;
  const ratio = total > 0 ? playerPower / total : 0.5;
  if (ratio >= WIN_RATIO) winWave();
  else if (ratio <= LOSE_RATIO) gameOver();

  document.getElementById("wave-num").textContent = wave;
  document.getElementById("army-score").textContent = Math.round(totalArmyScore);
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

function drawGearCell(ctx, cx, cy, size, cell, scale, highlighted) {
  const r = size * 0.42 * scale;
  if (r <= 0) return;
  const palette = cellColor(cell);
  ctx.save();
  if (highlighted) {
    ctx.shadowColor = "#ffcc33";
    ctx.shadowBlur = size * 0.3;
  }
  drawGearShape(ctx, cx, cy, r, r * 0.8, 10, palette.fill, palette.stroke);
  ctx.restore();

  ctx.beginPath();
  ctx.fillStyle = palette.hub;
  ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
  ctx.fill();

  if (cell.mult) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, size * 0.045);
    ctx.strokeStyle = "#fff6c8";
    ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "#1c130a";
  ctx.font = `800 ${Math.round(r * 0.78)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(cell.value === "J" ? "★" : String(cell.value), cx, cy + 1);

  if (cell.mult) {
    ctx.font = `700 ${Math.round(size * 0.15)}px system-ui, sans-serif`;
    ctx.fillStyle = "#3a2414";
    ctx.fillText(`×${cell.mult}`, cx, cy + r + size * 0.14);
  }
}

function drawBoard() {
  if (!boardCtx || boardCssW <= 0) return;
  const ctx = boardCtx;
  ctx.clearRect(0, 0, boardCssW, boardCssH);
  roundRectFill(ctx, 0, 0, boardCssW, boardCssH, 14, "#3a2414");

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell) continue;
      const cx = col * cellSize + cellSize / 2;
      const cy = cell.animRow * cellSize + cellSize / 2;
      const inChain = chain.some((c) => c.row === row && c.col === col);
      let scale = 1;
      if (cell.popping) scale = Math.max(0, 1 - cell.popT);
      else if (inChain) scale = 1.12;
      drawGearCell(ctx, cx, cy, cellSize, cell, scale, inChain);
    }
  }

  if (chain.length > 1) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(4, cellSize * 0.12);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    chain.forEach((p, i) => {
      const cell = grid[p.row][p.col];
      const x = p.col * cellSize + cellSize / 2;
      const y = (cell ? cell.animRow : p.row) * cellSize + cellSize / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
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

function playTickSound() {
  beep(700, 0.05, "square", 0.08);
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
  chain = [];
  dragging = false;
  boardBusy = false;
  pendingResolve = false;
  fallingActive = false;
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

  wireBoardInput();
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);

  requestAnimationFrame(loop);
}

document.addEventListener("DOMContentLoaded", init);
