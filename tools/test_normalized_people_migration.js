const assert = require("node:assert/strict");
const {
  availabilityPayloads,
  employeePayload,
  normalizedTime,
  roleCapabilityPayloads,
  rolePayload
} = require("./migrate_sandbox_people_to_normalized");

assert.equal(normalizedTime("12:00 AM"), "00:00:00");
assert.equal(normalizedTime("4:15 PM"), "16:15:00");

const role = rolePayload({ id: "role-server", name: "Server", department: "FOH", defaultRate: 12 }, "location", 3);
assert.equal(role.legacy_id, "role-server");
assert.equal(role.sort_order, 3);

const employee = {
  id: "employee-a",
  firstName: "Alex",
  lastName: "Rivera",
  canClose: true,
  roleTraining: ["role-server"],
  trainerRoles: ["role-server"],
  emergencyRoleIds: [],
  roleMealTraining: { "role-server": ["Dinner"] },
  availability: { 1: [{ start: "4:00 PM", end: "10:00 PM" }], 2: [] }
};
assert.equal(employeePayload(employee, "location").trained_closer, true);
assert.deepEqual(availabilityPayloads(employee, "employee-uuid"), [{
  employee_id: "employee-uuid", day_index: 1, start_time: "16:00:00", end_time: "22:00:00", available: true, note: "", sort_order: 0
}]);
const capabilities = roleCapabilityPayloads(employee, "employee-uuid", new Map([["role-server", { id: "role-uuid" }]]));
assert.equal(capabilities.length, 1);
assert.equal(capabilities[0].can_train, true);
assert.deepEqual(capabilities[0].meal_names, ["Dinner"]);

console.log("normalized people migration tests passed");
