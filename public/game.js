"use strict";

// =====================================================================
// Gear Fight! — a gear machine that runs by itself. One gear has a single
// tooth and keeps turning on its own. Each time that tooth hits a neighbouring
// gear, the neighbour gains 25%. At 100% it sends one soldier to the battle
// and starts again from 0%, staying where it is. The player can drag normal
// gears around to swap their positions.
// Two independent systems tied together by one number:
//   - the board (grid[][]) is the gear machine
//   - the battle (playerPower/enemyPower) is a simple push-the-line meter
// Everything here is client-only — no backend, no login. Progress within
// a run isn't persisted (a run is a few minutes), only the best wave
// reached, via localStorage.
// =====================================================================

const COLS = 6;
const ROWS = 7;
const BASE_POWER = 3;
const WIN_RATIO = 0.82; // playerPower share of the total needed to take the wave
const LOSE_RATIO = 0.3; // playerPower share at/below which the enemy overruns you
const HITS_TO_FULL = 4; // each hit fills 25% of a gear
const SOLDIERS_PER_FULL_GEAR = 1;
const TOOTH_COUNT = 10; // teeth drawn per gear — also one tick's worth of visual spin
const TICK_ANGLE = (Math.PI * 2) / TOOTH_COUNT;
const DRIVER_TURNS_PER_SEC = 1; // how fast the one-tooth gear turns
const QUARTER_TURN = Math.PI / 2;
// Which neighbour the tooth points at after each quarter turn, in canvas
// rotation order (positive angles are clockwise): right, down, left, up.
const TOOTH_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const ENEMY_BASE_GROWTH = 0.05; // enemy army per second at the start of wave 1
const ENEMY_WAVE_SCALE = 1.15; // enemy growth multiplier per wave
const ENEMY_DOUBLING_SECONDS = 20; // enemy growth doubles every this long within a wave
const WAVE_START_LEAD = 1.25; // player's army vs the enemy's when a new wave begins
const DRIVER_PALETTE = { fill: "#8d99a6", stroke: "#3f4a55", hub: "#c3ccd5" };

const GEAR_PALETTE = { fill: "#e0c355", stroke: "#8a6a1c", hub: "#f0dd8a" };

// The enemy's own army grows on its own the whole time, scaling up per
// wave and accelerating the longer a wave drags on. The board's payout
// rate is roughly steady, so this acceleration is what guarantees every
// wave ends: take it out and the two sides can settle into a balance where
// neither threshold is ever reached.
function enemyGrowthPerSec(wave, waveTime) {
  return ENEMY_BASE_GROWTH * Math.pow(ENEMY_WAVE_SCALE, wave - 1) * Math.pow(2, waveTime / ENEMY_DOUBLING_SECONDS);
}

// =====================================================================
// State
// =====================================================================

let boardCanvas, boardCtx, battleCanvas, battleCtx;
let boardCssW = 0, boardCssH = 0, cellSize = 0;
let battleCssW = 0, battleCssH = 0;

// grid[row][col] = { ticks, ticksAnim, spinTarget, spinAnim, flash } for a
//                  normal gear, plus { driver: true, angle, spin } for the
//                  one-tooth gear
let grid = [];
let drag = null; // { cell, row, col, x, y } while a gear is being dragged

let gameState = "title"; // "title" | "playing" | "gameover"
let wave = 1;
let waveTime = 0; // seconds since the current wave began
let playerPower = BASE_POWER;
let enemyPower = BASE_POWER;
let totalArmyScore = 0;
let bestWave = Number(localStorage.getItem("gearfight_best_wave") || 1);

function freshCell() {
  return { ticks: 0, ticksAnim: 0, spinTarget: 0, spinAnim: 0, flash: 0 };
}

// =====================================================================
// Board logic
// =====================================================================

// Turns a cell into the one-tooth gear, starting at a random angle.
function makeDriver(row, col) {
  const cell = freshCell();
  cell.driver = true;
  cell.angle = Math.random() * Math.PI * 2;
  cell.spin = 1;
  grid[row][col] = cell;
}

function createBoard() {
  grid = [];
  for (let row = 0; row < ROWS; row++) {
    const r = [];
    for (let col = 0; col < COLS; col++) r.push(freshCell());
    grid.push(r);
  }
  // The one-tooth gear sits mid-board so all four sides are in reach.
  makeDriver(Math.floor(ROWS / 2), Math.floor(COLS / 2));
}

// One tooth hit: only the gear being touched fills up. A full gear sends a
// soldier and restarts from 0%, staying in place.
function tickGear(row, col, driverSpin) {
  const cell = grid[row]?.[col];
  if (!cell || cell.driver) return;
  cell.ticks += 1;
  cell.spinTarget -= driverSpin; // meshed gears turn opposite ways
  cell.flash = 1;
  playTickSound();
  if (cell.ticks >= HITS_TO_FULL) {
    cell.ticks = 0;
    cell.ticksAnim = 0;
    sendSoldier();
  }
}

function sendSoldier() {
  playerPower += SOLDIERS_PER_FULL_GEAR;
  totalArmyScore += SOLDIERS_PER_FULL_GEAR;
  showToast(`+${SOLDIERS_PER_FULL_GEAR}`);
  playFireSound();
}

// =====================================================================
// Input — drag a gear onto another gear to swap them
// =====================================================================

function boardPoint(e) {
  const rect = boardCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// The gear at a board point that can be moved, or null. The one-tooth gear
// stays bolted down.
function movableAt({ x, y }) {
  const col = Math.floor(x / cellSize);
  const row = Math.floor(y / cellSize);
  const cell = grid[row]?.[col];
  if (!cell || cell.driver) return null;
  return { row, col, cell };
}

function onPointerDown(e) {
  ensureAudio();
  if (drag || gameState !== "playing") return;
  const point = boardPoint(e);
  const hit = movableAt(point);
  if (!hit) return;
  e.preventDefault();
  boardCanvas.setPointerCapture(e.pointerId);
  drag = { ...hit, ...point };
}

function onPointerMove(e) {
  if (drag) Object.assign(drag, boardPoint(e));
}

function onPointerUp(e) {
  if (!drag) return;
  const target = movableAt(boardPoint(e));
  if (target && target.cell !== drag.cell) {
    grid[drag.row][drag.col] = target.cell;
    grid[target.row][target.col] = drag.cell;
    playTickSound();
  }
  drag = null;
}

function wireBoardInput() {
  boardCanvas.addEventListener("pointerdown", onPointerDown);
  boardCanvas.addEventListener("pointermove", onPointerMove);
  boardCanvas.addEventListener("pointerup", onPointerUp);
  boardCanvas.addEventListener("pointercancel", () => { drag = null; });
  boardCanvas.addEventListener("contextmenu", (e) => e.preventDefault());
}

// =====================================================================
// Update loop
// =====================================================================

function updateDrivers(dt) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell.driver) continue;
      const before = Math.floor(cell.angle / QUARTER_TURN);
      cell.angle += DRIVER_TURNS_PER_SEC * Math.PI * 2 * dt;
      const after = Math.floor(cell.angle / QUARTER_TURN);
      for (let k = before + 1; k <= after; k++) {
        const [dr, dc] = TOOTH_DIRS[(((k * cell.spin) % 4) + 4) % 4];
        tickGear(row + dr, col + dc, cell.spin);
      }
    }
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
  waveTime = 0;
  if (wave > bestWave) {
    bestWave = wave;
    localStorage.setItem("gearfight_best_wave", String(bestWave));
  }
  showWaveBanner(`Wave ${wave}!`);
  playWinSound();
  // Reset the balance of power so the new wave starts contested. Carrying
  // the player's total over would put them past WIN_RATIO straight away,
  // and waves would then fall one after another with nothing happening.
  enemyPower = BASE_POWER * Math.pow(1.07, wave - 1);
  playerPower = enemyPower * WAVE_START_LEAD;
}

function gameOver() {
  gameState = "gameover";
  drag = null;
  document.getElementById("final-wave").textContent = wave;
  document.getElementById("gameover-screen").classList.remove("hidden");
  playLoseSound();
}

function update(dt) {
  if (gameState !== "playing") return;
  updateDrivers(dt);
  updateGearAnim(dt);

  waveTime += dt;
  enemyPower += enemyGrowthPerSec(wave, waveTime) * dt;
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

// A one-tooth gear: a plain disc with a single tooth long enough to visibly
// reach into the neighbouring gear as it sweeps past.
function drawDriverCell(ctx, cx, cy, size, cell) {
  const r = size * 0.34;
  const toothHalfWidth = size * 0.09;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cell.angle * cell.spin);
  ctx.beginPath();
  ctx.moveTo(r * 0.8, -toothHalfWidth);
  ctx.lineTo(size * 0.6, -toothHalfWidth * 0.55);
  ctx.lineTo(size * 0.6, toothHalfWidth * 0.55);
  ctx.lineTo(r * 0.8, toothHalfWidth);
  ctx.closePath();
  ctx.fillStyle = DRIVER_PALETTE.fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = DRIVER_PALETTE.stroke;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = DRIVER_PALETTE.fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = DRIVER_PALETTE.stroke;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = DRIVER_PALETTE.hub;
  ctx.fill();
}

function drawGearCell(ctx, cx, cy, size, cell) {
  const flashBoost = 1 + cell.flash * 0.12;
  const r = size * 0.42 * flashBoost;
  const palette = GEAR_PALETTE;

  // The gear body itself visibly spins, opposite to the tooth that ticked
  // it. Purely cosmetic; it never resets, so it keeps turning rather than
  // snapping back.
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

  // Progress ring — how close this gear is to sending a soldier. Decoupled
  // from the decorative spin above so it always reads the same way,
  // regardless of which way the gear has been spun.
  const progress = Math.max(0, Math.min(1, cell.ticksAnim / HITS_TO_FULL));
  if (progress > 0) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, size * 0.06);
    ctx.strokeStyle = "#fff6c8";
    ctx.lineCap = "round";
    const start = -Math.PI / 2;
    ctx.arc(cx, cy, r * 0.74, start, start + progress * Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "#1c130a";
  ctx.font = `800 ${Math.round(r * 0.46)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${(cell.ticks / HITS_TO_FULL) * 100}%`, cx, cy + 1);
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

  // The one-tooth gear goes on top so its tooth overlaps the gears it touches.
  for (const drawDrivers of [false, true]) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = grid[row][col];
        if (Boolean(cell.driver) !== drawDrivers) continue;
        if (drag && drag.cell === cell) continue;
        const cx = col * cellSize + cellSize / 2;
        const cy = row * cellSize + cellSize / 2;
        if (drawDrivers) drawDriverCell(ctx, cx, cy, cellSize, cell);
        else drawGearCell(ctx, cx, cy, cellSize, cell);
      }
    }
  }

  // The dragged gear follows the pointer, above everything else, with an
  // outline on the gear it would swap with.
  if (drag) {
    const target = movableAt(drag);
    if (target && target.cell !== drag.cell) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffcc33";
      ctx.strokeRect(target.col * cellSize + 3, target.row * cellSize + 3, cellSize - 6, cellSize - 6);
    }
    drawGearCell(ctx, drag.x, drag.y, cellSize * 1.12, drag.cell);
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

// Several teeth can land close together, so limit this to a steady patter.
let lastTickSoundAt = 0;
function playTickSound() {
  const now = performance.now();
  if (now - lastTickSoundAt < 110) return;
  lastTickSoundAt = now;
  beep(560, 0.05, "square", 0.05);
}

function playFireSound() {
  beep(520, 0.16, "triangle", 0.16);
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
  ensureAudio();
  drag = null;
  wave = 1;
  waveTime = 0;
  playerPower = BASE_POWER;
  enemyPower = BASE_POWER;
  totalArmyScore = 0;
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
