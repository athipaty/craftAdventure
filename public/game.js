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
const GATHER_RADIUS = 32;
const RESPAWN_MS = 15000;
const BASE_SPEED = 1.2;
const NODE_START_AMOUNT = 8;
const DIG_DURATION_MS = 500;
const PLAYER_RADIUS = 10;
const RESOURCE_COLLISION_RADIUS = { wood: 14, stone: 12, ore: 12 };

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

function positionBlocked(x, y) {
  for (const node of resources) {
    if (node.amount <= 0) continue;
    const scale = 0.55 + 0.45 * (node.amount / NODE_START_AMOUNT);
    const minDist = PLAYER_RADIUS + (RESOURCE_COLLISION_RADIUS[node.type] || 12) * scale;
    if (Math.hypot(node.x - x, node.y - y) < minDist) return true;
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
function updateCamera() {
  const maxCamX = Math.max(0, WORLD_W - CANVAS_W);
  const maxCamY = Math.max(0, WORLD_H - CANVAS_H);
  cameraX = Math.max(0, Math.min(maxCamX, player.x - CANVAS_W / 2));
  cameraY = Math.max(0, Math.min(maxCamY, player.y - CANVAS_H / 2));
}

// Faint world-space grid so panning the camera over empty ground still
// reads as movement, not just a static green backdrop.
function drawGrid() {
  const gridSize = 120;
  const startX = Math.floor(cameraX / gridSize) * gridSize;
  const startY = Math.floor(cameraY / gridSize) * gridSize;

  ctx.strokeStyle = "rgba(0, 0, 0, 0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x <= cameraX + CANVAS_W; x += gridSize) {
    ctx.moveTo(x, cameraY);
    ctx.lineTo(x, cameraY + CANVAS_H);
  }
  for (let y = startY; y <= cameraY + CANVAS_H; y += gridSize) {
    ctx.moveTo(cameraX, y);
    ctx.lineTo(cameraX + CANVAS_W, y);
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

    isDigging = false;
    digTargetNode = null;
    closeCraftPanel();
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

function renderCraftPanel() {
  const list = document.getElementById("craft-list");
  list.innerHTML = "";
  const entries = Object.entries(RECIPES);

  entries.forEach(([key, recipe], index) => {
    const { currentLevel, maxed, nextCost, canAfford } = craftEntryState(key);

    const row = document.createElement("div");
    row.className =
      "craft-item" +
      (index === selectedCraftIndex ? " selected" : "") +
      (!maxed && canAfford ? " craftable" : "");
    row.addEventListener("click", () => {
      selectedCraftIndex = index;
      renderCraftPanel();
    });

    // Just the essentials: current tool -> next tool, and what it costs.
    row.innerHTML = `
      <img class="tool-icon" src="${getToolIconUrl(key, currentLevel)}" alt="${recipe.label} current" />
      ${
        maxed
          ? `<span class="max-badge">MAX</span>`
          : `<span class="upgrade-arrow">→</span>
             <img class="tool-icon" src="${getToolIconUrl(key, currentLevel + 1)}" alt="${recipe.label} next" />
             <div class="cost-row">${buildCostPillsHtml(nextCost)}</div>`
      }
    `;

    const btn = document.createElement("button");
    btn.textContent = maxed ? "Maxed" : "Craft";
    btn.disabled = maxed || !canAfford;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      craftItem(key);
    });
    row.appendChild(btn);

    list.appendChild(row);
  });
}

function moveCraftSelection(delta) {
  const count = Object.keys(RECIPES).length;
  selectedCraftIndex = (selectedCraftIndex + delta + count) % count;
  renderCraftPanel();
}

function activateSelectedCraft() {
  const key = Object.keys(RECIPES)[selectedCraftIndex];
  const { maxed, canAfford } = craftEntryState(key);
  if (!maxed && canAfford) craftItem(key);
}

function isCraftPanelOpen() {
  return !document.getElementById("craft-panel").classList.contains("hidden");
}

function openCraftPanel() {
  document.getElementById("craft-panel").classList.remove("hidden");
  keys.clear();
  selectedCraftIndex = 0;
  renderCraftPanel();
}

function closeCraftPanel() {
  document.getElementById("craft-panel").classList.add("hidden");
}

function toggleCraftPanel() {
  if (isCraftPanelOpen()) closeCraftPanel();
  else openCraftPanel();
}

function update() {
  updateCamera();

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
  updateDigPrompt();
}

function startDig(node) {
  isDigging = true;
  digTargetNode = node;
  digStartedAt = Date.now();
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
  const progress = Math.min(1, elapsed / DIG_DURATION_MS);
  if (!digImpactTriggered && progress >= DIG_THRUST_END && digTargetNode) {
    digTargetNode.hitAt = now;
    digImpactTriggered = true;
    playHit(digTargetNode.type);
  }

  if (elapsed < DIG_DURATION_MS) return;

  const node = digTargetNode;
  isDigging = false;
  digTargetNode = null;

  if (!node || node.amount <= 0) return;
  const cap = capacityFor(player.upgrades.bagLevel);
  const remainingCapacity = cap - totalCarried(player.inventory);
  if (remainingCapacity <= 0) return;

  const toolLevel = node.type === "wood" ? player.upgrades.axeLevel : player.upgrades.pickaxeLevel;
  const gained = Math.min(1 + toolLevel, node.amount, remainingCapacity);
  player.inventory[node.type] += gained;
  node.amount -= gained;
  if (node.amount <= 0) node.respawnAt = Date.now() + RESPAWN_MS;
  spawnFloatingText(node.x, node.y - 20, `+${gained}`, RESOURCE_TEXT_COLOR[node.type]);
  renderHud();
}

// Bottom-left circular joystick (drag to move) and bottom-right action
// button (tap to hit/gather), plus a mouse fallback so the layout can be
// checked on desktop. Touches are tracked by identifier so dragging the
// joystick doesn't get confused by a second finger tapping the action button.
function setupTouchControls() {
  const base = document.getElementById("joystick-base");
  const knob = document.getElementById("joystick-knob");
  let activeId = null;

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
  }

  base.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      activeId = t.identifier;
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

  base.addEventListener("mousedown", (e) => {
    activeId = "mouse";
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
    if (!isDigging && nearbyNode) startDig(nearbyNode);
  };
  actionBtn.addEventListener("touchstart", triggerAction, { passive: false });
  actionBtn.addEventListener("click", triggerAction);

  document.getElementById("craft-btn").addEventListener("click", toggleCraftPanel);
}

function updateDigPrompt() {
  const prompt = document.getElementById("dig-prompt");
  const actionBtn = document.getElementById("action-btn");
  if (isDigging) {
    prompt.textContent = `Gathering ${digTargetNode.type}...`;
    prompt.classList.remove("hidden");
    actionBtn.classList.add("hidden");
  } else if (nearbyNode) {
    prompt.textContent = `Press E to gather ${nearbyNode.type}`;
    prompt.classList.remove("hidden");
    actionBtn.classList.remove("hidden");
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

function draw() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Everything below is drawn in world coordinates — this one translate is
  // the entire camera. No other draw function needs to know cameraX/Y exist.
  ctx.save();
  ctx.translate(-cameraX, -cameraY);

  drawGrid();

  for (const node of resources) {
    if (node.amount <= 0) continue;
    drawResource(node);
  }

  drawCharacter(player.x, player.y);
  drawFloatingTexts();

  ctx.restore();

  drawMinimap();
}

// Top-left minimap of the whole world: resource dots, the current camera
// viewport outline, and the player. Drawn in plain screen coordinates
// (after the camera ctx.restore() above), and kept translucent so it never
// fully hides the game underneath it.
const MINIMAP_W = 260;
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

  for (const node of resources) {
    if (node.amount <= 0) continue;
    ctx.fillStyle = MINIMAP_DOT_COLOR[node.type] || "#fff";
    ctx.beginPath();
    ctx.arc(mapX + node.x * scaleX, mapY + node.y * scaleY, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Outline of what the camera currently shows
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    mapX + cameraX * scaleX,
    mapY + cameraY * scaleY,
    CANVAS_W * scaleX,
    CANVAS_H * scaleY
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

// Dig-swing phase boundaries (fraction of DIG_DURATION_MS). Shared with
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
  const digProgress = digging ? Math.min(1, (Date.now() - digStartedAt) / DIG_DURATION_MS) : 0;

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
  ctx.beginPath();
  ctx.moveTo(-4, 5 - bob);
  ctx.lineTo(-4 + legSwing * 0.4, 15 - bob);
  ctx.moveTo(4, 5 - bob);
  ctx.lineTo(4 - legSwing * 0.4 + legPlant, 15 - bob);
  ctx.stroke();

  // back arm — with a tool, drawDigArm below draws it gripping the handle
  // (a real two-handed swing). Bare-handed, it counter-swings with the punch
  // for balance; while walking, it's the normal opposite-phase arm swing.
  if (!(digging && digToolLevel >= 1)) {
    const backArmX = digging ? -9 - dig.armLen * 0.3 : -9 + armSwing * 0.4;
    const backArmY = digging ? 6 - bob - Math.max(0, dig.armLen) * 0.15 : 8 - bob;
    ctx.beginPath();
    ctx.moveTo(-9, -1 - bob);
    ctx.lineTo(backArmX, backArmY);
    ctx.stroke();
  }

  // front arm — normal swing, or a windup/thrust/hold dig swing while gathering
  if (digging) {
    drawDigArm(9, -1, -9, -1 - bob, digToolType, digToolLevel, dig.armLen, dig.angle);
  } else {
    ctx.beginPath();
    ctx.moveTo(9, -1 - bob);
    ctx.lineTo(9 - armSwing * 0.4, 8 - bob);
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

  spawnResources();
  renderHud();

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();

    if (k === "c") {
      toggleCraftPanel();
      return;
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

    if (k === "e") {
      if (!isDigging && nearbyNode) startDig(nearbyNode);
      return;
    }
    keys.add(k);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  document.getElementById("close-craft").addEventListener("click", closeCraftPanel);
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
  try {
    initAudio();
    player = await loginOrCreate(name);
    startGame();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("start-btn").click();
});
