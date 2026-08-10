const path = require("path");
const { createLocalJsonStore, dataUpdatedAt } = require("./local-json-store");
const { createSupabaseStore } = require("./supabase-store");

function createSchedulerStore(options) {
  const mode = (process.env.SHIFT_BAY_STORAGE_MODE || "local-json").trim().toLowerCase();
  if (mode === "supabase") {
    return createSupabaseStore(options);
  }
  return createLocalJsonStore({
    ...options,
    dataDir: options.dataDir || path.join(options.root, "data"),
    backupDir: options.backupDir || path.join(options.root, "data", "backups"),
    dataFile: options.dataFile || path.join(options.root, "data", "restaurant-scheduler-data.json")
  });
}

module.exports = {
  createSchedulerStore,
  dataUpdatedAt
};
