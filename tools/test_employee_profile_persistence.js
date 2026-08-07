const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const store = fs.readFileSync(path.join(root, "storage", "supabase-store.js"), "utf8");
const edge = fs.readFileSync(path.join(root, "supabase", "functions", "shift-bay-api", "index.ts"), "utf8");

function includes(source, value, message) {
  assert.ok(source.includes(value), message || `Expected source to include ${value}`);
}

function run() {
  const availabilitySaveHandlerStart = app.indexOf('$("saveAvailabilityPatternBtn").onclick');
  const availabilitySaveHandlerEnd = app.indexOf('$("editAvailabilityPatternBtn")', availabilitySaveHandlerStart);
  const availabilitySaveHandler = app.slice(availabilitySaveHandlerStart, availabilitySaveHandlerEnd);
  assert.ok(availabilitySaveHandler.includes("submitEmployeeFormDirectly()"), "Save Availability must use the direct profile save handler");
  assert.ok(!availabilitySaveHandler.includes("requestSubmit()"), "Save Availability must not be silently blocked by native form validation");
  includes(app, 'saveScope: "employee-profile"', "client profile saves must use a scoped request");
  includes(app, "employeeProfile: employee", "client profile saves must send the selected employee only");
  includes(app, "employeeProfileSavePriority", "profile saves must be prioritized over a queued schedule save");
  includes(app, "lastKnownServerState.employees", "profile saves must update the local shared-state baseline");
  includes(store, 'saveScope === "employee-profile"', "local adapter must recognize profile-only saves");
  includes(store, "mergeEmployeeProfileState", "local adapter must merge a profile without replacing the schedule");
  includes(store, "!profileOnlySave && baseServerSavedAt", "schedule staleness checks must not reject profile-only saves");
  includes(edge, 'saveScope === "employee-profile"', "API must recognize profile-only saves");
  includes(edge, 'employee_profile_overrides?on_conflict=location_id,employee_id', "API must persist the profile override");
  includes(edge, 'employee_profile_saved', "profile saves must be auditable");
  includes(edge, "syncNormalizedEmployeeProfile", "profile saves must attempt normalized dual-write");
  includes(edge, 'if (!profileOnlySave && baseServerSavedAt', "API must keep the schedule stale guard scoped");
  console.log("employee profile persistence contract tests passed");
}

run();
