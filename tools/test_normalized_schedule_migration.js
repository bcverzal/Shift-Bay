const assert = require("node:assert/strict");
const {
  isScheduleBlock,
  normalizedTime,
  requestPayload,
  shiftPayload,
  templateShiftPayload,
  weekStartFor
} = require("./migrate_sandbox_schedule_to_normalized");

assert.equal(normalizedTime("12:00 AM"), "00:00:00");
assert.equal(normalizedTime("4:15 PM"), "16:15:00");
assert.equal(weekStartFor("2026-08-10", 2), "2026-08-04");
assert.equal(weekStartFor("2026-08-04", 2), "2026-08-04");
assert.equal(isScheduleBlock({ kind: "block" }), true);
assert.equal(isScheduleBlock({ blockType: "event" }), true);
assert.equal(isScheduleBlock({ kind: "ro" }), false);

const maps = {
  employeesByLegacyId: new Map([["employee_1", { id: "normalized_employee_1" }]]),
  rolesByLegacyId: new Map([["role_1", { id: "normalized_role_1" }]])
};
const shift = shiftPayload({
  id: "shift_1", date: "2026-08-04", employeeId: "employee_1", roleId: "role_1", department: "FOH",
  shiftLabel: "Server", start: "4:00 PM", end: "9:00 PM", isCloser: true, meals: ["Dinner"], training: { isTraining: true }
}, "sandbox", maps, "week_1");
assert.equal(shift.employee_id, "normalized_employee_1");
assert.equal(shift.role_id, "normalized_role_1");
assert.equal(shift.start_time, "16:00:00");
assert.equal(shift.is_open_bay, false);
assert.deepEqual(shift.metadata.meals, ["Dinner"]);

const openShift = shiftPayload({ id: "open_1", date: "2026-08-04", roleId: "role_1", department: "FOH" }, "sandbox", maps, "week_1", true);
assert.equal(openShift.employee_id, null);
assert.equal(openShift.is_open_bay, true);

const request = requestPayload({ id: "ro_1", date: "2026-08-05", allDay: true, note: "Vacation" }, "sandbox", "normalized_employee_1");
assert.equal(request.source_fingerprint, "legacy:ro_1");
assert.equal(request.kind, "ro");

const templateShift = templateShiftPayload({ id: "template_shift_1", dayIndex: 2, roleId: "role_1", department: "FOH", start: "9:00 AM", end: "3:00 PM" }, "template_1", maps, 3);
assert.equal(templateShift.role_id, "normalized_role_1");
assert.equal(templateShift.sort_order, 3);

console.log("normalized schedule migration tests passed");
