const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const staff = fs.readFileSync(path.join(root, "staff.js"), "utf8");

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

  includes(index, "id=\"scheduleGrid\"", "weekly schedule grid must remain present");
  includes(index, "id=\"floorPlanDate\"", "floor-plan date control must remain present");
  includes(index, "id=\"unassignedShiftTray\"", "Shift Bay tray must remain present");
  includes(staff, "function renderAvailabilityDays", "staff availability UI must remain present");
  console.log("app contract tests passed");
}

run();
