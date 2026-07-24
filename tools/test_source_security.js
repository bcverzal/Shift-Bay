const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function run() {
  const files = [];
  const ignoredDirectories = new Set([".git", "node_modules", "data", "dist", "build"]);
  const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html", ".css", ".json", ".ps1"]);

  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) collect(fullPath);
        continue;
      }
      if (entry.name === ".env" || entry.name === ".env.local") continue;
      if (sourceExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
    }
  }

  collect(root);

  for (const fullPath of files) {
    const content = fs.readFileSync(fullPath, "utf8");
    const file = path.relative(root, fullPath);
    if (file === path.join("tools", "test_source_security.js")) continue;
    assert.ok(!content.includes("sbp_"), `${file} appears to contain a Supabase secret`);
    assert.ok(!/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['\"]?ey[A-Za-z0-9_-]+/.test(content), `${file} appears to contain a service-role key`);
  }
  console.log("source security tests passed");
}

run();
