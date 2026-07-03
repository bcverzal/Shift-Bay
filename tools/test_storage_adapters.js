const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { createLocalJsonStore } = require("../storage/local-json-store");

function tempRoot() {
  return path.join(__dirname, "..", "tmp", "storage-adapter-test");
}

function envelope(updatedAt, extra = {}) {
  return {
    app: "restaurant-scheduler",
    schemaVersion: 2,
    savedAt: updatedAt,
    savedByDeviceId: extra.deviceId || "test-device",
    data: {
      meta: {
        schemaVersion: 2,
        updatedAt,
        deviceId: extra.deviceId || "test-device"
      },
      employees: extra.employees || [],
      roles: extra.roles || [],
      shifts: extra.shifts || []
    }
  };
}

async function testLocalJsonStore() {
  const root = tempRoot();
  fs.rmSync(root, { recursive: true, force: true });
  const store = createLocalJsonStore({
    dataDir: path.join(root, "data"),
    backupDir: path.join(root, "backups"),
    dataFile: path.join(root, "data", "state.json")
  });

  const emptyStatus = await store.status();
  assert.equal(emptyStatus.exists, false, "new local store should start empty");

  const firstUpdatedAt = "2026-07-03T10:00:00.000Z";
  const firstSave = await store.saveState(envelope(firstUpdatedAt, { employees: [{ id: "emp_1" }] }));
  assert.equal(firstSave.ok, true, "first save should succeed");

  const loaded = await store.loadState();
  assert.equal(loaded.exists, true, "saved state should load");
  assert.equal(loaded.payload.data.employees.length, 1, "saved employee should round-trip");

  const staleSave = await store.saveState(envelope("2026-07-03T09:00:00.000Z"));
  assert.equal(staleSave.stale, true, "older save should be rejected as stale");

  const secondSave = await store.saveState(envelope("2026-07-03T11:00:00.000Z", { employees: [{ id: "emp_2" }] }));
  assert.equal(secondSave.ok, true, "newer save should succeed");

  const backups = fs.readdirSync(path.join(root, "backups"));
  assert.ok(backups.length >= 1, "second save should create a backup");

  fs.rmSync(root, { recursive: true, force: true });
}

async function main() {
  await testLocalJsonStore();
  console.log("storage adapter tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
