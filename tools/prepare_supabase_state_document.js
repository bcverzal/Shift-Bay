const fs = require("fs");
const path = require("path");

function usage() {
  console.log("Usage: node tools/prepare_supabase_state_document.js <input-json> <output-json>");
  console.log("");
  console.log("Creates a Supabase scheduler_state_documents payload from a Shift Bay backup or state file.");
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
    scheduleBlocks: Array.isArray(state.scheduleBlocks) ? state.scheduleBlocks.length : 0
  };
}

function main() {
  const [, , inputFile, outputFile] = process.argv;
  if (!inputFile || !outputFile) {
    usage();
    process.exit(1);
  }
  const inputPath = path.resolve(inputFile);
  const outputPath = path.resolve(outputFile);
  const raw = readJson(inputPath);
  const state = unwrapState(raw);
  const document = {
    app: "restaurant-scheduler",
    schemaVersion: Number(raw.schemaVersion || state?.meta?.schemaVersion || 1),
    preparedAt: new Date().toISOString(),
    sourceFile: inputPath,
    summary: summarizeState(state),
    data: state
  };
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2), "utf8");
  console.log(`Prepared ${outputPath}`);
  console.log(JSON.stringify(document.summary, null, 2));
}

main();
