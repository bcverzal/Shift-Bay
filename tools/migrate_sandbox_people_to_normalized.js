const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile } = require("../config/load-env");

const ROOT = path.join(__dirname, "..");
const SANDBOX_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";

function values(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return text || null;
  let hour = Number(match[1]);
  const minute = match[2];
  const period = match[3].toUpperCase();
  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${minute}:00`;
}

function rolePayload(role, locationId, sortOrder) {
  return {
    location_id: locationId,
    legacy_id: String(role.id),
    name: String(role.name || "Unnamed role"),
    department: String(role.department || "FOH"),
    color: String(role.color || "#64748b"),
    default_rate: Number(role.defaultRate || 0),
    sort_order: sortOrder,
    active: role.active !== false,
    updated_at: new Date().toISOString()
  };
}

function employeePayload(employee, locationId) {
  return {
    location_id: locationId,
    legacy_id: String(employee.id),
    first_name: String(employee.firstName || ""),
    last_name: String(employee.lastName || ""),
    nickname: String(employee.nickname || ""),
    phone: String(employee.phone || ""),
    birthday: employee.birthday || null,
    departments: values(employee.departments).length ? values(employee.departments) : ["FOH"],
    active: employee.active !== false,
    archived: Boolean(employee.archived),
    call_weekly_availability: Boolean(employee.callWeekly),
    trained_closer: Boolean(employee.canClose || employee.trainedCloser),
    lunch_closer: Boolean(employee.canLunchClose || employee.lunchCloser),
    scheduling_note: String(employee.managerNotes || ""),
    updated_at: new Date().toISOString()
  };
}

function availabilityPayloads(employee, employeeId) {
  const availability = employee?.availability && typeof employee.availability === "object" ? employee.availability : {};
  return Object.entries(availability).flatMap(([dayIndex, ranges]) =>
    values(ranges).filter((range) => range && (range.start || range.end)).map((range, sortOrder) => ({
      employee_id: employeeId,
      day_index: Number(dayIndex),
      start_time: normalizedTime(range.start),
      end_time: normalizedTime(range.end),
      available: true,
      note: "",
      sort_order: sortOrder
    }))
  );
}

function roleCapabilityPayloads(employee, employeeId, rolesByLegacyId) {
  const trainedRoles = new Set(values(employee.roleTraining).map(String));
  const trainerRoles = new Set(values(employee.trainerRoles).map(String));
  const emergencyRoles = new Set(values(employee.emergencyRoleIds).map(String));
  const mealTraining = employee.roleMealTraining && typeof employee.roleMealTraining === "object" ? employee.roleMealTraining : {};
  return [...new Set([...trainedRoles, ...trainerRoles, ...emergencyRoles])].flatMap((legacyRoleId) => {
    const role = rolesByLegacyId.get(legacyRoleId);
    if (!role?.id) return [];
    return [{
      employee_id: employeeId,
      role_id: role.id,
      trained: trainedRoles.has(legacyRoleId),
      training: false,
      can_train: trainerRoles.has(legacyRoleId),
      emergency_only: emergencyRoles.has(legacyRoleId),
      meal_names: values(mealTraining[legacyRoleId])
    }];
  });
}

async function request(baseUrl, key, pathName, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathName}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || body?.hint || `Supabase request failed with ${response.status}: ${pathName}`);
  return body;
}

async function upsertByLegacy(baseUrl, key, table, locationId, sourceRows, makePayload) {
  const existing = await request(baseUrl, key, `${table}?location_id=eq.${encodeURIComponent(locationId)}&select=id,legacy_id`);
  const existingByLegacy = new Map(values(existing).filter((row) => row.legacy_id).map((row) => [String(row.legacy_id), row]));
  const results = [];
  for (let index = 0; index < sourceRows.length; index += 1) {
    const source = sourceRows[index];
    if (!source?.id) continue;
    const payload = makePayload(source, locationId, index);
    const current = existingByLegacy.get(String(source.id));
    const row = current?.id
      ? await request(baseUrl, key, `${table}?id=eq.${encodeURIComponent(current.id)}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await request(baseUrl, key, table, { method: "POST", body: JSON.stringify([payload]) });
    const saved = values(row)[0];
    if (saved?.id) results.push(saved);
  }
  return results;
}

async function main() {
  loadEnvFile(ROOT);
  const args = process.argv.slice(2);
  const writing = args.includes("--write");
  const sandboxConfirmed = args.includes("--confirm-sandbox");
  const liveConfirmed = args.includes("--confirm-live");
  const locationIndex = args.indexOf("--location");
  const locationId = locationIndex >= 0 ? args[locationIndex + 1] || "" : SANDBOX_LOCATION_ID;
  const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const documentKey = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";
  if (!baseUrl || !key) throw new Error("Missing Supabase credentials in .env.");
  const configuredLocation = String(process.env.SHIFT_BAY_LOCATION_ID || "");
  const isSandbox = locationId === SANDBOX_LOCATION_ID;
  const isConfirmedLive = liveConfirmed && locationId === configuredLocation && locationId !== SANDBOX_LOCATION_ID;
  if (!isSandbox && !isConfirmedLive) throw new Error("Refusing this location. Use Sandbox or pass --confirm-live for the configured live location.");
  if (writing && !sandboxConfirmed && !isConfirmedLive) throw new Error("Refusing to write until --confirm-sandbox or --confirm-live is supplied.");

  const snapshotRows = await request(baseUrl, key, `scheduler_state_documents?location_id=eq.${encodeURIComponent(locationId)}&document_key=eq.${encodeURIComponent(documentKey)}&select=state,saved_at,updated_at`);
  const snapshot = values(snapshotRows)[0];
  if (!snapshot?.state) throw new Error("Sandbox scheduler snapshot was not found.");
  const state = snapshot.state;
  const sourceRoles = values(state.roles);
  const sourceEmployees = values(state.employees);
  const plan = {
    locationId,
    snapshotSavedAt: snapshot.saved_at || snapshot.updated_at || null,
    roles: sourceRoles.length,
    employees: sourceEmployees.length,
    availabilityWindows: sourceEmployees.reduce((count, employee) => count + availabilityPayloads(employee, "placeholder").length, 0),
    roleCapabilities: sourceEmployees.reduce((count, employee) => count + new Set([...values(employee.roleTraining), ...values(employee.trainerRoles), ...values(employee.emergencyRoleIds)]).size, 0),
    mode: writing ? "write" : "dry-run"
  };
  if (!writing) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupDirectory = path.join(ROOT, "data", "backups", "cloud-baselines");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupPrefix = locationId === SANDBOX_LOCATION_ID ? "sandbox-before-normalized-people" : "live-before-normalized-people";
  const backupPath = path.join(backupDirectory, `${backupPrefix}-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2), "utf8");

  const roles = await upsertByLegacy(baseUrl, key, "roles", locationId, sourceRoles, rolePayload);
  const employees = await upsertByLegacy(baseUrl, key, "employees", locationId, sourceEmployees, employeePayload);
  const rolesByLegacyId = new Map(roles.filter((role) => role.legacy_id).map((role) => [String(role.legacy_id), role]));
  const employeesByLegacyId = new Map(employees.filter((employee) => employee.legacy_id).map((employee) => [String(employee.legacy_id), employee]));

  let availabilityWindows = 0;
  let roleCapabilities = 0;
  for (const employee of sourceEmployees) {
    const normalizedEmployee = employeesByLegacyId.get(String(employee.id));
    if (!normalizedEmployee?.id) throw new Error(`Employee did not normalize: ${employee.id}`);
    await request(baseUrl, key, `availability_rules?employee_id=eq.${encodeURIComponent(normalizedEmployee.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    await request(baseUrl, key, `employee_roles?employee_id=eq.${encodeURIComponent(normalizedEmployee.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    const availability = availabilityPayloads(employee, normalizedEmployee.id);
    const capabilities = roleCapabilityPayloads(employee, normalizedEmployee.id, rolesByLegacyId);
    if (availability.length) await request(baseUrl, key, "availability_rules", { method: "POST", body: JSON.stringify(availability) });
    if (capabilities.length) await request(baseUrl, key, "employee_roles", { method: "POST", body: JSON.stringify(capabilities) });
    availabilityWindows += availability.length;
    roleCapabilities += capabilities.length;
  }

  console.log(JSON.stringify({ ...plan, backupPath, normalizedRoles: roles.length, normalizedEmployees: employees.length, availabilityWindows, roleCapabilities }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  availabilityPayloads,
  employeePayload,
  normalizedTime,
  roleCapabilityPayloads,
  rolePayload
};
