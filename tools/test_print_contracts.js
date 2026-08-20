const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function includes(source, value, message) {
  assert.ok(source.includes(value), message || `Expected source to include ${value}`);
}

function run() {
  includes(app, "function preparePrintView", "print preparation must remain centralized");
  includes(app, "printing-floor-week", "floor-plan printing must have its own print mode");
  includes(app, "printing-ctuit-entry", "CTuit entry printing must have its own print mode");
  includes(app, "Close: Clear", "Ctuit entry rows must explicitly tell the operator to clear inherited closer flags");
  includes(app, "Close: Set", "Ctuit entry rows must explicitly tell the operator to set closer flags");
  includes(app, "function ctuitEntryPreflight", "Ctuit entry printing must classify exceptional rows before entry begins");
  includes(app, "function ctuitEntryEmployeeMarkup", "Ctuit entry rows must show the profile name when a nickname differs");
  includes(app, "Profile name:", "Ctuit preflight must flag nickname-to-profile lookup names");
  includes(app, "Show More", "Ctuit preflight must flag long shifts for the all-eligible-staff workflow");
  includes(app, "Staff profile not found", "Ctuit preflight must flag missing employee profiles");
  includes(app, "compact-print-role-list", "compact role printing must render role sections");
  includes(app, "printDepartmentFilters", "compact printing must expose department filtering");
  includes(app, "function isPrintableScheduledEmployee", "compact printing must have an active employee print guard");
  includes(app, "isPrintableScheduledEmployee(shift.employeeId)", "compact printing must exclude inactive and archived employee shifts");
  includes(app, "dateKeys.has(shift.date)", "compact role printing must only include the printed week");
  includes(app, "printing-current-page", "current-page printing must be an explicit print mode");
  includes(app, "window.print()", "print actions must invoke the browser print flow");
  includes(styles, "@media print", "print styles must be isolated from screen styles");
  includes(styles, ".printing-floor-week", "floor-plan print CSS must be scoped");
  includes(styles, ".printing-ctuit-entry", "CTuit print CSS must be scoped");
  includes(styles, ".ctuit-entry-preflight", "Ctuit preflight must remain print-scoped");
  includes(styles, ".printing-simple", "compact print CSS must be scoped");
  includes(styles, ".day-focus-tool-rail", "screen-only rails must be removable from print output");
  includes(styles, "binder-punch gutter", "compact schedules must reserve a binder gutter");
  includes(styles, "printing-current-page", "current-page print CSS must be scoped");
  console.log("print contract tests passed");
}

run();
