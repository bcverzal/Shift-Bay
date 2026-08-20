const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile } = require("../config/load-env");
const { sourceProfiles, assignmentStatus } = require("./migrate_sandbox_availability_to_normalized");

const ROOT = path.join(__dirname, "..");
const SANDBOX_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";

function values(value) {
  return Array.isArray(value) ? value : [];
}

function key(value) {
  return String(value || "").trim().toLowerCase();
}

async function request(baseUrl, serviceKey, pathName, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathName}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
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

function profilePayload(locationId, employeeId, profile) {
  return {
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
}

function assignmentPayload(locationId, employeeId, patternId, profile) {
  return {
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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const documentKey = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";
  if (!baseUrl || !serviceKey) throw new Error("Missing Supabase credentials in .env.");

  const [snapshotRows, employees, profiles, assignments] = await Promise.all([
    request(baseUrl, serviceKey, `scheduler_state_documents?location_id=eq.${encodeURIComponent(locationId)}&document_key=eq.${encodeURIComponent(documentKey)}&select=state,saved_at,updated_at`),
    request(baseUrl, serviceKey, `employees?location_id=eq.${encodeURIComponent(locationId)}&select=id,legacy_id,first_name,last_name`),
    request(baseUrl, serviceKey, `staff_availability_patterns?location_id=eq.${encodeURIComponent(locationId)}&source=eq.snapshot_bridge&select=id,employee_id,legacy_id,name`),
    request(baseUrl, serviceKey, `staff_availability_week_assignments?location_id=eq.${encodeURIComponent(locationId)}&source=eq.snapshot_bridge&select=id,employee_id,pattern_id,legacy_id,status`)
  ]);
  const snapshot = values(snapshotRows)[0];
  if (!snapshot?.state) throw new Error("Sandbox scheduler snapshot was not found.");
  const fallbackDate = String(snapshot.saved_at || snapshot.updated_at || new Date().toISOString()).slice(0, 10);
  const sourceEmployees = values(snapshot.state.employees);
  const normalizedEmployees = new Map(values(employees).map((employee) => [String(employee.legacy_id), employee]));
  const expected = sourceEmployees.flatMap((employee) => sourceProfiles(employee, fallbackDate).map((profile) => ({ employee, profile })));
  const expectedIds = new Set(expected.map(({ profile }) => profile.legacyId));
  const expectedAssignmentIds = new Set(expected
    .filter(({ profile }) => assignmentStatus(profile) !== "draft")
    .map(({ profile }) => profile.assignmentLegacyId));

  const profileByEmployeeAndName = new Map();
  for (const profile of profiles) {
    const identity = `${profile.employee_id}|${key(profile.name)}`;
    if (profileByEmployeeAndName.has(identity)) throw new Error(`Duplicate normalized availability name: ${profile.name}`);
    profileByEmployeeAndName.set(identity, profile);
  }
  const targetProfileIds = new Map();
  const pairs = [];
  for (const item of expected) {
    const normalizedEmployee = normalizedEmployees.get(String(item.employee.id));
    if (!normalizedEmployee) throw new Error(`Employee is not normalized: ${item.employee.id}`);
    const current = profileByEmployeeAndName.get(`${normalizedEmployee.id}|${key(item.profile.name)}`);
    if (!current) {
      pairs.push({ ...item, normalizedEmployee, current: null });
      continue;
    }
    if (targetProfileIds.has(item.profile.legacyId) && targetProfileIds.get(item.profile.legacyId) !== current.id) {
      throw new Error(`Availability legacy ID already maps to another row: ${item.profile.legacyId}`);
    }
    targetProfileIds.set(item.profile.legacyId, current.id);
    pairs.push({ ...item, normalizedEmployee, current });
  }

  const plan = {
    mode: writing ? "write" : "dry-run",
    locationId,
    expectedProfiles: expected.length,
    normalizedProfiles: profiles.length,
    profilesToReconcile: pairs.filter((pair) => pair.current).length,
    profilesToCreate: pairs.filter((pair) => !pair.current).length,
    staleProfiles: profiles.filter((profile) => !expectedIds.has(String(profile.legacy_id))).length,
    staleAssignments: assignments.filter((assignment) => !expectedAssignmentIds.has(String(assignment.legacy_id))).length
  };
  if (!writing) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const profileIds = profiles.map((profile) => profile.id).filter(Boolean);
  const windows = profileIds.length
    ? await request(baseUrl, serviceKey, `staff_availability_pattern_windows?pattern_id=in.(${profileIds.join(",")})&select=id,pattern_id,day_index,start_time,end_time,available,note,sort_order`)
    : [];
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupDirectory = path.join(ROOT, "data", "backups", "cloud-baselines");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, `sandbox-before-availability-identity-reconcile-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ snapshot, employees, profiles, assignments, windows }, null, 2), "utf8");

  for (const pair of pairs) {
    if (!pair.current) {
      const rows = await request(baseUrl, serviceKey, "staff_availability_patterns", {
        method: "POST",
        body: JSON.stringify([profilePayload(locationId, pair.normalizedEmployee.id, pair.profile)])
      });
      pair.current = values(rows)[0];
      if (!pair.current?.id) throw new Error(`Unable to create availability profile: ${pair.profile.name}`);
    } else {
      const rows = await request(baseUrl, serviceKey, `staff_availability_patterns?id=eq.${encodeURIComponent(pair.current.id)}`, {
        method: "PATCH",
        body: JSON.stringify(profilePayload(locationId, pair.normalizedEmployee.id, pair.profile))
      });
      pair.current = values(rows)[0] || pair.current;
    }
    targetProfileIds.set(pair.profile.legacyId, pair.current.id);
  }

  for (const pair of pairs.filter((item) => assignmentStatus(item.profile) !== "draft")) {
    const current = assignments.find((assignment) => String(assignment.pattern_id) === String(pair.current.id));
    const payload = assignmentPayload(locationId, pair.normalizedEmployee.id, pair.current.id, pair.profile);
    if (current) {
      await request(baseUrl, serviceKey, `staff_availability_week_assignments?id=eq.${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
    } else {
      await request(baseUrl, serviceKey, "staff_availability_week_assignments", {
        method: "POST",
        body: JSON.stringify([payload])
      });
    }
  }

  const retainedAssignmentIds = new Set();
  for (const pair of pairs.filter((item) => assignmentStatus(item.profile) !== "draft")) {
    const current = assignments.find((assignment) => String(assignment.pattern_id) === String(pair.current.id));
    if (current) retainedAssignmentIds.add(String(current.id));
  }
  const staleAssignments = assignments.filter((assignment) => !retainedAssignmentIds.has(String(assignment.id)));
  for (const assignment of staleAssignments) {
    await request(baseUrl, serviceKey, `staff_availability_week_assignments?id=eq.${encodeURIComponent(assignment.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  }
  const retainedProfileIds = new Set(pairs.map((pair) => String(pair.current.id)));
  const staleProfiles = profiles.filter((profile) => !retainedProfileIds.has(String(profile.id)));
  for (const profile of staleProfiles) {
    await request(baseUrl, serviceKey, `staff_availability_pattern_windows?pattern_id=eq.${encodeURIComponent(profile.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    await request(baseUrl, serviceKey, `staff_availability_patterns?id=eq.${encodeURIComponent(profile.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  }
  console.log(JSON.stringify({ ...plan, backupPath, reconciledProfiles: pairs.length, removedProfiles: staleProfiles.length, removedAssignments: staleAssignments.length }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
