const fs = require("fs");
const path = require("path");
const { loadEnvFile } = require("../config/load-env");
const { createSupabaseStore } = require("../storage/supabase-store");

const ROOT = path.join(__dirname, "..");

function usage() {
  console.log("Usage: node tools/upload_state_to_supabase.js <input-json> <backup-output-json>");
  console.log("");
  console.log("Backs up the current Supabase scheduler document, then uploads a copied Shift Bay state file.");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function unwrapState(payload) {
  if (payload?.data && payload?.app === "restaurant-scheduler") return payload.data;
  if (payload?.state) return payload.state;
  return payload;
}

function summarizeState(state) {
  return {
    employees: Array.isArray(state.employees) ? state.employees.length : 0,
    roles: Array.isArray(state.roles) ? state.roles.length : 0,
    shifts: Array.isArray(state.shifts) ? state.shifts.length : 0,
    unassignedShifts: Array.isArray(state.unassignedShifts) ? state.unassignedShifts.length : 0,
    templates: Array.isArray(state.templates) ? state.templates.length : 0,
    requestOffs: Array.isArray(state.timeOffRequests) ? state.timeOffRequests.length : 0,
    scheduleHistory: Array.isArray(state.scheduleHistory) ? state.scheduleHistory.length : 0
  };
}

async function main() {
  const [, , inputFile, backupFile] = process.argv;
  if (!inputFile || !backupFile) {
    usage();
    process.exit(1);
  }

  loadEnvFile(ROOT);
  const store = createSupabaseStore();
  const inputPath = path.resolve(inputFile);
  const backupPath = path.resolve(backupFile);

  const existing = await store.loadState();
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(existing.exists ? existing.payload : { exists: false }, null, 2), "utf8");

  const state = unwrapState(readJson(inputPath));
  state.meta = {
    ...(state.meta || {}),
    migratedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const envelope = {
    app: "restaurant-scheduler",
    schemaVersion: Number(state.meta?.schemaVersion || 1),
    savedAt: new Date().toISOString(),
    savedByDeviceId: state.meta?.deviceId || "supabase-migration",
    data: state
  };

  const result = await store.saveState(envelope);
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    backupPath,
    savedAt: result.savedAt,
    summary: summarizeState(state)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
