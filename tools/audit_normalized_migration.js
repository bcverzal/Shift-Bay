const fs = require("node:fs");
const path = require("node:path");

const COLLECTIONS = [
  ["employees", "employees"],
  ["roles", "roles"],
  ["shifts", "shifts"],
  ["unassignedShifts", "unassigned_shifts"],
  ["templates", "templates"],
  ["timeOffRequests", "request_offs"],
  ["scheduleBlocks", "schedule_blocks"]
];

function unwrapState(payload) {
  if (payload?.data && payload?.app === "restaurant-scheduler") return payload.data;
  if (payload?.state && typeof payload.state === "object") return payload.state;
  return payload || {};
}

function items(value) {
  return Array.isArray(value) ? value : [];
}

function idOf(item) {
  return String(item?.id ?? item?.legacy_id ?? item?.legacyId ?? "").trim();
}

function duplicateIds(rows) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const id = idOf(row);
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function unknownReferences(rows, validIds, getReferences) {
  const missing = new Set();
  for (const row of rows) {
    for (const reference of getReferences(row)) {
      if (reference && !validIds.has(String(reference))) missing.add(String(reference));
    }
  }
  return [...missing].sort();
}

function availabilityFindings(employee) {
  const windows = [];
  const availability = employee?.availability && typeof employee.availability === "object" ? employee.availability : {};
  for (const [day, value] of Object.entries(availability)) {
    const ranges = Array.isArray(value) ? value : value ? [value] : [];
    ranges.forEach((range, index) => {
      if (!range || typeof range !== "object") return;
      if (!range.start && !range.startTime && !range.end && !range.endTime) return;
      windows.push({ day, index, start: range.start || range.startTime || "", end: range.end || range.endTime || "" });
    });
  }
  const rules = items(employee?.availabilityRules || employee?.workRules);
  return { windows, rules: rules.length };
}

function analyzeState(raw) {
  const state = unwrapState(raw);
  const employees = items(state.employees);
  const roles = items(state.roles);
  const shifts = items(state.shifts);
  const unassignedShifts = items(state.unassignedShifts);
  const templates = items(state.templates);
  const requestOffs = items(state.timeOffRequests);
  const blocks = items(state.scheduleBlocks);
  const employeeIds = new Set(employees.map(idOf).filter(Boolean));
  const roleIds = new Set(roles.map(idOf).filter(Boolean));
  const report = {
    schemaVersion: raw?.schemaVersion || state?.meta?.schemaVersion || null,
    collections: {},
    references: {},
    availability: {
      employeesWithWindows: 0,
      totalWindows: 0,
      employeesWithRules: 0,
      missingEmployeeIds: []
    },
    warnings: []
  };
  for (const [legacyKey, normalizedKey] of COLLECTIONS) {
    const rows = items(state[legacyKey]);
    report.collections[normalizedKey] = {
      sourceKey: legacyKey,
      count: rows.length,
      missingIds: rows.filter((row) => !idOf(row)).length,
      duplicateIds: duplicateIds(rows)
    };
  }
  report.references.shiftsToEmployees = unknownReferences(
    [...shifts, ...unassignedShifts], employeeIds,
    (shift) => [shift.employeeId || shift.employee_id]
  );
  report.references.shiftsToRoles = unknownReferences(
    [...shifts, ...unassignedShifts], roleIds,
    (shift) => [shift.roleId || shift.role_id]
  );
  report.references.requestOffsToEmployees = unknownReferences(
    requestOffs, employeeIds,
    (request) => [request.employeeId || request.employee_id]
  );
  report.references.blocksToEmployees = unknownReferences(
    blocks, employeeIds,
    (block) => [block.employeeId || block.employee_id]
  );
  for (const employee of employees) {
    const finding = availabilityFindings(employee);
    if (finding.windows.length) report.availability.employeesWithWindows += 1;
    report.availability.totalWindows += finding.windows.length;
    if (finding.rules) report.availability.employeesWithRules += 1;
    if (!idOf(employee)) report.availability.missingEmployeeIds.push(employee?.firstName || employee?.nickname || "unnamed employee");
  }
  for (const [name, ids] of Object.entries(report.references)) {
    if (ids.length) report.warnings.push(`${name}: ${ids.length} unknown reference(s)`);
  }
  for (const [name, collection] of Object.entries(report.collections)) {
    if (collection.missingIds) report.warnings.push(`${name}: ${collection.missingIds} row(s) without an id`);
    if (collection.duplicateIds.length) report.warnings.push(`${name}: duplicate ids ${collection.duplicateIds.join(", ")}`);
  }
  return report;
}

function normalizedRows(raw, key) {
  if (Array.isArray(raw?.[key])) return raw[key];
  if (Array.isArray(raw?.data?.[key])) return raw.data[key];
  return [];
}

function compareNormalized(stateRaw, normalizedRaw) {
  const report = analyzeState(stateRaw);
  const normalized = {};
  for (const [, key] of COLLECTIONS) {
    const rows = normalizedRows(normalizedRaw, key);
    normalized[key] = {
      count: rows.length,
      missingLegacyIds: rows.filter((row) => !idOf(row)).length,
      duplicateLegacyIds: duplicateIds(rows)
    };
  }
  report.normalized = normalized;
  for (const [key, info] of Object.entries(normalized)) {
    const source = report.collections[key];
    if (source && info.count < source.count) report.warnings.push(`${key}: normalized count ${info.count} is below source count ${source.count}`);
  }
  return report;
}

function usage() {
  console.log("Usage: node tools/audit_normalized_migration.js <state-json> [--normalized <normalized-json>] [--json]");
  console.log("Audits legacy state ids, references, availability windows, and optional normalized export counts.");
}

function main() {
  const args = process.argv.slice(2);
  const inputFile = args.find((arg) => !arg.startsWith("--"));
  if (!inputFile) { usage(); process.exit(1); }
  const normalizedIndex = args.indexOf("--normalized");
  const normalizedFile = normalizedIndex >= 0 ? args[normalizedIndex + 1] : "";
  const raw = JSON.parse(fs.readFileSync(path.resolve(inputFile), "utf8"));
  const report = normalizedFile
    ? compareNormalized(raw, JSON.parse(fs.readFileSync(path.resolve(normalizedFile), "utf8")))
    : analyzeState(raw);
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Migration audit: ${path.resolve(inputFile)}`);
    for (const [key, value] of Object.entries(report.collections)) console.log(`- ${key}: ${value.count} rows, ${value.missingIds} missing ids, ${value.duplicateIds.length} duplicate ids`);
    console.log(`- availability windows: ${report.availability.totalWindows} across ${report.availability.employeesWithWindows} employees`);
    console.log(`- unknown references: ${Object.values(report.references).reduce((sum, value) => sum + value.length, 0)}`);
    if (report.warnings.length) { console.log("Warnings:"); report.warnings.forEach((warning) => console.log(`  * ${warning}`)); }
    else console.log("No migration warnings found.");
  }
}

if (require.main === module) main();

module.exports = { unwrapState, analyzeState, compareNormalized };
