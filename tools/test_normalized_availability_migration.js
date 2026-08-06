const assert = require("node:assert/strict");
const {
  availabilityWindows,
  assignmentStatus,
  normalizedTime,
  sourceProfiles,
  validDate
} = require("./migrate_sandbox_availability_to_normalized");

assert.equal(validDate("2026-08-10"), "2026-08-10");
assert.equal(validDate("08/10/2026"), "");
assert.equal(normalizedTime("12:00 AM"), "00:00:00");
assert.equal(normalizedTime("4:15 PM"), "16:15:00");

const employee = {
  id: "employee-1",
  availabilityPatterns: [{
    id: "school",
    name: "School Week",
    availability: { 1: [{ start: "4:00 PM", end: "10:00 PM" }] },
    repeatWeeks: 2,
    effectiveDate: "2026-08-10",
    active: true
  }, {
    id: "draft",
    name: "College Break",
    availability: { 2: [{ start: "10:00 AM", end: "6:00 PM" }] },
    active: false
  }]
};
const profiles = sourceProfiles(employee, "2026-08-03");
assert.equal(profiles.length, 2);
assert.equal(profiles[0].name, "School Week");
assert.equal(profiles[0].repeatWeeks, 2);
assert.equal(assignmentStatus(profiles[0]), "active");
assert.equal(assignmentStatus(profiles[1]), "draft");
assert.deepEqual(availabilityWindows(profiles[0].availability, "pattern-1"), [{
  pattern_id: "pattern-1", day_index: 1, start_time: "16:00:00", end_time: "22:00:00", available: true, note: "", sort_order: 0
}]);

const legacy = sourceProfiles({ id: "employee-2", availability: { 0: [{ start: "9:00 AM", end: "3:00 PM" }] } }, "2026-08-03");
assert.equal(legacy[0].name, "Regular availability");
assert.equal(legacy[0].effectiveDate, "2026-08-03");

console.log("normalized availability migration tests passed");
