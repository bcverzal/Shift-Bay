const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "restaurant-scheduler-data.json");
const backupPath = path.join(__dirname, "..", "data", `restaurant-scheduler-data.before-double-cleanup-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`);
const raw = fs.readFileSync(dataPath, "utf8");
const wrapper = JSON.parse(raw);
const state = wrapper.data || wrapper;

const targetDates = new Set(["2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26", "2026-06-27", "2026-06-28", "2026-06-29"]);

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function minutes(value) {
  if (!value || /until\s*volume/i.test(value)) return 9999;
  const match = String(value).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return 9999;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function roleById(id) {
  return (state.roles || []).find((role) => role.id === id);
}

function employeeById(id) {
  return (state.employees || []).find((employee) => employee.id === id);
}

function fullName(employee) {
  return [employee?.firstName || "", employee?.lastName || ""].filter(Boolean).join(" ").trim();
}

function displayName(employee) {
  return employee?.nickname || fullName(employee) || "Unknown";
}

function exemptEmployee(employee) {
  const name = `${displayName(employee)} ${fullName(employee)}`;
  return /Penny Abel/i.test(name) || /Paul Schellin/i.test(name);
}

function shiftLabel(shift) {
  return `${shift.date} ${displayName(employeeById(shift.employeeId))} ${roleById(shift.roleId)?.name || "Role"} ${shift.start}-${shift.untilVolume ? "Vol" : shift.end}`;
}

const groups = new Map();
(state.shifts || [])
  .filter((shift) => targetDates.has(shift.date) && shift.department === "FOH")
  .forEach((shift) => {
    const key = `${shift.employeeId}|${shift.date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(shift);
  });

const moveIds = new Set();
const moved = [];
groups.forEach((sameDayShifts) => {
  if (sameDayShifts.length <= 1) return;
  const employee = employeeById(sameDayShifts[0].employeeId);
  if (exemptEmployee(employee)) return;
  sameDayShifts.sort((a, b) => minutes(a.start) - minutes(b.start));
  sameDayShifts.slice(1).forEach((shift) => {
    moveIds.add(shift.id);
    moved.push(shiftLabel(shift));
  });
});

if (!moveIds.size) {
  console.log(JSON.stringify({ moved: 0, backup: null, details: [] }, null, 2));
  process.exit(0);
}

if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, raw);

const movedShifts = (state.shifts || []).filter((shift) => moveIds.has(shift.id));
state.shifts = (state.shifts || []).filter((shift) => !moveIds.has(shift.id));
state.unassignedShifts = [
  ...(state.unassignedShifts || []),
  ...movedShifts.map((shift) => ({
    id: uid("unassigned"),
    templateId: shift.templateId || "",
    templateShiftId: shift.templateShiftId || "",
    date: shift.date,
    shiftLabel: shift.shiftLabel || "",
    department: shift.department,
    roleId: shift.roleId,
    start: shift.start,
    end: shift.end,
    untilVolume: Boolean(shift.untilVolume),
    isCloser: Boolean(shift.isCloser),
    isFlexDouble: Boolean(shift.isFlexDouble),
    notes: shift.notes || "",
    color: shift.color || roleById(shift.roleId)?.color || "#2563eb",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }))
];

const now = new Date().toISOString();
state.meta = { ...(state.meta || {}), updatedAt: now };
if (wrapper.data) {
  wrapper.data = state;
  wrapper.savedAt = now;
  wrapper.savedByDeviceId = state.meta.deviceId || wrapper.savedByDeviceId;
}
fs.writeFileSync(dataPath, `${JSON.stringify(wrapper, null, 2)}\n`);

console.log(JSON.stringify({ moved: moved.length, backup: backupPath, details: moved }, null, 2));
