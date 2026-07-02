const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "restaurant-scheduler-data.json");
const wrapper = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const state = wrapper.data || wrapper;

const start = "2026-06-23";
const days = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];

function addDays(dateKey, count) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + count);
  return date.toISOString().slice(0, 10);
}

function minutes(value) {
  if (!value || /vol/i.test(value)) return null;
  const match = String(value).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function shiftTime(shift) {
  return `${shift.start}-${shift.untilVolume ? "Vol" : shift.end}`;
}

function shiftHours(shift) {
  const start = minutes(shift.start);
  const end = minutes(shift.end);
  if (start == null || end == null || end <= start) return 0;
  return (end - start) / 60;
}

function isAcceptedDouble(sameDayShifts) {
  const name = sameDayShifts[0]?.employeeName || "";
  const date = sameDayShifts[0]?.date || "";
  if (/Penny Abel/i.test(name)) return true;
  if (/Paul Schellin/i.test(name) && ["2026-06-26", "2026-06-27"].includes(date)) {
    const roles = sameDayShifts.map((shift) => shift.roleName);
    return roles.every((role) => role === "Host" || role === "Expo");
  }
  return false;
}

const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
const roles = Object.fromEntries((state.roles || []).map((role) => [role.id, role.name]));
const employees = Object.fromEntries((state.employees || []).map((employee) => [
  employee.id,
  {
    ...employee,
    name: [employee.nickname || "", employee.firstName || "", employee.lastName || ""].filter(Boolean).join(" ")
  }
]));

const shifts = (state.shifts || [])
  .filter((shift) => dates.includes(shift.date))
  .map((shift) => ({
    ...shift,
    employeeName: employees[shift.employeeId]?.name || "Unknown",
    roleName: roles[shift.roleId] || "Unknown role"
  }));

const bay = (state.unassignedShifts || [])
  .filter((shift) => dates.includes(shift.date))
  .map((shift) => ({ ...shift, roleName: roles[shift.roleId] || "Unknown role" }));

const requestOffs = (state.timeOffRequests || []).filter((request) => dates.includes(request.date));
const issues = [];

function addIssue(severity, type, date, text) {
  issues.push({ severity, type, date, text });
}

function requestText(request) {
  return request.reason || request.note || "Request off";
}

for (const shift of shifts) {
  const matches = requestOffs.filter((request) => request.employeeId === shift.employeeId && request.date === shift.date);
  if (matches.length) {
    addIssue(
      "HIGH",
      "Scheduled on request-off",
      shift.date,
      `${shift.employeeName} is scheduled ${shift.roleName} ${shiftTime(shift)} despite RO: ${matches.map(requestText).join("; ")}`
    );
  }
}

for (const shift of bay) {
  addIssue("HIGH", "Open bay shift", shift.date, `Unassigned ${shift.roleName} ${shiftTime(shift)}`);
}

const shiftsByEmployeeDate = new Map();
for (const shift of shifts) {
  const key = `${shift.employeeId}|${shift.date}`;
  if (!shiftsByEmployeeDate.has(key)) shiftsByEmployeeDate.set(key, []);
  shiftsByEmployeeDate.get(key).push(shift);
}

for (const sameDayShifts of shiftsByEmployeeDate.values()) {
  if (sameDayShifts.length <= 1) continue;
  sameDayShifts.sort((a, b) => (minutes(a.start) || 0) - (minutes(b.start) || 0));
  if (isAcceptedDouble(sameDayShifts)) continue;
  const overlapNotes = [];
  for (let i = 0; i < sameDayShifts.length; i++) {
    for (let j = i + 1; j < sameDayShifts.length; j++) {
      const a = sameDayShifts[i];
      const b = sameDayShifts[j];
      const aStart = minutes(a.start);
      const aEnd = minutes(a.end) ?? 1440;
      const bStart = minutes(b.start);
      const bEnd = minutes(b.end) ?? 1440;
      if (aStart != null && bStart != null && aStart < bEnd && bStart < aEnd) {
        overlapNotes.push(`${a.roleName} ${shiftTime(a)} overlaps ${b.roleName} ${shiftTime(b)}`);
      }
    }
  }
  if (!overlapNotes.length && sameDayShifts.some((shift) => shift.isFlexDouble)) continue;
  addIssue(
    overlapNotes.length ? "HIGH" : "MED",
    overlapNotes.length ? "Overlapping double" : "Double",
    sameDayShifts[0].date,
    `${sameDayShifts[0].employeeName}: ${sameDayShifts.map((shift) => `${shift.roleName} ${shiftTime(shift)}`).join(", ")}${overlapNotes.length ? ` (${overlapNotes.join("; ")})` : ""}`
  );
}

const shiftsByEmployee = new Map();
for (const shift of shifts) {
  if (!shiftsByEmployee.has(shift.employeeId)) shiftsByEmployee.set(shift.employeeId, []);
  shiftsByEmployee.get(shift.employeeId).push(shift);
}

for (const employeeShifts of shiftsByEmployee.values()) {
  employeeShifts.sort((a, b) => a.date.localeCompare(b.date) || (minutes(a.start) || 0) - (minutes(b.start) || 0));
  for (let i = 0; i < employeeShifts.length - 1; i++) {
    const current = employeeShifts[i];
    const next = employeeShifts[i + 1];
    if (addDays(current.date, 1) !== next.date) continue;
    const currentEnd = minutes(current.end) ?? (current.untilVolume ? 1380 : null);
    const nextStart = minutes(next.start);
    if (currentEnd == null || nextStart == null) continue;
    const rest = (1440 - currentEnd + nextStart) / 60;
    if ((current.isCloser || currentEnd >= 21 * 60 + 30) && nextStart <= 10 * 60 && rest < 10) {
      addIssue(
        "MED",
        "Clopen",
        next.date,
        `${current.employeeName}: closes ${current.date} ${shiftTime(current)}, opens ${next.date} ${shiftTime(next)} (${rest.toFixed(1)}h rest)`
      );
    }
  }
}

for (const shift of shifts.filter((shift) => /Lito Ortega/i.test(shift.employeeName))) {
  const request = requestOffs.find((item) => item.employeeId === shift.employeeId && item.date === shift.date);
  if (request) {
    addIssue(
      "HIGH",
      "Manager note",
      shift.date,
      `Lito is scheduled ${shift.roleName} ${shiftTime(shift)} while his vacation/request-off appears on this date. If Lito is off weekend, note says Christine opens and is not the flexible/cut person.`
    );
  }
}

for (const shift of shifts.filter((shift) => /Patty/i.test(shift.employeeName) && shift.date === "2026-06-28" && (minutes(shift.start) || 9999) <= 9 * 60)) {
  addIssue("HIGH", "Manager note", shift.date, `Patty is scheduled Sunday morning ${shiftTime(shift)}. Note says NEVER Patty for Sunday brunch/opening.`);
}

for (const shift of shifts.filter((shift) => /Gary/i.test(shift.employeeName) && shift.date === "2026-06-28" && minutes(shift.start) !== 8 * 60)) {
  addIssue("MED", "Manager note", shift.date, `Gary Sunday time is ${shiftTime(shift)}. If Gary is anything but 8:00 Sunday, text him or he may be late.`);
}

for (const shift of shifts.filter((shift) => /Henry/i.test(shift.employeeName) && shift.date === "2026-06-27" && (minutes(shift.end) || 0) >= 18 * 60)) {
  addIssue("MED", "Manager note", shift.date, `Henry is scheduled Saturday night ${shift.roleName} ${shiftTime(shift)}. If he works buffet that week, note says he should be off Saturday night.`);
}

const paulFohShifts = shifts.filter((shift) => /Paul Schellin/i.test(shift.employeeName));
const paulFohHours = paulFohShifts.reduce((total, shift) => total + shiftHours(shift), 0);
if (paulFohHours > 32) {
  addIssue(
    "HIGH",
    "Paul FOH hour cap",
    "2026-06-29",
    `Paul is scheduled ${paulFohHours.toFixed(1)} FOH hours. Cap him at 32 FOH hours because he commonly works BOH buffet Sunday and cannot hit OT.`
  );
}

for (const shift of shifts.filter((shift) => /Penny/i.test(shift.employeeName) && shift.date === "2026-06-24")) {
  addIssue("LOW", "Preference", shift.date, `Penny is scheduled Wednesday ${shift.roleName} ${shiftTime(shift)}. Note says she strongly prefers not to work Wednesday.`);
}

for (const shift of shifts.filter((shift) => /Penny/i.test(shift.employeeName) && shift.date === "2026-06-28")) {
  addIssue("LOW", "Preference", shift.date, `Penny is scheduled Sunday ${shift.roleName} ${shiftTime(shift)}. If she is asked to help Saturday too, confirm she is still willing to work Sunday.`);
}

const counts = Object.fromEntries(dates.map((date, index) => [
  `${days[index]} ${date.slice(5)}`,
  {
    assigned: shifts.filter((shift) => shift.date === date).length,
    bay: bay.filter((shift) => shift.date === date).length,
    requestsOff: requestOffs.filter((request) => request.date === date).length
  }
]));

issues.sort((a, b) => {
  const severityRank = { HIGH: 0, MED: 1, LOW: 2 };
  return severityRank[a.severity] - severityRank[b.severity] || a.date.localeCompare(b.date) || a.type.localeCompare(b.type);
});

console.log(JSON.stringify({
  week: "June 23-29, 2026",
  counts,
  totals: {
    assigned: shifts.length,
    bay: bay.length,
    requestsOff: requestOffs.length,
    issues: issues.length,
    high: issues.filter((issue) => issue.severity === "HIGH").length,
    medium: issues.filter((issue) => issue.severity === "MED").length,
    low: issues.filter((issue) => issue.severity === "LOW").length
  },
  issues
}, null, 2));
