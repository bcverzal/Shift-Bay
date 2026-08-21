const path = require("node:path");
const { loadEnvFile } = require("../config/load-env");
const { sourceProfiles, availabilityWindows } = require("./migrate_sandbox_availability_to_normalized");

const ROOT = path.join(__dirname, "..");

function values(value) {
  return Array.isArray(value) ? value : [];
}

function isBlock(item = {}) {
  return Boolean(item.blockType || item.kind === "block");
}

async function request(baseUrl, key, pathName) {
  const pageSize = 1000;
  const rows = [];
  let offset = 0;
  while (true) {
    const separator = pathName.includes("?") ? "&" : "?";
    const response = await fetch(`${baseUrl}/rest/v1/${pathName}${separator}limit=${pageSize}&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(body?.message || body?.hint || `Supabase request failed with ${response.status}: ${pathName}`);
    const page = values(body);
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

function compareIds(expected, actual) {
  const expectedSet = new Set(expected.filter(Boolean).map(String));
  const actualSet = new Set(actual.filter(Boolean).map(String));
  return {
    expected: expectedSet.size,
    actual: actualSet.size,
    missing: [...expectedSet].filter((id) => !actualSet.has(id)),
    extra: [...actualSet].filter((id) => !expectedSet.has(id))
  };
}

async function main() {
  loadEnvFile(ROOT);
  const args = process.argv.slice(2);
  const locationIndex = args.indexOf("--location");
  const locationId = locationIndex >= 0 ? args[locationIndex + 1] || "" : String(process.env.SHIFT_BAY_LOCATION_ID || "");
  const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const documentKey = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";
  if (!baseUrl || !key || !locationId) throw new Error("Missing Supabase credentials or SHIFT_BAY_LOCATION_ID in .env.");

  const snapshots = await request(baseUrl, key, `scheduler_state_documents?location_id=eq.${encodeURIComponent(locationId)}&document_key=eq.${encodeURIComponent(documentKey)}&order=updated_at.desc&select=state,saved_at,updated_at`);
  const snapshot = values(snapshots)[0];
  if (!snapshot?.state) throw new Error("No scheduler state document was found for the requested location.");
  const state = snapshot.state;
  const employees = values(state.employees);
  const roles = values(state.roles);
  const assigned = values(state.shifts);
  const open = values(state.unassignedShifts);
  const requests = values(state.timeOffRequests);
  const templates = values(state.templates);
  const templateShiftIds = templates.flatMap((template) => values(template.shifts).map((shift) => String(shift.id || "")));
  const availabilityProfiles = employees.flatMap((employee) => sourceProfiles(employee, String(snapshot.saved_at || snapshot.updated_at || "").slice(0, 10)));
  const availabilityAssignments = availabilityProfiles
    .filter((profile) => profile.active || ["approved", "submitted", "pending"].includes(profile.status))
    .map((profile) => profile.assignmentLegacyId);

  const tables = {
    roles: `roles?location_id=eq.${encodeURIComponent(locationId)}&select=legacy_id`,
    employees: `employees?location_id=eq.${encodeURIComponent(locationId)}&select=legacy_id`,
    shifts: `shifts?location_id=eq.${encodeURIComponent(locationId)}&select=legacy_id`,
    requestOffs: `request_offs?location_id=eq.${encodeURIComponent(locationId)}&select=legacy_id`,
    scheduleBlocks: `schedule_blocks?location_id=eq.${encodeURIComponent(locationId)}&select=legacy_id`,
    templates: `templates?location_id=eq.${encodeURIComponent(locationId)}&select=id,legacy_id`,
    availabilityProfiles: `staff_availability_patterns?location_id=eq.${encodeURIComponent(locationId)}&source=eq.snapshot_bridge&select=legacy_id`,
    availabilityAssignments: `staff_availability_week_assignments?location_id=eq.${encodeURIComponent(locationId)}&source=eq.snapshot_bridge&select=legacy_id`
  };
  const rows = Object.fromEntries(await Promise.all(Object.entries(tables).map(async ([name, query]) => [name, values(await request(baseUrl, key, query))])));
  const normalizedTemplates = rows.templates;
  const templateIds = normalizedTemplates.map((row) => row.id).filter(Boolean);
  rows.templateShifts = templateIds.length
    ? values(await request(baseUrl, key, `template_shifts?template_id=in.(${templateIds.map(encodeURIComponent).join(",")})&select=legacy_id,template_id`))
    : [];
  const expected = {
    roles: roles.map((item) => item.id),
    employees: employees.map((item) => item.id),
    shifts: [...assigned, ...open].map((item) => item.id),
    requestOffs: requests.filter((item) => !isBlock(item)).map((item) => item.id),
    scheduleBlocks: requests.filter(isBlock).map((item) => item.id),
    templates: templates.map((item) => item.id),
    templateShifts: templateShiftIds,
    availabilityProfiles: availabilityProfiles.map((profile) => profile.legacyId),
    availabilityAssignments
  };
  const comparison = Object.fromEntries(Object.keys(expected).map((name) => [name, compareIds(expected[name], rows[name].map((row) => row.legacy_id))]));
  const totalMissing = Object.values(comparison).reduce((count, item) => count + item.missing.length, 0);
  console.log(JSON.stringify({
    mode: "read-only-plan",
    locationId,
    snapshotSavedAt: snapshot.saved_at || snapshot.updated_at || null,
    sourceCounts: {
      roles: roles.length,
      employees: employees.length,
      assignedShifts: assigned.length,
      openShifts: open.length,
      requestOffs: expected.requestOffs.length,
      scheduleBlocks: expected.scheduleBlocks.length,
      templates: templates.length,
      templateShifts: templateShiftIds.length,
      availabilityProfiles: availabilityProfiles.length,
      availabilityWindows: availabilityProfiles.reduce((count, profile) => count + availabilityWindows(profile.availability, "placeholder").length, 0),
      availabilityAssignments: availabilityAssignments.length
    },
    comparison,
    readyForNormalizedWrites: totalMissing === 0,
    note: "No writes were performed. Extra legacy IDs are reported for review and are not deleted by this tool."
  }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.message || error); process.exit(1); });

module.exports = { compareIds, isBlock };
