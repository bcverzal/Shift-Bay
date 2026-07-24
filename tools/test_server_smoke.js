const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

function run() {
  assert.match(server, /url\.pathname === "\/api\/status"/, "status endpoint must remain available");
  assert.match(server, /server\.listen\(PORT, HOST/, "server must listen on its configured host and port");
  assert.match(server, /const PORT = Number\(process\.env\.PORT \|\| 8787\)/, "server must retain its configurable port");
  console.log("server contract tests passed");
}

run();
