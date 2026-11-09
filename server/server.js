// The Gear Fight! ghost server. Players upload the record of a duel they
// played, and fetch another player's record to duel against. No logins and
// nothing personal: a player is a random id the game makes, and their name
// comes from that id.
//
//   POST /ghosts             a ghost (see ghosts.js), up to 64 KB
//   GET  /ghosts/match?power=1.5&player=<id>   a ghost near that power, not the player's own
//   GET  /health
"use strict";

const http = require("http");
const { checkGhost, makeStore } = require("./ghosts");

const MAX_BODY = 64 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 30; // requests per address per minute
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://gear-fight.onrender.com").split(",").map((o) => o.trim());

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin || "");
  return allowed && origin
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" }
    : {};
}

function makeServer(store) {
  const hits = new Map(); // address: { count, since }
  function limited(address) {
    const now = Date.now();
    const entry = hits.get(address);
    if (!entry || now - entry.since > RATE_WINDOW_MS) {
      hits.set(address, { count: 1, since: now });
      if (hits.size > 10000) hits.clear();
      return false;
    }
    entry.count += 1;
    return entry.count > RATE_LIMIT;
  }

  return http.createServer((req, res) => {
    const headers = { "content-type": "application/json", ...corsHeaders(req.headers.origin) };
    const send = (status, data) => {
      res.writeHead(status, headers);
      res.end(JSON.stringify(data));
    };
    const url = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    if (url.pathname === "/health") {
      store.count().then((ghosts) => send(200, { ok: true, ghosts }), () => send(500, { ok: false }));
      return;
    }
    const address = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;
    if (limited(address)) {
      send(429, { error: "slow down" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/ghosts/match") {
      const power = Number(url.searchParams.get("power")) || 0;
      const player = url.searchParams.get("player") || "";
      store.match(Math.max(0, power), player).then(
        (ghost) => (ghost ? send(200, { name: ghost.name, power: ghost.power, rounds: ghost.rounds }) : send(404, { error: "no ghosts yet" })),
        () => send(500, { error: "storage" }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/ghosts") {
      let size = 0;
      const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          send(413, { error: "too big" });
          req.destroy();
        } else chunks.push(chunk);
      });
      req.on("end", () => {
        if (size > MAX_BODY) return;
        let ghost = null;
        try {
          ghost = checkGhost(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          ghost = null;
        }
        if (!ghost) {
          send(400, { error: "bad ghost" });
          return;
        }
        store.add(ghost).then(() => send(201, { ok: true, name: ghost.name }), () => send(500, { error: "storage" }));
      });
      return;
    }
    send(404, { error: "not found" });
  });
}

if (require.main === module) {
  makeStore().then((store) => {
    const port = Number(process.env.PORT) || 3000;
    makeServer(store).listen(port, () => console.log(`Ghost server on port ${port}`));
  });
}

module.exports = { makeServer };
