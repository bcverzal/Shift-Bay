const assert = require("node:assert/strict");
const { analyzeFieldCoverage } = require("./audit_normalized_field_coverage");

const report = analyzeFieldCoverage({
  data: {
    meta: {},
    blocks: [],
    unexpectedTopLevel: true,
    employees: [{
      id: "employee-1",
      firstName: "Alex",
      roleTraining: ["role-1"],
      trainerRoles: ["role-1"],
      noDoubles: true,
      unexpectedEmployeeField: true
    }]
  }
});

assert.deepEqual(report.topLevel.unknown, ["unexpectedTopLevel"]);
assert.deepEqual(report.employees.unknownFields, ["unexpectedEmployeeField"]);
assert.ok(report.employees.pendingMappings.some((entry) => entry.field === "noDoubles"));
assert.ok(report.topLevel.recognized.includes("blocks"));

console.log("normalized field coverage tests passed");
