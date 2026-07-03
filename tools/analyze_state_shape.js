const fs = require("fs");
const path = require("path");

function usage() {
  console.log("Usage: node tools/analyze_state_shape.js <input-json>");
  console.log("");
  console.log("Prints collection counts and field usage for a Shift Bay backup/state file.");
}

function unwrapState(payload) {
  if (payload?.data && payload?.app === "restaurant-scheduler") return payload.data;
  if (payload?.state) return payload.state;
  return payload;
}

function fieldSummary(items) {
  const counts = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item || typeof item !== "object") return;
    Object.keys(item).forEach((key) => counts.set(key, (counts.get(key) || 0) + 1));
  });
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, count]) => ({ field, count }));
}

function collectionSummary(state, key) {
  const value = state?.[key];
  const items = Array.isArray(value) ? value : [];
  return {
    key,
    count: items.length,
    fields: fieldSummary(items)
  };
}

function main() {
  const [, , inputFile] = process.argv;
  if (!inputFile) {
    usage();
    process.exit(1);
  }
  const inputPath = path.resolve(inputFile);
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const state = unwrapState(raw);
  const summary = {
    sourceFile: inputPath,
    schemaVersion: raw.schemaVersion || state?.meta?.schemaVersion || null,
    collections: [
      "roles",
      "employees",
      "templates",
      "shifts",
      "unassignedShifts",
      "timeOffRequests",
      "scheduleBlocks",
      "scheduleHistory"
    ].map((key) => collectionSummary(state, key)),
    objectKeys: {
      settings: state?.settings ? Object.keys(state.settings).sort() : [],
      salesProjections: state?.salesProjections ? Object.keys(state.salesProjections).length : 0,
      coverageRequirements: state?.coverageRequirements ? Object.keys(state.coverageRequirements).length : 0,
      localPreferences: state?.localPreferences ? Object.keys(state.localPreferences).sort() : []
    }
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
