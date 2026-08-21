// Point this at wherever the center-kitchen backend is running.
// Local dev default matches backend/.env PORT=5000.
const API_BASE = "http://localhost:5000/api/craft-adventure";

const RESOURCE_TYPES = {
  wood: { color: "#6b4226", shape: "triangle", size: 16 },
  stone: { color: "#9e9e9e", shape: "circle", size: 12 },
  ore: { color: "#e0a800", shape: "diamond", size: 12 },
};

const CANVAS_W = 800;
const CANVAS_H = 600;
const GATHER_RADIUS = 28;
const GATHER_COOLDOWN_MS = 450;
const RESPAWN_MS = 15000;
const BASE_SPEED = 2.6;
const NODE_START_AMOUNT = 8;

let player = null;
let resources = [];
let keys = new Set();
let lastGatherAt = 0;
let saveTimer = null;
let canvas, ctx;

function capacityFor(bagLevel) {
  return [50, 80, 120][bagLevel] ?? 50;
}

function totalCarried(inv) {
  return inv.wood + inv.stone + inv.ore;
}

function spawnResources() {
  resources = [];
  const counts = { wood: 12, stone: 9, ore: 6 };
  for (const [type, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      resources.push({
        type,
        x: 40 + Math.random() * (CANVAS_W - 80),
        y: 40 + Math.random() * (CANVAS_H - 80),
        amount: NODE_START_AMOUNT,
        respawnAt: 0,
      });
    }
  }
}

async function loginOrCreate(name) {
  const res = await fetch(`${API_BASE}/player/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error((await res.json()).error || "Failed to load player");
  return res.json();
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

function renderCraftPanel() {
  const list = document.getElementById("craft-list");
  list.innerHTML = "";
  for (const [key, recipe] of Object.entries(RECIPES)) {
    const currentLevel = player.upgrades[recipe.upgradeKey] || 0;
    const maxed = currentLevel >= recipe.maxLevel;
    const nextCost = !maxed ? recipe.costs[currentLevel + 1] : null;
    const canAfford =
      nextCost && Object.entries(nextCost).every(([res, amt]) => player.inventory[res] >= amt);

    const row = document.createElement("div");
    row.className = "craft-item";

    const costText = nextCost
      ? Object.entries(nextCost).map(([res, amt]) => `${amt} ${res}`).join(", ")
      : "max level";

    row.innerHTML = `
      <div class="info">
        <b>${recipe.label} (Lv ${currentLevel}/${recipe.maxLevel})</b>
        <small>${recipe.description}</small>
        <small>${maxed ? "" : "Cost: " + costText}</small>
      </div>
    `;

    const btn = document.createElement("button");
    btn.textContent = maxed ? "Maxed" : "Craft";
    btn.disabled = maxed || !canAfford;
    btn.addEventListener("click", () => craftItem(key));
    row.appendChild(btn);

    list.appendChild(row);
  }
}

function toggleCraftPanel() {
  const panel = document.getElementById("craft-panel");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) renderCraftPanel();
}

function update() {
  const speed = BASE_SPEED * (1 + 0.25 * player.upgrades.bootsLevel);
  let dx = 0, dy = 0;
  if (keys.has("arrowup") || keys.has("w")) dy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) dy += 1;
  if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
  if (keys.has("arrowright") || keys.has("d")) dx += 1;

  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    player.x = Math.min(CANVAS_W - 14, Math.max(14, player.x + (dx / len) * speed));
    player.y = Math.min(CANVAS_H - 14, Math.max(14, player.y + (dy / len) * speed));
  }

  const now = Date.now();
  for (const node of resources) {
    if (node.amount <= 0) {
      if (now >= node.respawnAt) node.amount = NODE_START_AMOUNT;
      continue;
    }
    const dist = Math.hypot(node.x - player.x, node.y - player.y);
    if (dist <= GATHER_RADIUS && now - lastGatherAt >= GATHER_COOLDOWN_MS) {
      const cap = capacityFor(player.upgrades.bagLevel);
      if (totalCarried(player.inventory) >= cap) continue;

      const toolLevel =
        node.type === "wood" ? player.upgrades.axeLevel : player.upgrades.pickaxeLevel;
      const gained = Math.min(1 + toolLevel, node.amount);
      player.inventory[node.type] += gained;
      node.amount -= gained;
      lastGatherAt = now;
      if (node.amount <= 0) node.respawnAt = now + RESPAWN_MS;
      renderHud();
      break;
    }
  }
}

function drawShape(shape, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(x, y, size, 0, Math.PI * 2);
  } else if (shape === "triangle") {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.lineTo(x + size, y + size);
    ctx.closePath();
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
  }
  ctx.fill();
}

function draw() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  for (const node of resources) {
    if (node.amount <= 0) continue;
    const def = RESOURCE_TYPES[node.type];
    drawShape(def.shape, node.x, node.y, def.size, def.color);
  }

  drawShape("circle", player.x, player.y, 14, "#4c8bf5");
  ctx.fillStyle = "white";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(player.name, player.x, player.y - 22);
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

function startGame() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");

  canvas = document.getElementById("game-canvas");
  ctx = canvas.getContext("2d");

  spawnResources();
  renderHud();

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "c") {
      toggleCraftPanel();
      return;
    }
    keys.add(k);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  document.getElementById("close-craft").addEventListener("click", toggleCraftPanel);

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
    player = await loginOrCreate(name);
    startGame();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("start-btn").click();
});
