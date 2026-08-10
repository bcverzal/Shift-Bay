const fs = require("fs");
const path = require("path");
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

function nowIso() {
  return new Date().toISOString();
}

function id(prefix, name) {
  return `${prefix}_demo_${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function fullAvailability() {
  return Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((day) => [day, [{ start: "12:00 AM", end: "11:59 PM" }]]));
}

function limitedAvailability(days) {
  const availability = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((day) => [day, []]));
  Object.entries(days).forEach(([day, windows]) => {
    availability[day] = windows;
  });
  return availability;
}

function role(name, color, department = "FOH") {
  return {
    id: id("role", name),
    name,
    department,
    color,
    defaultRate: 10,
    active: true
  };
}

const roles = [
  role("Server", "#2563eb"),
  role("Host", "#059669"),
  role("Busser", "#7c3aed"),
  role("Bartender", "#db2777"),
  role("Expo", "#ea580c"),
  role("Banquet Server", "#0891b2"),
  role("BOH Block", "#64748b", "BOH"),
  role("Manager", "#b45309", "Exec")
];
const roleByName = Object.fromEntries(roles.map((item) => [item.name, item]));

function employee(firstName, lastName, roleNames, options = {}) {
  return {
    id: id("employee", `${firstName}_${lastName}`),
    firstName,
    lastName,
    nickname: options.nickname || "",
    phone: options.phone || "(555) 010-0000",
    birthday: options.birthday || "",
    departments: options.departments || ["FOH"],
    active: true,
    archived: false,
    callWeekly: Boolean(options.callWeekly),
    noDoubles: Boolean(options.noDoubles),
    canClose: Boolean(options.canClose),
    canLunchClose: Boolean(options.canLunchClose),
    alwaysPrintFloorEndTime: Boolean(options.alwaysPrintFloorEndTime),
    roleTraining: roleNames.map((name) => roleByName[name].id),
    trainerRoles: (options.trainerRoles || []).map((name) => roleByName[name].id),
    emergencyRoleIds: (options.emergencyRoleIds || []).map((name) => roleByName[name].id),
    mealTraining: options.mealTraining || ["Breakfast", "Lunch", "Dinner", "Brunch"],
    roleMealTraining: options.roleMealTraining || {},
    availability: options.availability || fullAvailability(),
    weeklyAvailability: {},
    weeklyRules: [],
    payRates: {},
    managerNotes: options.managerNotes || "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

const employees = [
  employee("Alex", "Rivera", ["Server", "Bartender"], { canClose: true, canLunchClose: true, trainerRoles: ["Server"] }),
  employee("Morgan", "Lane", ["Server"], { canClose: true, managerNotes: "Strong dinner seller; use for prime shifts in demos." }),
  employee("Taylor", "Brooks", ["Host", "Expo"], { canLunchClose: true }),
  employee("Jordan", "Kim", ["Busser"], { availability: limitedAvailability({ 2: [{ start: "4:00 PM", end: "11:59 PM" }], 5: [{ start: "4:00 PM", end: "11:59 PM" }], 6: [{ start: "9:00 AM", end: "11:59 PM" }] }) }),
  employee("Casey", "Stone", ["Bartender", "Server"], { canClose: true, noDoubles: true }),
  employee("Riley", "Chen", ["Server", "Banquet Server"], { canClose: true }),
  employee("Sam", "Patel", ["Host", "Expo"], { canLunchClose: true }),
  employee("Jamie", "Ortiz", ["Server"], { trainerRoles: [], managerNotes: "Demo trainee candidate." }),
  employee("Avery", "Quinn", ["Host"], { callWeekly: true, availability: limitedAvailability({}) }),
  employee("Devin", "Moore", ["Busser", "Banquet Server"], { availability: limitedAvailability({ 4: [{ start: "11:00 AM", end: "5:00 PM" }], 5: [{ start: "11:00 AM", end: "11:59 PM" }], 6: [{ start: "11:00 AM", end: "11:59 PM" }] }) })
];
const employeeByName = Object.fromEntries(employees.map((item) => [`${item.firstName} ${item.lastName}`, item]));

function templateShift(dayIndex, roleName, start, end, flags = {}) {
  const role = roleByName[roleName];
  return {
    id: id("templateShift", `${dayIndex}_${roleName}_${start}_${end}_${Math.random().toString(36).slice(2, 7)}`),
    dayIndex,
    department: role.department,
    roleId: role.id,
    start,
    end,
    untilVolume: false,
    isCloser: Boolean(flags.isCloser),
    isFlexDouble: Boolean(flags.isFlexDouble),
    isLunchCloser: Boolean(flags.isLunchCloser),
    color: role.color,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

const templates = [{
  id: id("template", "standard_demo_week"),
  name: "Standard Demo Week",
  shifts: [
    templateShift(2, "Server", "6:30 AM", "11:00 AM"),
    templateShift(2, "Server", "11:00 AM", "3:00 PM"),
    templateShift(2, "Host", "9:00 AM", "2:00 PM"),
    templateShift(2, "Bartender", "5:00 PM", "9:30 PM", { isCloser: true }),
    templateShift(3, "Server", "8:00 AM", "1:00 PM"),
    templateShift(3, "Server", "4:00 PM", "9:30 PM", { isCloser: true }),
    templateShift(3, "Busser", "5:00 PM", "9:00 PM"),
    templateShift(4, "Server", "9:00 AM", "3:00 PM", { isLunchCloser: true }),
    templateShift(4, "Banquet Server", "4:30 PM", "9:00 PM"),
    templateShift(5, "Server", "9:00 AM", "7:00 PM", { isFlexDouble: true }),
    templateShift(5, "Bartender", "4:00 PM", "11:00 PM", { isCloser: true }),
    templateShift(5, "Expo", "4:00 PM", "8:00 PM"),
    templateShift(6, "Host", "9:00 AM", "2:00 PM"),
    templateShift(6, "Server", "5:00 PM", "10:30 PM", { isCloser: true }),
    templateShift(0, "Server", "9:00 AM", "2:00 PM"),
    templateShift(0, "Busser", "9:00 AM", "2:00 PM")
  ],
  createdAt: nowIso(),
  updatedAt: nowIso()
}];

function shift(date, employeeName, roleName, start, end, flags = {}) {
  const role = roleByName[roleName];
  const employeeRecord = employeeByName[employeeName];
  return {
    id: id("shift", `${date}_${employeeName}_${roleName}_${start}`),
    date,
    employeeId: employeeRecord.id,
    department: role.department,
    roleId: role.id,
    shiftLabel: flags.shiftLabel || roleName,
    start,
    end,
    untilVolume: false,
    isCloser: Boolean(flags.isCloser),
    isFlexDouble: Boolean(flags.isFlexDouble),
    isLunchCloser: Boolean(flags.isLunchCloser),
    color: role.color,
    meals: flags.meals || [],
    notes: flags.notes || "",
    training: flags.training || { isTraining: false, segmentEnd: "" },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function bayShift(date, roleName, start, end, flags = {}) {
  const role = roleByName[roleName];
  return {
    id: id("openShift", `${date}_${roleName}_${start}_${Math.random().toString(36).slice(2, 7)}`),
    date,
    department: role.department,
    roleId: role.id,
    shiftLabel: flags.shiftLabel || roleName,
    start,
    end,
    untilVolume: false,
    isCloser: Boolean(flags.isCloser),
    isFlexDouble: Boolean(flags.isFlexDouble),
    isLunchCloser: Boolean(flags.isLunchCloser),
    color: role.color,
    meals: flags.meals || [],
    notes: flags.notes || "",
    training: flags.training || { isTraining: false, segmentEnd: "" },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

const state = {
  meta: {
    schemaVersion: 2,
    documentId: id("scheduleData", "demo"),
    deviceId: "demo-seed",
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  settings: {
    weekStart: 2,
    nameDisplay: "full",
    visibleDepartments: ["FOH"],
    visibleRoleIds: [],
    groupEmployeesByRole: true,
    hideUnavailableEmployees: false,
    showUnavailablePanel: false,
    showWeeklyRoleSummary: true,
    hideDefaultAvailabilityBlocks: false,
    employeeRosterCollapsed: false,
    openShiftBaySort: "meal",
    scheduleRoleOrder: roles.filter((item) => item.department === "FOH").map((item) => item.id),
    printRoleOrder: roles.filter((item) => item.department === "FOH").map((item) => item.id),
    problemFocusMode: false,
    ignoreWarnings: false,
    showUntilVolumeInShiftEditor: false,
    showShiftNameFields: false,
    autoSetCloserEndTime: true,
    closerEndBufferMinutes: 60,
    flexDoubleEndTime: "7:00 PM",
    lunchCloserEndTime: "5:00 PM",
    closerTrainingRule: "onePerDay",
    scheduleZoom: 1,
    dragScrollSpeed: 5,
    staffingBuffer: 1,
    mealPeriods: {},
    defaultCoverage: {},
    closerRequirements: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 1 },
    projectionRules: {},
    floorPlanPrintRules: {},
    floorPlanCrossRoleNotes: {},
    trainingRequirements: {}
  },
  roles,
  employees,
  templates,
  shifts: [
    shift("2026-07-21", "Alex Rivera", "Server", "6:30 AM", "11:00 AM"),
    shift("2026-07-21", "Morgan Lane", "Server", "11:00 AM", "3:00 PM"),
    shift("2026-07-21", "Taylor Brooks", "Host", "9:00 AM", "2:00 PM"),
    shift("2026-07-22", "Casey Stone", "Bartender", "5:00 PM", "9:30 PM", { isCloser: true }),
    shift("2026-07-23", "Riley Chen", "Banquet Server", "4:30 PM", "9:00 PM"),
    shift("2026-07-24", "Alex Rivera", "Server", "9:00 AM", "7:00 PM", { isFlexDouble: true }),
    shift("2026-07-24", "Sam Patel", "Expo", "4:00 PM", "8:00 PM"),
    shift("2026-07-25", "Jordan Kim", "Busser", "5:00 PM", "10:00 PM"),
    shift("2026-07-26", "Morgan Lane", "Server", "9:00 AM", "2:00 PM", { isLunchCloser: true })
  ],
  unassignedShifts: [
    bayShift("2026-07-21", "Bartender", "5:00 PM", "9:30 PM", { isCloser: true }),
    bayShift("2026-07-22", "Server", "4:00 PM", "9:30 PM", { isCloser: true }),
    bayShift("2026-07-23", "Busser", "5:00 PM", "9:00 PM"),
    bayShift("2026-07-24", "Server", "5:00 PM", "11:00 PM", { isCloser: true }),
    bayShift("2026-07-25", "Host", "9:00 AM", "2:00 PM"),
    bayShift("2026-07-26", "Banquet Server", "11:00 AM", "3:00 PM")
  ],
  salesProjections: {},
  timeOffRequests: [{
    id: id("timeOff", "jamie_2026_07_25"),
    employeeId: employeeByName["Jamie Ortiz"].id,
    date: "2026-07-25",
    start: "",
    end: "",
    allDay: true,
    reason: "Demo request off",
    source: "Demo seed",
    createdAt: nowIso(),
    updatedAt: nowIso()
  }, {
    id: id("timeOff", "avery_2026_07_23_partial"),
    employeeId: employeeByName["Avery Quinn"].id,
    date: "2026-07-23",
    start: "8:00 AM",
    end: "3:00 PM",
    allDay: false,
    reason: "Demo partial request off",
    source: "Demo seed",
    createdAt: nowIso(),
    updatedAt: nowIso()
  }],
  blocks: [{
    id: id("block", "offsite_2026_07_24"),
    employeeId: employeeByName["Devin Moore"].id,
    date: "2026-07-24",
    start: "",
    end: "",
    allDay: true,
    reason: "Off-site demo event",
    createdAt: nowIso(),
    updatedAt: nowIso()
  }],
  coverageRequirements: {},
  scheduleHistory: [],
  dismissedIssues: []
};

async function supabaseFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body?.message || body?.hint || body?.details || `Supabase request failed with ${response.status}.`);
  }
  return body;
}

async function main() {
  const url = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const savedAt = nowIso();
  const body = [{
    location_id: DEMO_LOCATION_ID,
    document_key: DOCUMENT_KEY,
    schema_version: 2,
    state,
    saved_by: null,
    saved_by_device_id: "demo-seed",
    saved_at: savedAt,
    updated_at: savedAt
  }];
  await supabaseFetch(`${url}/rest/v1/scheduler_state_documents?on_conflict=location_id,document_key`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(body)
  });
  fs.writeFileSync(path.join(ROOT, "data", "demo-location-seed-preview.json"), JSON.stringify(state, null, 2));
  console.log(`Seeded demo location ${DEMO_LOCATION_ID}`);
  console.log(`${employees.length} employees, ${templates.length} template, ${state.shifts.length} assigned shifts, ${state.unassignedShifts.length} bay shifts.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
