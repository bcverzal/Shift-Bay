const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "restaurant-scheduler-data.json");

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function minutesFromTime(value) {
  if (!value || /until\s*volume/i.test(value)) return null;
  const match = String(value).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function activeWeekFor(state, wrapper) {
  const deviceId = state.meta?.deviceId || wrapper.savedByDeviceId;
  return (
    state.localPreferences?.[deviceId]?.activeWeek ||
    state.localPreferences?.[wrapper.savedByDeviceId]?.activeWeek ||
    state.localPreferences?.activeWeek ||
    state.meta?.activeWeek
  );
}

function templateShiftForDate(templateShift, date, templateId) {
  return {
    id: uid("unassigned"),
    templateId,
    templateShiftId: templateShift.id || "",
    date,
    shiftLabel: templateShift.shiftLabel || "",
    department: templateShift.department || "FOH",
    roleId: templateShift.roleId,
    start: templateShift.start,
    end: templateShift.end,
    untilVolume: Boolean(templateShift.untilVolume),
    isCloser: Boolean(templateShift.isCloser),
    notes: templateShift.notes || "",
    color: templateShift.color || ""
  };
}

const wrapper = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const state = wrapper.data || wrapper;
const historyTemplate = (state.templates || []).find((template) => /History Pattern Template/i.test(template.name || ""));
if (!historyTemplate) throw new Error("Could not find History Pattern Template.");

const activeWeek = activeWeekFor(state, wrapper);
if (!activeWeek) throw new Error("Could not determine the active week.");

const weekDates = Array.from({ length: 7 }, (_, index) => addDays(activeWeek, index));
const dateSet = new Set(weekDates);
const dateByDayIndex = Object.fromEntries(weekDates.map((date) => [new Date(`${date}T00:00:00`).getDay(), date]));

const currentAssigned = (state.shifts || []).filter((shift) => dateSet.has(shift.date));
const outsideWeekAssigned = (state.shifts || []).filter((shift) => !dateSet.has(shift.date));
const outsideWeekBay = (state.unassignedShifts || []).filter((shift) => !dateSet.has(shift.date));

const slots = (historyTemplate.shifts || [])
  .map((shift) => ({ ...shift, date: dateByDayIndex[Number(shift.dayIndex)] }))
  .filter((shift) => shift.date);

const unmatchedSlots = [...slots];
const adjustedAssigned = [];
const removedAssigned = [];

for (const assigned of currentAssigned) {
  const assignedStart = minutesFromTime(assigned.start);
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  unmatchedSlots.forEach((slot, index) => {
    if (slot.date !== assigned.date || slot.roleId !== assigned.roleId) return;
    const slotStart = minutesFromTime(slot.start);
    const score = Math.abs((assignedStart ?? 0) - (slotStart ?? 0));
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestIndex === -1) {
    removedAssigned.push(assigned);
    continue;
  }
  const slot = unmatchedSlots.splice(bestIndex, 1)[0];
  adjustedAssigned.push({
    ...assigned,
    date: slot.date,
    shiftLabel: slot.shiftLabel || assigned.shiftLabel || "",
    department: slot.department || assigned.department || "FOH",
    roleId: slot.roleId,
    start: slot.start,
    end: slot.end,
    untilVolume: Boolean(slot.untilVolume),
    isCloser: Boolean(slot.isCloser),
    color: slot.color || assigned.color || ""
  });
}

const rebuiltBay = unmatchedSlots.map((slot) => templateShiftForDate(slot, slot.date, historyTemplate.id));
const backupPath = DATA_PATH.replace(/\.json$/, `.before-history-align-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}.json`);
fs.copyFileSync(DATA_PATH, backupPath);

state.shifts = [...outsideWeekAssigned, ...adjustedAssigned];
state.unassignedShifts = [...outsideWeekBay, ...rebuiltBay];
state.meta = {
  ...(state.meta || {}),
  updatedAt: new Date().toISOString()
};

if (wrapper.data) {
  wrapper.data = state;
  wrapper.savedAt = new Date().toISOString();
}

fs.writeFileSync(DATA_PATH, `${JSON.stringify(wrapper, null, 2)}\n`);

console.log(JSON.stringify({
  activeWeek,
  backupPath,
  historySlots: slots.length,
  assignedKeptAndAdjusted: adjustedAssigned.length,
  assignedRemovedNoTemplateMatch: removedAssigned.length,
  bayRebuilt: rebuiltBay.length,
  finalWeekAssigned: adjustedAssigned.length,
  finalWeekBay: rebuiltBay.length
}, null, 2));
