const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const staff = fs.readFileSync(path.join(root, "staff.js"), "utf8");
const edge = fs.readFileSync(path.join(root, "supabase", "functions", "shift-bay-api", "index.ts"), "utf8");

function includes(source, value, message) {
  assert.ok(source.includes(value), message || `Expected source to include ${value}`);
}

function assertPermissionContract() {
  includes(app, 'return ["owner", "manager"].includes(currentAccessRole())', "manager editing must remain explicit");
  includes(app, 'document.body.classList.toggle("viewer-read-only"', "viewer UI must enter read-only mode");
  includes(app, 'managers.hidden = currentUser.role !== "owner"', "manager administration must remain owner-only");
  includes(edge, "async function validateSession", "API must validate authenticated sessions");
  includes(edge, "selectedLocationFromRequest", "API must resolve the requested location");
  includes(edge, "This account is not linked to this Shift Bay location", "location isolation must reject unknown memberships");
  includes(edge, "async function requireOwner", "owner-only API guard must exist");
  includes(edge, "async function requireEditor", "editor API guard must exist");
  includes(edge, '"owner", "manager"', "owner and manager must be the only editor roles");
  includes(edge, "view-only access", "viewer mutation rejection must be explicit");
  includes(edge, 'path === "/staff/schedule"', "staff schedule API must be separate from manager state API");
  includes(edge, 'path === "/staff/profile"', "staff profile API must be separate from manager profile editing");
  includes(edge, 'path === "/staff/request-offs"', "staff request-off API must be separately routed");
  includes(edge, 'path === "/staff/availability"', "staff availability API must be separately routed");
  includes(edge, 'path === "/normalized/employees"', "normalized employee shadow reads must be separately routed");
  includes(edge, "handleNormalizedEmployees", "normalized employee shadow reads must be implemented");
  includes(edge, 'path === "/normalized/schedule"', "normalized schedule shadow reads must be separately routed");
  includes(edge, "handleNormalizedSchedule", "normalized schedule shadow reads must be implemented");
  includes(edge, "Normalized schedule reads are not enabled for this location.", "normalized schedule endpoint must refuse unconfigured locations");
  includes(edge, 'path === "/staff-requests/review"', "manager review API must be separately routed");
  includes(edge, 'async function handleManagerStaffRequests', "manager request-off queue must exist");
  includes(edge, 'async function handleManagerStaffAvailability', "manager availability queue must exist");
}

async function request(baseUrl, token, pathname, locationId, options = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(locationId ? { "x-shift-bay-location-id": locationId } : {}),
    ...(options.body ? { "Content-Type": "application/json" } : {})
  };
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${pathname}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, body: await response.text() };
}

async function runRuntimeMatrix() {
  const baseUrl = process.env.SHIFT_BAY_ACCESS_TEST_BASE_URL;
  const locationId = process.env.SHIFT_BAY_ACCESS_TEST_LOCATION_ID;
  const tokens = {
    owner: process.env.SHIFT_BAY_ACCESS_TEST_OWNER_TOKEN,
    manager: process.env.SHIFT_BAY_ACCESS_TEST_MANAGER_TOKEN,
    viewer: process.env.SHIFT_BAY_ACCESS_TEST_VIEWER_TOKEN,
    staff: process.env.SHIFT_BAY_ACCESS_TEST_STAFF_TOKEN
  };
  if (!baseUrl || !locationId || !tokens.owner) {
    console.log("access matrix runtime checks skipped (sandbox base URL, location ID, and owner token are not configured)");
    return;
  }

  const stateReadRoles = ["owner", "manager", "viewer"];
  for (const role of stateReadRoles) {
    if (!tokens[role]) continue;
    const result = await request(baseUrl, tokens[role], "/api/state", locationId);
    assert.equal(result.status, 200, `${role} should be able to read the selected location state`);
  }

  if (tokens.staff) {
    const result = await request(baseUrl, tokens.staff, "/api/state", locationId);
    assert.ok([401, 403].includes(result.status), "staff must not read the manager state endpoint");
  }

  const normalizedScheduleLocationId = process.env.SHIFT_BAY_ACCESS_TEST_SANDBOX_LOCATION_ID;
  if (normalizedScheduleLocationId) {
    for (const role of stateReadRoles) {
      if (!tokens[role]) continue;
      const normalizedSchedule = await request(baseUrl, tokens[role], "/api/normalized/schedule", normalizedScheduleLocationId);
      const expected = role === "viewer" ? 403 : 200;
      assert.equal(normalizedSchedule.status, expected, `${role} must have the correct normalized schedule shadow-read access`);
    }
  }

  for (const role of ["manager", "viewer", "staff"]) {
    if (!tokens[role]) continue;
    const result = await request(baseUrl, tokens[role], "/api/managers", locationId);
    assert.ok([401, 403].includes(result.status), `${role} must not manage manager access`);
  }

  const ownerManagers = await request(baseUrl, tokens.owner, "/api/managers", locationId);
  assert.equal(ownerManagers.status, 200, "owner should be able to read manager access");

  for (const role of stateReadRoles) {
    if (!tokens[role]) continue;
    const normalizedEmployees = await request(baseUrl, tokens[role], "/api/normalized/employees", locationId);
    const expected = role === "viewer" ? 403 : 200;
    assert.equal(normalizedEmployees.status, expected, `${role} must have the correct normalized employee shadow-read access`);
  }

  if (tokens.staff) {
    const normalizedEmployees = await request(baseUrl, tokens.staff, "/api/normalized/employees", locationId);
    assert.equal(normalizedEmployees.status, 403, "staff must not read the manager normalized employee shadow endpoint");
  }

  const managerQueue = await request(baseUrl, tokens.manager || tokens.owner, "/api/staff-requests", locationId);
  assert.equal(managerQueue.status, 200, "owner or manager should be able to read request-off approvals");
  const availabilityQueue = await request(baseUrl, tokens.manager || tokens.owner, "/api/staff-availability", locationId);
  assert.equal(availabilityQueue.status, 200, "owner or manager should be able to read availability approvals");
  for (const role of ["viewer", "staff"]) {
    if (!tokens[role]) continue;
    const requestQueue = await request(baseUrl, tokens[role], "/api/staff-requests", locationId);
    assert.equal(requestQueue.status, 403, `${role} must not read manager request-off approvals`);
    const availabilityQueueRead = await request(baseUrl, tokens[role], "/api/staff-availability", locationId);
    assert.equal(availabilityQueueRead.status, 403, `${role} must not read manager availability approvals`);
  }

  if (tokens.staff) {
    const staffSchedule = await request(baseUrl, tokens.staff, "/api/staff/schedule", locationId);
    assert.ok([200, 403].includes(staffSchedule.status), "staff schedule must be authenticated and account-linked");
    const staffDirectory = await request(baseUrl, tokens.staff, "/api/staff/directory", locationId);
    assert.ok([200, 403].includes(staffDirectory.status), "staff directory must be authenticated and account-linked");
    const managerAsStaff = await request(baseUrl, tokens.manager || tokens.owner, "/api/staff/schedule", locationId);
    assert.equal(managerAsStaff.status, 403, "manager credentials must not impersonate a staff account");
  }

  if (tokens.viewer) {
    const viewerWrite = await request(baseUrl, tokens.viewer, "/api/state", locationId, {
      method: "PUT",
      body: { saveScope: "schedule", data: {} }
    });
    assert.equal(viewerWrite.status, 403, "viewer schedule writes must be rejected server-side");
  }

  const otherLocationId = process.env.SHIFT_BAY_ACCESS_TEST_OTHER_LOCATION_ID;
  if (otherLocationId) {
    const crossLocation = await request(baseUrl, tokens.owner, "/api/state", otherLocationId);
    assert.equal(crossLocation.status, 403, "a user must not read an unlinked location");
  }
  console.log("access matrix runtime checks passed");
}

async function run() {
  assertPermissionContract();
  await runRuntimeMatrix();
  console.log("access matrix contract tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
