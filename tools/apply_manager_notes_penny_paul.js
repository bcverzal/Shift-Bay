const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "restaurant-scheduler-data.json");
const backupPath = dataPath.replace(".json", ".before-penny-paul-manager-notes-20260615.json");
const wrapper = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const state = wrapper.data || wrapper;

function findEmployee(firstName, lastName) {
  return (state.employees || []).find((employee) => (
    String(employee.firstName || "").toLowerCase() === firstName.toLowerCase() &&
    String(employee.lastName || "").toLowerCase() === lastName.toLowerCase()
  ));
}

function appendNote(employee, note) {
  if (!employee) return "Missing employee";
  const current = String(employee.managerNotes || "").trim();
  if (current.includes(note)) return `${employee.firstName} ${employee.lastName}: note already present`;
  employee.managerNotes = current ? `${current}\n${note}` : note;
  return `${employee.firstName} ${employee.lastName}: added note`;
}

fs.copyFileSync(dataPath, backupPath);

const changed = [
  appendNote(
    findEmployee("Penny", "Abel"),
    "Scheduling note: Penny commonly works doubles and is usually okay with them. If she helps Saturday, confirm she is still willing to work Sunday. She strongly prefers not to work Wednesdays."
  ),
  appendNote(
    findEmployee("Paul", "Schellin"),
    "Scheduling note: Paul commonly works doubles Friday/Saturday. If hosting, he can work about 9 AM-8 PM hosting. If expo, he hosts morning/afternoon then switches to expo around 4 PM until about 8 PM. He often works BOH buffet Sunday, so cap him at 32 FOH hours to avoid OT."
  )
];

state.meta = { ...(state.meta || {}), updatedAt: new Date().toISOString() };
if (wrapper.data) {
  wrapper.data = state;
  wrapper.savedAt = new Date().toISOString();
}

fs.writeFileSync(dataPath, `${JSON.stringify(wrapper, null, 2)}\n`);
console.log(JSON.stringify({ backupPath, changed }, null, 2));
