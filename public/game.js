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
// three rewards, including special gears that make placement matter. Every
// fifth wave is a boss with a health bar, who rusts gears to break the chain.
// Runs earn coins, spent in the Workshop on upgrades that last between runs.
// Tips pause the game the first time something new happens. Training raises the
// army's rank, so each soldier is worth more; prices are counted in soldiers of
// the current rank, so a stronger army doesn't make everything free.
// Two independent systems tied together by one number:
//   - the board (grid[][]) is the gear machine
//   - the battle (playerPower/enemyPower) is a simple push-the-line meter
// Everything here is client-only — no backend, no login. Progress within
// a run isn't persisted (a run is a few minutes), only the best wave
// reached, coins, upgrades, tips seen and the mute setting, via localStorage.
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
const FLY_SECONDS = 0.4; // how long a soldier takes to fly from its gear to the battle
const MAX_FLYERS = 30;
const MAX_PARTICLES = 200;
const MAX_HIT_NUMBERS = 12;
const HIT_NUMBER_SECONDS = 0.7;
const SHAKE_FADE_PER_SEC = 24; // pixels of screen shake lost per second
const BOMB_SHAKE = 5; // pixels
const SAVE_KEY = "gearfight_save";
const COINS_PER_WAVE = 2;
const COINS_PER_BOSS = 10;
const RECRUITS_FIRST_WAVE_PER_LEVEL = 0.1; // extra share of the army in wave 1; level 5 stays under WIN_RATIO
const RECRUITS_LEAD_PER_LEVEL = 0.05; // added to the player's lead in later waves
const BOSS_BREAKER_PER_LEVEL = 0.1; // boss health and reinforcements removed by each level
const SPEED_PER_LEVEL = 0.05; // main gear speed added by each level
const OVERDRIVE_SECONDS_PER_LEVEL = 1;
const DISCOUNT_PER_LEVEL = 0.05; // gear price removed by each level
const BOSS_EVERY_WAVES = 5;
const BOSS_HP_SCALE = 1.5; // boss health vs the soldiers a normal wave would take to win
const BOSS_PRESSURE = 0.1; // enemies the boss brings per second, as a share of the wave's starting army
const BOSS_FIRST_ATTACK_SECONDS = 5;
const BOSS_ATTACK_SECONDS = 8; // time between rust attacks
const BOSS_WARNING_SECONDS = 1; // the boss glows for this long before it attacks
const BOSS_RUST_SHARE = 0.25; // share of working gears rusted by each attack
const BOSS_RUST_MAX_PER_ATTACK = 5; // keeps a big machine possible to repair by hand
const OVERDRIVE_MULTIPLIER = 3; // main gear speed while overdrive is on
const OVERDRIVE_BASE_SECONDS = 5;
const OVERDRIVE_COOLDOWN_SECONDS = 30;
const OVERDRIVE_START_COOLDOWN_SECONDS = 20; // ready from the first second, it wins wave 1 with no gears bought
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
const WAVE_START_SCALE = 1.55; // how much bigger both armies start each wave
const DRIVER_PALETTE = { light: "#dfe5ea", mid: "#8d99a6", dark: "#3f4a55", recess: "#6d7884", hub: "#c3ccd5" };

const GEAR_PALETTE = { light: "#f3d98a", mid: "#c99a35", dark: "#7a5716", recess: "#a97f28", hub: "#f6e6ae" };
const BIG_PALETTE = { light: "#a9d4ff", mid: "#4f8fd0", dark: "#1f4a7a", recess: "#3a74b0", hub: "#d8ecff" };
const BOOSTER_PALETTE = { light: "#c8f59a", mid: "#6fb83f", dark: "#2f6d18", recess: "#559a2c", hub: "#e4fbc9" };
const RUST_PALETTE = { light: "#a58a78", mid: "#6e5343", dark: "#33241b", recess: "#594234", hub: "#c9b3a3" };
const BOMB_PALETTE = { light: "#ffb3a0", mid: "#cf5238", dark: "#6e1f10", recess: "#ad3f28", hub: "#ffe0d6" };

// hits: how many hits fill the gear (0 means it never fills). A full gear
// sends `soldiers` or blasts `enemies`. A booster gives the gears touching it
// one extra hit each time they are hit.
const GEAR_TYPES = {
  soldier: { hits: 4, soldiers: 1, palette: GEAR_PALETTE },
  big: { hits: 8, soldiers: 5, palette: BIG_PALETTE },
  booster: { hits: 0, palette: BOOSTER_PALETTE },
  bomb: { hits: 8, enemies: 2, palette: BOMB_PALETTE },
};

const DRIVER_SPEED_REWARD = 0.1; // turns per second added by the reward
const VETERANS_REWARD = 0.15; // added to the player's lead each wave
const VETERANS_MAX_LEAD = 1.7; // stays well under the lead that wins a wave outright
const DISCOUNT_REWARD = 0.8; // gear price multiplier
const REWARD_CLICK_DELAY_MS = 400; // ignores taps meant for the board when a choice or tip appears
const CHAIN_FALLOFF = 0.85; // strength kept by a hit at each gear it passes through
const CHAIN_MIN_POWER = 0.3; // a long chain never fades below this
const COMBO_LINE_PAYOUT = 1.25; // three matching gears in a row
const COMBO_BLOCK_FILL = 1.25; // four matching gears in a square
const COMBO_RING_BOOST = 2; // a booster with gears on all four sides
const BOSS_WALL_CELLS = 3; // empty cells blocked by each Wall Maker attack
const BOSS_SCRAMBLE_SWAPS = 3; // pairs of gears swapped by each Scrambler attack
const BOSS_SHIELD_TAPS = 5; // taps on the battle to break an Iron Guard shield
const BOSS_KINDS = [
  { id: "rust", name: "Rust King", color: "#8c1d10" },
  { id: "wall", name: "Wall Maker", color: "#5b4a8a" },
  { id: "scramble", name: "Scrambler", color: "#1d6e6a" },
  { id: "shield", name: "Iron Guard", color: "#59606b" },
];
const RALLY_FULL_SECONDS = 5; // how long to hold the army back to earn the charge bonus
const RALLY_BONUS = 1.5; // charge size after a full rally
const RALLY_CHARGE_START = 0.4; // charges start part-way along the march
const WAVE_EVENT_FIRST_WAVE = 3;
const WAVE_EVENT_CHANCE = 0.4;
const EVENT_RUSH_SHARE = 0.2; // extra enemies per second, as a share of the machine's best soldiers per second
const EVENT_STORM_SECONDS = 8; // time between rust attacks in a storm
// strength: how much one soldier of this rank counts for. trainCost: soldiers
// of the rank before it needed to reach this one.
const ARMY_RANKS = [
  { name: "Recruit", plural: "Recruits", strength: 1, look: "r0" },
  { name: "Knight", plural: "Knights", strength: 3, trainCost: 30, look: "r1" },
  { name: "Champion", plural: "Champions", strength: 9, trainCost: 100, look: "r2" },
  { name: "Hero", plural: "Heroes", strength: 27, trainCost: 300, look: "r3" },
];
// The enemy's rank only changes how its army looks and is counted.
const ENEMY_RANKS = [
  { plural: "Goblins", strength: 1, fromWave: 1, look: "e0" },
  { plural: "Orcs", strength: 3, fromWave: 8, look: "e1" },
  { plural: "Trolls", strength: 9, fromWave: 15, look: "e2" },
  { plural: "Demons", strength: 27, fromWave: 22, look: "e3" },
];
const MAX_GEAR_LEVEL = 5;
const LEVEL_PAYOUT_GROWTH = 2.5; // payout multiplier per level, so merging beats keeping two gears
const TIP_GAP_SECONDS = 18; // play time between tips that aren't urgent
const BUY_WARN_RATIO = 0.4; // warn when a purchase would leave the army's share below this
const MAX_SPECIAL_GEARS = 6; // rewards stop offering special gears at this many on the board
const REINFORCEMENTS_REWARD = 0.2; // added to the player's lead for one wave

// Permanent upgrades. `costs` has one price per level, so its length is the
// highest level.
const UPGRADES = [
  { id: "startGears", name: "Spare gears", text: "Start each run with 1 more gear", costs: [20, 60, 120] },
  { id: "recruits", name: "Recruits", text: "Start every wave with more soldiers", costs: [10, 20, 35, 50, 70] },
  { id: "bossBreaker", name: "Boss breaker", text: "Bosses have 10% less health and help", costs: [40, 90, 160] },
  { id: "speed", name: "Oiled main gear", text: "The one-tooth gear turns 5% faster", costs: [30, 60, 100, 150] },
  { id: "overdrive", name: "Long Overdrive", text: "Overdrive lasts 1 second longer", costs: [25, 60, 110] },
  { id: "discount", name: "Trade deal", text: "New gears cost 5% less", costs: [20, 45, 80, 120] },
  { id: "extraChoice", name: "Bigger crate", text: "Choose from 4 rewards after each wave", costs: [200] },
];

const REWARDS = [
  { name: "Big gear", text: "Fills half as fast, then sends 5 soldiers", gear: "big" },
  { name: "Booster gear", text: "Gears touching it get an extra 25% per hit", gear: "booster" },
  { name: "Bomb gear", text: "Fills half as fast, then blasts 2 enemies", gear: "bomb" },
  { name: "Faster main gear", text: "The one-tooth gear turns 10% faster", apply: () => { driverTurnsPerSec += DRIVER_SPEED_REWARD; } },
  { name: "Veterans", text: "Start every wave with more soldiers", apply: () => { waveLead += VETERANS_REWARD; }, available: () => waveLead + VETERANS_REWARD <= VETERANS_MAX_LEAD },
  { name: "Cheaper gears", text: "New gears cost 20% less", apply: () => { gearPriceScale *= DISCOUNT_REWARD; } },
  { name: "Reinforcements", text: "Start the next wave with extra soldiers", apply: () => { nextWaveBonus = REINFORCEMENTS_REWARD; } },
];

const WAVE_EVENTS = [
  { id: "rush", name: "Enemy rush" },
  { id: "storm", name: "Rust storm" },
  { id: "double", name: "Double soldiers" },
  { id: "blocked", name: "Blocked row", available: () => blockableRows().length > 0 },
];

// Shown once each, the first time `when` is true. Earlier entries go first.
// Tips wait their turn so they don't pile up, unless they're urgent.
const TIPS = [
  { id: "start", urgent: true, text: "The main gear turns by itself. Each hit fills the gear beside it, and at 100% that gear sends a soldier to fight.", when: () => waveTime > 0.2 },
  { id: "boss", urgent: true, text: "Boss wave! Soldiers and bombs hurt the boss. Empty its health bar to win.", when: () => boss },
  { id: "rust", urgent: true, text: "Rust! A rusted gear stops working and blocks the gears behind it. Tap it to fix it.", when: () => grid.flat().some((cell) => cell?.rusted) },
  { id: "buy", text: "You can afford a gear. It joins the machine by itself, and every connected gear fills on each hit. Buying costs soldiers, so choose your moment.", target: "#buy-gear-btn", when: () => canBuyGear() },
  { id: "line", text: "Soldiers push the line. Get your side of the bar to 70% to win the wave. If it falls to 30%, you lose.", when: () => totalArmyScore >= 1 && waveTime > 5 },
  { id: "overdrive", text: "Overdrive is ready! Tap it to spin the main gear 3x faster for a few seconds, then wait for it to recharge.", target: "#overdrive-btn", when: () => overdriveReady() },
  { id: "drag", text: "Drag a gear to move it. Drag it onto the red bar that appears to scrap it and get some soldiers back.", when: () => grid.flat().filter((cell) => cell && !cell.driver).length >= 4 },
  { id: "chain", text: "Hits fade as they pass along a chain, so far-away gears fill more slowly. A booster in the chain brings them back to full strength.", when: () => grid.flat().filter((cell) => cell && !cell.driver).length >= 5 },
  { id: "combo", text: "Combos! With merged or special gears: 3 matching in a row pay 25% more, a 2x2 square fills 25% faster, and a booster with gears on all 4 sides is twice as strong.", when: () => grid.flat().some((cell) => cell && !cell.driver && (cell.level > 1 || cell.type !== "soldier")) && grid.flat().filter((cell) => cell && !cell.driver).length >= 6 },
  { id: "bossShield", urgent: true, text: "The Iron Guard raises a shield that blocks all damage. Tap the battle area 5 times to break it.", when: () => boss?.shield > 0 },
  { id: "rally", text: "Rally holds your arriving soldiers back. After 5 seconds, tap again to charge with 50% more, but your line gets no help while you wait.", target: "#rally-btn", when: () => wave >= 2 },
  { id: "train", text: "You can train your army! Every new soldier becomes stronger, and prices count in soldiers of your new rank. Train or buy a gear? That choice is yours.", target: "#train-btn", when: () => canTrain() },
  { id: "merge", text: "Drag a gear onto a matching one to merge them into one stronger gear. Merging also frees up space.", when: () => grid.flat().filter((cell) => cell?.type === "soldier" && cell.level === 1).length >= 3 },
];

// The enemy's own army grows on its own the whole time, scaling up per
// wave and accelerating the longer a wave drags on. The board's payout
// rate is roughly steady, so this acceleration is what guarantees every
// wave ends: take it out and the two sides can settle into a balance where
// neither threshold is ever reached.
function isBossWave(forWave) {
  return forWave % BOSS_EVERY_WAVES === 0;
}

function enemyGrowthPerSec(wave, waveTime) {
  return ENEMY_BASE_GROWTH * Math.pow(ENEMY_WAVE_SCALE, wave - 1) * Math.pow(2, waveTime / ENEMY_DOUBLING_SECONDS);
}

// =====================================================================
// State
// =====================================================================

let boardCanvas, boardCtx, battleCanvas, battleCtx;
let boardCssW = 0, boardCssH = 0, cellSize = 0;
let battleCssW = 0, battleCssH = 0;

// grid[row][col] = { type, ticks, ticksAnim, spinTarget, spinAnim, flash, rusted } for a
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
let nextWaveBonus = 0; // extra lead for the next wave only
let tipOpenedAt = 0;
let openTip = null;
let lastTipAt = 0; // play time when the last tip appeared
let boss = null; // { kind, hp, maxHp, attackIn, hitFlash, reinforcePerSec, shield } during a boss wave
let bossesBeaten = 0;
let enemiesBlasted = 0;
let runTime = 0; // seconds played this run, not counting reward choices
let bestWaveBeforeRun = 1; // decides whether this run set a new record
let runBanked = false; // whether this run's coins have been paid out
let save = loadSave();
let armyRank = 0; // index into ARMY_RANKS
let rallying = false;
let rallyReserve = 0; // soldiers waiting for the charge
let rallyHeld = 0; // seconds held so far
let comboCounts = { line: 0, block: 0, ring: 0 };
let waveEvent = null; // the twist on this wave, from WAVE_EVENTS
let lastEventId = null; // so the same twist doesn't come twice in a row
let eventAttackIn = 0;
let eventReinforcePerSec = 0;
let blockedCells = new Set(); // "row,col" of empty cells no gear can use for now
let overdriveLeft = 0; // seconds of overdrive still running
let overdriveCooldown = 0; // seconds until overdrive can be used again

// Effects drawn over the whole game. They never change the outcome of a run.
let fxCanvas, fxCtx;
let fxCssW = 0, fxCssH = 0;
let boardOrigin = { x: 0, y: 0 }; // where the board canvas sits on the effects canvas
let flyTarget = { x: 0, y: 0 }; // where flying soldiers land in the battle lane
let flyers = []; // { fromX, fromY, side, t }
let particles = []; // { x, y, vx, vy, gravity, age, life, size, color, angle, spin }
let hitNumbers = []; // { x, y, text, color, age } floating up from the front line
let laneRect = { x: 0, y: 0, w: 0, h: 0 }; // where the battle lane sits on the effects canvas
let screenShake = 0; // pixels

let gameState = "title"; // "title" | "playing" | "choosing" | "tip" | "paused" | "gameover"
let wave = 1;
let waveTime = 0; // seconds since the current wave began
let playerPower = BASE_POWER;
let enemyPower = BASE_POWER;
let totalArmyScore = 0;
let bestWave = Number(localStorage.getItem("gearfight_best_wave") || 1);

// Saved data can be missing, damaged or blocked, and none of that should stop
// the game from starting.
function loadSave() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    return {
      coins: Math.max(0, Math.floor(Number(data?.coins)) || 0),
      upgrades: data?.upgrades && typeof data.upgrades === "object" ? data.upgrades : {},
      muted: data?.muted === true,
      tips: data?.tips && typeof data.tips === "object" ? data.tips : {},
    };
  } catch {
    return { coins: 0, upgrades: {}, muted: false, tips: {} };
  }
}

function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Without storage, progress simply lasts until the page closes.
  }
}

function upgradeLevel(id) {
  const upgrade = UPGRADES.find((u) => u.id === id);
  const level = Math.floor(Number(save.upgrades[id])) || 0;
  return Math.max(0, Math.min(upgrade.costs.length, level));
}

function freshCell(type = "soldier") {
  return { type, level: 1, ticks: 0, ticksAnim: 0, spinTarget: 0, spinAnim: 0, flash: 0 };
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
// to the gear that drives it, with the strength the hit still has when it gets
// there. Each gear appears once, by its shortest route, even when a loop gives
// it two. Rusted gears are stuck, so hits stop there. Empty when the
// cell has no working normal gear.
function connectedGears(row, col, firstSpin) {
  const first = grid[row]?.[col];
  if (!first || first.driver || first.rusted) return [];
  const seen = new Set([first]);
  const queue = [{ row, col, spin: firstSpin, power: 1 }];
  for (const cur of queue) {
    for (const [dr, dc] of TOOTH_DIRS) {
      const next = grid[cur.row + dr]?.[cur.col + dc];
      if (!next || next.driver || next.rusted || seen.has(next)) continue;
      seen.add(next);
      const power = grid[cur.row][cur.col].type === "booster" ? 1 : Math.max(CHAIN_MIN_POWER, cur.power * CHAIN_FALLOFF);
      queue.push({ row: cur.row + dr, col: cur.col + dc, spin: -cur.spin, power });
    }
  }
  return queue;
}

// One tooth hit: the gear being touched turns, and turns every gear connected to it.
function tickGear(row, col, driverSpin) {
  const gears = connectedGears(row, col, -driverSpin);
  if (!gears.length) return;
  for (const gear of gears) hitGear(gear, (1 + boostersTouching(gear.row, gear.col)) * gear.power);
  spawnToothSparks(row, col);
  playTickSound();
}

// Plain level 1 gears don't count, or any big machine would be full of combos
// without trying.
function comboMatch(a, b) {
  return Boolean(a) && Boolean(b) && !a.driver && !b.driver && !a.rusted && !b.rusted
    && a.type === b.type && a.level === b.level && (a.type !== "soldier" || a.level > 1);
}

// Marks every gear with the combos it is part of, and announces new ones.
function updateCombos() {
  const at = (r, c) => grid[r]?.[c];
  const counts = { line: 0, block: 0, ring: 0 };
  for (const cell of grid.flat()) {
    if (cell) {
      cell.comboLine = false;
      cell.comboBlock = false;
      cell.comboRing = false;
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = at(r, c);
      if (!cell) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const second = at(r + dr, c + dc);
        const third = at(r + dr * 2, c + dc * 2);
        if (comboMatch(cell, second) && comboMatch(cell, third)) {
          cell.comboLine = second.comboLine = third.comboLine = true;
          counts.line += 1;
        }
      }
      const right = at(r, c + 1);
      const below = at(r + 1, c);
      const corner = at(r + 1, c + 1);
      if (comboMatch(cell, right) && comboMatch(cell, below) && comboMatch(cell, corner)) {
        cell.comboBlock = right.comboBlock = below.comboBlock = corner.comboBlock = true;
        counts.block += 1;
      }
      if (cell.type === "booster" && !cell.rusted) {
        const sides = TOOTH_DIRS.map(([dr, dc]) => at(r + dr, c + dc));
        if (sides.every((side) => side && !side.driver && !side.rusted)) {
          cell.comboRing = true;
          counts.ring += 1;
        }
      }
    }
  }
  if (counts.ring > comboCounts.ring) showToast("Ring combo!");
  else if (counts.block > comboCounts.block) showToast("Square combo!");
  else if (counts.line > comboCounts.line) showToast("Line combo!");
  comboCounts = counts;
}

function boostersTouching(row, col) {
  let count = 0;
  for (const [dr, dc] of TOOTH_DIRS) {
    const other = grid[row + dr]?.[col + dc];
    if (other?.type === "booster" && !other.rusted) count += other.level * (other.comboRing ? COMBO_RING_BOOST : 1);
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
      const level = levelPayout(grid[gear.row][gear.col].level) * armyStrength();
      const cell = grid[gear.row][gear.col];
      const payout = ((spec.soldiers || 0) + (spec.enemies || 0) * soldiersPerEnemy) * level * (cell.comboLine ? COMBO_LINE_PAYOUT : 1);
      const fill = cell.comboBlock ? COMBO_BLOCK_FILL : 1;
      perTurn += ((1 + boostersTouching(gear.row, gear.col)) * gear.power * fill * payout) / spec.hits;
    }
  }
  return perTurn * driverTurnsPerSec;
}

// A full gear pays out and starts filling again, staying in place.
function hitGear(gear, hits) {
  const cell = grid[gear.row][gear.col];
  const spec = GEAR_TYPES[cell.type];
  cell.spinTarget += gear.spin;
  cell.flash = 1;
  if (!spec.hits) return;
  cell.ticks += hits * (cell.comboBlock ? COMBO_BLOCK_FILL : 1);
  while (cell.ticks >= spec.hits) {
    cell.ticks -= spec.hits;
    cell.ticksAnim = cell.ticks;
    const level = levelPayout(cell.level) * (cell.comboLine ? COMBO_LINE_PAYOUT : 1) * armyStrength();
    if (spec.soldiers) sendSoldiers(spec.soldiers * level, gear.row, gear.col);
    else launchBomb(spec.enemies * level, gear.row, gear.col);
  }
}

function armyStrength() {
  return ARMY_RANKS[armyRank].strength;
}

function enemyRank() {
  return [...ENEMY_RANKS].reverse().find((rank) => wave >= rank.fromWave);
}

function nextRank() {
  return ARMY_RANKS[armyRank + 1];
}

function canTrain() {
  return gameState === "playing" && Boolean(nextRank()) && soldiersShortFor(nextRank().trainCost) === 0;
}

function trainArmy() {
  if (!canTrain()) return;
  playerPower -= nextRank().trainCost * armyStrength();
  armyRank += 1;
  showWaveBanner(`${ARMY_RANKS[armyRank].plural}!`);
  spawnConfetti();
  playWinSound();
}

function updateTrainButton() {
  const button = document.getElementById("train-btn");
  const next = nextRank();
  let label = `${ARMY_RANKS[armyRank].plural} (top rank)`;
  if (next) {
    const short = soldiersShortFor(next.trainCost);
    label = short > 0 ? `Train ${next.name}: ${next.trainCost} (need ${short})` : `Train ${next.name}: ${next.trainCost}`;
  }
  if (button.textContent !== label) button.textContent = label;
  button.disabled = !canTrain();
  document.getElementById("rank-label").textContent = ARMY_RANKS[armyRank].plural;
}

function levelPayout(level) {
  return Math.round(Math.pow(LEVEL_PAYOUT_GROWTH, level - 1));
}

function canMerge(from, onto) {
  return Boolean(onto) && !onto.driver && from !== onto && from.type === onto.type
    && from.level === onto.level && from.level < MAX_GEAR_LEVEL;
}

// The gear on the target cell levels up and keeps its progress.
function mergeGears(fromRow, fromCol, toRow, toCol) {
  const target = grid[toRow][toCol];
  grid[fromRow][fromCol] = null;
  target.level += 1;
  target.rusted = false;
  target.flash = 1;
  spawnRustBurst(toRow, toCol, "#ffcc33", "#fff3c4");
  showToast(`Level ${target.level}!`);
  playClankSound();
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
      if (!cell) {
        if (!isBlocked(r, c)) return { row: r, col: c };
        continue;
      }
      if (!seen.has(cell)) {
        seen.add(cell);
        queue.push({ row: r, col: c });
      }
    }
  }
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!grid[row][col] && !isBlocked(row, col)) return { row, col };
    }
  }
  return null;
}

function isBlocked(row, col) {
  return blockedCells.has(`${row},${col}`);
}

function placeGear(type) {
  const { row, col } = bestEmptyCell();
  grid[row][col] = freshCell(type);
  grid[row][col].flash = 1;
}

// Soldiers are the price, so buying weakens the army. A purchase that would
// lose the game on the spot is refused rather than ending the run. Returns how
// many more soldiers the player needs for this one, or 0 when they can afford it.
function soldiersShortFor(soldiers) {
  const armyToKeep = (enemyPower * LOSE_RATIO) / (1 - LOSE_RATIO);
  const short = soldiers * armyStrength() + armyToKeep - playerPower;
  return short < 0 ? 0 : Math.floor(short / armyStrength()) + 1;
}

function soldiersShortForGear() {
  return soldiersShortFor(gearCost());
}

function canBuyGear() {
  return gameState === "playing" && Boolean(bestEmptyCell()) && soldiersShortForGear() === 0;
}

function buyIsRisky() {
  const left = playerPower - gearCost() * armyStrength();
  return canBuyGear() && left / (left + enemyPower) < BUY_WARN_RATIO;
}

function buyButtonLabel() {
  if (!bestEmptyCell()) return "Board full: scrap a gear";
  const label = `Buy gear: ${gearCost()} soldiers`;
  const short = soldiersShortForGear();
  if (short > 0) return `Buy gear: ${gearCost()} (need ${short})`;
  return buyIsRisky() ? `Buy gear: ${gearCost()} (risky!)` : label;
}

function updateBuyButton() {
  const button = document.getElementById("buy-gear-btn");
  const label = buyButtonLabel();
  if (button.textContent !== label) button.textContent = label;
  button.disabled = !canBuyGear();
  button.classList.toggle("risky", buyIsRisky());
}

function buyGear() {
  if (!canBuyGear()) return;
  playerPower -= gearCost() * armyStrength();
  gearsBought += 1;
  placeGear("soldier");
  playClankSound();
}

// Half the current price, which is always less than a gear just cost, so
// buying and scrapping can never make soldiers.
function scrapRefund() {
  return Math.floor(gearCost() / 2);
}

function scrapGear(row, col) {
  const refund = scrapRefund();
  grid[row][col] = null;
  playerPower += refund * armyStrength();
  spawnRustBurst(row, col);
  showToast(`Scrapped: +${refund}`);
  playClankSound();
}

function pointerOverScrapZone(e) {
  const r = document.getElementById("scrap-zone").getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

function updateScrapZone() {
  const zone = document.getElementById("scrap-zone");
  zone.classList.toggle("hidden", !drag);
  if (!drag) return;
  zone.classList.toggle("hover", Boolean(drag.overScrap));
  const label = `Drop here to scrap: +${scrapRefund()}`;
  if (zone.textContent !== label) zone.textContent = label;
}

function sendSoldiers(baseCount, row, col) {
  const count = waveEvent?.id === "double" ? baseCount * 2 : baseCount;
  launchFlyer(row, col, "player");
  sendMarcher("player", count, FLY_SECONDS);
  totalArmyScore += count / armyStrength();
  showToast(`+${Math.round(count / armyStrength())}`);
  playFireSound();
}

function launchBomb(enemies, row, col) {
  launchFlyer(row, col, "bomb");
  enemiesBlasted += enemies;
  sendMarcher("bomb", enemies, FLY_SECONDS);
  showToast(`-${enemies}`);
  playFireSound();
}

// A delay holds the marcher back while its soldier is still flying in.
function sendMarcher(side, value, delaySeconds = 0) {
  const team = marchers.filter((m) => m.side === side);
  if (team.length >= MAX_MARCHERS) team[team.length - 1].value += value;
  else marchers.push({ side, value, t: -delaySeconds / MARCH_SECONDS });
}

function bossWeakening() {
  return 1 - upgradeLevel("bossBreaker") * BOSS_BREAKER_PER_LEVEL;
}

function bossMaxHp(forWave) {
  const soldiersToWinPerEnemy = WIN_RATIO / (1 - WIN_RATIO) - waveLead;
  return waveStartEnemy(forWave) * soldiersToWinPerEnemy * BOSS_HP_SCALE * bossWeakening();
}

function damageBoss(amount) {
  if (!boss || boss.shield > 0) return;
  boss.hp = Math.max(0, boss.hp - amount);
  boss.hitFlash = 1;
}

function bossReinforcePerSec(enemyStart) {
  return enemyStart * BOSS_PRESSURE * bossWeakening();
}

function rustPerAttack(workingGears) {
  return Math.min(BOSS_RUST_MAX_PER_ATTACK, Math.ceil(workingGears * BOSS_RUST_SHARE));
}

// Every working gear the tooth can reach, so an attack always hurts the machine.
function rustTargets() {
  const targets = new Map();
  for (const [dr, dc] of TOOTH_DIRS) {
    for (const gear of connectedGears(DRIVER_ROW + dr, DRIVER_COL + dc, 1)) {
      targets.set(grid[gear.row][gear.col], gear);
    }
  }
  return [...targets.values()];
}

function rustAttack() {
  const targets = rustTargets();
  if (!targets.length) return;
  const count = rustPerAttack(targets.length);
  for (let i = 0; i < count; i++) {
    const [{ row, col }] = targets.splice(Math.floor(Math.random() * targets.length), 1);
    grid[row][col].rusted = true;
    if (drag?.cell === grid[row][col]) drag = null;
    spawnRustBurst(row, col);
  }
  screenShake = Math.max(screenShake, BOMB_SHAKE);
  showToast("Rust! Tap the gears");
  playRustSound();
}

function wallAttack() {
  const free = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!grid[row][col] && !isBlocked(row, col)) free.push({ row, col });
    }
  }
  if (!free.length) {
    rustAttack();
    return;
  }
  for (let i = 0; i < BOSS_WALL_CELLS && free.length; i++) {
    const [{ row, col }] = free.splice(Math.floor(Math.random() * free.length), 1);
    blockedCells.add(`${row},${col}`);
  }
  screenShake = Math.max(screenShake, BOMB_SHAKE);
  showToast("Cells blocked!");
  playRustSound();
}

// Gears only swap with each other, so the machine keeps its shape and stays
// connected: moving them onto empty cells could cut off most of the machine
// faster than anyone could drag it back.
function scrambleAttack() {
  const gears = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (grid[row][col] && !grid[row][col].driver) gears.push({ row, col });
    }
  }
  if (gears.length < 2) return;
  for (let i = 0; i < BOSS_SCRAMBLE_SWAPS; i++) {
    const a = gears[Math.floor(Math.random() * gears.length)];
    const b = gears[Math.floor(Math.random() * gears.length)];
    [grid[a.row][a.col], grid[b.row][b.col]] = [grid[b.row][b.col], grid[a.row][a.col]];
    spawnRustBurst(a.row, a.col, "#8fe7ff", "#1d6e6a");
    spawnRustBurst(b.row, b.col, "#8fe7ff", "#1d6e6a");
  }
  drag = null;
  screenShake = Math.max(screenShake, BOMB_SHAKE);
  showToast("Scrambled!");
  playRustSound();
}

function shieldAttack() {
  if (boss.shield > 0) return;
  boss.shield = BOSS_SHIELD_TAPS;
  showToast("Shield up! Tap the battle");
  playRustSound();
}

function bossAttack() {
  if (boss.kind.id === "wall") wallAttack();
  else if (boss.kind.id === "scramble") scrambleAttack();
  else if (boss.kind.id === "shield") shieldAttack();
  else rustAttack();
}

function tapShield() {
  if (gameState !== "playing" || !(boss?.shield > 0)) return;
  boss.shield -= 1;
  boss.hitFlash = 1;
  playClankSound();
  if (boss.shield === 0) showToast("Shield broken!");
}

function blockableRows() {
  const rows = [];
  for (let row = 0; row < ROWS; row++) {
    if (row !== DRIVER_ROW && grid[row].some((cell) => !cell)) rows.push(row);
  }
  return rows;
}

function startWaveEvent() {
  const options = WAVE_EVENTS.filter((e) => e.id !== lastEventId && (!e.available || e.available()));
  waveEvent = options[Math.floor(Math.random() * options.length)];
  lastEventId = waveEvent.id;
  eventAttackIn = EVENT_STORM_SECONDS;
  // Tied to the machine's output: each enemy takes about 2.3 soldiers to match
  // at WIN_RATIO, so this share slows a win down without making it impossible.
  eventReinforcePerSec = waveEvent.id === "rush" ? peakRate * EVENT_RUSH_SHARE : 0;
  if (waveEvent.id === "blocked") {
    const rows = blockableRows();
    const row = rows[Math.floor(Math.random() * rows.length)];
    for (let col = 0; col < COLS; col++) {
      if (!grid[row][col]) blockedCells.add(`${row},${col}`);
    }
  }
}

function updateWaveEvent(dt) {
  if (waveEvent?.id !== "storm") return;
  eventAttackIn -= dt;
  if (eventAttackIn <= 0) {
    eventAttackIn = EVENT_STORM_SECONDS;
    rustAttack();
  }
}

function updateBoss(dt) {
  if (!boss) return;
  boss.hitFlash = Math.max(0, boss.hitFlash - dt / 0.2);
  boss.attackIn -= dt;
  if (boss.attackIn <= 0) {
    boss.attackIn = BOSS_ATTACK_SECONDS;
    bossAttack();
  }
}

function toggleRally() {
  if (gameState !== "playing") return;
  if (!rallying) {
    rallying = true;
    rallyHeld = 0;
    return;
  }
  rallying = false;
  if (rallyReserve > 0) {
    const bonus = rallyHeld >= RALLY_FULL_SECONDS ? RALLY_BONUS : 1;
    marchers.push({ side: "player", value: rallyReserve * bonus, t: RALLY_CHARGE_START, charge: true });
    rallyReserve = 0;
    screenShake = Math.max(screenShake, BOMB_SHAKE);
    playBoomSound();
  }
}

function resetRally() {
  rallying = false;
  rallyReserve = 0;
  rallyHeld = 0;
}

function updateRallyButton() {
  const button = document.getElementById("rally-btn");
  const full = rallying && rallyHeld >= RALLY_FULL_SECONDS;
  const label = !rallying ? "Rally" : full ? `Charge! ${Math.round(rallyReserve * RALLY_BONUS)}` : `Charge ${Math.round(rallyReserve)}`;
  if (button.textContent !== label) button.textContent = label;
  button.disabled = gameState !== "playing";
  button.classList.toggle("holding", rallying);
  button.classList.toggle("full", full);
}

function overdriveSeconds() {
  return OVERDRIVE_BASE_SECONDS + upgradeLevel("overdrive") * OVERDRIVE_SECONDS_PER_LEVEL;
}

function overdriveReady() {
  return overdriveLeft <= 0 && overdriveCooldown <= 0;
}

function activateOverdrive() {
  if (gameState !== "playing" || !overdriveReady()) return;
  overdriveLeft = overdriveSeconds();
  playOverdriveSound();
}

function updateOverdrive(dt) {
  if (overdriveLeft > 0) {
    overdriveLeft -= dt;
    if (overdriveLeft <= 0) {
      overdriveLeft = 0;
      overdriveCooldown = OVERDRIVE_COOLDOWN_SECONDS;
    }
  } else if (overdriveCooldown > 0) {
    overdriveCooldown = Math.max(0, overdriveCooldown - dt);
  }
}

function updateOverdriveButton() {
  const button = document.getElementById("overdrive-btn");
  const seconds = Math.ceil(overdriveLeft > 0 ? overdriveLeft : overdriveCooldown);
  const label = overdriveReady() ? "Overdrive!" : `Overdrive ${seconds}s`;
  if (button.textContent !== label) button.textContent = label;
  button.disabled = !overdriveReady() || gameState !== "playing";
  button.classList.toggle("ready", overdriveReady());
  button.classList.toggle("active", overdriveLeft > 0);
  const charge = overdriveLeft > 0 ? overdriveLeft / overdriveSeconds() : 1 - overdriveCooldown / OVERDRIVE_COOLDOWN_SECONDS;
  button.style.setProperty("--charge", `${Math.round(charge * 100)}%`);
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
  return target && !target.cell?.driver && target.cell !== drag.cell && !isBlocked(target.row, target.col);
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
  if (drag) Object.assign(drag, boardPoint(e), { overScrap: pointerOverScrapZone(e) });
}

function onPointerUp(e) {
  if (!drag) return;
  if (pointerOverScrapZone(e)) {
    scrapGear(drag.row, drag.col);
    drag = null;
    return;
  }
  // Handling a rusted gear frees it, whether it was tapped or moved.
  if (drag.cell.rusted) {
    drag.cell.rusted = false;
    playClankSound();
  }
  const target = cellAt(boardPoint(e));
  if (target && canMerge(drag.cell, target.cell)) {
    mergeGears(drag.row, drag.col, target.row, target.col);
  } else if (canDropOn(target)) {
    grid[drag.row][drag.col] = target.cell;
    grid[target.row][target.col] = drag.cell;
    playClankSound();
  }
  drag = null;
}

function wireBoardInput() {
  boardCanvas.addEventListener("pointerdown", onPointerDown);
  battleCanvas.addEventListener("pointerdown", tapShield);
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
      const boost = overdriveLeft > 0 ? OVERDRIVE_MULTIPLIER : 1;
      cell.angle += driverTurnsPerSec * boost * Math.PI * 2 * dt;
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
    if (m.side === "player") {
      if (rallying && !m.charge) {
        rallyReserve += m.value;
      } else {
        playerPower += m.value;
        damageBoss(m.value);
      }
    }
    else if (m.side === "bomb") {
      enemyPower = Math.max(1, enemyPower - m.value);
      damageBoss((m.value * WIN_RATIO) / (1 - WIN_RATIO));
      screenShake = Math.max(screenShake, BOMB_SHAKE);
      playBoomSound();
    }
    else enemyPower += m.value;
    clashes.push({ t: 0 });
    spawnFrontLineHit(m);
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
  const bossBeaten = Boolean(boss);
  boss = null;
  for (const cell of grid.flat()) {
    if (cell) cell.rusted = false;
  }
  if (bossBeaten) {
    bossesBeaten += 1;
    // Beating a boss recharges Overdrive on top of the usual reward.
    overdriveLeft = 0;
    overdriveCooldown = 0;
  }
  wave += 1;
  waveTime = 0;
  marchers = [];
  enemyBacklog = 0;
  flyers = [];
  waveEvent = null;
  eventReinforcePerSec = 0;
  blockedCells.clear();
  resetRally();
  spawnConfetti();
  if (wave > bestWave) {
    bestWave = wave;
    localStorage.setItem("gearfight_best_wave", String(bestWave));
  }
  playWinSound();
  offerRewards(bossBeaten ? "Boss defeated!" : `Wave ${wave - 1} won!`);
}

// Reset the balance of power so the new wave starts contested. Carrying the
// player's total over would put them past WIN_RATIO straight away, and waves
// would then fall one after another with nothing happening. This runs after
// the reward is picked so the wave is sized for the machine it will face.
function startWave() {
  peakRate = Math.max(peakRate, soldiersPerSecond());
  enemyPower = waveStartEnemy(wave);
  playerPower = enemyPower * (waveLead + nextWaveBonus);
  nextWaveBonus = 0;
  if (isBossWave(wave)) {
    const hp = bossMaxHp(wave);
    const kind = BOSS_KINDS[(wave / BOSS_EVERY_WAVES - 1) % BOSS_KINDS.length];
    boss = { kind, hp, maxHp: hp, attackIn: BOSS_FIRST_ATTACK_SECONDS, hitFlash: 0, reinforcePerSec: bossReinforcePerSec(enemyPower), shield: 0 };
    playBossSound();
  } else if (wave >= WAVE_EVENT_FIRST_WAVE && Math.random() < WAVE_EVENT_CHANCE) {
    startWaveEvent();
  }
}

function boardHasGear(type) {
  return grid.flat().some((cell) => cell?.type === type);
}

// Free gears are limited so that most of a machine has to be bought.
function specialGearCap() {
  return MAX_SPECIAL_GEARS;
}

function canOfferSpecialGear() {
  const specials = grid.flat().filter((cell) => cell && !cell.driver && cell.type !== "soldier").length;
  return Boolean(bestEmptyCell()) && specials < specialGearCap();
}

// One special gear (while one can be offered) plus other rewards.
function pickRewards() {
  const open = REWARDS.filter((r) => (r.gear ? canOfferSpecialGear() : !r.available || r.available()));
  const shuffled = open.map((r) => [Math.random(), r]).sort((a, b) => a[0] - b[0]).map((pair) => pair[1]);
  const firstGear = shuffled.find((r) => r.gear);
  const rest = shuffled.filter((r) => r !== firstGear);
  return (firstGear ? [firstGear, ...rest] : rest).slice(0, 3 + upgradeLevel("extraChoice"));
}

function offerRewards(title) {
  gameState = "choosing";
  drag = null;
  rewardOpenedAt = performance.now();
  document.getElementById("reward-title").textContent = title;
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
  if (reward.gear) {
    placeGear(reward.gear);
    playClankSound();
  } else {
    reward.apply();
  }
  startWave();
  document.getElementById("reward-screen").classList.add("hidden");
  gameState = "playing";
  showWaveBanner(boss ? "Boss wave!" : waveEvent ? `${waveEvent.name}!` : `Wave ${wave}!`);
}

function coinsForRun() {
  return (wave - 1) * COINS_PER_WAVE + bossesBeaten * COINS_PER_BOSS;
}

// Pays out once per run, whether it ended in defeat or with Restart.
function bankRun() {
  if (runBanked) return 0;
  runBanked = true;
  const coins = coinsForRun();
  save.coins += coins;
  writeSave();
  return coins;
}

function formatTime(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function showRunSummary(coins) {
  document.getElementById("final-wave").textContent = wave;
  document.getElementById("new-record").classList.toggle("hidden", wave <= bestWaveBeforeRun);
  document.getElementById("stat-soldiers").textContent = Math.round(totalArmyScore);
  document.getElementById("stat-bosses").textContent = bossesBeaten;
  document.getElementById("stat-blasted").textContent = enemiesBlasted;
  document.getElementById("stat-time").textContent = formatTime(runTime);
  document.getElementById("coins-earned").textContent = `+${coins} coins`;
  document.getElementById("gameover-screen").classList.remove("hidden");
}

function pauseGame() {
  if (gameState !== "playing") return;
  gameState = "paused";
  drag = null;
  document.getElementById("pause-screen").classList.remove("hidden");
}

function resumeGame() {
  if (gameState !== "paused") return;
  gameState = "playing";
  document.getElementById("pause-screen").classList.add("hidden");
}

function maybeShowTip() {
  if (gameState !== "playing") return;
  const canWait = runTime - lastTipAt < TIP_GAP_SECONDS;
  const tip = TIPS.find((t) => !save.tips[t.id] && !(canWait && !t.urgent) && t.when());
  if (!tip) return;
  lastTipAt = runTime;
  gameState = "tip";
  drag = null;
  openTip = tip;
  tipOpenedAt = performance.now();
  document.getElementById("tip-text").textContent = tip.text;
  document.getElementById("tip-screen").classList.remove("hidden");
  if (tip.target) document.querySelector(tip.target).classList.add("tip-target");
}

function hideTip() {
  document.getElementById("tip-screen").classList.add("hidden");
  for (const el of document.querySelectorAll(".tip-target")) el.classList.remove("tip-target");
  openTip = null;
}

function closeTip() {
  if (!openTip || performance.now() - tipOpenedAt < REWARD_CLICK_DELAY_MS) return;
  save.tips[openTip.id] = true;
  writeSave();
  hideTip();
  gameState = "playing";
}

// Shows every tip again from the start of a new run.
function replayTips() {
  save.tips = {};
  writeSave();
  startNewRun();
}

function gameOver() {
  gameState = "gameover";
  drag = null;
  showRunSummary(bankRun());
  playLoseSound();
}

function update(dt) {
  if (gameState !== "playing") return;
  runTime += dt;
  updateCombos();
  updateOverdrive(dt);
  if (rallying) rallyHeld += dt;
  updateBoss(dt);
  updateWaveEvent(dt);
  updateDrivers(dt);
  updateGearAnim(dt);
  updateMarchers(dt);
  peakRate = Math.max(peakRate, soldiersPerSecond());

  waveTime += dt;
  enemyBacklog += (enemyGrowthPerSec(wave, waveTime) + (boss ? boss.reinforcePerSec : 0) + eventReinforcePerSec) * dt;
  const newEnemies = Math.floor(enemyBacklog);
  if (newEnemies > 0) {
    enemyBacklog -= newEnemies;
    sendMarcher("enemy", newEnemies);
  }
  const total = playerPower + enemyPower;
  const ratio = total > 0 ? playerPower / total : 0.5;
  const won = boss ? boss.hp <= 0 : ratio >= WIN_RATIO;
  if (won) winWave();
  else if (ratio <= LOSE_RATIO) gameOver();

  document.getElementById("wave-num").textContent = wave;
  document.getElementById("army-score").textContent = Math.round(totalArmyScore);
  updateBuyButton();
  updateOverdriveButton();
  updateRallyButton();
  updateTrainButton();
  maybeShowTip();
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

// Flat cartoon colour rather than shaded metal.
function metalGradient(ctx, r, palette) {
  return palette.mid;
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
  if (overdriveLeft > 0) {
    ctx.shadowColor = "#ff8a3d";
    ctx.shadowBlur = size * 0.45;
  }

  ctx.beginPath();
  ctx.moveTo(r * 0.9, -halfRoot);
  ctx.lineTo(size * 0.62, -halfTip);
  ctx.lineTo(size * 0.62, halfTip);
  ctx.lineTo(r * 0.9, halfRoot);
  ctx.closePath();
  ctx.fillStyle = DRIVER_PALETTE.mid;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = metalGradient(ctx, r, DRIVER_PALETTE);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  drawGearFace(ctx, r * 0.78, r * 0.3, DRIVER_PALETTE);
  ctx.restore();

  // The main gear is the hero of the machine, so it gets a happy face that
  // stays upright while it turns.
  drawCartoonEyes(ctx, cx - size * 0.02, cy - size * 0.05, size * 0.065, false);
  ctx.beginPath();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1.5, size * 0.03);
  ctx.lineCap = "round";
  ctx.arc(cx, cy + size * 0.06, size * 0.09, 0.25, Math.PI - 0.25);
  ctx.stroke();
}

function drawGearCell(ctx, cx, cy, size, cell) {
  const flashBoost = 1 + cell.flash * 0.06;
  const r = size * 0.48 * flashBoost;
  const spec = GEAR_TYPES[cell.type];
  const palette = cell.rusted ? RUST_PALETTE : spec.palette;

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
  ctx.lineWidth = Math.max(2, size * 0.045);
  ctx.lineJoin = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  drawGearFace(ctx, r * 0.72, r * 0.46, palette);
  ctx.restore();

  // A coloured ring marks gears that are part of a combo.
  if (cell.comboLine || cell.comboBlock || cell.comboRing) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, size * 0.04);
    ctx.strokeStyle = cell.comboRing ? "#c8f59a" : cell.comboBlock ? "#8fe7ff" : "#ffcc33";
    ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Progress ring — how close this gear is to sending a soldier. It stays
  // still while the body turns, so it always reads the same way.
  const progress = spec.hits && !cell.rusted ? Math.max(0, Math.min(1, cell.ticksAnim / spec.hits)) : 0;
  if (progress > 0) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, size * 0.05);
    ctx.strokeStyle = "#fffbe6";
    ctx.lineCap = "round";
    const start = -Math.PI / 2;
    ctx.arc(cx, cy, r * 0.6, start, start + progress * Math.PI * 2);
    ctx.stroke();
  }

  if (cell.rusted) {
    ctx.fillStyle = "#2a1b08";
    ctx.font = `800 ${Math.round(r * 0.34)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("TAP", cx, cy + 1);
    return;
  }
  if (!spec.hits) {
    drawBolt(ctx, cx, cy, r * 0.34, palette.dark);
    drawLevelMark(ctx, cx, cy, r, cell.level);
    return;
  }
  ctx.fillStyle = "#2a1b08";
  ctx.font = `800 ${Math.round(r * 0.34)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round((cell.ticks / spec.hits) * 100)}%`, cx, cy + 1);

  const payout = levelPayout(cell.level);
  const badge = spec.enemies ? `-${spec.enemies * payout}` : spec.soldiers * payout > 1 ? `x${spec.soldiers * payout}` : "";
  if (badge) {
    roundRectFill(ctx, cx - r * 0.38, cy + r * 0.52, r * 0.76, r * 0.4, r * 0.15, palette.dark);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${Math.round(r * 0.3)}px system-ui, sans-serif`;
    ctx.fillText(badge, cx, cy + r * 0.73);
  }
  drawLevelMark(ctx, cx, cy, r, cell.level);
}

// A pill on top of the gear showing its merge level.
function drawLevelMark(ctx, cx, cy, r, level) {
  if (level <= 1) return;
  roundRectFill(ctx, cx - r * 0.3, cy - r * 0.92, r * 0.6, r * 0.38, r * 0.15, "#2a1b08");
  ctx.fillStyle = "#ffcc33";
  ctx.font = `800 ${Math.round(r * 0.28)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`L${level}`, cx, cy - r * 0.72);
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
      if (grid[row][col]?.type !== "booster" || grid[row][col].rusted) continue;
      for (const [dr, dc] of TOOTH_DIRS) {
        const other = grid[row + dr]?.[col + dc];
        if (!other || other.driver || other.rusted) continue;
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
  ctx.fillStyle = "rgba(70, 40, 15, 0.35)";
  ctx.fill();
}

// While a gear is held, fades the gears it can't merge with and rings the ones
// it can, so matches are easy to spot on a busy board.
function drawMergeHints(ctx) {
  const pulse = REDUCED_MOTION ? 0.5 : 0.5 + Math.sin(performance.now() / 130) * 0.5;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell || cell.driver || cell === drag.cell) continue;
      const cx = col * cellSize + cellSize / 2;
      const cy = row * cellSize + cellSize / 2;
      ctx.beginPath();
      if (canMerge(drag.cell, cell)) {
        ctx.arc(cx, cy, cellSize * (0.47 + pulse * 0.04), 0, Math.PI * 2);
        ctx.lineWidth = Math.max(3, cellSize * 0.07);
        ctx.strokeStyle = "#7dff5a";
        ctx.shadowColor = "#7dff5a";
        ctx.shadowBlur = cellSize * 0.25;
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        ctx.arc(cx, cy, cellSize * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(40, 22, 8, 0.55)";
        ctx.fill();
      }
    }
  }
}

// A cartoon wooden workbench under the gears.
function drawWoodBoard(ctx) {
  roundRectFill(ctx, 0, 0, boardCssW, boardCssH, 14, "#a9743f");
  ctx.strokeStyle = "#8a5a2c";
  ctx.lineWidth = 2;
  for (let row = 1; row < ROWS; row++) {
    ctx.beginPath();
    ctx.moveTo(4, row * cellSize);
    ctx.lineTo(boardCssW - 4, row * cellSize);
    ctx.stroke();
  }
  ctx.fillStyle = "#6d4520";
  for (const [x, y] of [[9, 9], [boardCssW - 9, 9], [9, boardCssH - 9], [boardCssW - 9, boardCssH - 9]]) {
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBlockedCell(ctx, cx, cy, size) {
  const half = size * 0.2;
  ctx.lineWidth = Math.max(2, size * 0.05);
  ctx.strokeStyle = "rgba(216, 67, 47, 0.75)";
  ctx.beginPath();
  ctx.moveTo(cx - half, cy - half);
  ctx.lineTo(cx + half, cy + half);
  ctx.moveTo(cx + half, cy - half);
  ctx.lineTo(cx - half, cy + half);
  ctx.stroke();
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
  drawWoodBoard(ctx);

  // The one-tooth gear goes on top so its tooth overlaps the gears it touches.
  for (const drawDrivers of [false, true]) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = grid[row][col];
        const cx = col * cellSize + cellSize / 2;
        const cy = row * cellSize + cellSize / 2;
        if (!cell) {
          if (!drawDrivers) {
            if (isBlocked(row, col)) drawBlockedCell(ctx, cx, cy, cellSize);
            else drawEmptyCell(ctx, cx, cy, cellSize);
          }
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
    drawMergeHints(ctx);
    const target = cellAt(drag);
    if (canDropOn(target)) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = canMerge(drag.cell, target.cell) ? "#8bd65a" : "#ffcc33";
      ctx.strokeRect(target.col * cellSize + 3, target.row * cellSize + 3, cellSize - 6, cellSize - 6);
    }
    drawGearCell(ctx, drag.x, drag.y, cellSize * 1.12, drag.cell);
  }
}

const SOLDIER_LOOKS = {
  r0: { tunic: "#3a7ddb", trim: "#1f4a7a", skin: "#f3d5b0", helmet: "#c3ccd5", blade: "#eef2f5", size: 1 },
  r1: { tunic: "#8d99a6", trim: "#3f4a55", skin: "#f3d5b0", helmet: "#dfe5ea", blade: "#ffffff", plume: "#3a7ddb", size: 1.12 },
  r2: { tunic: "#e0a92e", trim: "#7a5716", skin: "#f3d5b0", helmet: "#ffe28a", blade: "#ffffff", plume: "#d8432f", cape: "#b5261a", size: 1.25 },
  r3: { tunic: "#fff0b8", trim: "#b98a1e", skin: "#f3d5b0", helmet: "#ffffff", blade: "#8fe7ff", plume: "#8fe7ff", cape: "#3a7ddb", glow: "#ffe28a", size: 1.4 },
  charge: { tunic: "#ffcc33", trim: "#a06d10", skin: "#f3d5b0", helmet: "#fff3c4", blade: "#ffffff", size: 1.1 },
  e0: { tunic: "#a32a1c", trim: "#5e140a", skin: "#7fa84a", horns: "#2f2410", blade: "#6e4a24", size: 1 },
  e1: { tunic: "#5a3a20", trim: "#2a1b08", skin: "#4f7a33", horns: "#e8dcc0", blade: "#8d99a6", size: 1.15 },
  e2: { tunic: "#4a5560", trim: "#262c33", skin: "#7a93a3", horns: "#d7dfe6", blade: "#59402a", size: 1.3 },
  e3: { tunic: "#2a1020", trim: "#120610", skin: "#c2362a", horns: "#1c0a06", blade: "#ff8a3d", glow: "#ff5a2a", size: 1.42 },
};

const OUTLINE = "#22150b";

function battleArtScale() {
  return Math.max(0.85, Math.min(1.2, battleCssH / 92));
}

// Fills and outlines the current path, the look everything cartoon here shares.
function inked(ctx, fill, width = 1.4) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function inkedCircle(ctx, x, y, r, fill, width) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  inked(ctx, fill, width);
}

// Big round eyes looking the way the character faces.
function drawCartoonEyes(ctx, x, y, size, angry) {
  for (const offset of [-size * 1.05, size * 1.05]) {
    ctx.beginPath();
    ctx.ellipse(x + offset, y, size * 0.85, size, 0, 0, Math.PI * 2);
    inked(ctx, "#ffffff", 0.8);
    ctx.beginPath();
    ctx.fillStyle = OUTLINE;
    ctx.arc(x + offset + size * 0.3, y + size * 0.1, size * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  if (angry) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = size * 0.55;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * size * 2, y - size * 1.5);
      ctx.lineTo(x + side * size * 0.3, y - size * 0.8);
      ctx.stroke();
    }
  }
}

// A chunky cartoon soldier standing on `feetY`, facing +1 (right) or -1 (left).
// state: "idle" bounces, "walk" moves its legs, "fight" swings its weapon.
// `seed` keeps a crowd from moving in step.
function drawSoldier(ctx, x, feetY, facing, look, state, seed) {
  const colors = SOLDIER_LOOKS[look];
  const time = performance.now() / 1000 + seed * 0.37;
  const stride = state === "walk" ? Math.sin(time * 14) * 2.6 : 0;
  const hop = state === "walk" ? Math.abs(Math.sin(time * 14)) * 1.6 : 0;
  // Squash and stretch: a soft bounce that makes them feel alive.
  const squash = state === "idle" ? Math.sin(time * 3) * 0.04 : state === "fight" ? Math.sin(time * 11) * 0.06 : 0;
  const swing = state === "fight" ? -0.5 + Math.sin(time * 11) * 1.1 : state === "walk" ? -0.3 + Math.sin(time * 14) * 0.3 : -0.5;
  const scale = colors.size * battleArtScale();
  ctx.save();
  ctx.translate(x, feetY - hop);
  ctx.scale(facing * scale * (1 - squash), scale * (1 + squash));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (colors.glow) {
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 8;
  }
  if (colors.cape) {
    ctx.beginPath();
    ctx.moveTo(-3, -15);
    ctx.quadraticCurveTo(-11 - Math.abs(stride), -8, -8 - Math.abs(stride), -2);
    ctx.lineTo(-1, -5);
    ctx.closePath();
    inked(ctx, colors.cape);
  }

  // Boots.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 2.6 + side * stride, -1.6, 2.8, 1.9, 0, 0, Math.PI * 2);
    inked(ctx, colors.trim);
  }

  // Round body.
  ctx.beginPath();
  ctx.ellipse(0, -8, 5.8, 6, 0, 0, Math.PI * 2);
  inked(ctx, colors.tunic);

  // Weapon arm.
  ctx.save();
  ctx.translate(4.2, -9);
  ctx.rotate(swing);
  ctx.beginPath();
  if (colors.horns) {
    // A knobbly club.
    ctx.moveTo(3, 1.2);
    ctx.lineTo(4.4, -6);
    ctx.quadraticCurveTo(7, -12, 3.4, -12.5);
    ctx.quadraticCurveTo(0.4, -12, 2, -6);
    ctx.lineTo(1.6, 1);
  } else {
    // A big toy sword.
    ctx.moveTo(1.8, 0);
    ctx.lineTo(1.4, -11);
    ctx.lineTo(3.2, -14);
    ctx.lineTo(5, -11);
    ctx.lineTo(4.4, 0);
  }
  ctx.closePath();
  inked(ctx, colors.blade);
  if (!colors.horns) {
    ctx.beginPath();
    ctx.rect(0.4, -1.5, 5.6, 2.2);
    inked(ctx, colors.trim, 1);
  }
  inkedCircle(ctx, 3, 1, 2.3, colors.skin, 1.1);
  ctx.restore();

  // Big head.
  const headY = -19;
  if (colors.horns) {
    // Pointed ears behind the head.
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 5, headY - 2);
      ctx.lineTo(side * 11, headY - 4);
      ctx.lineTo(side * 5.5, headY + 2.5);
      ctx.closePath();
      inked(ctx, colors.skin);
    }
  }
  inkedCircle(ctx, 0, headY, 7.6, colors.skin);
  drawCartoonEyes(ctx, 1.6, headY - 0.4, 2.2, Boolean(colors.horns));

  if (colors.helmet) {
    // Helmet with a little crest.
    ctx.beginPath();
    ctx.arc(0, headY - 1, 8, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(0, headY - 3.4, -8, headY - 1);
    ctx.closePath();
    inked(ctx, colors.helmet);
    if (colors.plume) {
      ctx.beginPath();
      ctx.moveTo(-1.6, headY - 8.4);
      ctx.quadraticCurveTo(-7, headY - 14, -9.4, headY - 7);
      ctx.quadraticCurveTo(-5, headY - 9.4, 1.4, headY - 8);
      ctx.closePath();
      inked(ctx, colors.plume, 1.1);
    }
    // Smile.
    ctx.beginPath();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.arc(2, headY + 2.6, 2, 0.2, Math.PI - 0.2);
    ctx.stroke();
    // Round shield.
    inkedCircle(ctx, -4.8, -8, 4.4, colors.helmet, 1.2);
    inkedCircle(ctx, -4.8, -8, 1.8, colors.trim, 0.8);
  } else {
    // Toothy grin.
    ctx.beginPath();
    ctx.moveTo(-1.5, headY + 3);
    ctx.quadraticCurveTo(2.2, headY + 5.6, 6, headY + 2.6);
    ctx.closePath();
    inked(ctx, "#fff7e0", 0.9);
    // Horns.
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 2, headY - 6.6);
      ctx.quadraticCurveTo(side * 5, headY - 12, side * 5.6, headY - 12.6);
      ctx.lineTo(side * 6, headY - 5.4);
      ctx.closePath();
      inked(ctx, colors.horns, 1.1);
    }
  }
  ctx.restore();
}

function drawBombIcon(ctx, x, y) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 4, y - 6);
  ctx.quadraticCurveTo(x + 7, y - 11, x + 10, y - 9);
  ctx.stroke();
  inkedCircle(ctx, x, y, 7.5, "#3a3a44", 1.6);
  ctx.beginPath();
  ctx.fillStyle = "#ffffff";
  ctx.ellipse(x - 2.6, y - 2.8, 1.8, 2.6, 0.6, 0, Math.PI * 2);
  ctx.fill();
  const flicker = 2.6 + Math.sin(performance.now() / 50);
  inkedCircle(ctx, x + 10.5, y - 9.5, flicker, "#ffcc33", 1);
  ctx.restore();
}

// Each army is shown as one big fighter at the front line, its size growing a
// little with rank. The number above says how many soldiers it stands for.
function drawArmyFighter(ctx, x, feetY, look, facing) {
  const scale = 1.3 * (1 + (SOLDIER_LOOKS[look].size - 1) * 0.4) / SOLDIER_LOOKS[look].size;
  ctx.save();
  ctx.translate(x, feetY);
  ctx.scale(scale, scale);
  drawSoldier(ctx, 0, 0, facing, look, "fight", facing);
  ctx.restore();
}

function drawArmyCount(ctx, x, y, count) {
  ctx.font = "800 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  drawLaneText(ctx, String(count), x, y);
}

// The boss stands just past the front line, glowing before each attack, and
// flashes when soldiers hit it.
function drawBoss(ctx, markerX, x1, feetY) {
  const x = Math.min(x1 - 22, markerX + 32);
  const warning = boss.attackIn < BOSS_WARNING_SECONDS;
  const time = performance.now() / 1000;
  const body = boss.hitFlash > 0 ? "#ffffff" : boss.kind.color;
  const armSwing = warning ? -1.7 + Math.sin(time * 18) * 0.15 : -0.5 + Math.sin(time * 4) * 0.4;
  const breathe = Math.sin(time * 3) * 0.03;
  ctx.save();
  ctx.translate(x, feetY);
  ctx.scale(1 - breathe, 1 + breathe + (warning ? 0.05 : 0));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (warning) {
    ctx.shadowColor = "#ff3b1f";
    ctx.shadowBlur = 16;
  }

  // Stubby feet.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 8, -3, 6.5, 3.6, 0, 0, Math.PI * 2);
    inked(ctx, "#3d2a18", 1.8);
  }

  // Weapon arm, raised before an attack.
  ctx.save();
  ctx.translate(-16, -23);
  ctx.rotate(armSwing);
  ctx.beginPath();
  ctx.rect(-10.5, -17, 3.4, 18);
  inked(ctx, "#7a5430", 1.6);
  ctx.beginPath();
  ctx.ellipse(-8.8, -21, 8, 6, 0, 0, Math.PI * 2);
  inked(ctx, boss.kind.id === "shield" ? "#c3ccd5" : "#8a5f36", 1.8);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-8.8, 0);
  ctx.lineWidth = 8;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.strokeStyle = body;
  ctx.stroke();
  ctx.restore();

  // One big round monster.
  ctx.beginPath();
  ctx.ellipse(0, -22, 18, 20, 0, 0, Math.PI * 2);
  inked(ctx, body, 2.2);
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
  ctx.ellipse(-6, -32, 5, 7, 0.5, 0, Math.PI * 2);
  ctx.fill();

  drawCartoonEyes(ctx, -3, -27, 4.6, true);

  // Wide toothy mouth, pointing at the player's army.
  ctx.beginPath();
  ctx.moveTo(-13, -16);
  ctx.quadraticCurveTo(-3, -8, 8, -16);
  ctx.closePath();
  inked(ctx, "#3a0d06", 1.6);
  ctx.fillStyle = "#fff7e0";
  for (const toothX of [-10, -4, 2]) {
    ctx.beginPath();
    ctx.moveTo(toothX, -15.6);
    ctx.lineTo(toothX + 2, -12);
    ctx.lineTo(toothX + 4, -15.8);
    ctx.closePath();
    ctx.fill();
  }

  // Each kind of boss has its own headgear.
  if (boss.kind.id === "rust") {
    ctx.beginPath();
    ctx.moveTo(-10, -40);
    ctx.lineTo(-11, -50);
    ctx.lineTo(-5, -45);
    ctx.lineTo(0, -52);
    ctx.lineTo(5, -45);
    ctx.lineTo(11, -50);
    ctx.lineTo(10, -40);
    ctx.closePath();
    inked(ctx, "#f2c23e", 1.8);
  } else if (boss.kind.id === "wall") {
    for (const [bx, by] of [[-11, -46], [-1, -46], [-6, -51]]) {
      ctx.beginPath();
      ctx.rect(bx, by, 11, 6);
      inked(ctx, "#c98560", 1.5);
    }
  } else if (boss.kind.id === "scramble") {
    ctx.save();
    ctx.translate(0, -47);
    ctx.rotate(time * 4);
    traceToothedRim(ctx, 8.5, 6, 8);
    inked(ctx, "#8fe7ff", 1.6);
    inkedCircle(ctx, 0, 0, 2.4, "#1d6e6a", 1.2);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(0, -35, 15, Math.PI * 1.08, Math.PI * 1.92);
    ctx.closePath();
    inked(ctx, "#c3ccd5", 1.8);
  }
  ctx.restore();
  if (boss.shield > 0) {
    const y = feetY - 25;
    ctx.beginPath();
    ctx.fillStyle = "rgba(10, 40, 60, 0.8)";
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#8fe7ff";
    ctx.stroke();
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.fillStyle = "#d8f6ff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`TAP ${boss.shield}`, x, y);
  }
}

function drawBossBar(ctx, x0, x1) {
  const barX = x0 + 36;
  const barW = x1 - x0 - 72;
  roundRectFill(ctx, barX, 4, barW, 12, 6, "#1c130a");
  roundRectFill(ctx, barX, 4, barW * (boss.hp / boss.maxHp), 12, 6, "#d8432f");
  ctx.font = "800 10px system-ui, sans-serif";
  const label = `${boss.kind.name.toUpperCase()} ${Math.ceil(boss.hp)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#1c130a";
  ctx.strokeText(label, barX + barW / 2, 10.5);
  ctx.fillStyle = "#fdf6e8";
  ctx.fillText(label, barX + barW / 2, 10.5);
}

// A sunny cartoon battlefield, with a banner at each army's camp.
function drawBattlefield(ctx, x0, x1, groundY) {
  const w = battleCssW;
  const h = battleCssH;
  const time = performance.now() / 1000;
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, "#58b8ee");
  sky.addColorStop(1, "#c6ecfb");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, groundY);

  // Fluffy clouds drifting by.
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  for (const [speed, start, y, r] of [[5, 0.15, 0.2, 7], [3, 0.55, 0.28, 9], [4, 0.85, 0.14, 6]]) {
    const cx = ((start * w + time * speed) % (w + 60)) - 30;
    for (const [dx, dy, size] of [[-r, 0, 0.8], [0, -r * 0.4, 1], [r, 0, 0.8]]) {
      ctx.beginPath();
      ctx.arc(cx + dx, y * h + dy, r * size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Round green hills.
  for (const [color, baseUp, bumps, phase] of [["#8ed36a", 15, 3, 0.4], ["#6fbf4e", 8, 4, 1.8]]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    for (let i = 0; i <= 40; i++) {
      const px = (w * i) / 40;
      ctx.lineTo(px, groundY - baseUp - Math.abs(Math.sin((i / 40) * Math.PI * bumps + phase)) * 12);
    }
    ctx.lineTo(w, groundY);
    ctx.closePath();
    ctx.fill();
  }

  // Grass in front.
  ctx.fillStyle = "#57a63a";
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.fillStyle = "#4a9231";
  ctx.fillRect(0, groundY + 8, w, h - groundY - 8);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();

  const flap = Math.sin(time * 4) * 2.5;
  for (const [x, color, dir] of [[x0 - 8, "#3a7ddb", 1], [x1 + 8, "#d8432f", -1]]) {
    ctx.beginPath();
    ctx.rect(x - 1.2, groundY - 28, 2.4, 30);
    inked(ctx, "#8a5f36", 1);
    ctx.beginPath();
    ctx.moveTo(x, groundY - 28);
    ctx.quadraticCurveTo(x + dir * 7, groundY - 26 + flap, x + dir * 13, groundY - 23 + flap);
    ctx.lineTo(x, groundY - 17);
    ctx.closePath();
    inked(ctx, color, 1.2);
  }
}

// White text with a dark edge, readable on the bright sky.
function drawLaneText(ctx, text, x, y) {
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
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
  const groundY = battleCssH * 0.62;

  drawBattlefield(ctx, x0, x1, groundY);

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

  const playerX = Math.max(x0 + 12, markerX - 20);
  const enemyX = Math.min(x1 - 12, markerX + 20);
  drawArmyFighter(ctx, playerX, groundY, ARMY_RANKS[armyRank].look, 1);
  if (!boss) drawArmyFighter(ctx, enemyX, groundY, enemyRank().look, -1);

  // Soldiers on their way, on a row of their own so they stand out from the
  // armies already at the front.
  for (const m of marchers) {
    if (m.t < 0) continue;
    const x = m.side === "enemy" ? x1 - (x1 - markerX) * m.t : x0 + (markerX - x0) * m.t;
    const feetY = battleCssH * 0.72;
    if (m.side === "bomb") drawBombIcon(ctx, x, feetY - 8);
    else if (m.charge) {
      for (const offset of [-14, 0, 14]) drawSoldier(ctx, x + offset, feetY, 1, "charge", "walk", offset);
    } else {
      const facing = m.side === "player" ? 1 : -1;
      drawSoldier(ctx, x, feetY, facing, m.side === "player" ? ARMY_RANKS[armyRank].look : enemyRank().look, "walk", m.t * 40);
    }
    const headCount = Math.round(m.value / (m.side === "enemy" ? enemyRank().strength : armyStrength()));
    if (headCount >= 2 && m.side !== "bomb") {
      ctx.font = "800 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#1c130a";
      ctx.strokeText(headCount, x, feetY - 29);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(headCount, x, feetY - 29);
    }
  }
  if (boss) drawBoss(ctx, markerX, x1, battleCssH * 0.75);
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
  // Counted in soldiers of each army's rank, so numbers stay small as ranks rise.
  // During a boss fight the enemy's number sits over the boss, below its health bar.
  const countY = boss ? 25 : 13;
  drawArmyCount(ctx, playerX, countY, Math.round(playerPower / armyStrength()));
  drawArmyCount(ctx, boss ? Math.min(x1 - 22, markerX + 30) : enemyX, countY, Math.round(enemyPower / enemyRank().strength));
  ctx.font = "800 12px system-ui, sans-serif";
  ctx.fillStyle = "#ffcc33";
  ctx.textBaseline = "alphabetic";
  if (rallying) {
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.fillStyle = "#ffcc33";
    ctx.textAlign = "left";
    drawLaneText(ctx, `RALLY ${Math.round(rallyReserve)}`, x0, battleCssH * 0.74);
  }
  if (boss) drawBossBar(ctx, x0, x1);
  else if (waveEvent) {
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.fillStyle = "#ffcc33";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    drawLaneText(ctx, waveEvent.name.toUpperCase(), battleCssW / 2, battleCssH - 5);
  }
}

// =====================================================================
// Effects — soldiers flying out of gears, sparks, confetti, screen shake
// =====================================================================

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function spawnParticle(particle) {
  if (particles.length < MAX_PARTICLES) particles.push({ age: 0, angle: 0, spin: 0, gravity: 0, ...particle });
}

function launchFlyer(row, col, side) {
  if (flyers.length >= MAX_FLYERS) return;
  flyers.push({
    fromX: boardOrigin.x + (col + 0.5) * cellSize,
    fromY: boardOrigin.y + (row + 0.5) * cellSize,
    side,
    t: 0,
  });
}

// Sparks where the tooth meets the gear it just hit.
function spawnToothSparks(row, col) {
  const x = boardOrigin.x + ((col + DRIVER_COL) / 2 + 0.5) * cellSize;
  const y = boardOrigin.y + ((row + DRIVER_ROW) / 2 + 0.5) * cellSize;
  for (let i = 0; i < 6; i++) {
    const angle = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(40, 170);
    spawnParticle({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: 320,
      life: randomBetween(0.15, 0.35),
      size: randomBetween(1.5, 3),
      color: i % 2 ? "#ffcc33" : "#fff3c4",
    });
  }
}

function spawnRustBurst(row, col, colorA = "#a4552a", colorB = "#6e3a1c") {
  const x = boardOrigin.x + (col + 0.5) * cellSize;
  const y = boardOrigin.y + (row + 0.5) * cellSize;
  for (let i = 0; i < 18; i++) {
    const angle = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(30, 130);
    spawnParticle({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: 120,
      life: randomBetween(0.3, 0.7),
      size: randomBetween(2, 5),
      color: i % 2 ? colorA : colorB,
    });
  }
}

// Sparks and a floating number where a soldier or bomb reached the front line.
function spawnFrontLineHit(marcher) {
  const total = playerPower + enemyPower;
  const ratio = total > 0 ? playerPower / total : 0.5;
  const x = laneRect.x + 16 + (laneRect.w - 32) * ratio;
  const y = laneRect.y + laneRect.h * 0.5;
  const isEnemy = marcher.side === "enemy";
  for (let i = 0; i < 5; i++) {
    spawnParticle({
      x,
      y,
      vx: randomBetween(-90, 90),
      vy: randomBetween(-110, 10),
      gravity: 260,
      life: randomBetween(0.2, 0.4),
      size: randomBetween(1.5, 3),
      color: isEnemy ? "#ff9a85" : i % 2 ? "#ffcc33" : "#ffffff",
    });
  }
  if (isEnemy || hitNumbers.length >= MAX_HIT_NUMBERS) return;
  hitNumbers.push({
    x: x + randomBetween(-10, 10),
    y: y - 10,
    text: `${marcher.side === "bomb" ? "-" : "+"}${Math.round(marcher.value)}`,
    color: marcher.side === "bomb" ? "#ff8a3d" : marcher.charge ? "#ffcc33" : "#bcd9ff",
    age: 0,
  });
}

function spawnConfetti() {
  if (REDUCED_MOTION) return;
  const colors = ["#ffcc33", "#3a7ddb", "#8bd65a", "#ff8a3d", "#fdf6e8"];
  for (let i = 0; i < 70; i++) {
    spawnParticle({
      x: randomBetween(0, fxCssW),
      y: randomBetween(-40, 0),
      vx: randomBetween(-50, 50),
      vy: randomBetween(60, 220),
      gravity: 180,
      life: randomBetween(1, 1.8),
      size: randomBetween(4, 8),
      color: colors[i % colors.length],
      angle: randomBetween(0, Math.PI),
      spin: randomBetween(-9, 9),
    });
  }
}

function updateFx(dt) {
  for (const flyer of flyers) flyer.t += dt / FLY_SECONDS;
  flyers = flyers.filter((flyer) => flyer.t < 1);

  for (const p of particles) {
    p.age += dt;
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.angle += p.spin * dt;
  }
  particles = particles.filter((p) => p.age < p.life);
  for (const number of hitNumbers) {
    number.age += dt;
    number.y -= 34 * dt;
  }
  hitNumbers = hitNumbers.filter((number) => number.age < HIT_NUMBER_SECONDS);

  screenShake = Math.max(0, screenShake - SHAKE_FADE_PER_SEC * dt);
  const shake = REDUCED_MOTION ? 0 : screenShake;
  document.getElementById("game-screen").style.transform = shake > 0
    ? `translate(${randomBetween(-shake, shake)}px, ${randomBetween(-shake, shake)}px)`
    : "";
}

function drawFx() {
  if (!fxCtx) return;
  const ctx = fxCtx;
  ctx.clearRect(0, 0, fxCssW, fxCssH);

  for (const flyer of flyers) {
    // An arc from the gear up to the lane, speeding up as it goes.
    const t = flyer.t * flyer.t;
    const x = flyer.fromX + (flyTarget.x - flyer.fromX) * t;
    const y = flyer.fromY + (flyTarget.y - flyer.fromY) * flyer.t;
    ctx.save();
    ctx.shadowColor = flyer.side === "bomb" ? "#ff8a3d" : "#8fc0ff";
    ctx.shadowBlur = 16;
    if (flyer.side === "bomb") drawBombIcon(ctx, x, y);
    else drawSoldier(ctx, x, y + 10, 1, ARMY_RANKS[armyRank].look, "walk", flyer.fromX);
    ctx.restore();
  }

  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = 1 - p.age / p.life;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }

  ctx.font = "800 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  for (const number of hitNumbers) {
    ctx.globalAlpha = 1 - number.age / HIT_NUMBER_SECONDS;
    ctx.strokeStyle = "#1c130a";
    ctx.strokeText(number.text, number.x, number.y);
    ctx.fillStyle = number.color;
    ctx.fillText(number.text, number.x, number.y);
  }
  ctx.globalAlpha = 1;
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

function setMuted(muted) {
  save.muted = muted;
  writeSave();
  updateMuteButton();
}

function updateMuteButton() {
  const button = document.getElementById("mute-btn");
  button.textContent = save.muted ? "\u{1F507}" : "\u{1F50A}";
  button.setAttribute("aria-label", save.muted ? "Turn sound on" : "Turn sound off");
}

function beep(freq, duration, type, gainPeak) {
  if (!audioCtx || save.muted) return;
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

// A pitch slide, for launches and explosions.
function sweep(fromFreq, toFreq, duration, type, gainPeak) {
  if (!audioCtx || save.muted) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const t0 = audioCtx.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(fromFreq, t0);
  osc.frequency.exponentialRampToValueAtTime(toFreq, t0 + duration);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(t0 + duration + 0.02);
}

// Filtered noise is what makes these sound like metal rather than a beep.
let noiseBuffer = null;
function noiseBurst(duration, filterType, filterFreq, gainPeak) {
  if (!audioCtx || save.muted) return;
  if (!noiseBuffer) {
    noiseBuffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate / 2), audioCtx.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  const source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  const gain = audioCtx.createGain();
  const t0 = audioCtx.currentTime;
  gain.gain.setValueAtTime(gainPeak, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  source.connect(filter).connect(gain).connect(audioCtx.destination);
  source.start();
  source.stop(t0 + duration + 0.02);
}

// Several teeth can land close together, so limit this to a steady patter.
let lastTickSoundAt = 0;
function playTickSound() {
  const now = performance.now();
  if (now - lastTickSoundAt < 110) return;
  lastTickSoundAt = now;
  noiseBurst(0.03, "highpass", 4000, 0.1);
  beep(1800, 0.025, "square", 0.03);
}

// Many gears can fill on the same hit, so one launch sound covers them.
let lastFireSoundAt = 0;
function playFireSound() {
  const now = performance.now();
  if (now - lastFireSoundAt < 70) return;
  lastFireSoundAt = now;
  sweep(420, 880, 0.14, "triangle", 0.1);
}

function playClankSound() {
  noiseBurst(0.09, "bandpass", 2400, 0.25);
  beep(1250, 0.12, "triangle", 0.1);
  beep(1870, 0.09, "sine", 0.06);
}

let lastBoomSoundAt = 0;
function playBoomSound() {
  const now = performance.now();
  if (now - lastBoomSoundAt < 120) return;
  lastBoomSoundAt = now;
  sweep(140, 40, 0.35, "sine", 0.35);
  noiseBurst(0.25, "lowpass", 700, 0.3);
}

function playBossSound() {
  sweep(95, 45, 0.7, "sawtooth", 0.25);
  noiseBurst(0.4, "lowpass", 500, 0.25);
}

function playRustSound() {
  sweep(320, 90, 0.3, "sawtooth", 0.14);
  noiseBurst(0.3, "bandpass", 900, 0.3);
}

function playOverdriveSound() {
  sweep(200, 1200, 0.5, "sawtooth", 0.1);
}

function playWinSound() {
  beep(523, 0.12, "square", 0.2);
  setTimeout(() => beep(659, 0.12, "square", 0.2), 110);
  setTimeout(() => {
    beep(784, 0.22, "square", 0.22);
    playClankSound();
  }, 220);
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
// Workshop — spend coins on permanent upgrades
// =====================================================================

function buyUpgrade(upgrade) {
  const level = upgradeLevel(upgrade.id);
  const cost = upgrade.costs[level];
  if (cost === undefined || save.coins < cost) return;
  save.coins -= cost;
  save.upgrades[upgrade.id] = level + 1;
  writeSave();
  ensureAudio();
  playClankSound();
  renderWorkshop();
}

function renderWorkshop() {
  document.getElementById("workshop-coins").textContent = save.coins;
  document.getElementById("title-coins").textContent = save.coins;
  const list = document.getElementById("workshop-list");
  list.replaceChildren();
  for (const upgrade of UPGRADES) {
    const level = upgradeLevel(upgrade.id);
    const cost = upgrade.costs[level];
    const button = document.createElement("button");
    button.className = "upgrade";
    button.disabled = cost === undefined || save.coins < cost;
    const name = document.createElement("b");
    name.textContent = `${upgrade.name} ${level}/${upgrade.costs.length}`;
    const text = document.createElement("span");
    text.textContent = upgrade.text;
    const price = document.createElement("em");
    price.textContent = cost === undefined ? "Max" : `${cost} coins`;
    button.append(name, text, price);
    button.addEventListener("click", () => buyUpgrade(upgrade));
    list.append(button);
  }
}

function openWorkshop() {
  renderWorkshop();
  document.getElementById("workshop-screen").classList.remove("hidden");
}

function closeWorkshop() {
  document.getElementById("workshop-screen").classList.add("hidden");
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

// The effects canvas covers the whole game, so it needs to know where the
// board and the battle lane sit on it.
function layoutFxCanvas() {
  const frame = document.getElementById("app-frame").getBoundingClientRect();
  const board = boardCanvas.getBoundingClientRect();
  const lane = document.getElementById("battle-lane").getBoundingClientRect();
  fxCssW = frame.width;
  fxCssH = frame.height;
  boardOrigin = { x: board.left - frame.left, y: board.top - frame.top };
  flyTarget = { x: lane.left - frame.left + 16, y: lane.top - frame.top + lane.height * 0.6 };
  laneRect = { x: lane.left - frame.left, y: lane.top - frame.top, w: lane.width, h: lane.height };
  fxCtx = fitCanvasDPR(fxCanvas, fxCssW, fxCssH);
}

function handleResize() {
  layoutBoardCanvas();
  layoutBattleCanvas();
  layoutFxCanvas();
}

// =====================================================================
// Game lifecycle / boot
// =====================================================================

function startNewRun() {
  ensureAudio();
  // Restart ends a run in progress, which still earns its coins.
  const restarted = ["playing", "choosing", "tip", "paused"].includes(gameState);
  const coinsFromRestart = restarted ? bankRun() : 0;
  drag = null;
  gearsBought = 0;
  peakRate = 0;
  marchers = [];
  clashes = [];
  enemyBacklog = 0;
  driverTurnsPerSec = DRIVER_BASE_TURNS_PER_SEC * (1 + upgradeLevel("speed") * SPEED_PER_LEVEL);
  waveLead = WAVE_START_LEAD + upgradeLevel("recruits") * RECRUITS_LEAD_PER_LEVEL;
  gearPriceScale = 1 - upgradeLevel("discount") * DISCOUNT_PER_LEVEL;
  nextWaveBonus = 0;
  lastTipAt = 0;
  hideTip();
  document.getElementById("pause-screen").classList.add("hidden");
  bossesBeaten = 0;
  enemiesBlasted = 0;
  runTime = 0;
  bestWaveBeforeRun = bestWave;
  runBanked = false;
  boss = null;
  comboCounts = { line: 0, block: 0, ring: 0 };
  armyRank = 0;
  resetRally();
  waveEvent = null;
  lastEventId = null;
  eventReinforcePerSec = 0;
  blockedCells.clear();
  overdriveLeft = 0;
  overdriveCooldown = OVERDRIVE_START_COOLDOWN_SECONDS;
  flyers = [];
  particles = [];
  hitNumbers = [];
  screenShake = 0;
  wave = 1;
  waveTime = 0;
  playerPower = BASE_POWER * (1 + upgradeLevel("recruits") * RECRUITS_FIRST_WAVE_PER_LEVEL);
  enemyPower = BASE_POWER;
  totalArmyScore = 0;
  createBoard();
  for (let i = 0; i < upgradeLevel("startGears"); i++) placeGear("soldier");

  document.getElementById("title-screen").classList.add("hidden");
  document.getElementById("gameover-screen").classList.add("hidden");
  document.getElementById("reward-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  gameState = "playing";
  handleResize();
  if (coinsFromRestart > 0) showToast(`+${coinsFromRestart} coins`);
}

let lastTime = 0;
function loop(now) {
  const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
  lastTime = now;
  update(dt);
  updateScrapZone();
  updateFx(dt);
  drawBoard();
  drawBattle();
  drawFx();
  requestAnimationFrame(loop);
}

function init() {
  boardCanvas = document.getElementById("board-canvas");
  battleCanvas = document.getElementById("battle-canvas");
  fxCanvas = document.getElementById("fx-canvas");

  if (bestWave > 1) {
    document.getElementById("best-wave").textContent = bestWave;
    document.getElementById("best-line").classList.remove("hidden");
  }

  document.getElementById("play-btn").addEventListener("click", startNewRun);
  document.getElementById("retry-btn").addEventListener("click", startNewRun);
  document.getElementById("restart-btn").addEventListener("click", startNewRun);
  document.getElementById("buy-gear-btn").addEventListener("click", buyGear);
  document.getElementById("overdrive-btn").addEventListener("click", activateOverdrive);
  document.getElementById("rally-btn").addEventListener("click", toggleRally);
  document.getElementById("train-btn").addEventListener("click", trainArmy);
  document.getElementById("mute-btn").addEventListener("click", () => setMuted(!save.muted));
  document.getElementById("tip-ok-btn").addEventListener("click", closeTip);
  document.getElementById("pause-btn").addEventListener("click", pauseGame);
  document.getElementById("resume-btn").addEventListener("click", resumeGame);
  // A call or a switch to another app shouldn't lose the run.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseGame();
  });
  document.getElementById("how-to-play-btn").addEventListener("click", replayTips);
  document.getElementById("title-workshop-btn").addEventListener("click", openWorkshop);
  document.getElementById("gameover-workshop-btn").addEventListener("click", openWorkshop);
  document.getElementById("workshop-close-btn").addEventListener("click", closeWorkshop);
  updateMuteButton();
  renderWorkshop();

  wireBoardInput();
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);

  requestAnimationFrame(loop);
}

document.addEventListener("DOMContentLoaded", init);
