#!/usr/bin/env node
/**
 * Run every `*.test.js` under a directory with Node's test runner.
 *
 *   node scripts/runTests.js tests
 *   node scripts/runTests.js tests-e2e
 *
 * Node 20 on Windows does not expand a glob in `node --test "tests/**"`,
 * and Node 22 reads a bare directory as a file to require, so neither form
 * runs the suite everywhere. Listing the files here does, on both.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const dir = path.resolve(process.argv[2] || "tests");
const files = [];
(function walk(d) {
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.test\.js$/.test(entry.name)) files.push(p);
  }
})(dir);
if (!files.length) {
  console.error(`No *.test.js under ${dir}`);
  process.exit(2);
}
const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(3), ...files.sort()], { stdio: "inherit" });
process.exit(r.status ?? 1);
