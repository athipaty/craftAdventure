// Checking and storing ghosts. A ghost is the record of one duel: what the
// player's machine sent each second of each round, and the hits it landed.
// Storage is Postgres when DATABASE_URL is set, otherwise memory (for tests
// and trying it out; memory is lost whenever the server restarts).
"use strict";

const { ghostName } = require("./names");

const MAX_ROUNDS = 3;
const MAX_SECONDS = 61;
const MAX_HITS = 200;
const MAX_VALUE = 1e9;
const KEEP_PER_PLAYER = 5;
const KEEP_IN_MEMORY = 2000;
const CLOSEST = 5; // a match is picked at random from this many of the closest ghosts

const isNumber = (x, max = MAX_VALUE) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max;

// Returns a clean ghost, or null if anything about it is off.
function checkGhost(body) {
  if (!body || typeof body !== "object") return null;
  const { player, power, rounds } = body;
  if (typeof player !== "string" || !/^[0-9a-f]{16}$/.test(player)) return null;
  if (!isNumber(power) || power <= 0) return null;
  if (!Array.isArray(rounds) || rounds.length < 1 || rounds.length > MAX_ROUNDS) return null;
  const clean = [];
  for (const round of rounds) {
    if (!round || typeof round !== "object") return null;
    const { start, soldiers, hits } = round;
    if (!isNumber(start) || start <= 0) return null;
    if (!Array.isArray(soldiers) || soldiers.length < 1 || soldiers.length > MAX_SECONDS || !soldiers.every((x) => isNumber(x))) return null;
    if (!Array.isArray(hits) || hits.length > MAX_HITS) return null;
    if (!hits.every((h) => Array.isArray(h) && h.length === 2 && isNumber(h[0], MAX_SECONDS) && isNumber(h[1]))) return null;
    clean.push({ start, soldiers: soldiers.map(Number), hits: hits.map(([t, a]) => [t, a]) });
  }
  return { player, name: ghostName(player), power, rounds: clean };
}

function closeness(ghost, power) {
  return power > 0 ? Math.abs(Math.log(ghost.power / power)) : ghost.power;
}

function memoryStore() {
  let ghosts = [];
  let nextId = 1;
  return {
    async add(ghost) {
      ghosts.push({ ...ghost, id: nextId++, created: Date.now() });
      const mine = ghosts.filter((g) => g.player === ghost.player);
      if (mine.length > KEEP_PER_PLAYER) {
        const drop = new Set(mine.slice(0, mine.length - KEEP_PER_PLAYER));
        ghosts = ghosts.filter((g) => !drop.has(g));
      }
      if (ghosts.length > KEEP_IN_MEMORY) ghosts = ghosts.slice(-KEEP_IN_MEMORY);
    },
    async match(power, exclude) {
      const options = ghosts.filter((g) => g.player !== exclude).sort((a, b) => closeness(a, power) - closeness(b, power)).slice(0, CLOSEST);
      return options[Math.floor(Math.random() * options.length)] || null;
    },
    async count() {
      return ghosts.length;
    },
  };
}

async function postgresStore(url) {
  const { Pool } = require("pg");
  // Render's internal address (no dots, same region) needs no SSL; its external one does.
  const host = new URL(url).hostname;
  const pool = new Pool({ connectionString: url, ssl: host.includes(".") && host !== "127.0.0.1" ? { rejectUnauthorized: false } : false });
  await pool.query(`CREATE TABLE IF NOT EXISTS ghosts (
    id SERIAL PRIMARY KEY,
    player TEXT NOT NULL,
    name TEXT NOT NULL,
    power DOUBLE PRECISION NOT NULL,
    rounds JSONB NOT NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS ghosts_power ON ghosts (power)");
  await pool.query("CREATE INDEX IF NOT EXISTS ghosts_player ON ghosts (player, created)");
  return {
    async add(ghost) {
      await pool.query("INSERT INTO ghosts (player, name, power, rounds) VALUES ($1, $2, $3, $4)", [ghost.player, ghost.name, ghost.power, JSON.stringify(ghost.rounds)]);
      await pool.query(
        "DELETE FROM ghosts WHERE player = $1 AND id NOT IN (SELECT id FROM ghosts WHERE player = $1 ORDER BY created DESC LIMIT $2)",
        [ghost.player, KEEP_PER_PLAYER],
      );
    },
    async match(power, exclude) {
      const order = power > 0 ? "abs(ln(power / $1))" : "power + 0 * $1";
      const { rows } = await pool.query(
        `SELECT id, player, name, power, rounds FROM ghosts WHERE player <> $2 ORDER BY ${order} LIMIT ${CLOSEST}`,
        [power > 0 ? power : 1, exclude],
      );
      return rows[Math.floor(Math.random() * rows.length)] || null;
    },
    async count() {
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM ghosts");
      return rows[0].n;
    },
  };
}

// If the database can't be reached, the server still runs, on memory.
async function makeStore(url = process.env.DATABASE_URL) {
  if (!url) return memoryStore();
  try {
    return await postgresStore(url);
  } catch (error) {
    console.error("Postgres not reachable, keeping ghosts in memory:", error.message);
    return memoryStore();
  }
}

module.exports = { checkGhost, makeStore, memoryStore };
