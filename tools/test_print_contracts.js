const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function includes(source, value, message) {
  assert.ok(source.includes(value), message || `Expected source to include ${value}`);
}

function run() {
  includes(app, "function preparePrintView", "print preparation must remain centralized");
  includes(app, "printing-floor-week", "floor-plan printing must have its own print mode");
  includes(app, "printing-ctuit-entry", "CTuit entry printing must have its own print mode");
  includes(app, "compact-print-role-list", "compact role printing must render role sections");
  includes(styles, "@media print", "print styles must be isolated from screen styles");
  includes(styles, ".printing-floor-week", "floor-plan print CSS must be scoped");
  includes(styles, ".printing-ctuit-entry", "CTuit print CSS must be scoped");
  includes(styles, ".printing-simple", "compact print CSS must be scoped");
  console.log("print contract tests passed");
}

run();
