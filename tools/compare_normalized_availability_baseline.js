const { loadEnvFile } = require("../config/load-env");
const { availabilityWindows, assignmentStatus, normalizedTime, sourceProfiles } = require("./migrate_sandbox_availability_to_normalized");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SANDBOX_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";

function values(value) {
  return Array.isArray(value) ? value : [];
}

async function get(baseUrl, key, table, filters, select) {
  const query = new URLSearchParams({ ...filters, select });
  const response = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || `Unable to read ${table}: ${response.status}`);
  return values(body);
}

function comparisonKey(window) {
  return `${window.day_index}|${window.start_time || ""}|${window.end_time || ""}|${window.sort_order || 0}`;
}

async function main() {
  loadEnvFile(ROOT);
  const args = process.argv.slice(2);
  const locationIndex = args.indexOf("--location");
  const locationId = locationIndex >= 0 ? args[locationIndex + 1] || "" : SANDBOX_LOCATION_ID;
  const liveConfirmed = args.includes("--confirm-live");
  const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const documentKey = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";
  if (!baseUrl || !key) throw new Error("Missing Supabase credentials in .env.");
  const configuredLocation = String(process.env.SHIFT_BAY_LOCATION_ID || "");
  const isSandbox = locationId === SANDBOX_LOCATION_ID;
  const isConfirmedLive = liveConfirmed && locationId === configuredLocation && locationId !== SANDBOX_LOCATION_ID;
  if (!isSandbox && !isConfirmedLive) throw new Error("Refusing this location. Use Sandbox or pass --confirm-live for the configured live location.");

  const snapshotRows = await get(baseUrl, key, "scheduler_state_documents", {
    location_id: `eq.${locationId}`,
    document_key: `eq.${documentKey}`
  }, "state,saved_at,updated_at");
  const snapshot = snapshotRows[0];
  if (!snapshot?.state) throw new Error("Sandbox scheduler snapshot was not found.");
  const fallbackDate = String(snapshot.saved_at || snapshot.updated_at || new Date().toISOString()).slice(0, 10);
  const expected = values(snapshot.state.employees).flatMap((employee) => sourceProfiles(employee, fallbackDate).map((profile) => ({ employee, profile })));

  const [employees, profiles, assignments] = await Promise.all([
    get(baseUrl, key, "employees", { location_id: `eq.${locationId}` }, "id,legacy_id"),
    get(baseUrl, key, "staff_availability_patterns", { location_id: `eq.${locationId}`, source: "eq.snapshot_bridge" }, "id,employee_id,legacy_id,name"),
    get(baseUrl, key, "staff_availability_week_assignments", { location_id: `eq.${locationId}`, source: "eq.snapshot_bridge" }, "id,legacy_id,employee_id,pattern_id,week_start,effective_date,repeat_interval_weeks,status")
  ]);
  const profileIds = profiles.map((profile) => profile.id).filter(Boolean);
  const windows = profileIds.length
    ? await get(baseUrl, key, "staff_availability_pattern_windows", { pattern_id: `in.(${profileIds.join(",")})` }, "pattern_id,day_index,start_time,end_time,sort_order,available")
    : [];
  const employeesByLegacy = new Map(employees.filter((employee) => employee.legacy_id).map((employee) => [String(employee.legacy_id), employee]));
  const profilesByLegacy = new Map(profiles.filter((profile) => profile.legacy_id).map((profile) => [String(profile.legacy_id), profile]));
  const assignmentsByLegacy = new Map(assignments.filter((assignment) => assignment.legacy_id).map((assignment) => [String(assignment.legacy_id), assignment]));
  const windowsByProfile = new Map();
  windows.forEach((window) => {
    const list = windowsByProfile.get(window.pattern_id) || [];
    list.push(window);
    windowsByProfile.set(window.pattern_id, list);
  });

  const missingProfiles = [];
  const windowMismatches = [];
  const assignmentMismatches = [];
  const expectedAssignmentIds = new Set();
  expected.forEach(({ employee, profile }) => {
    const normalizedEmployee = employeesByLegacy.get(String(employee.id || ""));
    const normalizedProfile = profilesByLegacy.get(profile.legacyId);
    if (!normalizedEmployee || !normalizedProfile) {
      missingProfiles.push({ employeeId: employee.id, name: profile.name, legacyId: profile.legacyId });
      return;
    }
    const expectedWindows = availabilityWindows(profile.availability, normalizedProfile.id)
      .map((window) => `${window.day_index}|${window.start_time || ""}|${window.end_time || ""}|${window.sort_order || 0}`)
      .sort();
    const actualWindows = values(windowsByProfile.get(normalizedProfile.id))
      .filter((window) => window.available !== false)
      .map(comparisonKey)
      .sort();
    if (JSON.stringify(expectedWindows) !== JSON.stringify(actualWindows)) {
      windowMismatches.push({ employeeId: employee.id, name: profile.name, expected: expectedWindows.length, actual: actualWindows.length });
    }
    if (assignmentStatus(profile) === "draft") return;
    expectedAssignmentIds.add(profile.assignmentLegacyId);
    const assignment = assignmentsByLegacy.get(profile.assignmentLegacyId);
    if (!assignment || String(assignment.employee_id) !== String(normalizedEmployee.id) || String(assignment.pattern_id) !== String(normalizedProfile.id)
      || String(assignment.effective_date || assignment.week_start) !== profile.effectiveDate
      || Number(assignment.repeat_interval_weeks) !== profile.repeatWeeks
      || String(assignment.status) !== assignmentStatus(profile)) {
      assignmentMismatches.push({ employeeId: employee.id, name: profile.name, legacyId: profile.assignmentLegacyId });
    }
  });
  const unexpectedProfiles = profiles.filter((profile) => !expected.some((item) => item.profile.legacyId === profile.legacy_id)).map((profile) => profile.legacy_id);
  const unexpectedAssignments = assignments.filter((assignment) => !expectedAssignmentIds.has(String(assignment.legacy_id))).map((assignment) => assignment.legacy_id);
  const report = {
    generatedAt: new Date().toISOString(),
    locationId,
    snapshotSavedAt: snapshot.saved_at || snapshot.updated_at || null,
    counts: { expectedProfiles: expected.length, normalizedProfiles: profiles.length, normalizedWindows: windows.length, normalizedAssignments: assignments.length },
    findings: { missingProfiles, windowMismatches, assignmentMismatches, unexpectedProfiles, unexpectedAssignments },
    readyForNormalizedAvailabilityReads: !missingProfiles.length && !windowMismatches.length && !assignmentMismatches.length && !unexpectedProfiles.length && !unexpectedAssignments.length
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
