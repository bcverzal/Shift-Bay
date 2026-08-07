const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile } = require("../config/load-env");

const ROOT = path.join(__dirname, "..");
const SANDBOX_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";

function values(value) {
  return Array.isArray(value) ? value : [];
}

function validDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizedTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return text || null;
  let hour = Number(match[1]);
  const period = match[3].toUpperCase();
  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}:00`;
}

function availabilityWindows(availability, patternId) {
  const source = availability && typeof availability === "object" ? availability : {};
  return Object.entries(source).flatMap(([dayIndex, ranges]) => values(ranges)
    .filter((range) => range && (range.start || range.end))
    .map((range, sortOrder) => ({
      pattern_id: patternId,
      day_index: Number(dayIndex),
      start_time: normalizedTime(range.start),
      end_time: normalizedTime(range.end),
      available: true,
      note: "",
      sort_order: sortOrder
    })));
}

function sourceProfiles(employee, fallbackDate) {
  const patterns = values(employee?.availabilityPatterns);
  if (patterns.length) {
    return patterns.map((pattern, index) => ({
      legacyId: `availability-profile:${employee.id}:${pattern.id || index + 1}`,
      assignmentLegacyId: `availability-assignment:${employee.id}:${pattern.id || index + 1}`,
      name: String(pattern.name || `Availability ${index + 1}`).trim() || `Availability ${index + 1}`,
      availability: pattern.availability || {},
      effectiveDate: validDate(pattern.effectiveDate || employee.availabilityEffectiveDate) || fallbackDate,
      repeatWeeks: Math.max(1, Math.min(4, Number(pattern.repeatWeeks) || 1)),
      status: String(pattern.approvalStatus || pattern.status || (pattern.approved ? "approved" : (pattern.active !== false ? "active" : "draft"))).toLowerCase(),
      active: pattern.active !== false
    }));
  }
  return [{
    legacyId: `availability-profile:${employee.id}:regular`,
    assignmentLegacyId: `availability-assignment:${employee.id}:regular`,
    name: String(employee?.availabilityPatternName || "Regular availability").trim() || "Regular availability",
    availability: employee?.availability || {},
    effectiveDate: validDate(employee?.availabilityEffectiveDate) || fallbackDate,
    repeatWeeks: Math.max(1, Math.min(4, Number(employee?.availabilityRepeatWeeks) || 1)),
    status: "active",
    active: true
  }];
}

function assignmentStatus(profile) {
  if (profile.active) return "active";
  if (profile.status === "approved") return "approved";
  if (["submitted", "pending"].includes(profile.status)) return "submitted";
  return "draft";
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

async function findByLegacy(baseUrl, key, table, locationId, legacyId) {
  const rows = await request(baseUrl, key, `${table}?location_id=eq.${encodeURIComponent(locationId)}&legacy_id=eq.${encodeURIComponent(legacyId)}&select=id`);
  return values(rows)[0] || null;
}

async function upsertProfile(baseUrl, key, locationId, employeeId, profile) {
  const payload = {
    location_id: locationId,
    employee_id: employeeId,
    legacy_id: profile.legacyId,
    name: profile.name,
    mode: "saved",
    active: false,
    source: "snapshot_bridge",
    archived: false,
    updated_at: new Date().toISOString()
  };
  const existing = await findByLegacy(baseUrl, key, "staff_availability_patterns", locationId, profile.legacyId);
  const rows = existing?.id
    ? await request(baseUrl, key, `staff_availability_patterns?id=eq.${encodeURIComponent(existing.id)}`, { method: "PATCH", body: JSON.stringify(payload) })
    : await request(baseUrl, key, "staff_availability_patterns", { method: "POST", body: JSON.stringify([payload]) });
  return values(rows)[0];
}

async function upsertAssignment(baseUrl, key, locationId, employeeId, patternId, profile) {
  const payload = {
    location_id: locationId,
    employee_id: employeeId,
    legacy_id: profile.assignmentLegacyId,
    pattern_id: patternId,
    week_start: profile.effectiveDate,
    effective_date: profile.effectiveDate,
    repeat_interval_weeks: profile.repeatWeeks,
    submission_mode: "manager_entered",
    status: assignmentStatus(profile),
    source: "snapshot_bridge",
    updated_at: new Date().toISOString()
  };
  const existing = await findByLegacy(baseUrl, key, "staff_availability_week_assignments", locationId, profile.assignmentLegacyId);
  const rows = existing?.id
    ? await request(baseUrl, key, `staff_availability_week_assignments?id=eq.${encodeURIComponent(existing.id)}`, { method: "PATCH", body: JSON.stringify(payload) })
    : await request(baseUrl, key, "staff_availability_week_assignments", { method: "POST", body: JSON.stringify([payload]) });
  return values(rows)[0];
}

async function replaceWindows(baseUrl, key, patternId, availability) {
  await request(baseUrl, key, `staff_availability_pattern_windows?pattern_id=eq.${encodeURIComponent(patternId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  const rows = availabilityWindows(availability, patternId);
  if (rows.length) await request(baseUrl, key, "staff_availability_pattern_windows", { method: "POST", body: JSON.stringify(rows) });
  return rows.length;
}

async function removeStaleSnapshotRows(baseUrl, key, table, locationId, legacyIds) {
  const rows = await request(baseUrl, key, `${table}?location_id=eq.${encodeURIComponent(locationId)}&source=eq.snapshot_bridge&select=id,legacy_id`);
  const stale = values(rows).filter((row) => row?.legacy_id && !legacyIds.has(String(row.legacy_id)));
  for (const row of stale) {
    await request(baseUrl, key, `${table}?id=eq.${encodeURIComponent(row.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  }
  return stale.length;
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
  if (!snapshot?.state) throw new Error("Scheduler snapshot was not found for this location.");
  const state = snapshot.state;
  const fallbackDate = validDate(state?.settings?.weekStartDate) || String(snapshot.saved_at || snapshot.updated_at || new Date().toISOString()).slice(0, 10);
  const employees = values(state.employees);
  const profiles = employees.flatMap((employee) => sourceProfiles(employee, fallbackDate).map((profile) => ({ employee, profile })));
  const plan = {
    mode: writing ? "write" : "dry-run",
    locationId,
    snapshotSavedAt: snapshot.saved_at || snapshot.updated_at || null,
    employees: employees.length,
    profiles: profiles.length,
    availabilityWindows: profiles.reduce((count, item) => count + availabilityWindows(item.profile.availability, "placeholder").length, 0),
    assignments: profiles.filter(({ profile }) => assignmentStatus(profile) !== "draft").length
  };
  if (!writing) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupDirectory = path.join(ROOT, "data", "backups", "cloud-baselines");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupPrefix = locationId === SANDBOX_LOCATION_ID ? "sandbox-before-normalized-availability" : "live-before-normalized-availability";
  const backupPath = path.join(backupDirectory, `${backupPrefix}-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2), "utf8");

  const normalizedEmployees = await request(baseUrl, key, `employees?location_id=eq.${encodeURIComponent(locationId)}&select=id,legacy_id`);
  const employeeIds = new Map(values(normalizedEmployees).filter((row) => row?.legacy_id).map((row) => [String(row.legacy_id), String(row.id)]));
  const profileLegacyIds = new Set();
  const assignmentLegacyIds = new Set();
  let windowsWritten = 0;
  let assignmentsWritten = 0;
  for (const { employee, profile } of profiles) {
    const employeeId = employeeIds.get(String(employee?.id || ""));
    if (!employeeId) throw new Error(`Employee is not normalized: ${employee?.id || "unknown"}`);
    const saved = await upsertProfile(baseUrl, key, locationId, employeeId, profile);
    if (!saved?.id) throw new Error(`Availability profile was not saved: ${profile.name}`);
    windowsWritten += await replaceWindows(baseUrl, key, saved.id, profile.availability);
    profileLegacyIds.add(profile.legacyId);
    if (assignmentStatus(profile) !== "draft") {
      const assignment = await upsertAssignment(baseUrl, key, locationId, employeeId, saved.id, profile);
      if (!assignment?.id) throw new Error(`Availability assignment was not saved: ${profile.name}`);
      assignmentsWritten += 1;
      assignmentLegacyIds.add(profile.assignmentLegacyId);
    }
  }
  const removedProfiles = await removeStaleSnapshotRows(baseUrl, key, "staff_availability_patterns", locationId, profileLegacyIds);
  const removedAssignments = await removeStaleSnapshotRows(baseUrl, key, "staff_availability_week_assignments", locationId, assignmentLegacyIds);
  console.log(JSON.stringify({ ...plan, backupPath, windowsWritten, assignmentsWritten, removedProfiles, removedAssignments }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { availabilityWindows, assignmentStatus, normalizedTime, sourceProfiles, validDate };
