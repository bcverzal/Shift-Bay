const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const staff = fs.readFileSync(path.join(root, "staff.js"), "utf8");
const edgeFunction = fs.readFileSync(path.join(root, "supabase", "functions", "shift-bay-api", "index.ts"), "utf8");

function includes(source, value, message) {
  assert.ok(source.includes(value), message || `Expected source to include ${value}`);
}

function excludes(source, value, message) {
  assert.ok(!source.includes(value), message || `Expected source not to include ${value}`);
}

function run() {
  includes(app, "function syncFloorPlanDateToActiveWeek", "floor-plan date handoff must exist");
  includes(app, "focusedDateKey || formatDateKey(currentDate)", "floor plans must prefer the focused day");
  excludes(app, "data-day-focus-date=", "redundant per-day buttons should stay removed");
  includes(app, "Double-click the date header to open Day View.", "day-header guidance must remain available");

  includes(app, "const RECOMMENDATION_FACTORS", "recommendation factors must be explicit");
  includes(app, "minimumWeeks: 2", "one historical occurrence must not drive a recommendation");
  includes(app, "function recommendationFactorWeight", "recommendation weights must have a future configuration hook");
  includes(app, "function historicalRecommendationForOpenShift", "historical recommendation selection must exist");
  includes(app, "function historicalMostRecentMatchDate", "historical recommendation ties must use recency");
  includes(app, "historicalMostRecentDate.localeCompare", "historical recommendation ties must prefer the most recent assignment");
  includes(app, "Schedule pattern", "recommendations should use plain schedule-pattern language");
  assert.ok(!app.includes("${renderRecentStagedSection(recent)}"), "selected shift info should not show the misleading recent section");
  includes(app, "day-focus-pattern-chip", "day-view pattern styling must target only the eligible name chip");
  includes(app, "staged-info-history-recommendation", "historical recommendations must be visible in the bay info panel");
  includes(app, "day-focus-pattern-chip", "historical recommendations must be visible in day view");
  includes(app, 'data-availability-preset="unavailable"', "regular availability must offer an unavailable preset");
  includes(app, 'preset === "unavailable"', "unavailable preset must clear the day availability");
  includes(app, "function showDayFocusChipTooltip", "day-view eligibility tooltips must escape the scroll container");
  includes(app, "id = \"dayFocusChipTooltip\"", "day-view eligibility tooltip must use a page-level host");
  includes(app, 'orderedRolesForSchedule("")', "expanding day-view eligibility must preserve role order");
  includes(app, "employeeAvailabilityEffectiveDate", "manager availability needs an effective-date control");
  includes(app, "availabilitySchedule", "manager availability needs effective-dated versions");
  includes(app, 'data-availability-end-slot', "manager availability needs paired start/end time controls");
  includes(app, 'data-add-availability-window', "manager availability needs an add-window action");
  includes(app, "availabilityEffectiveDate", "manager availability must preserve the effective date");
  includes(app, "employeeProfileSavePriority", "employee profile saves must take priority over queued full-schedule writes");
  includes(app, "another large schedule request", "employee profile saves must reserve the next cloud write");
  includes(index, 'id="employeeSaveDebugStatus"', "employee profile saves must expose their current stage");
  includes(app, "Save Employee button clicked", "the employee save button must immediately confirm its click handler ran");
  includes(app, "Cloud save confirmed", "employee profile saves must visibly confirm the cloud response");
  includes(app, "saveAttemptId", "employee profile saves must send a traceable attempt id");
  includes(edgeFunction, "saveAttemptId", "employee profile audit events must retain the traceable attempt id");
  includes(app, "const regularAvailabilityMode = !callWeekly", "Call Weekly saves must use a separate availability-validation branch");
  includes(app, "const duplicatePattern = saveAvailability", "Only explicit availability saves may be blocked by duplicate availability names");
  includes(app, "availabilitySaveRequested = true", "Save Availability must explicitly request availability validation");

  includes(index, "id=\"scheduleGrid\"", "weekly schedule grid must remain present");
  includes(index, "id=\"floorPlanDate\"", "floor-plan date control must remain present");
  includes(index, "id=\"unassignedShiftTray\"", "Shift Bay tray must remain present");
  includes(index, "class=\"mobile-access-notice\"", "narrow-screen access guidance must remain present");
  includes(index, 'data-mobile-view="day"', "narrow-screen day review action must remain present");
  includes(index, 'data-mobile-view="compact"', "narrow-screen compact review action must remain present");
  includes(staff, 'data-staff-availability-preset="unavailable"', "staff availability needs an explicit unavailable preset");
  includes(staff, 'data-staff-availability-end-slot', "staff availability needs paired start/end time controls");
  includes(staff, 'data-add-staff-window', "staff availability needs an add-window action");
  includes(staff, "function renderAvailabilityDays", "staff availability UI must remain present");
  console.log("app contract tests passed");
}

run();
