const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile } = require("../config/load-env");

const ROOT = path.join(__dirname, "..");
const DEFAULT_DOCUMENT_KEY = "primary";

function usage() {
  console.log("Usage: node tools/compare_normalized_employee_baseline.js [--location <uuid>] [--output <report.json>]");
  console.log("Reads only. Compares a scheduler snapshot to normalized employees, roles, and availability windows.");
}

function values(value) {
  return Array.isArray(value) ? value : [];
}

function expectedAvailabilityWindows(employee) {
  const availability = employee?.availability && typeof employee.availability === "object" ? employee.availability : {};
  return Object.entries(availability).flatMap(([dayIndex, ranges]) =>
    values(ranges).filter((range) => range && (range.start || range.end)).map((range, sortOrder) => ({
      dayIndex: Number(dayIndex),
      start: String(range.start || ""),
      end: String(range.end || ""),
      sortOrder
    }))
  );
}

function normalizedTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return text;
  let hour = Number(match[1]);
  const minute = match[2];
  const period = match[3].toUpperCase();
  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${minute}:00`;
}

function expectedRoleCapabilities(employee) {
  const trained = new Set(values(employee?.roleTraining).map(String));
  const canTrain = new Set(values(employee?.trainerRoles).map(String));
  const emergencyOnly = new Set(values(employee?.emergencyRoleIds).map(String));
  const mealsByRole = employee?.roleMealTraining && typeof employee.roleMealTraining === "object" ? employee.roleMealTraining : {};
  return [...new Set([...trained, ...canTrain, ...emergencyOnly])]
    .map((roleLegacyId) => ({
      roleLegacyId,
      trained: trained.has(roleLegacyId),
      canTrain: canTrain.has(roleLegacyId),
      emergencyOnly: emergencyOnly.has(roleLegacyId),
      meals: values(mealsByRole[roleLegacyId]).map(String).sort()
    }))
    .sort((a, b) => a.roleLegacyId.localeCompare(b.roleLegacyId));
}

async function supabaseGet(baseUrl, serviceRoleKey, table, filters, select) {
  const query = new URLSearchParams({ ...filters, select });
  const response = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || `Unable to read ${table}: ${response.status}`);
  return values(body);
}

async function main() {
  loadEnvFile(ROOT);
  const args = process.argv.slice(2);
  if (args.includes("--help")) { usage(); return; }
  const getArg = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] || "" : "";
  };
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const locationId = getArg("--location") || process.env.SHIFT_BAY_LOCATION_ID || "";
  const documentKey = process.env.SHIFT_BAY_DOCUMENT_KEY || DEFAULT_DOCUMENT_KEY;
  const outputPath = getArg("--output");
  if (!supabaseUrl || !serviceRoleKey || !locationId) throw new Error("Missing Supabase configuration or location ID.");

  const snapshotRows = await supabaseGet(supabaseUrl, serviceRoleKey, "scheduler_state_documents", {
    location_id: `eq.${locationId}`,
    document_key: `eq.${documentKey}`
  }, "state,schema_version,saved_at,updated_at");
  const snapshot = snapshotRows[0];
  if (!snapshot?.state) throw new Error("No scheduler snapshot found for this location.");

  const [normalizedEmployees, normalizedRoles] = await Promise.all([
    supabaseGet(supabaseUrl, serviceRoleKey, "employees", { location_id: `eq.${locationId}` }, "id,legacy_id,first_name,last_name,nickname,active,archived"),
    supabaseGet(supabaseUrl, serviceRoleKey, "roles", { location_id: `eq.${locationId}` }, "id,legacy_id,name,department,active")
  ]);
  const employeeIds = normalizedEmployees.map((employee) => employee.id).filter(Boolean);
  const [normalizedAvailability, normalizedCapabilities] = employeeIds.length
    ? await Promise.all([
      supabaseGet(supabaseUrl, serviceRoleKey, "availability_rules", { employee_id: `in.(${employeeIds.join(",")})` }, "employee_id,day_index,start_time,end_time,available,sort_order"),
      supabaseGet(supabaseUrl, serviceRoleKey, "employee_roles", { employee_id: `in.(${employeeIds.join(",")})` }, "employee_id,role_id,trained,can_train,emergency_only,meal_names")
    ])
    : [[], []];

  const sourceEmployees = values(snapshot.state.employees);
  const sourceRoles = values(snapshot.state.roles);
  const normalizedEmployeesByLegacy = new Map(normalizedEmployees.filter((row) => row.legacy_id).map((row) => [String(row.legacy_id), row]));
  const normalizedRolesByLegacy = new Map(normalizedRoles.filter((row) => row.legacy_id).map((row) => [String(row.legacy_id), row]));
  const availabilityByEmployee = new Map();
  normalizedAvailability.forEach((row) => {
    const rows = availabilityByEmployee.get(row.employee_id) || [];
    rows.push(row);
    availabilityByEmployee.set(row.employee_id, rows);
  });
  const capabilityByEmployee = new Map();
  normalizedCapabilities.forEach((row) => {
    const rows = capabilityByEmployee.get(row.employee_id) || [];
    rows.push(row);
    capabilityByEmployee.set(row.employee_id, rows);
  });

  const missingEmployees = sourceEmployees
    .filter((employee) => employee?.id && !normalizedEmployeesByLegacy.has(String(employee.id)))
    .map((employee) => ({ legacyId: employee.id, name: [employee.firstName, employee.lastName].filter(Boolean).join(" ") }));
  const orphanNormalizedEmployees = normalizedEmployees
    .filter((employee) => employee.legacy_id && !sourceEmployees.some((source) => String(source?.id || "") === String(employee.legacy_id)))
    .map((employee) => ({ legacyId: employee.legacy_id, name: [employee.first_name, employee.last_name].filter(Boolean).join(" ") }));
  const missingRoles = sourceRoles
    .filter((role) => role?.id && !normalizedRolesByLegacy.has(String(role.id)))
    .map((role) => ({ legacyId: role.id, name: role.name }));

  const availabilityMismatches = [];
  const roleCapabilityMismatches = [];
  sourceEmployees.forEach((employee) => {
    const normalizedEmployee = normalizedEmployeesByLegacy.get(String(employee?.id || ""));
    if (!normalizedEmployee) return;
    const expected = expectedAvailabilityWindows(employee)
      .map((window) => `${window.dayIndex}|${normalizedTime(window.start)}|${normalizedTime(window.end)}|${window.sortOrder}`)
      .sort();
    const actual = values(availabilityByEmployee.get(normalizedEmployee.id))
      .filter((window) => window.available !== false)
      .map((window) => `${window.day_index}|${window.start_time || ""}|${window.end_time || ""}|${window.sort_order || 0}`)
      .sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      availabilityMismatches.push({
        legacyId: employee.id,
        name: [employee.firstName, employee.lastName].filter(Boolean).join(" "),
        expectedWindows: expected.length,
        normalizedWindows: actual.length
      });
    }
    const expectedCapabilities = expectedRoleCapabilities(employee);
    const actualCapabilities = values(capabilityByEmployee.get(normalizedEmployee.id))
      .map((capability) => ({
        roleLegacyId: String(normalizedRoles.find((role) => role.id === capability.role_id)?.legacy_id || ""),
        trained: Boolean(capability.trained),
        canTrain: Boolean(capability.can_train),
        emergencyOnly: Boolean(capability.emergency_only),
        meals: values(capability.meal_names).map(String).sort()
      }))
      .sort((a, b) => a.roleLegacyId.localeCompare(b.roleLegacyId));
    if (JSON.stringify(expectedCapabilities) !== JSON.stringify(actualCapabilities)) {
      roleCapabilityMismatches.push({
        legacyId: employee.id,
        name: [employee.firstName, employee.lastName].filter(Boolean).join(" "),
        expectedCapabilities: expectedCapabilities.length,
        normalizedCapabilities: actualCapabilities.length
      });
    }
  });

  const report = {
    generatedAt: new Date().toISOString(),
    locationId,
    document: {
      schemaVersion: snapshot.schema_version,
      savedAt: snapshot.saved_at,
      updatedAt: snapshot.updated_at
    },
    counts: {
      snapshotEmployees: sourceEmployees.length,
      normalizedEmployees: normalizedEmployees.length,
      snapshotRoles: sourceRoles.length,
      normalizedRoles: normalizedRoles.length,
      normalizedAvailabilityWindows: normalizedAvailability.length,
      normalizedRoleCapabilities: normalizedCapabilities.length
    },
    findings: {
      snapshotEmployeesMissingNormalized: missingEmployees,
      normalizedEmployeesNotInSnapshot: orphanNormalizedEmployees,
      snapshotRolesMissingNormalized: missingRoles,
      availabilityMismatches,
      roleCapabilityMismatches
    },
    readyForNormalizedEmployeeReads: missingEmployees.length === 0 && missingRoles.length === 0 && availabilityMismatches.length === 0 && roleCapabilityMismatches.length === 0
  };
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(report, null, 2), "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
