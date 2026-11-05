// Runs every test file one after another and gives a total. Exits non-zero on any failure.
const { spawnSync } = require("child_process");
const fs = require("fs"), path = require("path");
let passed = 0, failed = 0;
for (const file of fs.readdirSync(__dirname).filter((name) => name.endsWith(".test.js")).sort()) {
  console.log(`\n=== ${file}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: "utf8" });
  const output = (result.stdout || "") + (result.stderr || "");
  console.log(output.trimEnd());
  const totals = output.match(/(\d+) passed, (\d+) failed/);
  if (totals) { passed += Number(totals[1]); failed += Number(totals[2]); } else failed += 1;
}
console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
