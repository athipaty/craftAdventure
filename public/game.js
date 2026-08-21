// Local dev (including opening the dev server from another device on the
// same network, e.g. your phone, via the PC's LAN IP) talks to the backend
// on port 5000 on that same host. Anywhere else (the deployed Vercel site)
// talks to the live Render backend. "localhost" only ever means "whatever
// device is running this script" — it can never point at your PC from a
// phone, which is why this used to fail to fetch when opened on mobile.
const API_BASE = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(
  location.hostname
)
  ? `http://${location.hostname}:5000/api/craft-adventure`
  : "https://center-kitchen-backend.onrender.com/api/craft-adventure";

// CANVAS_W/H are the VIEWPORT — the visible window onto the world. Desktop
// stays a fixed 800x600 by default; on any device resizeCanvas() overwrites
// these to match the real screen, so the game fills whatever it's running
// in. WORLD_W/H are the actual game world, much bigger than any viewport —
// the camera (cameraX/Y below) follows the player around inside it.
let CANVAS_W = 800;
let CANVAS_H = 600;
const WORLD_W = 2400;
const WORLD_H = 1600;
const ZOOM = 1.8; // >1 shows less world per screen pixel, i.e. "closer in"
const GATHER_RADIUS = 32;
const RESPAWN_MS = 15000;
const BASE_SPEED = 1.0; // lower than before ZOOM went 1.5 -> 1.8, since the higher zoom alone made the same speed look faster on screen
const NODE_START_AMOUNT = 8;
let digDurationMs = 500; // recomputed per-swing in startDig() based on tool level
// Collision hitbox is just the torso/shoulder core (the body is an 18px-wide
// box, drawn in drawCharacter()) — deliberately smaller than the full
// sprite, so swinging arms/legs and the shadow can overlap a resource or
// structure's art without that being treated as a collision.
//
// This used to switch between two radii depending on whether the object
// was above or below the character on screen (to avoid the character
// visually overlapping something that should occlude it). Reverted: right
// at the boundary where an object's y crosses the character's y — which
// happens constantly while walking diagonally past something — the radius
// jumped between the two values and could snag the character mid-stride.
// Smooth, predictable movement matters more than that occlusion nicety.
const PLAYER_RADIUS = 6;
const RESOURCE_COLLISION_RADIUS = { wood: 14, stone: 12, ore: 12 };

// Buildable structures — costs/levels are also enforced server-side (see
// the backend's own STRUCTURES table) so a player can't skip payment or
// grant themselves levels by editing this file; this copy just drives the
// client UI/collision/rendering.
const STRUCTURES = {
  wall: {
    label: "Wall",
    cost: { wood: 5 }, // level 1 (build cost)
    // Kept small (well under half of PLACE_GRID) so two walls dropped on
    // neighboring grid cells don't block each other's placement — that's
    // what makes lining up a fence or walled area work.
    radius: 6,
    maxLevel: 3,
    upgradeCost: {
      2: { wood: 6, stone: 4 },
      3: { stone: 10, ore: 6 },
    },
  },
};
const PLACE_DISTANCE = 30; // how far in front of the player a structure lands
const PLACE_GRID = 16; // placement snaps to the same 16px grid the ground is drawn on
let placingType = null; // structure key currently being lined up (brand-new build), if any
// Structure currently picked up to be relocated (its pre-move doc, so we
// know its type/level/_id) — mutually exclusive with placingType, and
// drives the same ghost-placement UI for a free reposition instead of a
// paid build.
let movingStructure = null;
// Pixel offset (world space) the placement ghost has been nudged away from
// its default in-front-of-player spot. Movement input drags this around
// instead of the character while a structure is being lined up.
let placeOffset = { x: 0, y: 0 };
let nearbyStructure = null; // placed structure in range right now, if any

let player = null;
let resources = [];
let keys = new Set();
let saveTimer = null;
let canvas, ctx;
let cameraX = 0;
let cameraY = 0;

const joystickVector = { x: 0, y: 0 }; // set by the on-screen joystick, read by update()

// Floating "+N" popup shown after each successful gather.
let floatingTexts = [];
const FLOAT_TEXT_DURATION_MS = 900;
const RESOURCE_TEXT_COLOR = { wood: "#c98b4a", stone: "#e2e2e2", ore: "#ffd23f" };

function spawnFloatingText(x, y, text, color) {
  floatingTexts.push({
    x: x + (Math.random() - 0.5) * 24, // a little random horizontal jitter...
    y,
    drift: (Math.random() - 0.5) * 14, // ...and continued sideways drift as it rises
    rise: 26 + Math.random() * 12, // random rise distance
    text,
    color,
    startedAt: Date.now(),
  });
}

function drawFloatingTexts() {
  if (floatingTexts.length === 0) return;
  const now = Date.now();
  floatingTexts = floatingTexts.filter((t) => now - t.startedAt < FLOAT_TEXT_DURATION_MS);

  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  for (const t of floatingTexts) {
    const progress = (now - t.startedAt) / FLOAT_TEXT_DURATION_MS;
    const eased = 1 - Math.pow(1 - progress, 2); // fast start, slows down near the top
    const riseY = t.y - eased * t.rise;
    const driftX = t.x + eased * t.drift;
    ctx.globalAlpha = 1 - progress; // fades out as it goes
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, driftX, riseY);
  }
  ctx.globalAlpha = 1;
}

let nearbyNode = null; // resource in range right now, if any
let isDigging = false;
let digTargetNode = null;
let digStartedAt = 0;
let digImpactTriggered = false;

let selectedCraftIndex = 0;

const SHAKE_DURATION_MS = 300;
function shakeOffset(node) {
  if (!node.hitAt) return [0, 0];
  const t = Date.now() - node.hitAt;
  if (t >= SHAKE_DURATION_MS) return [0, 0];
  const decay = 1 - t / SHAKE_DURATION_MS;
  return [Math.sin(t * 0.09) * 4 * decay, Math.sin(t * 0.14 + 1) * 2 * decay];
}

// All sound is synthesized at runtime (filtered noise bursts) — no audio
// files to fetch/host. audioCtx is created lazily on the Play click, since
// browsers block audio until a user gesture.
let audioCtx = null;
let noiseBuffer = null;
let lastStepIndex = -1;

function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const length = audioCtx.sampleRate * 0.2;
  noiseBuffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function playThud({ freq, peakGain, duration }) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  const source = audioCtx.createBufferSource();
  source.buffer = getNoiseBuffer();

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(freq, now);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter).connect(gain).connect(audioCtx.destination);
  source.start(now);
  source.stop(now + duration + 0.02);
}

function playFootstep() {
  playThud({ freq: 280 + Math.random() * 80, peakGain: 0.18, duration: 0.09 });
}

function playHit(toolType) {
  if (toolType === "wood") {
    playThud({ freq: 500 + Math.random() * 80, peakGain: 0.32, duration: 0.13 }); // dull chop
  } else {
    playThud({ freq: 1300 + Math.random() * 200, peakGain: 0.28, duration: 0.06 }); // sharp clink
  }
}

let isMoving = false;
let walkPhase = 0;
let idlePhase = 0;

// 8-directional facing. Index order matches Math.atan2(dy, dx) snapped to 45°
// steps (0 = E, going clockwise since screen y grows downward). Everything is
// drawn assuming an East-leaning pose; W/NW/SW just mirror the E/NE/SE pose
// via flip: -1, so only 5 distinct poses (front/frontQuarter/side/backQuarter/back)
// need real drawing code.
let dirIndex = 2; // start facing S (down)
const DIR_TABLE = [
  { flip: 1, face: "side" }, // 0 E
  { flip: 1, face: "frontQuarter" }, // 1 SE
  { flip: 1, face: "front" }, // 2 S
  { flip: -1, face: "frontQuarter" }, // 3 SW
  { flip: -1, face: "side" }, // 4 W
  { flip: -1, face: "backQuarter" }, // 5 NW
  { flip: 1, face: "back" }, // 6 N
  { flip: 1, face: "backQuarter" }, // 7 NE
];

// excludeStructureId lets a structure being moved skip colliding with its
// own (pre-move) position while its ghost is placed elsewhere.
function positionBlocked(x, y, excludeStructureId) {
  for (const node of resources) {
    if (node.amount <= 0) continue;
    const scale = 0.55 + 0.45 * (node.amount / NODE_START_AMOUNT);
    const minDist = PLAYER_RADIUS + (RESOURCE_COLLISION_RADIUS[node.type] || 12) * scale;
    if (Math.hypot(node.x - x, node.y - y) < minDist) return true;
  }
  for (const s of player.structures) {
    if (excludeStructureId && s._id === excludeStructureId) continue;
    const minDist = PLAYER_RADIUS + (STRUCTURES[s.type]?.radius || 14);
    if (Math.hypot(s.x - x, s.y - y) < minDist) return true;
  }
  return false;
}

function capacityFor(bagLevel) {
  return [50, 80, 120][bagLevel] ?? 50;
}

function totalCarried(inv) {
  return inv.wood + inv.stone + inv.ore;
}

const TOTAL_RESOURCE_NODES = 100; // scaled up for WORLD_W x WORLD_H instead of one screen

// Map density follows demand: sum every recipe's cost across all levels, turn
// that into a % share per material, then hand out TOTAL_RESOURCE_NODES nodes
// in that proportion. A material barely used by any upgrade ends up with few
// nodes on the map; a heavily-used one gets plenty. Recomputed straight from
// RECIPES, so it stays correct automatically if recipes ever change.
function computeResourceSpawnCounts() {
  const totals = { wood: 0, stone: 0, ore: 0 };
  for (const recipe of Object.values(RECIPES)) {
    for (const cost of Object.values(recipe.costs)) {
      for (const [res, amt] of Object.entries(cost)) {
        totals[res] = (totals[res] || 0) + amt;
      }
    }
  }
  const grandTotal = totals.wood + totals.stone + totals.ore;

  const raw = {};
  for (const res of Object.keys(totals)) {
    raw[res] = (totals[res] / grandTotal) * TOTAL_RESOURCE_NODES;
  }

  const counts = {};
  for (const res of Object.keys(raw)) counts[res] = Math.max(1, Math.floor(raw[res]));

  // Hand out whatever's left from flooring to whichever type's fractional
  // remainder was largest, so the total lands exactly on TOTAL_RESOURCE_NODES.
  let remainder = TOTAL_RESOURCE_NODES - Object.values(counts).reduce((a, b) => a + b, 0);
  const byRemainder = Object.keys(raw).sort((a, b) => (raw[b] - counts[b]) - (raw[a] - counts[a]));
  for (let i = 0; i < remainder; i++) counts[byRemainder[i % byRemainder.length]]++;

  return counts;
}

const RESPAWN_MIN_DISTANCE = 150;
const MIN_NODE_SPACING = 55; // no two nodes' "own area" may overlap closer than this

// Centers the camera on the player, clamped so it never scrolls past the
// edge of the world (or, if the world happens to be smaller than the
// viewport, just stays put at 0).
// How much world-space is actually visible on screen at once — shrinks as
// ZOOM increases, since a zoomed-in camera shows less of the world.
function viewWorldSize() {
  return { w: CANVAS_W / ZOOM, h: CANVAS_H / ZOOM };
}

// Fog of war. The world is divided into cells; a cell is "explored" once the
// player has ever been within REVEAL_RADIUS of it, and stays explored (dimly
// visible) forever after — vs. "currently lit", which only cells within
// REVEAL_RADIUS right now get (full visibility). Never persisted — resets
// each time the game loads.
const FOG_CELL = 16;
const FOG_COLS = Math.ceil(WORLD_W / FOG_CELL);
const FOG_ROWS = Math.ceil(WORLD_H / FOG_CELL);
const REVEAL_RADIUS = 180;
const exploredCells = new Uint8Array(FOG_COLS * FOG_ROWS);

function updateFog() {
  const cellReach = Math.ceil(REVEAL_RADIUS / FOG_CELL) + 1;
  const pc = Math.floor(player.x / FOG_CELL);
  const pr = Math.floor(player.y / FOG_CELL);

  for (let r = Math.max(0, pr - cellReach); r <= Math.min(FOG_ROWS - 1, pr + cellReach); r++) {
    for (let c = Math.max(0, pc - cellReach); c <= Math.min(FOG_COLS - 1, pc + cellReach); c++) {
      const dx = (c + 0.5) * FOG_CELL - player.x;
      const dy = (r + 0.5) * FOG_CELL - player.y;
      if (dx * dx + dy * dy <= REVEAL_RADIUS * REVEAL_RADIUS) {
        exploredCells[r * FOG_COLS + c] = 1;
      }
    }
  }
}

function drawFog() {
  const view = viewWorldSize();
  const colStart = Math.max(0, Math.floor(cameraX / FOG_CELL));
  const colEnd = Math.min(FOG_COLS - 1, Math.floor((cameraX + view.w) / FOG_CELL));
  const rowStart = Math.max(0, Math.floor(cameraY / FOG_CELL));
  const rowEnd = Math.min(FOG_ROWS - 1, Math.floor((cameraY + view.h) / FOG_CELL));

  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      const cx = (c + 0.5) * FOG_CELL;
      const cy = (r + 0.5) * FOG_CELL;
      const dx = cx - player.x;
      const dy = cy - player.y;
      if (dx * dx + dy * dy <= REVEAL_RADIUS * REVEAL_RADIUS) continue; // currently lit

      const wasExplored = exploredCells[r * FOG_COLS + c];
      ctx.fillStyle = wasExplored ? "rgba(0, 0, 0, 0.55)" : "rgba(0, 0, 0, 0.96)";
      ctx.fillRect(c * FOG_CELL, r * FOG_CELL, FOG_CELL, FOG_CELL);
    }
  }
}

function updateCamera() {
  const { w: viewW, h: viewH } = viewWorldSize();
  const maxCamX = Math.max(0, WORLD_W - viewW);
  const maxCamY = Math.max(0, WORLD_H - viewH);
  cameraX = Math.max(0, Math.min(maxCamX, player.x - viewW / 2));
  cameraY = Math.max(0, Math.min(maxCamY, player.y - viewH / 2));
}

// Faint world-space grid so panning the camera over empty ground still
// reads as movement, not just a static green backdrop.
function drawGrid() {
  const { w: viewW, h: viewH } = viewWorldSize();
  const gridSize = 16;
  const startX = Math.floor(cameraX / gridSize) * gridSize;
  const startY = Math.floor(cameraY / gridSize) * gridSize;

  ctx.strokeStyle = "rgba(0, 0, 0, 0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x <= cameraX + viewW; x += gridSize) {
    ctx.moveTo(x, cameraY);
    ctx.lineTo(x, cameraY + viewH);
  }
  for (let y = startY; y <= cameraY + viewH; y += gridSize) {
    ctx.moveTo(cameraX, y);
    ctx.lineTo(cameraX + viewW, y);
  }
  ctx.stroke();
}

function randomMapPoint() {
  return { x: 40 + Math.random() * (WORLD_W - 80), y: 40 + Math.random() * (WORLD_H - 80) };
}

function isTooCloseToOtherNodes(x, y, excludeNode) {
  for (const node of resources) {
    if (node === excludeNode) continue;
    if (Math.hypot(node.x - x, node.y - y) < MIN_NODE_SPACING) return true;
  }
  return false;
}

// Picks a fresh spot for a respawning node — far enough from where it just
// was that it doesn't feel like it grew right back in the same place, and
// far enough from every other node so nothing spawns overlapping.
function pickRespawnPosition(node) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const { x, y } = randomMapPoint();
    const farFromOldSpot = Math.hypot(x - node.x, y - node.y) >= RESPAWN_MIN_DISTANCE;
    if (farFromOldSpot && !isTooCloseToOtherNodes(x, y, node)) return { x, y };
  }
  return randomMapPoint();
}

function pickSpawnPosition() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const { x, y } = randomMapPoint();
    if (!isTooCloseToOtherNodes(x, y, null)) return { x, y };
  }
  return randomMapPoint();
}

function spawnResources() {
  resources = [];
  const counts = computeResourceSpawnCounts();
  for (const [type, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      const { x, y } = pickSpawnPosition();
      resources.push({ type, x, y, amount: NODE_START_AMOUNT, respawnAt: 0 });
    }
  }
}

async function loginOrCreate(name) {
  const res = await fetch(`${API_BASE}/player/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error((await res.json()).error || "Failed to load player");
  return res.json();
}

async function resetPlayer() {
  if (!player) return;
  if (!confirm("Reset this save? Inventory, upgrades, and position will be wiped.")) return;

  try {
    const res = await fetch(`${API_BASE}/player/${encodeURIComponent(player.name)}/reset`, {
      method: "POST",
    });
    if (!res.ok) throw new Error((await res.json()).error || "Reset failed");
    player = await res.json();
    player.structures = player.structures || [];

    isDigging = false;
    digTargetNode = null;
    placingType = null;
    movingStructure = null;
    placeOffset = { x: 0, y: 0 };
    exploredCells.fill(0);
    closeCraftPanel();
    closeBuildPanel();
    spawnResources();
    renderHud();
    document.getElementById("save-status").textContent = "Reset " + new Date().toLocaleTimeString();
  } catch (err) {
    document.getElementById("save-status").textContent = err.message;
  }
}

async function savePlayer() {
  if (!player) return;
  const statusEl = document.getElementById("save-status");
  try {
    await fetch(`${API_BASE}/player/${encodeURIComponent(player.name)}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: player.x, y: player.y, inventory: player.inventory }),
    });
    statusEl.textContent = "Saved " + new Date().toLocaleTimeString();
  } catch {
    statusEl.textContent = "Save failed (backend offline?)";
  }
}

async function craftItem(key) {
  const res = await fetch(`${API_BASE}/player/${encodeURIComponent(player.name)}/craft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: key }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Craft failed");
    return;
  }
  player.inventory = data.inventory;
  player.upgrades = data.upgrades;
  renderHud();
  renderCraftPanel();
}

// Where a structure would land right now: a fixed distance in front of the
// player, facing whichever way they were facing when placement started,
// nudged by placeOffset and snapped to the same 16px grid the ground is
// drawn on so the target slot is unambiguous. While placing, movement input
// drags placeOffset around instead of walking the character (see update()),
// so lining up a spot doesn't require dragging the player around too.
function placementPosition() {
  const angle = dirIndex * (Math.PI / 4);
  const rawX = player.x + Math.cos(angle) * PLACE_DISTANCE + placeOffset.x;
  const rawY = player.y + Math.sin(angle) * PLACE_DISTANCE + placeOffset.y;
  const x = Math.min(WORLD_W - 14, Math.max(14, Math.round(rawX / PLACE_GRID) * PLACE_GRID));
  const y = Math.min(WORLD_H - 14, Math.max(14, Math.round(rawY / PLACE_GRID) * PLACE_GRID));
  return { x, y };
}

function startPlacing(key) {
  placingType = key;
  movingStructure = null;
  placeOffset = { x: 0, y: 0 };
  closeBuildPanel();
}

// Picks a placed structure up to relocate it: pulls it out of the normal
// render/collision pass (see draw()/positionBlocked's excludeStructureId)
// and drives it through the same ghost-placement UI as a fresh build,
// except confirming calls moveStructure() instead of buildStructure() —
// no cost, since it's the same structure just landing somewhere else.
function startMovingStructure(structure) {
  movingStructure = structure;
  placingType = null;
  placeOffset = { x: 0, y: 0 };
}

function cancelPlacing() {
  placingType = null;
  movingStructure = null;
  placeOffset = { x: 0, y: 0 };
  updateDigPrompt();
}

function confirmPlacement() {
  const { x, y } = placementPosition();
  if (movingStructure) {
    if (positionBlocked(x, y, movingStructure._id)) return;
    moveStructure(movingStructure, x, y);
    return;
  }
  if (!placingType) return;
  if (!structureAfford(placingType) || positionBlocked(x, y)) return;
  buildStructure(placingType, x, y);
}

async function buildStructure(key, x, y) {
  const structure = STRUCTURES[key];
  const res = await fetch(`${API_BASE}/player/${encodeURIComponent(player.name)}/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: key, x, y }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Build failed");
    return;
  }
  player.inventory = data.inventory;
  player.structures = data.structures;
  placingType = null;
  placeOffset = { x: 0, y: 0 };
  spawnFloatingText(x, y - 20, structure.label, "#8fb4f7");
  renderHud();
}

async function moveStructure(structure, x, y) {
  const res = await fetch(`${API_BASE}/player/${encodeURIComponent(player.name)}/move-structure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structureId: structure._id, x, y }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Move failed");
    return;
  }
  player.structures = data.structures;
  movingStructure = null;
  placeOffset = { x: 0, y: 0 };
  renderHud();
}

async function upgradeStructure(structure) {
  const res = await fetch(`${API_BASE}/player/${encodeURIComponent(player.name)}/upgrade-structure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structureId: structure._id }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Upgrade failed");
    return;
  }
  player.inventory = data.inventory;
  player.structures = data.structures;
  const label = STRUCTURES[structure.type]?.label || structure.type;
  spawnFloatingText(structure.x, structure.y - 20, `${label} Lvl ${(structure.level || 1) + 1}`, "#8fb4f7");
  renderHud();
}

async function demolishStructure(structure) {
  const res = await fetch(`${API_BASE}/player/${encodeURIComponent(player.name)}/demolish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structureId: structure._id }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Demolish failed");
    return;
  }
  player.inventory = data.inventory;
  player.structures = data.structures;
  const label = STRUCTURES[structure.type]?.label || structure.type;
  spawnFloatingText(structure.x, structure.y - 20, `-${label}`, "#ff8a8a");
  renderHud();
}

function structureUpgradeInfo(structure) {
  const def = STRUCTURES[structure.type];
  const currentLevel = structure.level || 1;
  const maxLevel = def?.maxLevel || 1;
  const maxed = currentLevel >= maxLevel;
  const cost = !maxed ? def.upgradeCost[currentLevel + 1] : null;
  const canAfford = !!cost && Object.entries(cost).every(([res, amt]) => player.inventory[res] >= amt);
  return { currentLevel, maxLevel, maxed, cost, canAfford };
}

// Single entry point for the "act" input (E key / mobile action button),
// same priority everywhere it's wired up: finish what you're already doing,
// then placing/moving, then gathering, then demolishing.
function performAction() {
  if (isDigging) return;
  if (placingType || movingStructure) {
    confirmPlacement();
  } else if (nearbyNode) {
    startDig(nearbyNode);
  } else if (nearbyStructure) {
    demolishStructure(nearbyStructure);
  }
}

function renderHud() {
  document.getElementById("wood-count").textContent = player.inventory.wood;
  document.getElementById("stone-count").textContent = player.inventory.stone;
  document.getElementById("ore-count").textContent = player.inventory.ore;
  document.getElementById("capacity").textContent =
    `(${totalCarried(player.inventory)}/${capacityFor(player.upgrades.bagLevel)} carried)`;
}

// Small material icons for the crafting cost display — rendered from the
// same drawTree/drawRock/drawOre art used on the map, not separate assets.
const resourceIconCache = {};
function getResourceIconUrl(type) {
  if (resourceIconCache[type]) return resourceIconCache[type];

  const iconCanvas = document.createElement("canvas");
  iconCanvas.width = 32;
  iconCanvas.height = 32;
  const savedCtx = ctx;
  ctx = iconCanvas.getContext("2d");
  if (type === "wood") drawTree(16, 17, 0.6); // shorter scale — the tree is taller than it is wide
  else if (type === "stone") drawRock(16, 17, 1.0);
  else if (type === "ore") drawOre(16, 17, 1.0);
  ctx = savedCtx;

  resourceIconCache[type] = iconCanvas.toDataURL();
  return resourceIconCache[type];
}

function drawAxeIcon(x, y, scale, level = 1) {
  const upgraded = level >= 2;
  const bladeScale = upgraded ? scale * 1.2 : scale;

  ctx.strokeStyle = "#8a5a2f";
  ctx.lineWidth = 3.5 * scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 6 * scale, y + 10 * scale);
  ctx.lineTo(x + 5 * scale, y - 9 * scale);
  ctx.stroke();

  ctx.fillStyle = upgraded ? "#ffd23f" : "#c9c9c9";
  ctx.strokeStyle = upgraded ? "#c99a1f" : "#6e6e6e";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 2 * bladeScale, y - 11 * bladeScale);
  ctx.lineTo(x + 11 * bladeScale, y - 7 * bladeScale);
  ctx.lineTo(x + 8 * bladeScale, y + 1 * bladeScale);
  ctx.lineTo(x - 1 * bladeScale, y - 4 * bladeScale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (upgraded) {
    ctx.fillStyle = "#fff3c4";
    ctx.beginPath();
    ctx.arc(x + 5 * scale, y - 6 * scale, 1.6 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPickaxeIcon(x, y, scale, level = 1) {
  const upgraded = level >= 2;
  const headScale = upgraded ? scale * 1.15 : scale;

  ctx.strokeStyle = "#8a5a2f";
  ctx.lineWidth = 3.5 * scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 6 * scale, y + 10 * scale);
  ctx.lineTo(x + 4 * scale, y - 8 * scale);
  ctx.stroke();

  const hx = x + 4 * scale;
  const hy = y - 8 * scale;
  ctx.strokeStyle = upgraded ? "#5c5c5c" : "#8a8a8a";
  ctx.lineWidth = 4 * headScale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(hx - 9 * headScale, hy - 5 * headScale);
  ctx.quadraticCurveTo(hx, hy - 10 * headScale, hx + 9 * headScale, hy - 4 * headScale);
  ctx.stroke();

  if (upgraded) {
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(x + 4 * scale, y - 8 * scale, 1.8 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBootsIcon(x, y, scale, level = 1) {
  const upgraded = level >= 2;

  ctx.fillStyle = "#5a3921";
  ctx.beginPath();
  ctx.roundRect(x - 9 * scale, y - 10 * scale, 7 * scale, 14 * scale, 2 * scale);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x - 10 * scale, y + 2 * scale, 14 * scale, 6 * scale, 3 * scale);
  ctx.fill();

  ctx.fillStyle = "#3d2716";
  ctx.beginPath();
  ctx.roundRect(x - 10 * scale, y + 6.5 * scale, 14 * scale, 2.5 * scale, 1 * scale);
  ctx.fill();

  if (upgraded) {
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.roundRect(x - 9 * scale, y - 4 * scale, 7 * scale, 2 * scale, 1 * scale);
    ctx.fill();
  }
}

function drawBagIcon(x, y, scale, level = 1) {
  const upgraded = level >= 2;
  const bodyScale = upgraded ? scale * 1.12 : scale;

  ctx.strokeStyle = "#5a3921";
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.arc(x, y - 9 * scale, 6 * scale, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();

  ctx.fillStyle = "#9c6b3f";
  ctx.beginPath();
  ctx.roundRect(x - 9 * bodyScale, y - 6 * bodyScale, 18 * bodyScale, 16 * bodyScale, 4 * bodyScale);
  ctx.fill();

  ctx.fillStyle = "#7a5230";
  ctx.beginPath();
  ctx.roundRect(x - 9 * bodyScale, y - 6 * bodyScale, 18 * bodyScale, 6 * bodyScale, 4 * bodyScale);
  ctx.fill();

  if (upgraded) {
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(x, y + 2 * scale, 2.2 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Mobile's floating Craft button uses this in place of the "Craft" text
// label — same hand-drawn style as the tool icons above, just not tied to
// any recipe/level.
function drawHammerIcon(x, y, scale) {
  ctx.strokeStyle = "#8a5a2f";
  ctx.lineWidth = 3.5 * scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 6 * scale, y + 10 * scale);
  ctx.lineTo(x + 3 * scale, y - 7 * scale);
  ctx.stroke();

  ctx.save();
  ctx.translate(x + 3 * scale, y - 7 * scale);
  ctx.rotate(-Math.PI / 4.2);
  ctx.fillStyle = "#8a8a8a";
  ctx.strokeStyle = "#5c5c5c";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-9 * scale, -5 * scale, 18 * scale, 10 * scale, 2 * scale);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

const TOOL_ICON_DRAWERS = { axe: drawAxeIcon, pickaxe: drawPickaxeIcon, boots: drawBootsIcon, bag: drawBagIcon };

const toolIconCache = {};
function getToolIconUrl(key, level = 1) {
  const cacheKey = `${key}-${level}`;
  if (toolIconCache[cacheKey]) return toolIconCache[cacheKey];

  const iconCanvas = document.createElement("canvas");
  iconCanvas.width = 36;
  iconCanvas.height = 36;
  const savedCtx = ctx;
  ctx = iconCanvas.getContext("2d");

  // Level 0 (not crafted yet) reuses the level-1 art but faded to a ghost —
  // a third, distinct look from both the plain level-1 and gold level-2
  // renders, so "not owned / owned / upgraded" all read differently at a
  // glance instead of level 0 and level 1 looking identical.
  const locked = level < 1;
  if (locked) ctx.globalAlpha = 0.35;
  (TOOL_ICON_DRAWERS[key] || drawAxeIcon)(18, 20, 0.9, Math.max(1, level));
  if (locked) ctx.globalAlpha = 1;

  ctx = savedCtx;

  toolIconCache[cacheKey] = iconCanvas.toDataURL();
  return toolIconCache[cacheKey];
}

let craftButtonIconCache = null;
function getCraftButtonIconUrl() {
  if (craftButtonIconCache) return craftButtonIconCache;

  const iconCanvas = document.createElement("canvas");
  iconCanvas.width = 36;
  iconCanvas.height = 36;
  const savedCtx = ctx;
  ctx = iconCanvas.getContext("2d");
  drawHammerIcon(18, 20, 1);
  ctx = savedCtx;

  craftButtonIconCache = iconCanvas.toDataURL();
  return craftButtonIconCache;
}

let buildButtonIconCache = null;
function getBuildButtonIconUrl() {
  if (buildButtonIconCache) return buildButtonIconCache;

  const iconCanvas = document.createElement("canvas");
  iconCanvas.width = 36;
  iconCanvas.height = 36;
  const savedCtx = ctx;
  ctx = iconCanvas.getContext("2d");
  drawWall(18, 20); // same art as a placed wall — ties the icon to what it builds
  ctx = savedCtx;

  buildButtonIconCache = iconCanvas.toDataURL();
  return buildButtonIconCache;
}

let fullscreenButtonIconCache = null;
function getFullscreenButtonIconUrl() {
  if (fullscreenButtonIconCache) return fullscreenButtonIconCache;

  const iconCanvas = document.createElement("canvas");
  iconCanvas.width = 36;
  iconCanvas.height = 36;
  const savedCtx = ctx;
  ctx = iconCanvas.getContext("2d");

  // Four corner brackets — the standard "expand to fullscreen" glyph.
  ctx.strokeStyle = "#e8e8e8";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  const inset = 7;
  const arm = 7;
  const corners = [
    [
      [inset + arm, inset],
      [inset, inset],
      [inset, inset + arm],
    ],
    [
      [36 - inset - arm, inset],
      [36 - inset, inset],
      [36 - inset, inset + arm],
    ],
    [
      [inset, 36 - inset - arm],
      [inset, 36 - inset],
      [inset + arm, 36 - inset],
    ],
    [
      [36 - inset, 36 - inset - arm],
      [36 - inset, 36 - inset],
      [36 - inset - arm, 36 - inset],
    ],
  ];
  for (const [[x1, y1], [x2, y2], [x3, y3]] of corners) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.stroke();
  }

  ctx = savedCtx;

  fullscreenButtonIconCache = iconCanvas.toDataURL();
  return fullscreenButtonIconCache;
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  } else {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}

function craftEntryState(key) {
  const recipe = RECIPES[key];
  const currentLevel = player.upgrades[recipe.upgradeKey] || 0;
  const maxed = currentLevel >= recipe.maxLevel;
  const nextCost = !maxed ? recipe.costs[currentLevel + 1] : null;
  const canAfford =
    !!nextCost && Object.entries(nextCost).every(([res, amt]) => player.inventory[res] >= amt);
  return { recipe, currentLevel, maxed, nextCost, canAfford };
}

function buildCostPillsHtml(cost) {
  return Object.entries(cost)
    .map(
      ([res, amt]) => `<span class="cost-pill"><img src="${getResourceIconUrl(res)}" alt="${res}" />${amt}</span>`
    )
    .join("");
}

// Plain-text cost, e.g. "6 wood, 4 stone" — used where cost needs to sit in
// a text-only prompt/title rather than the icon pills above.
function formatCostText(cost) {
  return Object.entries(cost)
    .map(([res, amt]) => `${amt} ${res}`)
    .join(", ");
}

// Maxed-out tools have nothing left to offer, so once a tool hits its cap it
// drops out of the list entirely instead of sitting there as a dead "MAX" row.
function visibleCraftKeys() {
  return Object.keys(RECIPES).filter((key) => !craftEntryState(key).maxed);
}

function renderCraftPanel() {
  const list = document.getElementById("craft-list");
  list.innerHTML = "";
  const visibleKeys = visibleCraftKeys();

  if (visibleKeys.length === 0) {
    list.innerHTML = `<p class="hint">All tools maxed out!</p>`;
    return;
  }
  if (selectedCraftIndex >= visibleKeys.length) selectedCraftIndex = visibleKeys.length - 1;

  visibleKeys.forEach((key, index) => {
    const recipe = RECIPES[key];
    const { currentLevel, nextCost, canAfford } = craftEntryState(key);

    const row = document.createElement("div");
    row.className =
      "craft-item" + (index === selectedCraftIndex ? " selected" : "") + (canAfford ? " craftable" : "");
    row.addEventListener("click", () => {
      selectedCraftIndex = index;
      renderCraftPanel();
    });

    // Just the essentials: current tool -> next tool, and what it costs.
    row.innerHTML = `
      <img class="tool-icon" src="${getToolIconUrl(key, currentLevel)}" alt="${recipe.label} current" />
      <span class="upgrade-arrow">→</span>
      <img class="tool-icon" src="${getToolIconUrl(key, currentLevel + 1)}" alt="${recipe.label} next" />
      <div class="cost-row">${buildCostPillsHtml(nextCost)}</div>
    `;

    const btn = document.createElement("button");
    btn.textContent = "Craft";
    btn.disabled = !canAfford;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      craftItem(key);
    });
    row.appendChild(btn);

    list.appendChild(row);
  });
}

function moveCraftSelection(delta) {
  const count = visibleCraftKeys().length;
  if (count === 0) return;
  selectedCraftIndex = (selectedCraftIndex + delta + count) % count;
  renderCraftPanel();
}

function activateSelectedCraft() {
  const key = visibleCraftKeys()[selectedCraftIndex];
  if (!key) return;
  const { canAfford } = craftEntryState(key);
  if (canAfford) craftItem(key);
}

// Shared dimmed backdrop behind whichever panel (craft/build) is open —
// tapping it closes that panel, same as Esc.
function updateBackdrop() {
  const anyOpen = isCraftPanelOpen() || isBuildPanelOpen();
  document.getElementById("panel-backdrop").classList.toggle("hidden", !anyOpen);
}

function isCraftPanelOpen() {
  return !document.getElementById("craft-panel").classList.contains("hidden");
}

function openCraftPanel() {
  closeBuildPanel();
  document.getElementById("craft-panel").classList.remove("hidden");
  keys.clear();
  selectedCraftIndex = 0;
  renderCraftPanel();
  updateBackdrop();
}

function closeCraftPanel() {
  document.getElementById("craft-panel").classList.add("hidden");
  updateBackdrop();
}

function toggleCraftPanel() {
  if (isCraftPanelOpen()) closeCraftPanel();
  else openCraftPanel();
}

function structureAfford(key) {
  const cost = STRUCTURES[key].cost;
  return Object.entries(cost).every(([res, amt]) => player.inventory[res] >= amt);
}

function renderBuildPanel() {
  const list = document.getElementById("build-list");
  list.innerHTML = "";

  Object.entries(STRUCTURES).forEach(([key, structure]) => {
    const canAfford = structureAfford(key);

    const row = document.createElement("div");
    row.className = "craft-item" + (canAfford ? " craftable" : "");
    row.innerHTML = `
      <span>${structure.label}</span>
      <div class="cost-row">${buildCostPillsHtml(structure.cost)}</div>
    `;

    const btn = document.createElement("button");
    btn.textContent = "Build";
    btn.disabled = !canAfford;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      startPlacing(key);
    });
    row.appendChild(btn);

    list.appendChild(row);
  });
}

function isBuildPanelOpen() {
  return !document.getElementById("build-panel").classList.contains("hidden");
}

function openBuildPanel() {
  closeCraftPanel();
  placingType = null;
  movingStructure = null;
  placeOffset = { x: 0, y: 0 };
  document.getElementById("build-panel").classList.remove("hidden");
  keys.clear();
  renderBuildPanel();
  updateBackdrop();
}

function closeBuildPanel() {
  document.getElementById("build-panel").classList.add("hidden");
  updateBackdrop();
}

function toggleBuildPanel() {
  if (isBuildPanelOpen()) closeBuildPanel();
  else openBuildPanel();
}

function update() {
  updateCamera();
  updateFog();

  const now = Date.now();
  for (const node of resources) {
    if (node.amount <= 0 && now >= node.respawnAt) {
      const { x, y } = pickRespawnPosition(node);
      node.x = x;
      node.y = y;
      node.amount = NODE_START_AMOUNT;
    }
  }

  if (isDigging) {
    handleDigging(now);
    return;
  }

  const speed = BASE_SPEED * (1 + 0.25 * player.upgrades.bootsLevel);
  let dx = 0, dy = 0;
  if (keys.has("arrowup") || keys.has("w")) dy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) dy += 1;
  if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
  if (keys.has("arrowright") || keys.has("d")) dx += 1;
  dx += joystickVector.x;
  dy += joystickVector.y;

  if (placingType || movingStructure) {
    // Lining up a structure (building new or relocating an existing one):
    // movement input drags the placement ghost around instead of walking
    // the character, so the wall you're trying to position doesn't drift
    // out from under you as you nudge it.
    isMoving = false;
    idlePhase += 0.05;
    lastStepIndex = -1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      placeOffset.x += (dx / len) * speed;
      placeOffset.y += (dy / len) * speed;
    }
    nearbyNode = null;
    nearbyStructure = null;
    updateDigPrompt();
    return;
  }

  isMoving = Boolean(dx || dy);
  if (isMoving) {
    const len = Math.hypot(dx, dy);
    const targetX = Math.min(WORLD_W - 14, Math.max(14, player.x + (dx / len) * speed));
    const targetY = Math.min(WORLD_H - 14, Math.max(14, player.y + (dy / len) * speed));

    // Try the full diagonal move; if a resource blocks it, slide along
    // whichever single axis is still open instead of hard-stopping.
    if (!positionBlocked(targetX, targetY)) {
      player.x = targetX;
      player.y = targetY;
    } else if (!positionBlocked(targetX, player.y)) {
      player.x = targetX;
    } else if (!positionBlocked(player.x, targetY)) {
      player.y = targetY;
    }

    const angle = Math.atan2(dy, dx);
    dirIndex = (((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8);
    walkPhase += 0.25;

    const stepIndex = Math.floor(walkPhase / Math.PI);
    if (stepIndex !== lastStepIndex) {
      lastStepIndex = stepIndex;
      playFootstep();
    }
  } else {
    idlePhase += 0.05;
    lastStepIndex = -1;
  }

  nearbyNode = null;
  let bestDist = Infinity;
  for (const node of resources) {
    if (node.amount <= 0) continue;
    const dist = Math.hypot(node.x - player.x, node.y - player.y);
    if (dist <= GATHER_RADIUS && dist < bestDist) {
      bestDist = dist;
      nearbyNode = node;
    }
  }

  nearbyStructure = null;
  let bestStructDist = Infinity;
  for (const s of player.structures) {
    const dist = Math.hypot(s.x - player.x, s.y - player.y);
    if (dist <= GATHER_RADIUS && dist < bestStructDist) {
      bestStructDist = dist;
      nearbyStructure = s;
    }
  }

  updateDigPrompt();
}

// A bare-handed swing is slow; each tool level speeds it up — upgrading
// isn't just bigger yields, it's a faster gathering rhythm too.
function toolLevelFor(node) {
  return node.type === "wood" ? player.upgrades.axeLevel : player.upgrades.pickaxeLevel;
}

function digDurationFor(toolLevel) {
  if (toolLevel >= 2) return 380;
  if (toolLevel >= 1) return 500;
  return 700;
}

function startDig(node) {
  isDigging = true;
  digTargetNode = node;
  digStartedAt = Date.now();
  digDurationMs = digDurationFor(toolLevelFor(node));
  digImpactTriggered = false;
  isMoving = false;

  const dx = node.x - player.x;
  const dy = node.y - player.y;
  if (dx !== 0 || dy !== 0) {
    const angle = Math.atan2(dy, dx);
    dirIndex = (((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8);
  }
  updateDigPrompt();
}

function handleDigging(now) {
  const elapsed = now - digStartedAt;
  const progress = Math.min(1, elapsed / digDurationMs);
  if (!digImpactTriggered && progress >= DIG_THRUST_END && digTargetNode) {
    digTargetNode.hitAt = now;
    digImpactTriggered = true;
    playHit(digTargetNode.type);
  }

  if (elapsed < digDurationMs) return;

  const node = digTargetNode;
  isDigging = false;
  digTargetNode = null;

  if (!node || node.amount <= 0) return;
  const cap = capacityFor(player.upgrades.bagLevel);
  const remainingCapacity = cap - totalCarried(player.inventory);
  if (remainingCapacity <= 0) return;

  const gained = Math.min(1 + toolLevelFor(node), node.amount, remainingCapacity);
  player.inventory[node.type] += gained;
  node.amount -= gained;
  if (node.amount <= 0) node.respawnAt = Date.now() + RESPAWN_MS;
  spawnFloatingText(node.x, node.y - 20, `+${gained}`, RESOURCE_TEXT_COLOR[node.type]);
  renderHud();
}

// Floating bottom-left joystick (drag to move) and bottom-right action
// button (tap to hit/gather/place/demolish), plus a mouse fallback so the
// layout can be checked on desktop. Touches are tracked by identifier so
// dragging the joystick doesn't get confused by a second finger tapping the
// action button. "Floating" means the base isn't pinned to one fixed spot —
// touching anywhere in the bottom-left zone spawns it centered on that
// point, so it lands wherever the player's thumb naturally is.
function setupTouchControls() {
  const zone = document.getElementById("joystick-zone");
  const base = document.getElementById("joystick-base");
  const knob = document.getElementById("joystick-knob");
  let activeId = null;

  function showBaseAt(clientX, clientY) {
    const wrapRect = document.getElementById("canvas-wrap").getBoundingClientRect();
    base.style.left = `${clientX - wrapRect.left}px`;
    base.style.top = `${clientY - wrapRect.top}px`;
    base.classList.add("active");
  }

  function moveTo(clientX, clientY) {
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const maxR = rect.width / 2;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;

    const deadzone = maxR * 0.15;
    if (Math.hypot(dx, dy) < deadzone) {
      joystickVector.x = 0;
      joystickVector.y = 0;
    } else {
      joystickVector.x = dx / maxR;
      joystickVector.y = dy / maxR;
    }
  }

  function resetJoystick() {
    activeId = null;
    joystickVector.x = 0;
    joystickVector.y = 0;
    knob.style.transform = "translate(0px, 0px)";
    base.classList.remove("active");
  }

  zone.addEventListener(
    "touchstart",
    (e) => {
      if (activeId !== null) return; // already tracking a touch
      e.preventDefault();
      const t = e.changedTouches[0];
      activeId = t.identifier;
      showBaseAt(t.clientX, t.clientY);
      moveTo(t.clientX, t.clientY);
    },
    { passive: false }
  );
  window.addEventListener(
    "touchmove",
    (e) => {
      if (activeId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier === activeId) {
          e.preventDefault();
          moveTo(t.clientX, t.clientY);
        }
      }
    },
    { passive: false }
  );
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === activeId) resetJoystick();
    }
  };
  window.addEventListener("touchend", endTouch);
  window.addEventListener("touchcancel", endTouch);

  zone.addEventListener("mousedown", (e) => {
    if (activeId !== null) return;
    activeId = "mouse";
    showBaseAt(e.clientX, e.clientY);
    moveTo(e.clientX, e.clientY);
  });
  window.addEventListener("mousemove", (e) => {
    if (activeId === "mouse") moveTo(e.clientX, e.clientY);
  });
  window.addEventListener("mouseup", () => {
    if (activeId === "mouse") resetJoystick();
  });

  const actionBtn = document.getElementById("action-btn");
  const triggerAction = (e) => {
    e.preventDefault();
    performAction();
  };
  actionBtn.addEventListener("touchstart", triggerAction, { passive: false });
  actionBtn.addEventListener("click", triggerAction);
  document.getElementById("cancel-place-btn").addEventListener("click", cancelPlacing);

  const moveBtn = document.getElementById("move-btn");
  const triggerMove = (e) => {
    e.preventDefault();
    if (nearbyStructure) startMovingStructure(nearbyStructure);
  };
  moveBtn.addEventListener("touchstart", triggerMove, { passive: false });
  moveBtn.addEventListener("click", triggerMove);

  const upgradeBtn = document.getElementById("upgrade-btn");
  const triggerUpgrade = (e) => {
    e.preventDefault();
    if (nearbyStructure && !structureUpgradeInfo(nearbyStructure).maxed) upgradeStructure(nearbyStructure);
  };
  upgradeBtn.addEventListener("touchstart", triggerUpgrade, { passive: false });
  upgradeBtn.addEventListener("click", triggerUpgrade);

  document.getElementById("craft-btn").addEventListener("click", toggleCraftPanel);
}

function updateDigPrompt() {
  const prompt = document.getElementById("dig-prompt");
  const promptText = document.getElementById("dig-prompt-text");
  const actionBtn = document.getElementById("action-btn");
  const cancelBtn = document.getElementById("cancel-place-btn");
  const moveBtn = document.getElementById("move-btn");
  const upgradeBtn = document.getElementById("upgrade-btn");
  cancelBtn.classList.toggle("hidden", !(placingType || movingStructure));
  moveBtn.classList.add("hidden");
  upgradeBtn.classList.add("hidden");

  if (isDigging) {
    promptText.textContent = `Gathering ${digTargetNode.type}...`;
    prompt.classList.remove("hidden");
    actionBtn.classList.add("hidden");
  } else if (placingType) {
    promptText.textContent = `Press E to place ${STRUCTURES[placingType].label}`;
    prompt.classList.remove("hidden");
    actionBtn.textContent = "Place";
    actionBtn.classList.remove("hidden");
  } else if (movingStructure) {
    const label = STRUCTURES[movingStructure.type]?.label || movingStructure.type;
    promptText.textContent = `Press E to set the ${label} down here`;
    prompt.classList.remove("hidden");
    actionBtn.textContent = "Move";
    actionBtn.classList.remove("hidden");
  } else if (nearbyNode) {
    promptText.textContent = `Press E to gather ${nearbyNode.type}`;
    prompt.classList.remove("hidden");
    actionBtn.textContent = "Hit";
    actionBtn.classList.remove("hidden");
  } else if (nearbyStructure) {
    const label = STRUCTURES[nearbyStructure.type]?.label || nearbyStructure.type;
    const { currentLevel, maxed, cost, canAfford } = structureUpgradeInfo(nearbyStructure);
    // Kept short on purpose (#dig-prompt is a nowrap pill) — the cost detail
    // lives in the upgrade button's title instead of cluttering this line.
    const upgradeHint = maxed ? "max" : "U upgrade";
    promptText.textContent = `${label} Lvl ${currentLevel} — E demolish · M move · ${upgradeHint}`;
    prompt.classList.remove("hidden");
    actionBtn.textContent = "Demolish";
    actionBtn.classList.remove("hidden");
    moveBtn.classList.remove("hidden");
    if (!maxed) {
      upgradeBtn.disabled = !canAfford;
      upgradeBtn.title = `Upgrade to Lvl ${currentLevel + 1} (${formatCostText(cost)})`;
      upgradeBtn.classList.remove("hidden");
    }
  } else {
    prompt.classList.add("hidden");
    actionBtn.classList.add("hidden");
  }
}

function drawShadow(x, y, rx, ry) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Irregular rounded polygon — the base shape rocks/ore share, so they read as
// chunky mineral clumps rather than perfect circles.
const BLOB_POINTS = [
  [-1.0, -0.6], [-0.3, -1.0], [0.6, -0.8], [1.0, -0.1],
  [0.7, 0.7], [-0.1, 1.0], [-0.9, 0.5],
];
function drawBlob(cx, cy, r) {
  ctx.beginPath();
  BLOB_POINTS.forEach(([px, py], i) => {
    const X = cx + px * r;
    const Y = cy + py * r;
    if (i === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  });
  ctx.closePath();
  ctx.fill();
}

function drawTree(x, y, scale) {
  drawShadow(x, y + 15 * scale, 12 * scale, 4 * scale);

  ctx.fillStyle = "#6b4226";
  ctx.beginPath();
  ctx.roundRect(x - 3 * scale, y + 1 * scale, 6 * scale, 13 * scale, 2 * scale);
  ctx.fill();

  ctx.fillStyle = "#2f6b2f";
  ctx.beginPath(); ctx.arc(x - 8 * scale, y - 2 * scale, 9 * scale, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 8 * scale, y - 2 * scale, 9 * scale, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y - 11 * scale, 12 * scale, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#4b9c4b";
  ctx.beginPath();
  ctx.arc(x - 4 * scale, y - 15 * scale, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
}

function drawRock(x, y, scale) {
  drawShadow(x, y + 9 * scale, 11 * scale, 4 * scale);

  ctx.fillStyle = "#6e6e6e";
  drawBlob(x, y + 2 * scale, 10 * scale);
  ctx.fillStyle = "#9e9e9e";
  drawBlob(x, y, 10 * scale);
  ctx.fillStyle = "#c2c2c2";
  drawBlob(x - 3 * scale, y - 3 * scale, 4 * scale);
}

function drawOre(x, y, scale) {
  drawShadow(x, y + 9 * scale, 11 * scale, 4 * scale);

  ctx.fillStyle = "#5c4a3d";
  drawBlob(x, y + 1 * scale, 10 * scale);

  const crystal = (cx, cy, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.6, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r * 0.6, cy);
    ctx.closePath();
    ctx.fill();
  };
  crystal(x - 4 * scale, y - 3 * scale, 5 * scale, "#e0a800");
  crystal(x + 3 * scale, y - 5 * scale, 4 * scale, "#ffd23f");
  crystal(x + 5 * scale, y + 1 * scale, 3.5 * scale, "#e0a800");

  ctx.strokeStyle = "#fff7cc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 2 * scale, y - 8 * scale);
  ctx.lineTo(x + 2 * scale, y - 4 * scale);
  ctx.moveTo(x, y - 6 * scale);
  ctx.lineTo(x + 4 * scale, y - 6 * scale);
  ctx.stroke();
}

function drawResource(node) {
  const scale = 0.55 + 0.45 * (node.amount / NODE_START_AMOUNT);
  const [sx, sy] = shakeOffset(node);
  const x = node.x + sx;
  const y = node.y + sy;
  if (node.type === "wood") drawTree(x, y, scale);
  else if (node.type === "stone") drawRock(x, y, scale);
  else if (node.type === "ore") drawOre(x, y, scale);
}

// Material tier per wall level — same shape at every level, just a
// different skin, so an upgraded wall reads as visibly sturdier at a
// glance: wood -> stone -> reinforced (with rivets).
const WALL_LEVEL_STYLE = {
  1: { fill: "#8a5a2f", stroke: "#5a3a1c", line: "rgba(0, 0, 0, 0.25)" },
  2: { fill: "#9a9a9a", stroke: "#5f5f5f", line: "rgba(0, 0, 0, 0.3)" },
  3: { fill: "#5a6068", stroke: "#2b2e33", line: "rgba(255, 255, 255, 0.15)" },
};

// Square, sized to exactly one PLACE_GRID cell — so walls placed on
// neighboring grid cells butt up edge-to-edge with no gap or overlap,
// which is what makes lining up a fence or walled-off area straightforward.
const WALL_HALF = PLACE_GRID / 2;

function drawWall(x, y, level = 1) {
  const style = WALL_LEVEL_STYLE[level] || WALL_LEVEL_STYLE[1];
  drawShadow(x, y + WALL_HALF - 1, WALL_HALF + 1, 3);

  ctx.fillStyle = style.fill;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - WALL_HALF, y - WALL_HALF, WALL_HALF * 2, WALL_HALF * 2, 2);
  ctx.fill();
  ctx.stroke();

  // horizontal plank/mortar line
  ctx.strokeStyle = style.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - WALL_HALF, y);
  ctx.lineTo(x + WALL_HALF, y);
  ctx.stroke();

  if (level >= 3) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    for (const rx of [-WALL_HALF + 2, WALL_HALF - 2]) {
      for (const ry of [-WALL_HALF + 2, WALL_HALF - 2]) {
        ctx.beginPath();
        ctx.arc(x + rx, y + ry, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawStructure(s, isDemolishTarget = false) {
  const level = s.level || 1;
  if (!isDemolishTarget) {
    if (s.type === "wall") drawWall(s.x, s.y, level);
    return;
  }

  // In range to demolish (E hits this one): pulse a red ring on the ground
  // and bob the structure up off it, so it's unmistakably the one that will
  // be torn down and not one of its neighbors.
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);
  ctx.save();
  ctx.fillStyle = `rgba(230, 90, 90, ${0.1 + pulse * 0.15})`;
  ctx.strokeStyle = `rgba(230, 90, 90, ${0.4 + pulse * 0.5})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(s.x, s.y + WALL_HALF, WALL_HALF + 4, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const bob = 3 + pulse * 3;
  if (s.type === "wall") drawWall(s.x, s.y - bob, level);
}

// The "you're about to place here" slot — a highlighted square at the
// snapped target position (green if it's a legal spot, red if not), with a
// translucent preview of the structure itself sitting on top of it. Used
// both for a brand-new build (placingType) and for relocating an existing
// structure (movingStructure) — the latter is free, so affordability isn't
// part of its validity check, and it excludes its own pre-move position
// from the collision check so putting it back down nearby isn't blocked.
function drawPlacementGhost() {
  const type = placingType || (movingStructure && movingStructure.type);
  if (!type) return;
  const { x, y } = placementPosition();
  const structure = STRUCTURES[type];
  const excludeId = movingStructure ? movingStructure._id : undefined;
  const affordable = placingType ? structureAfford(placingType) : true;
  const valid = affordable && !positionBlocked(x, y, excludeId);
  const half = structure.radius + 4;

  ctx.fillStyle = valid ? "rgba(90, 220, 120, 0.2)" : "rgba(230, 90, 90, 0.2)";
  ctx.strokeStyle = valid ? "rgba(90, 220, 120, 0.9)" : "rgba(230, 90, 90, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(x - half, y - half, half * 2, half * 2);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = 0.6;
  drawStructure({ type, x, y, level: movingStructure ? movingStructure.level : 1 });
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Everything below is drawn in world coordinates — this scale+translate
  // is the entire camera (zoom first, so the translate is expressed in
  // already-zoomed screen pixels: screen = (world - camera) * ZOOM). No
  // other draw function needs to know cameraX/Y or ZOOM exist.
  ctx.save();
  ctx.scale(ZOOM, ZOOM);
  ctx.translate(-cameraX, -cameraY);

  drawGrid();

  for (const node of resources) {
    if (node.amount <= 0) continue;
    drawResource(node);
  }

  for (const s of player.structures) {
    if (movingStructure && s._id === movingStructure._id) continue; // shown as the ghost instead
    drawStructure(s, s === nearbyStructure);
  }
  drawPlacementGhost();

  drawCharacter(player.x, player.y);
  drawFloatingTexts();
  drawFog();

  ctx.restore();

  drawMinimap();
}

// Top-left minimap of the whole world: resource dots, the current camera
// viewport outline, and the player. Drawn in plain screen coordinates
// (after the camera ctx.restore() above), and kept translucent so it never
// fully hides the game underneath it.
const MINIMAP_W = window.matchMedia("(pointer: coarse)").matches ? 150 : 320;
const MINIMAP_H = Math.round(MINIMAP_W * (WORLD_H / WORLD_W));
const MINIMAP_MARGIN = 12;
const MINIMAP_DOT_COLOR = { wood: "#8a5a2f", stone: "#c2c2c2", ore: "#ffd23f" };

function drawMinimap() {
  const scaleX = MINIMAP_W / WORLD_W;
  const scaleY = MINIMAP_H / WORLD_H;
  const mapX = MINIMAP_MARGIN;
  const mapY = MINIMAP_MARGIN;

  ctx.save();

  ctx.fillStyle = "rgba(20, 40, 25, 0.45)";
  ctx.fillRect(mapX, mapY, MINIMAP_W, MINIMAP_H);

  ctx.beginPath();
  ctx.rect(mapX, mapY, MINIMAP_W, MINIMAP_H);
  ctx.clip();

  // Same fog the main view uses — unexplored ground stays dark here too, at
  // cell resolution since drawing WORLD_W x WORLD_H worth of individual
  // fog cells this small would just look noisy.
  const cellW = FOG_CELL * scaleX;
  const cellH = FOG_CELL * scaleY;
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  for (let r = 0; r < FOG_ROWS; r++) {
    for (let c = 0; c < FOG_COLS; c++) {
      if (!exploredCells[r * FOG_COLS + c]) {
        ctx.fillRect(mapX + c * cellW, mapY + r * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
  }

  for (const node of resources) {
    if (node.amount <= 0) continue;
    const cell = Math.floor(node.y / FOG_CELL) * FOG_COLS + Math.floor(node.x / FOG_CELL);
    if (!exploredCells[cell]) continue; // hidden until you've actually been near it
    ctx.fillStyle = MINIMAP_DOT_COLOR[node.type] || "#fff";
    ctx.beginPath();
    ctx.arc(mapX + node.x * scaleX, mapY + node.y * scaleY, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Built structures — always shown regardless of fog, since the player
  // placed them and already knows where they are. Square marker to read as
  // distinct from the round resource dots above.
  ctx.fillStyle = "#c9a06a";
  for (const s of player.structures) {
    if (movingStructure && s._id === movingStructure._id) continue; // being relocated right now
    ctx.fillRect(mapX + s.x * scaleX - 2, mapY + s.y * scaleY - 2, 4, 4);
  }

  // Outline of what the camera currently shows
  const view = viewWorldSize();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    mapX + cameraX * scaleX,
    mapY + cameraY * scaleY,
    view.w * scaleX,
    view.h * scaleY
  );

  ctx.fillStyle = "#4c8bf5";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(mapX + player.x * scaleX, mapY + player.y * scaleY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(mapX, mapY, MINIMAP_W, MINIMAP_H);
}

// Dig-swing phase boundaries (fraction of digDurationMs). Shared with
// handleDigging() so the impact sound/shake fire on the exact frame the
// animation reaches full extension.
const DIG_WINDUP_END = 0.3;
const DIG_THRUST_END = 0.48;
const DIG_HOLD_END = 0.6;
const PUNCH_ANGLE = 15 * (Math.PI / 180);

// Bare-handed gathering (no tool yet): windup -> explosive thrust -> impact
// hold -> recovery, along a fixed forward angle — reads as a punch/push.
function punchAnimation(progress) {
  if (progress < DIG_WINDUP_END) {
    const p = progress / DIG_WINDUP_END;
    const eased = 1 - Math.pow(1 - p, 2);
    return {
      angle: PUNCH_ANGLE,
      armLen: 6 - eased * 12,
      bodyLeanX: -eased * 3,
      squash: -eased * 1.5,
    };
  }
  if (progress < DIG_THRUST_END) {
    const p = (progress - DIG_WINDUP_END) / (DIG_THRUST_END - DIG_WINDUP_END);
    const eased = p * p;
    return {
      angle: PUNCH_ANGLE,
      armLen: -6 + eased * 21,
      bodyLeanX: -3 + eased * 8,
      squash: -1.5 + eased * 2.5,
    };
  }
  if (progress < DIG_HOLD_END) {
    return { angle: PUNCH_ANGLE, armLen: 15, bodyLeanX: 5, squash: 1 };
  }
  const p = (progress - DIG_HOLD_END) / (1 - DIG_HOLD_END);
  const eased = 1 - Math.pow(1 - p, 2);
  return {
    angle: PUNCH_ANGLE,
    armLen: 15 - eased * 9,
    bodyLeanX: 5 - eased * 5,
    squash: 1 - eased,
  };
}

// Once a tool is owned, gathering looks like actually using it: the tool
// raises up and back over the shoulder (windup), then swings down through an
// arc onto the resource (thrust/impact), instead of a straight punch.
const CHOP_ANGLE_WINDUP = -100 * (Math.PI / 180);
const CHOP_ANGLE_IMPACT = 65 * (Math.PI / 180);

function chopAnimation(progress) {
  if (progress < DIG_WINDUP_END) {
    const p = progress / DIG_WINDUP_END;
    const eased = 1 - Math.pow(1 - p, 2);
    return {
      angle: PUNCH_ANGLE + eased * (CHOP_ANGLE_WINDUP - PUNCH_ANGLE),
      armLen: 10 + eased * 4,
      bodyLeanX: -eased * 2,
      squash: -eased * 1.2,
    };
  }
  if (progress < DIG_THRUST_END) {
    const p = (progress - DIG_WINDUP_END) / (DIG_THRUST_END - DIG_WINDUP_END);
    const eased = p * p;
    return {
      angle: CHOP_ANGLE_WINDUP + eased * (CHOP_ANGLE_IMPACT - CHOP_ANGLE_WINDUP),
      armLen: 14 + eased * 4,
      bodyLeanX: -2 + eased * 6,
      squash: -1.2 + eased * 2,
    };
  }
  if (progress < DIG_HOLD_END) {
    return { angle: CHOP_ANGLE_IMPACT, armLen: 18, bodyLeanX: 4, squash: 1 };
  }
  const p = (progress - DIG_HOLD_END) / (1 - DIG_HOLD_END);
  const eased = 1 - Math.pow(1 - p, 2);
  return {
    angle: CHOP_ANGLE_IMPACT + eased * (PUNCH_ANGLE - CHOP_ANGLE_IMPACT),
    armLen: 18 - eased * 8,
    bodyLeanX: 4 - eased * 4,
    squash: 1 - eased,
  };
}

function drawDigArm(shoulderX, shoulderY, backShoulderX, backShoulderY, toolType, toolLevel, armLen, angle) {
  const tipX = shoulderX + Math.cos(angle) * armLen;
  const tipY = shoulderY + Math.sin(angle) * armLen;

  // front arm: shoulder -> hand
  ctx.strokeStyle = "#2c3e50";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  if (toolLevel < 1) {
    // bare hands — just a fist at the end of the punch
    ctx.fillStyle = "#ffd8a8";
    ctx.beginPath();
    ctx.arc(tipX, tipY, 3.2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // has a tool: the handle continues past the hand, gripped with both hands
  const handleLen = 11;
  const headX = tipX + Math.cos(angle) * handleLen;
  const headY = tipY + Math.sin(angle) * handleLen;

  ctx.strokeStyle = "#8a5a2f";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(headX, headY);
  ctx.stroke();

  // second hand grips further down the same handle — a real two-handed swing
  const gripX = tipX + (headX - tipX) * 0.35;
  const gripY = tipY + (headY - tipY) * 0.35;
  ctx.strokeStyle = "#2c3e50";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(backShoulderX, backShoulderY);
  ctx.lineTo(gripX, gripY);
  ctx.stroke();

  const upgraded = toolLevel >= 2;

  // draw the actual tool head, oriented along the swing angle
  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(angle);

  if (toolType === "wood") {
    ctx.fillStyle = upgraded ? "#ffd23f" : "#c9c9c9";
    ctx.strokeStyle = upgraded ? "#c99a1f" : "#6e6e6e";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(2, -7);
    ctx.lineTo(9, -3);
    ctx.lineTo(7, 5);
    ctx.lineTo(-1, 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (upgraded) {
      ctx.fillStyle = "#fff3c4";
      ctx.beginPath();
      ctx.arc(5, -2, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = upgraded ? "#5c5c5c" : "#8a8a8a";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-8, -5);
    ctx.lineTo(0, 0);
    ctx.lineTo(9, -4);
    ctx.stroke();
    if (upgraded) {
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath();
      ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawCharacter(x, y) {
  const digging = isDigging;
  const digProgress = digging ? Math.min(1, (Date.now() - digStartedAt) / digDurationMs) : 0;

  const bob = digging ? 0 : isMoving ? Math.abs(Math.sin(walkPhase)) * 2 : Math.sin(idlePhase) * 1;
  const legSwing = digging || !isMoving ? 0 : Math.sin(walkPhase) * 6;
  const armSwing = digging || !isMoving ? 0 : Math.sin(walkPhase + Math.PI) * 5;

  const digToolType = digTargetNode ? digTargetNode.type : "wood";
  const digToolLevel = digging
    ? digToolType === "wood"
      ? player.upgrades.axeLevel
      : player.upgrades.pickaxeLevel
    : 0;
  const dig = digging
    ? digToolLevel >= 1
      ? chopAnimation(digProgress)
      : punchAnimation(digProgress)
    : { angle: PUNCH_ANGLE, armLen: 0, bodyLeanX: 0, squash: 0 };
  const legPlant = digging ? Math.max(0, dig.bodyLeanX) * 0.5 : 0;

  const { flip, face } = DIR_TABLE[dirIndex];
  const lean = face === "side" ? 3 : face === "frontQuarter" || face === "backQuarter" ? 2 : 0;

  // Facing straight up/down, fore-aft leg/arm swing is edge-on and invisible,
  // so walking there alternates a vertical lift instead of the sideways swing.
  const facingVertical = !digging && isMoving && (face === "front" || face === "back");
  const legLift = facingVertical ? Math.sin(walkPhase) * 4 : 0;
  const armLift = facingVertical ? Math.sin(walkPhase + Math.PI) * 3 : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip, 1);
  ctx.translate(lean, 0);

  // shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 17, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#2c3e50";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  // legs — front foot plants forward slightly as the body lunges into the hit
  const legSwingX = facingVertical ? 0 : legSwing;
  ctx.beginPath();
  ctx.moveTo(-4, 5 - bob);
  ctx.lineTo(-4 + legSwingX * 0.4, 15 - bob - Math.max(0, legLift));
  ctx.moveTo(4, 5 - bob);
  ctx.lineTo(4 - legSwingX * 0.4 + legPlant, 15 - bob - Math.max(0, -legLift));
  ctx.stroke();

  // back arm — with a tool, drawDigArm below draws it gripping the handle
  // (a real two-handed swing). Bare-handed, it counter-swings with the punch
  // for balance; while walking, it's the normal opposite-phase arm swing.
  if (!(digging && digToolLevel >= 1)) {
    const armSwingX = facingVertical ? 0 : armSwing;
    const backArmX = digging ? -9 - dig.armLen * 0.3 : -9 + armSwingX * 0.4;
    const backArmY = digging ? 6 - bob - Math.max(0, dig.armLen) * 0.15 : 8 - bob - Math.max(0, -armLift);
    ctx.beginPath();
    ctx.moveTo(-9, -1 - bob);
    ctx.lineTo(backArmX, backArmY);
    ctx.stroke();
  }

  // front arm — normal swing, or a windup/thrust/hold dig swing while gathering
  if (digging) {
    drawDigArm(9, -1, -9, -1 - bob, digToolType, digToolLevel, dig.armLen, dig.angle);
  } else {
    const armSwingX = facingVertical ? 0 : armSwing;
    ctx.beginPath();
    ctx.moveTo(9, -1 - bob);
    ctx.lineTo(9 - armSwingX * 0.4, 8 - bob - Math.max(0, armLift));
    ctx.stroke();
  }

  // torso + head lunge forward with the punch (feet stay planted), with a
  // touch of squash-and-stretch: compressed on windup/impact, stretched
  // through the thrust — sells the sense of force.
  ctx.save();
  ctx.translate(dig.bodyLeanX, 0);
  ctx.scale(1 + dig.squash * 0.04, 1 - dig.squash * 0.06);

  // body
  ctx.fillStyle = "#4c8bf5";
  ctx.beginPath();
  ctx.roundRect(-9, -9 - bob, 18, 18, 6);
  ctx.fill();

  // head
  ctx.fillStyle = "#ffd8a8";
  ctx.beginPath();
  ctx.arc(0, -17 - bob, 8, 0, Math.PI * 2);
  ctx.fill();

  const headY = -17 - bob;

  // ear peeking out — any pose where the head has turned off pure front/back
  if (face === "frontQuarter" || face === "side" || face === "backQuarter") {
    ctx.fillStyle = "#ffd8a8";
    ctx.beginPath();
    ctx.arc(7, headY, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  if (face === "front") {
    ctx.fillStyle = "#2c3e50";
    ctx.beginPath();
    ctx.arc(-3, headY - 1, 1.3, 0, Math.PI * 2);
    ctx.arc(3, headY - 1, 1.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (face === "frontQuarter") {
    ctx.fillStyle = "#2c3e50";
    ctx.beginPath();
    ctx.arc(-1, headY - 1, 1.3, 0, Math.PI * 2);
    ctx.arc(5, headY - 1, 1.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (face === "side") {
    ctx.fillStyle = "#2c3e50";
    ctx.beginPath();
    ctx.arc(5, headY - 1, 1.4, 0, Math.PI * 2);
    ctx.fill();
    // nose bump
    ctx.fillStyle = "#ffd8a8";
    ctx.beginPath();
    ctx.moveTo(7, headY - 1);
    ctx.lineTo(10, headY);
    ctx.lineTo(7, headY + 2);
    ctx.closePath();
    ctx.fill();
  } else if (face === "backQuarter") {
    ctx.fillStyle = "#5a3921";
    ctx.beginPath();
    ctx.arc(2, headY - 3, 6, Math.PI, Math.PI * 2);
    ctx.fill();
  } else if (face === "back") {
    ctx.fillStyle = "#5a3921";
    ctx.beginPath();
    ctx.arc(0, headY - 3, 6, Math.PI, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore(); // undo bodyLeanX

  ctx.restore();

  ctx.fillStyle = "white";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(player.name, x, y - 34);
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

// Sizes the canvas's actual pixel buffer to match canvas-wrap's real
// rendered box, on every device — the game world fills whatever window/
// screen it's actually running in instead of sitting in a fixed 800x600 box.
function resizeCanvas() {
  const rect = document.getElementById("canvas-wrap").getBoundingClientRect();
  const w = Math.max(200, Math.round(rect.width));
  const h = Math.max(150, Math.round(rect.height));
  if (w === CANVAS_W && h === CANVAS_H) return false;

  CANVAS_W = w;
  CANVAS_H = h;
  canvas.width = w;
  canvas.height = h;
  return true;
}

function startGame() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");

  canvas = document.getElementById("game-canvas");
  ctx = canvas.getContext("2d");
  resizeCanvas();

  // Just resize the viewport now — the world itself (and resource layout)
  // is a fixed size independent of screen size, so rotating/resizing only
  // changes how much of it is visible, not where anything is.
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 200));

  document.getElementById("wood-icon").src = getResourceIconUrl("wood");
  document.getElementById("stone-icon").src = getResourceIconUrl("stone");
  document.getElementById("ore-icon").src = getResourceIconUrl("ore");
  document.getElementById("craft-btn-icon").src = getCraftButtonIconUrl();
  document.getElementById("build-btn-icon").src = getBuildButtonIconUrl();
  document.getElementById("fullscreen-btn-icon").src = getFullscreenButtonIconUrl();
  // iOS Safari has no element Fullscreen API at all — a button that can
  // never do anything is worse than no button, so hide it there.
  if (!document.documentElement.requestFullscreen) {
    document.getElementById("fullscreen-btn").classList.add("hidden");
  }

  spawnResources();
  renderHud();

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();

    if (k === "c") {
      toggleCraftPanel();
      return;
    }

    if (k === "b") {
      toggleBuildPanel();
      return;
    }

    // Only intercept the confirm/cancel keys here and fall through for
    // everything else — WASD still reaches `keys.add(k)` below as normal,
    // but update() reads placingType/movingStructure and steers that input
    // into nudging the placement ghost instead of walking the character.
    // "e" is handled by the shared performAction() further down.
    if (placingType || movingStructure) {
      if (k === "enter") {
        e.preventDefault();
        confirmPlacement();
        return;
      }
      if (k === "escape") {
        cancelPlacing();
        return;
      }
    } else if (nearbyStructure) {
      if (k === "m") {
        startMovingStructure(nearbyStructure);
        return;
      }
      if (k === "u" && !structureUpgradeInfo(nearbyStructure).maxed) {
        upgradeStructure(nearbyStructure);
        return;
      }
    }

    if (isCraftPanelOpen()) {
      if (k === "arrowup" || k === "w") {
        e.preventDefault();
        moveCraftSelection(-1);
      } else if (k === "arrowdown" || k === "s") {
        e.preventDefault();
        moveCraftSelection(1);
      } else if (k === "enter") {
        e.preventDefault();
        activateSelectedCraft();
      } else if (k === "escape") {
        closeCraftPanel();
      }
      return; // swallow everything else (no movement/gathering with the menu open)
    }

    if (isBuildPanelOpen()) {
      if (k === "escape") closeBuildPanel();
      return; // swallow everything else (no movement/gathering with the menu open)
    }

    if (k === "e") {
      performAction();
      return;
    }
    keys.add(k);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  document.getElementById("close-craft").addEventListener("click", closeCraftPanel);
  document.getElementById("close-build").addEventListener("click", closeBuildPanel);
  document.getElementById("build-btn").addEventListener("click", toggleBuildPanel);
  document.getElementById("fullscreen-btn").addEventListener("click", toggleFullscreen);
  document.getElementById("panel-backdrop").addEventListener("click", () => {
    closeCraftPanel();
    closeBuildPanel();
  });
  document.getElementById("reset-btn").addEventListener("click", resetPlayer);
  setupTouchControls();

  saveTimer = setInterval(savePlayer, 5000);
  window.addEventListener("beforeunload", () => {
    navigator.sendBeacon(
      `${API_BASE}/player/${encodeURIComponent(player.name)}/save`,
      new Blob([JSON.stringify({ x: player.x, y: player.y, inventory: player.inventory })], {
        type: "application/json",
      })
    );
  });

  loop();
}

document.getElementById("start-btn").addEventListener("click", async () => {
  const name = document.getElementById("name-input").value.trim();
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";
  if (!name) {
    errorEl.textContent = "Please enter a name";
    return;
  }
  // Must fire directly on the click, before any await, or browsers drop the
  // "user activation" fullscreen needs and silently refuse the request.
  // (No-ops on iOS Safari, which doesn't support element fullscreen at all —
  // there, "Add to Home Screen" via the manifest is the real fix.)
  document.documentElement.requestFullscreen?.().catch(() => {});
  try {
    initAudio();
    player = await loginOrCreate(name);
    player.structures = player.structures || [];
    startGame();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("start-btn").click();
});
