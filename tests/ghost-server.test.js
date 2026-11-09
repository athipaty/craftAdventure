// The ghost server: what it accepts, what it hands out, and how it protects itself.
const assert = require("assert");
const { makeServer } = require("../server/server");
const { memoryStore, checkGhost } = require("../server/ghosts");
const { ghostName } = require("../server/names");

let passed = 0; const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log("  ok  ", name); }
  catch (e) { failures.push(name); console.log("  FAIL", name, "\n      ", e.message.split("\n").slice(0, 8).join("\n       ")); }
}

const ghost = (player, power = 1, extra = {}) => ({
  player, power,
  rounds: [{ start: 8, soldiers: [1, 1.2, 1.4], hits: [[1.5, 2]] }, { start: 9, soldiers: [2, 2], hits: [] }],
  ...extra,
});

(async () => {
  const server = makeServer(memoryStore());
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${base}/ghosts`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const match = (power, player) => fetch(`${base}/ghosts/match?power=${power}&player=${player}`);

  console.log("\nWhat it accepts");
  await check("turns down anything that isn't a proper ghost", async () => {
    const bad = [
      null, {}, ghost("nothex!!nothex!!"), ghost("abcd"), ghost("0123456789abcdef", -1), ghost("0123456789abcdef", Infinity),
      ghost("0123456789abcdef", 1, { rounds: [] }),
      ghost("0123456789abcdef", 1, { rounds: [1, 2, 3, 4].map(() => ({ start: 1, soldiers: [1], hits: [] })) }),
      ghost("0123456789abcdef", 1, { rounds: [{ start: 1, soldiers: Array(62).fill(1), hits: [] }] }),
      ghost("0123456789abcdef", 1, { rounds: [{ start: 1, soldiers: ["1"], hits: [] }] }),
      ghost("0123456789abcdef", 1, { rounds: [{ start: 1, soldiers: [1], hits: [[1]] }] }),
      ghost("0123456789abcdef", 1, { rounds: [{ start: 0, soldiers: [1], hits: [] }] }),
    ];
    for (const g of bad) assert.equal(checkGhost(g), null, JSON.stringify(g));
    assert.equal((await post("not json")).status, 400);
    assert.equal((await post(bad[2])).status, 400);
  });
  await check("keeps a good one, named from the player's id and nothing typed", async () => {
    const response = await post({ ...ghost("0123456789abcdef"), name: "Some rude name" });
    assert.equal(response.status, 201);
    const { name } = await response.json();
    assert.equal(name, ghostName("0123456789abcdef"));
    assert.match(name, /^[A-Z][a-z]+ [A-Z][a-z]+ \d{1,2}$/);
  });
  await check("turns down a body that is too big", async () => {
    const response = await post(JSON.stringify({ junk: "x".repeat(70 * 1024) })).catch(() => ({ status: 413 }));
    assert.equal(response.status, 413);
  });

  console.log("\nWhat it hands out");
  await check("never a player's own ghost", async () => {
    assert.equal((await match(1, "0123456789abcdef")).status, 404);
  });
  await check("the ghost closest to the player's power", async () => {
    await post(ghost("1111111111111111", 0.5));
    await post(ghost("2222222222222222", 50));
    for (let i = 0; i < 5; i++) await post(ghost(`${i}333333333333333`, 40 + i));
    const body = await (await match(0.6, "ffffffffffffffff")).json();
    // The five closest to 0.6 include the 0.5 and 1 ghosts; never one at 50.
    assert.ok(body.power < 45, `got ${body.power}`);
    assert.ok(Array.isArray(body.rounds) && body.rounds[0].soldiers.length === 3);
    assert.equal(body.player, undefined, "the player's id stays private");
  });
  await check("keeps only a player's last five", async () => {
    const store = memoryStore();
    for (let i = 0; i < 8; i++) await store.add(checkGhost(ghost("4444444444444444", i + 1)));
    assert.equal(await store.count(), 5);
  });

  console.log("\nAnd the rest");
  await check("lets the game's own site read the answers", async () => {
    const response = await fetch(`${base}/health`, { headers: { origin: "https://gear-fight.onrender.com" } });
    assert.equal(response.headers.get("access-control-allow-origin"), "https://gear-fight.onrender.com");
    const other = await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
    assert.equal((await response.json()).ok, true);
  });
  await check("slows down anyone asking too often", async () => {
    let last = 0;
    for (let i = 0; i < 40; i++) last = (await match(1, "ffffffffffffffff")).status;
    assert.equal(last, 429);
  });

  server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
