const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile } = require("../config/load-env");

const ROOT = path.resolve(__dirname, "..");
const DEMO_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";
const DOCUMENT_KEY = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";
loadEnvFile(ROOT);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function nowIso() { return new Date().toISOString(); }
function id(prefix, value) { return `${prefix}_demo_history_${String(value).replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`; }
function addDays(date, days) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function roleId(state, name) {
  const role = (state.roles || []).find((item) => item.name === name);
  if (!role) throw new Error(`Demo role not found: ${name}`);
  return role.id;
}

function employeeId(state, name) {
  const employee = (state.employees || []).find((item) => `${item.firstName} ${item.lastName}` === name);
  if (!employee) throw new Error(`Demo employee not found: ${name}`);
  return employee.id;
}

function historicalShift(state, weekStart, date, employeeName, roleName, start, end, flags = {}) {
  const role = (state.roles || []).find((item) => item.name === roleName);
  return {
    id: id("shift", `${weekStart}_${date}_${employeeName}_${roleName}_${start}`),
    date,
    employeeId: employeeId(state, employeeName),
    department: role.department,
    roleId: role.id,
    shiftLabel: roleName,
    start,
    end,
    untilVolume: false,
    isCloser: Boolean(flags.isCloser),
    isFlexDouble: Boolean(flags.isFlexDouble),
    isLunchCloser: Boolean(flags.isLunchCloser),
    color: role.color,
    meals: flags.meals || [],
    notes: flags.notes || "Demo history",
    training: { isTraining: false, segmentEnd: "" },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function requestOff(state, date, employeeName, note) {
  return {
    id: id("timeoff", `${date}_${employeeName}`),
    employeeId: employeeId(state, employeeName),
    date,
    start: "",
    end: "",
    allDay: true,
    reason: note,
    note,
    source: "Demo history",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function buildHistory(state) {
  const weeks = ["2026-05-26", "2026-06-02", "2026-06-09", "2026-06-16", "2026-06-23", "2026-06-30", "2026-07-07", "2026-07-14"];
  const history = weeks.map((weekStart, index) => {
    const tuesday = weekStart;
    const friday = addDays(weekStart, 3);
    const sunday = addDays(weekStart, 5);
    const shifts = [];
    const targetEmployee = index < 4 || index === 6 || index === 7 ? "Alex Rivera" : "Morgan Lane";
    shifts.push(historicalShift(state, weekStart, tuesday, targetEmployee, "Server", "6:30 AM", "11:00 AM", { meals: ["Breakfast"] }));
    shifts.push(historicalShift(state, weekStart, addDays(weekStart, 1), index % 2 ? "Jamie Ortiz" : "Morgan Lane", "Server", "11:00 AM", "3:00 PM", { meals: ["Lunch"] }));
    shifts.push(historicalShift(state, weekStart, friday, index % 2 ? "Casey Stone" : "Alex Rivera", "Bartender", "5:00 PM", "11:00 PM", { isCloser: true, meals: ["Dinner"] }));
    shifts.push(historicalShift(state, weekStart, sunday, index % 2 ? "Taylor Brooks" : "Sam Patel", "Host", "9:00 AM", "2:00 PM", { meals: ["Breakfast", "Lunch"] }));
    return {
      id: id("week", weekStart),
      sourceName: "Demo recommendation history",
      importedAt: nowIso(),
      weekStart,
      shifts
    };
  });
  return history;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || body?.hint || body?.details || `Supabase request failed with ${response.status}.`);
  return body;
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
  const rows = await request(`${supabaseUrl}/rest/v1/scheduler_state_documents?location_id=eq.${DEMO_LOCATION_ID}&document_key=eq.${encodeURIComponent(DOCUMENT_KEY)}&select=*`, { headers });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.state) throw new Error("The demo scheduler document was not found.");
  const state = row.state;
  const backupPath = path.join(ROOT, "data", "backups", `demo-recommendation-history-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(state, null, 2), "utf8");

  const history = buildHistory(state);
  const targetDate = "2026-07-28";
  const targetRoleId = roleId(state, "Server");
  state.scheduleHistory = [
    ...(state.scheduleHistory || []).filter((week) => week.sourceName !== "Demo recommendation history"),
    ...history
  ];
  state.timeOffRequests = [
    ...(state.timeOffRequests || []).filter((request) => request.source !== "Demo history"),
    requestOff(state, "2026-06-23", "Alex Rivera", "Demo history: unavailable for the recurring Tuesday breakfast shift."),
    requestOff(state, "2026-06-30", "Alex Rivera", "Demo history: unavailable for the recurring Tuesday breakfast shift.")
  ];
  state.unassignedShifts = [
    ...(state.unassignedShifts || []).filter((shift) => !(shift.date === targetDate && shift.roleId === targetRoleId && shift.start === "6:30 AM" && shift.end === "11:00 AM")),
    historicalShift(state, "2026-07-28", targetDate, "Alex Rivera", "Server", "6:30 AM", "11:00 AM", { meals: ["Breakfast"] })
  ].map((shift) => ({ ...shift, employeeId: undefined }));
  const savedAt = nowIso();
  await request(`${supabaseUrl}/rest/v1/scheduler_state_documents?on_conflict=location_id,document_key`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      location_id: DEMO_LOCATION_ID,
      document_key: DOCUMENT_KEY,
      schema_version: Number(row.schema_version || 2),
      state,
      saved_by: null,
      saved_by_device_id: "demo-recommendation-seed",
      saved_at: savedAt,
      updated_at: savedAt
    }])
  });
  console.log(JSON.stringify({
    backupPath,
    weeksAdded: history.length,
    targetShift: "Tuesday, July 28, 2026 | Server | 6:30 AM - 11:00 AM",
    expectedCandidates: ["Alex Rivera", "Morgan Lane"]
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
