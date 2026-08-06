const { spawnSync } = require("node:child_process");
const path = require("node:path");

const node = process.execPath;
const tests = [
  "test_storage_adapters.js",
  "test_app_contracts.js",
  "test_print_contracts.js",
  "test_source_security.js",
  "test_server_smoke.js",
  "test_access_matrix.js",
  "test_employee_profile_persistence.js",
  "test_migration_audit.js",
  "test_normalized_people_migration.js",
  "test_normalized_availability_migration.js",
  "test_normalized_schedule_migration.js",
  "test_normalized_field_coverage.js",
  "test_scheduler_state_history_migration.js",
  "test_normalized_schedule_atomic_write_migration.js",
  "test_migration_manifest.js"
];

for (const test of tests) {
  const result = spawnSync(node, [path.join(__dirname, test)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Shift Bay baseline tests passed (${tests.length} modules).`);
