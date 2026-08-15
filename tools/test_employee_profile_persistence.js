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
  includes(app, "saveAvailability ? \"\" : selectedAvailabilityPatternId", "selecting a saved availability must not silently turn a save into an overwrite");
  assert.ok(availabilitySaveHandler.includes('title: "Availability Not Saved"'), "a blocked availability save must show a visible app dialog");
  includes(app, "function defaultAvailabilityPatternName", "availability drafts must receive an employee-specific default name");
  includes(app, "function nextAvailabilityPatternName", "Copy Live must generate a distinct saved availability name");
  includes(app, "copyLiveAvailabilityBtn", "the availability workflow must offer a separate replacement draft action");
  includes(app, "Discard Draft?", "opening a saved availability must protect unsaved draft work");
  const availabilityEditHandlerStart = app.indexOf('$("editAvailabilityPatternBtn")?.addEventListener');
  const availabilityEditHandlerEnd = app.indexOf('$("newAvailabilityPatternBtn").onclick', availabilityEditHandlerStart);
  const availabilityEditHandler = app.slice(availabilityEditHandlerStart, availabilityEditHandlerEnd);
  assert.ok(availabilityEditHandler.includes("availabilityEditingPatternId = selected.id"), "Edit must load the selected saved availability into the editor");
  assert.ok(!availabilityEditHandler.includes("selected.active"), "Edit must allow active saved availabilities to load into the editor");
  includes(app, "editButton.disabled = !selected", "Edit must stay unavailable until a saved availability is selected");
  includes(app, "availability-day-strip", "availability editing must keep day selection in a stable strip");
  includes(app, "aria-selected", "day selection must expose a clear selected state");
  includes(app, "availability-day-select", "preset and time changes must update the fixed day selector summaries");
  includes(app, "defaultAvailabilityPatternName(employee)", "the availability editor must seed the employee-specific default name");
  includes(app, "const employee = (state.employees || []).find", "availability name uniqueness must be scoped to the selected employee");
  includes(app, "This employee already has a saved availability named", "duplicate availability warnings must not expose another employee's name");
  includes(app, 'saveScope: "employee-profile"', "client profile saves must use a scoped request");
  includes(app, "employeeProfile: employee", "client profile saves must send the selected employee only");
  includes(app, "employeeProfileSavePriority", "profile saves must be prioritized over a queued schedule save");
  includes(app, "lastKnownServerState.employees", "profile saves must update the local shared-state baseline");
  includes(app, "Do not advance the schedule document timestamp here", "profile saves must not advance the whole-schedule freshness timestamp");
  includes(store, 'saveScope === "employee-profile"', "local adapter must recognize profile-only saves");
  includes(store, "mergeEmployeeProfileState", "local adapter must merge a profile without replacing the schedule");
  includes(store, "!profileOnlySave && baseServerSavedAt", "schedule staleness checks must not reject profile-only saves");
  includes(edge, 'saveScope === "employee-profile"', "API must recognize profile-only saves");
  includes(edge, 'employee_profile_overrides?on_conflict=location_id,employee_id', "API must persist the profile override");
  includes(edge, "profileOverrideSaved: true", "profile saves must return an explicit compatibility-override confirmation");
  includes(edge, 'employee_profile_saved', "profile saves must be auditable");
  includes(edge, "syncNormalizedEmployeeProfile", "profile saves must attempt normalized dual-write");
  includes(edge, "normalized sync deferred", "profile saves must not wait indefinitely on normalized migration work");
  includes(edge, 'if (!profileOnlySave && baseServerSavedAt', "API must keep the schedule stale guard scoped");
  console.log("employee profile persistence contract tests passed");
}

run();
