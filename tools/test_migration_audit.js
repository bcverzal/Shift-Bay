const assert = require("node:assert/strict");
const { analyzeState, compareNormalized } = require("./audit_normalized_migration");

function run() {
  const state = {
    meta: { schemaVersion: 4 },
    employees: [
      { id: "e1", firstName: "A", availability: { sunday: [{ start: "09:00 AM", end: "03:00 PM" }] } },
      { id: "e1", firstName: "Duplicate", availabilityRules: [{ note: "one day off" }] }
    ],
    roles: [{ id: "r1" }],
    shifts: [{ id: "s1", employeeId: "e1", roleId: "missing-role" }],
    timeOffRequests: [{ id: "ro1", employeeId: "missing-employee" }]
  };
  const report = analyzeState(state);
  assert.equal(report.collections.employees.duplicateIds[0], "e1");
  assert.deepEqual(report.references.shiftsToRoles, ["missing-role"]);
  assert.deepEqual(report.references.requestOffsToEmployees, ["missing-employee"]);
  assert.equal(report.availability.totalWindows, 1);
  const comparison = compareNormalized(state, { employees: [{ legacy_id: "e1" }] });
  assert.ok(comparison.warnings.some((warning) => warning.includes("employees: normalized count 1 is below source count 2")));
  console.log("migration audit tests passed");
}

run();
