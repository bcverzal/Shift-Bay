const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "supabase", "migration-manifest.json"), "utf8"));

assert.equal(manifest.formatVersion, 1);
const ids = new Set();
for (const migration of manifest.migrations) {
  assert.ok(migration.id, "every migration needs an ID");
  assert.ok(!ids.has(migration.id), `duplicate migration ID: ${migration.id}`);
  ids.add(migration.id);
  assert.ok(fs.existsSync(path.join(root, "supabase", migration.file)), `migration file missing: ${migration.file}`);
  assert.ok(Array.isArray(migration.dependsOn), `${migration.id} must list dependencies`);
  assert.ok(migration.rollback, `${migration.id} must document rollback behavior`);
}
for (const migration of manifest.migrations) {
  migration.dependsOn.forEach((dependency) => assert.ok(ids.has(dependency), `${migration.id} depends on unknown migration ${dependency}`));
}

console.log("migration manifest tests passed");
