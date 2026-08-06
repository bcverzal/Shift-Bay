const fs = require("node:fs");
const path = require("node:path");
const { unwrapState } = require("./audit_normalized_migration");

const TOP_LEVEL_FIELDS = {
  meta: "snapshot metadata / audit bridge",
  settings: "app_settings and specialized location settings (pending)",
  roles: "roles (Phase 1 sandbox migration prepared)",
  employees: "employees, employee_roles, employee_pay_rates, availability tables (Phase 1 in progress)",
  templates: "templates and template_shifts (pending)",
  shifts: "schedule_weeks and shifts (pending)",
  unassignedShifts: "shifts.is_open_bay (pending)",
  salesProjections: "sales_projections (pending)",
  timeOffRequests: "request_offs (pending)",
  blocks: "schedule_blocks (pending)",
  coverageRequirements: "coverage_requirements (pending)",
  scheduleHistory: "historical shift import / audit records (deferred)",
  dismissedIssues: "user-local preference (not normalized)",
  localPreferences: "device-local view state; intentionally remains outside normalized shared data",
  requestOffImportLog: "request-off import audit history (Phase 2 import log)"
};

const EMPLOYEE_FIELDS = {
  id: "employees.legacy_id",
  firstName: "employees.first_name",
  lastName: "employees.last_name",
  nickname: "employees.nickname",
  phone: "employees.phone",
  birthday: "employees.birthday",
  departments: "employees.departments",
  active: "employees.active",
  archived: "employees.archived",
  callWeekly: "employees.call_weekly_availability",
  canClose: "employees.trained_closer",
  canLunchClose: "employees.lunch_closer",
  managerNotes: "employees.scheduling_note",
  roleTraining: "employee_roles.trained",
  trainerRoles: "employee_roles.can_train",
  emergencyRoleIds: "employee_roles.emergency_only",
  roleMealTraining: "employee_roles.meal_names",
  availability: "availability_rules",
  availabilityEffectiveDate: "staff_availability_week_assignments.week_start (not mirrored yet)",
  availabilityPatternName: "staff_availability_patterns.name (not mirrored yet)",
  availabilityRepeatWeeks: "staff_availability_patterns.repeat_interval_weeks (not mirrored yet)",
  payRates: "employee_pay_rates (not mirrored yet)",
  weeklyAvailability: "weekly_availability_overrides (not mirrored yet)",
  availabilitySchedule: "effective-dated availability assignments (schema needed)",
  availabilityPatterns: "staff_availability_patterns (not mirrored yet)",
  availabilitySubmissions: "staff_availability_submissions (workflow model)",
  weeklyRules: "employee work-rules table (schema needed)",
  noDoubles: "employees.no_doubles (schema needed)",
  alwaysPrintFloorEndTime: "employees.always_print_floor_end_time (schema needed)",
  mealTraining: "default meal qualifications (schema decision needed)",
  priority: "legacy display/sort field; preserve in snapshot until a user-facing scheduling priority is defined",
  createdAt: "audit timestamp bridge",
  updatedAt: "audit timestamp bridge"
};

function values(value) {
  return Array.isArray(value) ? value : [];
}

function unknownFields(rows, knownFields) {
  const fields = new Set();
  values(rows).forEach((row) => {
    if (!row || typeof row !== "object") return;
    Object.keys(row).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(knownFields, key)) fields.add(key);
    });
  });
  return [...fields].sort();
}

function analyzeFieldCoverage(raw) {
  const source = raw?.data && typeof raw.data === "object" ? raw.data : raw;
  const state = source?.document?.state && typeof source.document.state === "object" ? source.document.state : unwrapState(source);
  const topLevelUnknown = Object.keys(state).filter((key) => !Object.prototype.hasOwnProperty.call(TOP_LEVEL_FIELDS, key)).sort();
  const employees = values(state.employees);
  const usedEmployeeFields = [...new Set(employees.flatMap((employee) => Object.keys(employee || {})))].sort();
  const pendingEmployeeMappings = usedEmployeeFields
    .filter((field) => Object.prototype.hasOwnProperty.call(EMPLOYEE_FIELDS, field) && /not mirrored|schema needed|schema decision needed|workflow model/i.test(EMPLOYEE_FIELDS[field]))
    .map((field) => ({ field, target: EMPLOYEE_FIELDS[field] }));
  return {
    topLevel: {
      recognized: Object.keys(state).filter((key) => Object.prototype.hasOwnProperty.call(TOP_LEVEL_FIELDS, key)).sort(),
      unknown: topLevelUnknown,
      mappings: TOP_LEVEL_FIELDS
    },
    employees: {
      count: employees.length,
      usedFields: usedEmployeeFields,
      unknownFields: unknownFields(employees, EMPLOYEE_FIELDS),
      pendingMappings: pendingEmployeeMappings,
      mappings: EMPLOYEE_FIELDS
    }
  };
}

function usage() {
  console.log("Usage: node tools/audit_normalized_field_coverage.js <state-json> [--json]");
}

function main() {
  const args = process.argv.slice(2);
  const input = args.find((arg) => !arg.startsWith("--"));
  if (!input) { usage(); process.exit(1); }
  const raw = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
  const report = analyzeFieldCoverage(raw);
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Field coverage: ${path.resolve(input)}`);
  console.log(`- employees: ${report.employees.count}`);
  console.log(`- unknown top-level fields: ${report.topLevel.unknown.length || "none"}`);
  console.log(`- unknown employee fields: ${report.employees.unknownFields.length || "none"}`);
  console.log(`- pending employee mappings: ${report.employees.pendingMappings.length}`);
  report.employees.pendingMappings.forEach((entry) => console.log(`  * ${entry.field}: ${entry.target}`));
}

if (require.main === module) main();

module.exports = { analyzeFieldCoverage, EMPLOYEE_FIELDS, TOP_LEVEL_FIELDS };
