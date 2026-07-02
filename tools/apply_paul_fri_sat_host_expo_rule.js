const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "restaurant-scheduler-data.json");
const backupPath = path.join(__dirname, "..", "data", `restaurant-scheduler-data.before-paul-fri-sat-rule-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`);
const raw = fs.readFileSync(dataPath, "utf8");
const wrapper = JSON.parse(raw);
const state = wrapper.data || wrapper;

const paul = (state.employees || []).find((employee) => `${employee.firstName || ""} ${employee.lastName || ""}`.trim() === "Paul Schellin");
const hostRole = (state.roles || []).find((role) => role.name === "Host");
const expoRole = (state.roles || []).find((role) => role.name === "Expo");

if (!paul || !hostRole || !expoRole) {
  throw new Error("Could not find Paul, Host role, or Expo role.");
}

if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, raw);

const changed = [];
for (const shift of state.shifts || []) {
  if (shift.employeeId !== paul.id || !["2026-06-26", "2026-06-27"].includes(shift.date)) continue;
  if (shift.start === "9:00 AM") {
    shift.roleId = hostRole.id;
    shift.department = "FOH";
    shift.end = "4:00 PM";
    shift.untilVolume = false;
    shift.color = hostRole.color || shift.color;
    changed.push(`${shift.date} Host 9:00 AM-4:00 PM`);
  } else if (shift.start === "4:00 PM") {
    shift.roleId = expoRole.id;
    shift.department = "FOH";
    shift.end = "8:00 PM";
    shift.untilVolume = false;
    shift.color = expoRole.color || shift.color;
    changed.push(`${shift.date} Expo 4:00 PM-8:00 PM`);
  }
}

paul.managerNotes = [
  paul.managerNotes || "",
  "Friday/Saturday Paul rule: use either Host 9:00 AM-8:00 PM, or Host 9:00 AM-4:00 PM plus Expo 4:00 PM-8:00 PM."
].filter(Boolean).join("\n");

const now = new Date().toISOString();
state.meta = { ...(state.meta || {}), updatedAt: now };
if (wrapper.data) {
  wrapper.data = state;
  wrapper.savedAt = now;
  wrapper.savedByDeviceId = state.meta.deviceId || wrapper.savedByDeviceId;
}
fs.writeFileSync(dataPath, `${JSON.stringify(wrapper, null, 2)}\n`);

console.log(JSON.stringify({ backup: backupPath, changed }, null, 2));
