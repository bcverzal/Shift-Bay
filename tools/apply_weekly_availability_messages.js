const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "restaurant-scheduler-data.json");
const backupPath = dataPath.replace(".json", ".before-weekly-availability-messages-20260615.json");
const wrapper = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const state = wrapper.data || wrapper;
const weekKey = "2026-06-23";

function emptyAvailability() {
  return Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((day) => [day, []]));
}

function findEmployee(firstName, lastName) {
  return (state.employees || []).find((employee) => (
    String(employee.firstName || "").toLowerCase() === firstName.toLowerCase() &&
    String(employee.lastName || "").toLowerCase() === lastName.toLowerCase()
  ));
}

function setWeeklyAvailability(firstName, lastName, dayIndex, ranges) {
  const employee = findEmployee(firstName, lastName);
  if (!employee) return `Missing ${firstName} ${lastName}`;
  employee.weeklyAvailability = employee.weeklyAvailability || {};
  employee.weeklyAvailability[weekKey] = employee.weeklyAvailability[weekKey] || emptyAvailability();
  employee.weeklyAvailability[weekKey][dayIndex] = ranges;
  return `${firstName} ${lastName}: ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayIndex]} ${ranges.map((range) => `${range.start}-${range.end}`).join(", ")}`;
}

fs.copyFileSync(dataPath, backupPath);

const pm = [{ start: "4:00 PM", end: "10:00 PM" }];
const am = [{ start: "9:00 AM", end: "3:00 PM" }];
const changed = [
  setWeeklyAvailability("Braden", "Fick", 2, pm),
  setWeeklyAvailability("Braden", "Fick", 3, pm),
  setWeeklyAvailability("Riley", "Fick", 5, pm),
  setWeeklyAvailability("Riley", "Fick", 1, am),
  setWeeklyAvailability("Caleb", "Engle", 4, pm),
  setWeeklyAvailability("Caleb", "Engle", 1, pm)
];

state.meta = { ...(state.meta || {}), updatedAt: new Date().toISOString() };
if (wrapper.data) {
  wrapper.data = state;
  wrapper.savedAt = new Date().toISOString();
}

fs.writeFileSync(dataPath, `${JSON.stringify(wrapper, null, 2)}\n`);
console.log(JSON.stringify({ backupPath, changed }, null, 2));
