const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { createLocalJsonStore } = require("../storage/local-json-store");
const { createSupabaseStore } = require("../storage/supabase-store");

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

async function testSupabaseStoreWithMockFetch() {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const rows = new Map();

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  process.env.SHIFT_BAY_LOCATION_ID = "00000000-0000-0000-0000-000000000001";
  process.env.SHIFT_BAY_DOCUMENT_KEY = "primary";

  global.fetch = async (url, options = {}) => {
    const requestUrl = new URL(url);
    if (!requestUrl.pathname.endsWith("/scheduler_state_documents")) {
      return new Response(JSON.stringify({ message: `Unexpected path ${requestUrl.pathname}` }), { status: 404 });
    }
    if ((options.method || "GET").toUpperCase() === "POST") {
      const body = JSON.parse(options.body);
      const row = Array.isArray(body) ? body[0] : body;
      rows.set(`${row.location_id}:${row.document_key}`, {
        ...row,
        id: "mock-row-id"
      });
      return new Response(JSON.stringify([rows.values().next().value]), { status: 201 });
    }
    const locationId = requestUrl.searchParams.get("location_id")?.replace(/^eq\./, "");
    const documentKey = requestUrl.searchParams.get("document_key")?.replace(/^eq\./, "");
    const row = rows.get(`${locationId}:${documentKey}`);
    return new Response(JSON.stringify(row ? [row] : []), { status: 200 });
  };

  try {
    const store = createSupabaseStore();
    const emptyLoad = await store.loadState();
    assert.equal(emptyLoad.exists, false, "mock Supabase store should start empty");

    const savedAt = "2026-07-03T12:00:00.000Z";
    const save = await store.saveState(envelope(savedAt, { employees: [{ id: "emp_cloud" }] }));
    assert.equal(save.ok, true, "mock Supabase save should succeed");

    const loaded = await store.loadState();
    assert.equal(loaded.exists, true, "mock Supabase document should load after save");
    assert.equal(loaded.payload.data.employees[0].id, "emp_cloud", "mock Supabase state should round-trip");
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
}

async function main() {
  await testLocalJsonStore();
  await testSupabaseStoreWithMockFetch();
  console.log("storage adapter tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
