const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile } = require("../config/load-env");
const { employeePayload, rolePayload } = require("./migrate_sandbox_people_to_normalized");

const ROOT = path.join(__dirname, "..");
const SANDBOX_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";

function values(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").trim().toLowerCase();
}

function employeeName(employee) {
  return text(`${employee?.first_name || employee?.firstName || ""} ${employee?.last_name || employee?.lastName || ""}`);
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
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;
  if (!response.ok) throw new Error(body?.message || body?.hint || `Supabase request failed with ${response.status}: ${pathName}`);
  return body;
}

function uniqueBy(rows, keyFn, label) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) throw new Error(`${label} has a blank identity.`);
    if (map.has(key)) throw new Error(`${label} has duplicate identity: ${key}`);
    map.set(key, row);
  }
  return map;
}

async function main() {
  loadEnvFile(ROOT);
  const args = process.argv.slice(2);
  const writing = args.includes("--write");
  const confirmed = args.includes("--confirm-sandbox");
  const locationIndex = args.indexOf("--location");
  const locationId = locationIndex >= 0 ? args[locationIndex + 1] || "" : SANDBOX_LOCATION_ID;
  if (locationId !== SANDBOX_LOCATION_ID) throw new Error("This repair is sandbox-only.");
  if (writing && !confirmed) throw new Error("Refusing to write until --confirm-sandbox is supplied.");

  const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const documentKey = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";
  if (!baseUrl || !key) throw new Error("Missing Supabase credentials in .env.");

  const [snapshotRows, normalizedRoles, normalizedEmployees] = await Promise.all([
    request(baseUrl, key, `scheduler_state_documents?location_id=eq.${encodeURIComponent(locationId)}&document_key=eq.${encodeURIComponent(documentKey)}&select=state,saved_at,updated_at`),
    request(baseUrl, key, `roles?location_id=eq.${encodeURIComponent(locationId)}&select=id,legacy_id,name,department,color,default_rate,sort_order,active`),
    request(baseUrl, key, `employees?location_id=eq.${encodeURIComponent(locationId)}&select=id,legacy_id,first_name,last_name,nickname,phone,birthday,departments,active,archived,call_weekly_availability,trained_closer,lunch_closer,scheduling_note`)
  ]);
  const snapshot = values(snapshotRows)[0];
  if (!snapshot?.state) throw new Error("Sandbox scheduler snapshot was not found.");
  const sourceRoles = values(snapshot.state.roles);
  const sourceEmployees = values(snapshot.state.employees);
  const sourceRolesByName = uniqueBy(sourceRoles, (row) => text(row.name), "Snapshot roles");
  const sourceEmployeesByName = uniqueBy(sourceEmployees, (row) => text(`${row.firstName} ${row.lastName}`), "Snapshot employees");
  const normalizedRolesByName = uniqueBy(normalizedRoles, (row) => text(row.name), "Normalized roles");
  const normalizedEmployeesByName = uniqueBy(normalizedEmployees, employeeName, "Normalized employees");

  const rolePairs = sourceRoles.map((source) => {
    const normalized = normalizedRolesByName.get(text(source.name));
    if (!normalized) throw new Error(`No normalized role matches snapshot role: ${source.name}`);
    return { source, normalized };
  });
  const employeePairs = sourceEmployees.map((source) => {
    const normalized = normalizedEmployeesByName.get(text(`${source.firstName} ${source.lastName}`));
    if (!normalized) throw new Error(`No normalized employee matches snapshot employee: ${source.firstName} ${source.lastName}`);
    return { source, normalized };
  });

  const targetRoleIds = new Map();
  const targetEmployeeIds = new Map();
  for (const { source, normalized } of rolePairs) {
    const existingTarget = normalizedRoles.find((row) => row.legacy_id === String(source.id) && row.id !== normalized.id);
    if (existingTarget) throw new Error(`Role legacy ID already belongs to another row: ${source.id}`);
    targetRoleIds.set(String(source.id), normalized.id);
  }
  for (const { source, normalized } of employeePairs) {
    const existingTarget = normalizedEmployees.find((row) => row.legacy_id === String(source.id) && row.id !== normalized.id);
    if (existingTarget) throw new Error(`Employee legacy ID already belongs to another row: ${source.id}`);
    targetEmployeeIds.set(String(source.id), normalized.id);
  }

  const plan = {
    mode: writing ? "write" : "dry-run",
    locationId,
    snapshotSavedAt: snapshot.saved_at || snapshot.updated_at || null,
    roles: rolePairs.map(({ source, normalized }) => ({ name: source.name, from: normalized.legacy_id, to: String(source.id) })),
    employees: employeePairs.map(({ source, normalized }) => ({ name: `${source.firstName} ${source.lastName}`, from: normalized.legacy_id, to: String(source.id) }))
  };
  if (!writing) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupDirectory = path.join(ROOT, "data", "backups", "cloud-baselines");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, `sandbox-before-identity-reconcile-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ snapshot, normalizedRoles, normalizedEmployees }, null, 2), "utf8");

  for (const { source, normalized } of rolePairs) {
    await request(baseUrl, key, `roles?id=eq.${encodeURIComponent(normalized.id)}`, {
      method: "PATCH",
      body: JSON.stringify(rolePayload(source, locationId, Number(source.sortOrder || 0)))
    });
  }
  for (const { source, normalized } of employeePairs) {
    await request(baseUrl, key, `employees?id=eq.${encodeURIComponent(normalized.id)}`, {
      method: "PATCH",
      body: JSON.stringify(employeePayload(source, locationId))
    });
  }

  console.log(JSON.stringify({ ...plan, backupPath, reconciledRoles: rolePairs.length, reconciledEmployees: employeePairs.length }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
