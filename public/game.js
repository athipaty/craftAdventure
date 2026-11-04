"use strict";

// =====================================================================
// Gear Fight! — a gear machine that runs by itself. One gear has a single
// tooth and keeps turning on its own. Each time that tooth hits a neighbouring
// gear, that gear and every gear connected to it gain 25%, like a gear train.
// At 100% a gear sends one soldier to the battle and starts again from 0%,
// staying where it is. A run starts with just one normal gear beside the
// one-tooth gear. Soldiers can be spent on more gears, which the player drags
// into place to connect them. Soldiers from both armies march to the front
// line and only count once they get there. Winning a wave offers a choice of
// three rewards, including special gears that make placement matter.
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
const WIN_RATIO = 0.7; // playerPower share of the total needed to take the wave
const LOSE_RATIO = 0.3; // playerPower share at/below which the enemy overruns you
const GEAR_BASE_COST = 3; // soldiers for the first extra gear
const GEAR_COST_GROWTH = 1.15; // price multiplier per gear bought this run
const DRIVER_ROW = Math.floor(ROWS / 2);
const DRIVER_COL = Math.floor(COLS / 2);
const MARCH_SECONDS = 0.9; // how long a soldier takes to reach the front line
const MAX_MARCHERS = 24; // per army; past this, new soldiers join the newest one
const CLASH_SECONDS = 0.3;
const TOOTH_COUNT = 12; // teeth drawn per gear — also one tick's worth of visual spin
const TICK_ANGLE = (Math.PI * 2) / TOOTH_COUNT;
const DRIVER_BASE_TURNS_PER_SEC = 1; // how fast the one-tooth gear turns at the start of a run
const QUARTER_TURN = Math.PI / 2;
// Which neighbour the tooth points at after each quarter turn, in canvas
// rotation order (positive angles are clockwise): right, down, left, up.
const TOOTH_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const MIN_WAVE_SECONDS = 20; // a new wave starts big enough to take the player's best output this long
const ENEMY_BASE_GROWTH = 0.08; // enemy army per second at the start of wave 1
const ENEMY_WAVE_SCALE = 1.2; // enemy growth multiplier per wave
const ENEMY_DOUBLING_SECONDS = 30; // enemy growth doubles every this long within a wave
const WAVE_START_LEAD = 1.25; // player's army vs the enemy's when a new wave begins
const WAVE_START_SCALE = 1.45; // how much bigger both armies start each wave
const DRIVER_PALETTE = { light: "#dfe5ea", mid: "#8d99a6", dark: "#3f4a55", recess: "#6d7884", hub: "#c3ccd5" };

const GEAR_PALETTE = { light: "#f3d98a", mid: "#c99a35", dark: "#7a5716", recess: "#a97f28", hub: "#f6e6ae" };
const BIG_PALETTE = { light: "#a9d4ff", mid: "#4f8fd0", dark: "#1f4a7a", recess: "#3a74b0", hub: "#d8ecff" };
const BOOSTER_PALETTE = { light: "#c8f59a", mid: "#6fb83f", dark: "#2f6d18", recess: "#559a2c", hub: "#e4fbc9" };
const BOMB_PALETTE = { light: "#ffb3a0", mid: "#cf5238", dark: "#6e1f10", recess: "#ad3f28", hub: "#ffe0d6" };

// hits: how many hits fill the gear (0 means it never fills). A full gear
// sends `soldiers` or blasts `enemies`. A booster gives the gears touching it
// one extra hit each time they are hit.
const GEAR_TYPES = {
  soldier: { hits: 4, soldiers: 1, palette: GEAR_PALETTE },
  big: { hits: 8, soldiers: 5, badge: "x5", palette: BIG_PALETTE },
  booster: { hits: 0, palette: BOOSTER_PALETTE },
  bomb: { hits: 8, enemies: 2, badge: "-2", palette: BOMB_PALETTE },
};

const DRIVER_SPEED_REWARD = 0.1; // turns per second added by the reward
const VETERANS_REWARD = 0.15; // added to the player's lead each wave
const VETERANS_MAX_LEAD = 1.7; // stays well under the lead that wins a wave outright
const DISCOUNT_REWARD = 0.8; // gear price multiplier
const REWARD_CLICK_DELAY_MS = 400; // ignores taps meant for the board when the choice appears

const REWARDS = [
  { name: "Big gear", text: "Fills half as fast, then sends 5 soldiers", gear: "big" },
  { name: "Booster gear", text: "Gears touching it get an extra 25% per hit", gear: "booster" },
  { name: "Bomb gear", text: "Fills half as fast, then blasts 2 enemies", gear: "bomb" },
  { name: "Faster main gear", text: "The one-tooth gear turns 10% faster", apply: () => { driverTurnsPerSec += DRIVER_SPEED_REWARD; } },
  { name: "Veterans", text: "Start every wave with more soldiers", apply: () => { waveLead += VETERANS_REWARD; }, available: () => waveLead + VETERANS_REWARD <= VETERANS_MAX_LEAD },
  { name: "Cheaper gears", text: "New gears cost 20% less", apply: () => { gearPriceScale *= DISCOUNT_REWARD; } },
];

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

// grid[row][col] = { type, ticks, ticksAnim, spinTarget, spinAnim, flash } for a
//                  normal gear, plus { driver: true, angle, spin } for the
//                  one-tooth gear, or null for an empty cell
let grid = [];
let drag = null; // { cell, row, col, x, y } while a gear is being dragged
let gearsBought = 0;
let peakRate = 0; // the most soldiers per second the machine has produced this run
let marchers = []; // { side: "player" | "enemy", value, t } on their way to the front
let clashes = []; // { t } sparks where soldiers reached the front
let enemyBacklog = 0; // enemy growth not yet worth a whole soldier
let driverTurnsPerSec = DRIVER_BASE_TURNS_PER_SEC;
let waveLead = WAVE_START_LEAD; // player's army vs the enemy's when a new wave begins
let gearPriceScale = 1;
let rewardOpenedAt = 0;

let gameState = "title"; // "title" | "playing" | "choosing" | "gameover"
let wave = 1;
let waveTime = 0; // seconds since the current wave began
let playerPower = BASE_POWER;
let enemyPower = BASE_POWER;
let totalArmyScore = 0;
let bestWave = Number(localStorage.getItem("gearfight_best_wave") || 1);

function freshCell(type = "soldier") {
  return { type, ticks: 0, ticksAnim: 0, spinTarget: 0, spinAnim: 0, flash: 0 };
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
  for (let row = 0; row < ROWS; row++) grid.push(new Array(COLS).fill(null));
  // The one-tooth gear sits mid-board so all four sides are in reach, with
  // the one starting gear already beside it.
  makeDriver(DRIVER_ROW, DRIVER_COL);
  grid[DRIVER_ROW][DRIVER_COL + 1] = freshCell();
}

// The gear at a cell plus every gear connected to it, each spinning opposite
// to the gear that drives it. Each gear appears once, even when a loop gives
// it two routes. Empty when the cell has no normal gear.
function connectedGears(row, col, firstSpin) {
  const first = grid[row]?.[col];
  if (!first || first.driver) return [];
  const seen = new Set([first]);
  const queue = [{ row, col, spin: firstSpin }];
  for (const cur of queue) {
    for (const [dr, dc] of TOOTH_DIRS) {
      const next = grid[cur.row + dr]?.[cur.col + dc];
      if (!next || next.driver || seen.has(next)) continue;
      seen.add(next);
      queue.push({ row: cur.row + dr, col: cur.col + dc, spin: -cur.spin });
    }
  }
  return queue;
}

// One tooth hit: the gear being touched turns, and turns every gear connected to it.
function tickGear(row, col, driverSpin) {
  const gears = connectedGears(row, col, -driverSpin);
  if (!gears.length) return;
  for (const gear of gears) hitGear(grid[gear.row][gear.col], gear.spin, 1 + boostersTouching(gear.row, gear.col));
  playTickSound();
}

function boostersTouching(row, col) {
  let count = 0;
  for (const [dr, dc] of TOOTH_DIRS) {
    if (grid[row + dr]?.[col + dc]?.type === "booster") count += 1;
  }
  return count;
}

// Each turn the tooth hits all four sides once, so a gear reachable from two
// sides fills twice as fast. Blasting an enemy counts as the soldiers it would
// take to match it, since either one moves the line toward a win.
function soldiersPerSecond() {
  const soldiersPerEnemy = WIN_RATIO / (1 - WIN_RATIO);
  let perTurn = 0;
  for (const [dr, dc] of TOOTH_DIRS) {
    for (const gear of connectedGears(DRIVER_ROW + dr, DRIVER_COL + dc, 1)) {
      const spec = GEAR_TYPES[grid[gear.row][gear.col].type];
      if (!spec.hits) continue;
      const payout = (spec.soldiers || 0) + (spec.enemies || 0) * soldiersPerEnemy;
      perTurn += ((1 + boostersTouching(gear.row, gear.col)) * payout) / spec.hits;
    }
  }
  return perTurn * driverTurnsPerSec;
}

// A full gear pays out and starts filling again, staying in place.
function hitGear(cell, spin, hits) {
  const spec = GEAR_TYPES[cell.type];
  cell.spinTarget += spin;
  cell.flash = 1;
  if (!spec.hits) return;
  cell.ticks += hits;
  while (cell.ticks >= spec.hits) {
    cell.ticks -= spec.hits;
    cell.ticksAnim = cell.ticks;
    if (spec.soldiers) sendSoldiers(spec.soldiers);
    else launchBomb(spec.enemies);
  }
}

function gearCost() {
  return Math.max(1, Math.round(GEAR_BASE_COST * Math.pow(GEAR_COST_GROWTH, gearsBought) * gearPriceScale));
}

// Where a new gear goes: the free cell closest to the one-tooth gear along the
// chain, so it starts working at once. Any free cell will do if the chain is
// walled in, and null means the board is full.
function bestEmptyCell() {
  const seen = new Set([grid[DRIVER_ROW][DRIVER_COL]]);
  const queue = [{ row: DRIVER_ROW, col: DRIVER_COL }];
  for (const { row, col } of queue) {
    for (const [dr, dc] of TOOTH_DIRS) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      const cell = grid[r][c];
      if (!cell) return { row: r, col: c };
      if (!seen.has(cell)) {
        seen.add(cell);
        queue.push({ row: r, col: c });
      }
    }
  }
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!grid[row][col]) return { row, col };
    }
  }
  return null;
}

function placeGear(type) {
  const { row, col } = bestEmptyCell();
  grid[row][col] = freshCell(type);
  grid[row][col].flash = 1;
}

// Soldiers are the price, so buying weakens the army. A purchase that would
// lose the game on the spot is refused rather than ending the run. Returns how
// many more soldiers the player needs for this one, or 0 when they can afford it.
function soldiersShortForGear() {
  const armyToKeep = (enemyPower * LOSE_RATIO) / (1 - LOSE_RATIO);
  const short = gearCost() + armyToKeep - playerPower;
  return short < 0 ? 0 : Math.floor(short) + 1;
}

function canBuyGear() {
  return gameState === "playing" && Boolean(bestEmptyCell()) && soldiersShortForGear() === 0;
}

function buyButtonLabel() {
  if (!bestEmptyCell()) return "Board full";
  const label = `Buy gear: ${gearCost()} soldiers`;
  const short = soldiersShortForGear();
  return short > 0 ? `${label} (need ${short} more)` : label;
}

function updateBuyButton() {
  const button = document.getElementById("buy-gear-btn");
  const label = buyButtonLabel();
  if (button.textContent !== label) button.textContent = label;
  button.disabled = !canBuyGear();
}

function buyGear() {
  if (!canBuyGear()) return;
  playerPower -= gearCost();
  gearsBought += 1;
  placeGear("soldier");
  playFireSound();
}

function sendSoldiers(count) {
  sendMarcher("player", count);
  totalArmyScore += count;
  showToast(`+${count}`);
  playFireSound();
}

function launchBomb(enemies) {
  sendMarcher("bomb", enemies);
  showToast(`-${enemies}`);
  playFireSound();
}

function sendMarcher(side, value) {
  const team = marchers.filter((m) => m.side === side);
  if (team.length >= MAX_MARCHERS) team[team.length - 1].value += value;
  else marchers.push({ side, value, t: 0 });
}

// =====================================================================
// Input — drag a gear onto another gear to swap them
// =====================================================================

function boardPoint(e) {
  const rect = boardCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// The cell under a board point, or null when the point is off the board.
function cellAt({ x, y }) {
  const col = Math.floor(x / cellSize);
  const row = Math.floor(y / cellSize);
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
  return { row, col, cell: grid[row][col] };
}

// A dragged gear can land on an empty cell or swap with another normal gear.
// The one-tooth gear stays bolted down.
function canDropOn(target) {
  return target && !target.cell?.driver && target.cell !== drag.cell;
}

function onPointerDown(e) {
  ensureAudio();
  if (drag || gameState !== "playing") return;
  const point = boardPoint(e);
  const hit = cellAt(point);
  if (!hit || !hit.cell || hit.cell.driver) return;
  e.preventDefault();
  boardCanvas.setPointerCapture(e.pointerId);
  drag = { ...hit, ...point };
}

function onPointerMove(e) {
  if (drag) Object.assign(drag, boardPoint(e));
}

function onPointerUp(e) {
  if (!drag) return;
  const target = cellAt(boardPoint(e));
  if (canDropOn(target)) {
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
      if (!cell?.driver) continue;
      const before = Math.floor(cell.angle / QUARTER_TURN);
      cell.angle += driverTurnsPerSec * Math.PI * 2 * dt;
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

// A soldier only joins its army's total on reaching the front line.
function updateMarchers(dt) {
  for (const m of marchers) {
    m.t += dt / MARCH_SECONDS;
    if (m.t < 1) continue;
    if (m.side === "player") playerPower += m.value;
    else if (m.side === "bomb") enemyPower = Math.max(1, enemyPower - m.value);
    else enemyPower += m.value;
    clashes.push({ t: 0 });
  }
  marchers = marchers.filter((m) => m.t < 1);
  for (const c of clashes) c.t += dt / CLASH_SECONDS;
  clashes = clashes.filter((c) => c.t < 1);
}

// The enemy's size for a new wave: the usual schedule, or more if the player's
// machine would otherwise beat it almost at once. Uses the run's best output so
// unplugging gears just before a wave ends doesn't make the next one smaller.
function waveStartEnemy(forWave) {
  const scheduled = BASE_POWER * Math.pow(WAVE_START_SCALE, forWave - 1);
  const soldiersToWinPerEnemy = WIN_RATIO / (1 - WIN_RATIO) - waveLead;
  return Math.max(scheduled, (peakRate * MIN_WAVE_SECONDS) / soldiersToWinPerEnemy);
}

function winWave() {
  wave += 1;
  waveTime = 0;
  marchers = [];
  enemyBacklog = 0;
  if (wave > bestWave) {
    bestWave = wave;
    localStorage.setItem("gearfight_best_wave", String(bestWave));
  }
  playWinSound();
  offerRewards();
}

// Reset the balance of power so the new wave starts contested. Carrying the
// player's total over would put them past WIN_RATIO straight away, and waves
// would then fall one after another with nothing happening. This runs after
// the reward is picked so the wave is sized for the machine it will face.
function startWave() {
  peakRate = Math.max(peakRate, soldiersPerSecond());
  enemyPower = waveStartEnemy(wave);
  playerPower = enemyPower * waveLead;
}

// One special gear (while there's room) plus two other rewards, so a choice
// always includes something to place.
function pickRewards() {
  const open = REWARDS.filter((r) => (r.gear ? bestEmptyCell() : !r.available || r.available()));
  const shuffled = open.map((r) => [Math.random(), r]).sort((a, b) => a[0] - b[0]).map((pair) => pair[1]);
  const firstGear = shuffled.find((r) => r.gear);
  const rest = shuffled.filter((r) => r !== firstGear);
  return (firstGear ? [firstGear, ...rest] : rest).slice(0, 3);
}

function offerRewards() {
  gameState = "choosing";
  drag = null;
  rewardOpenedAt = performance.now();
  document.getElementById("reward-title").textContent = `Wave ${wave - 1} won!`;
  const list = document.getElementById("reward-options");
  list.replaceChildren();
  for (const reward of pickRewards()) {
    const button = document.createElement("button");
    button.className = "reward-option";
    const name = document.createElement("b");
    name.textContent = reward.name;
    const text = document.createElement("span");
    text.textContent = reward.text;
    button.append(name, text);
    button.addEventListener("click", () => {
      if (performance.now() - rewardOpenedAt >= REWARD_CLICK_DELAY_MS) chooseReward(reward);
    });
    list.append(button);
  }
  document.getElementById("reward-screen").classList.remove("hidden");
}

function chooseReward(reward) {
  if (reward.gear) placeGear(reward.gear);
  else reward.apply();
  startWave();
  document.getElementById("reward-screen").classList.add("hidden");
  gameState = "playing";
  showWaveBanner(`Wave ${wave}!`);
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
  updateMarchers(dt);
  peakRate = Math.max(peakRate, soldiersPerSecond());

  waveTime += dt;
  enemyBacklog += enemyGrowthPerSec(wave, waveTime) * dt;
  const newEnemies = Math.floor(enemyBacklog);
  if (newEnemies > 0) {
    enemyBacklog -= newEnemies;
    sendMarcher("enemy", newEnemies);
  }
  const total = playerPower + enemyPower;
  const ratio = total > 0 ? playerPower / total : 0.5;
  if (ratio >= WIN_RATIO) winWave();
  else if (ratio <= LOSE_RATIO) gameOver();

  document.getElementById("wave-num").textContent = wave;
  document.getElementById("army-score").textContent = Math.round(totalArmyScore);
  updateBuyButton();
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

function metalGradient(ctx, r, palette) {
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r * 1.1);
  g.addColorStop(0, palette.light);
  g.addColorStop(0.55, palette.mid);
  g.addColorStop(1, palette.dark);
  return g;
}

// Machined details shared by both gear types, drawn around the origin: a
// sunken web, lightening holes that make the turning easy to see, and a hub.
function drawGearFace(ctx, rWeb, rHub, palette) {
  ctx.beginPath();
  ctx.arc(0, 0, rWeb, 0, Math.PI * 2);
  ctx.fillStyle = palette.recess;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.dark;
  ctx.stroke();

  const holeOrbit = (rWeb + rHub) / 2;
  const holeR = (rWeb - rHub) * 0.3;
  ctx.fillStyle = palette.dark;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * holeOrbit, Math.sin(a) * holeOrbit, holeR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(0, 0, rHub, 0, Math.PI * 2);
  ctx.fillStyle = palette.hub;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = palette.dark;
  ctx.stroke();
}

// A gear outline with flat-topped, tapered teeth, drawn around the origin.
function traceToothedRim(ctx, rTip, rRoot, teeth) {
  const pitch = (Math.PI * 2) / teeth;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = i * pitch;
    const points = [[rRoot, -0.3], [rTip, -0.15], [rTip, 0.15], [rRoot, 0.3]];
    for (const [radius, offset] of points) {
      const angle = a + offset * pitch;
      ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    ctx.arc(0, 0, rRoot, a + 0.3 * pitch, a + 0.7 * pitch);
  }
  ctx.closePath();
}

// The one-tooth gear: a smooth steel wheel with a single tooth long enough
// to visibly reach into the neighbouring gear as it sweeps past.
function drawDriverCell(ctx, cx, cy, size, cell) {
  const r = size * 0.38;
  const halfRoot = size * 0.11;
  const halfTip = size * 0.06;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cell.angle * cell.spin);

  ctx.beginPath();
  ctx.moveTo(r * 0.9, -halfRoot);
  ctx.lineTo(size * 0.62, -halfTip);
  ctx.lineTo(size * 0.62, halfTip);
  ctx.lineTo(r * 0.9, halfRoot);
  ctx.closePath();
  ctx.fillStyle = DRIVER_PALETTE.mid;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = DRIVER_PALETTE.dark;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = metalGradient(ctx, r, DRIVER_PALETTE);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = DRIVER_PALETTE.dark;
  ctx.stroke();

  drawGearFace(ctx, r * 0.78, r * 0.3, DRIVER_PALETTE);
  ctx.restore();
}

function drawGearCell(ctx, cx, cy, size, cell) {
  const flashBoost = 1 + cell.flash * 0.06;
  const r = size * 0.48 * flashBoost;
  const spec = GEAR_TYPES[cell.type];
  const palette = spec.palette;

  // The gear body visibly turns one tooth per hit. It never resets, so it
  // keeps turning rather than snapping back.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cell.spinAnim * TICK_ANGLE);
  if (cell.flash > 0) {
    ctx.shadowColor = "#ffcc33";
    ctx.shadowBlur = size * 0.3 * cell.flash;
  }
  traceToothedRim(ctx, r, r * 0.84, TOOTH_COUNT);
  ctx.fillStyle = metalGradient(ctx, r, palette);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = palette.dark;
  ctx.stroke();
  drawGearFace(ctx, r * 0.72, r * 0.46, palette);
  ctx.restore();

  // Progress ring — how close this gear is to sending a soldier. It stays
  // still while the body turns, so it always reads the same way.
  const progress = spec.hits ? Math.max(0, Math.min(1, cell.ticksAnim / spec.hits)) : 0;
  if (progress > 0) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, size * 0.05);
    ctx.strokeStyle = "#fffbe6";
    ctx.lineCap = "round";
    const start = -Math.PI / 2;
    ctx.arc(cx, cy, r * 0.6, start, start + progress * Math.PI * 2);
    ctx.stroke();
  }

  if (!spec.hits) {
    drawBolt(ctx, cx, cy, r * 0.34, palette.dark);
    return;
  }
  ctx.fillStyle = "#2a1b08";
  ctx.font = `800 ${Math.round(r * 0.34)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round((cell.ticks / spec.hits) * 100)}%`, cx, cy + 1);

  if (spec.badge) {
    roundRectFill(ctx, cx - r * 0.34, cy + r * 0.52, r * 0.68, r * 0.4, r * 0.15, palette.dark);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${Math.round(r * 0.3)}px system-ui, sans-serif`;
    ctx.fillText(spec.badge, cx, cy + r * 0.73);
  }
}

// The booster's mark: a lightning bolt.
function drawBolt(ctx, cx, cy, size, color) {
  const points = [[0.2, -1], [-0.6, 0.15], [-0.05, 0.15], [-0.2, 1], [0.6, -0.2], [0.05, -0.2]];
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(cx + x * size, cy + y * size);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// Sparks where a booster touches another gear, so its reach is easy to see.
function drawBoostLinks(ctx) {
  const pulse = 0.65 + Math.sin(performance.now() / 180) * 0.35;
  ctx.fillStyle = `rgba(190, 255, 120, ${pulse})`;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (grid[row][col]?.type !== "booster") continue;
      for (const [dr, dc] of TOOTH_DIRS) {
        const other = grid[row + dr]?.[col + dc];
        if (!other || other.driver) continue;
        ctx.beginPath();
        ctx.arc((col + 0.5 + dc / 2) * cellSize, (row + 0.5 + dr / 2) * cellSize, cellSize * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// Marks a cell a gear can be dragged into.
function drawEmptyCell(ctx, cx, cy, size) {
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 246, 200, 0.12)";
  ctx.fill();
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
        const cx = col * cellSize + cellSize / 2;
        const cy = row * cellSize + cellSize / 2;
        if (!cell) {
          if (!drawDrivers) drawEmptyCell(ctx, cx, cy, cellSize);
          continue;
        }
        if (Boolean(cell.driver) !== drawDrivers) continue;
        if (drag && drag.cell === cell) continue;
        if (drawDrivers) drawDriverCell(ctx, cx, cy, cellSize, cell);
        else drawGearCell(ctx, cx, cy, cellSize, cell);
      }
    }
  }

  drawBoostLinks(ctx);

  // The dragged gear follows the pointer, above everything else, with an
  // outline on the gear it would swap with.
  if (drag) {
    const target = cellAt(drag);
    if (canDropOn(target)) {
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

function drawBombIcon(ctx, x, y) {
  ctx.beginPath();
  ctx.fillStyle = "#1c130a";
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = "#ff8a3d";
  ctx.arc(x + 5, y - 6, 3, 0, Math.PI * 2);
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

  // Soldiers on their way, on a row of their own so they stand out from the
  // armies already at the front.
  for (const m of marchers) {
    const x = m.side === "enemy" ? x1 - (x1 - markerX) * m.t : x0 + (markerX - x0) * m.t;
    const stride = Math.abs(Math.sin(m.t * Math.PI * 5)) * 3;
    if (m.side === "bomb") drawBombIcon(ctx, x, battleCssH * 0.6);
    else drawArmyIcon(ctx, x, battleCssH * 0.6 - stride, m.side === "player" ? "#8fc0ff" : "#ff9a85");
  }
  for (const c of clashes) {
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255, 204, 51, ${1 - c.t})`;
    ctx.arc(markerX, barY + barH / 2, 9 + c.t * 14, 0, Math.PI * 2);
    ctx.stroke();
  }

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
  gearsBought = 0;
  peakRate = 0;
  marchers = [];
  clashes = [];
  enemyBacklog = 0;
  driverTurnsPerSec = DRIVER_BASE_TURNS_PER_SEC;
  waveLead = WAVE_START_LEAD;
  gearPriceScale = 1;
  wave = 1;
  waveTime = 0;
  playerPower = BASE_POWER;
  enemyPower = BASE_POWER;
  totalArmyScore = 0;
  createBoard();

  document.getElementById("title-screen").classList.add("hidden");
  document.getElementById("gameover-screen").classList.add("hidden");
  document.getElementById("reward-screen").classList.add("hidden");
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
  document.getElementById("buy-gear-btn").addEventListener("click", buyGear);

  wireBoardInput();
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);

  requestAnimationFrame(loop);
}

document.addEventListener("DOMContentLoaded", init);
