// Shift Bay hosted API bridge.
//
// Deploy as a Supabase Edge Function named `shift-bay-api`.
// Required secrets:
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY
// - SHIFT_BAY_LOCATION_ID
// - SHIFT_BAY_DOCUMENT_KEY optional, defaults to primary
// - SHIFT_BAY_SITE_URL optional, defaults to hosted Shift Bay URL
// - RESEND_API_KEY required for invitation email delivery
// - RESEND_FROM_EMAIL optional, defaults to invites@send.shift-bay.com

type JsonRecord = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shift-bay-location-id",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Cache-Control": "no-store"
};

function env(name: string, fallback = "") {
  return Deno.env.get(name) || fallback;
}

function config() {
  return {
    supabaseUrl: env("SUPABASE_URL").replace(/\/$/, ""),
    anonKey: env("SUPABASE_ANON_KEY"),
    serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    locationId: env("SHIFT_BAY_LOCATION_ID"),
    siteUrl: env("SHIFT_BAY_SITE_URL", "https://shift-bay.com"),
    documentKey: env("SHIFT_BAY_DOCUMENT_KEY", "primary"),
    resendApiKey: env("RESEND_API_KEY"),
    resendFrom: env("RESEND_FROM_EMAIL", "Shift Bay <invites@send.shift-bay.com>")
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function routePath(request: Request) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const functionIndex = parts.indexOf("shift-bay-api");
  const routeParts = functionIndex >= 0 ? parts.slice(functionIndex + 1) : parts;
  const path = `/${routeParts.join("/")}`;
  return path === "/" ? "/status" : path;
}

function bearerToken(request: Request) {
  const match = String(request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function supabaseJson(pathOrUrl: string, options: RequestInit = {}) {
  const cfg = config();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${cfg.supabaseUrl}/rest/v1${pathOrUrl}`;
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.error_description || body?.details || `Supabase request failed with ${response.status}.`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body;
}

function serviceHeaders(extra: HeadersInit = {}) {
  const cfg = config();
  return {
    apikey: cfg.serviceRoleKey,
    Authorization: `Bearer ${cfg.serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra
  };
}

function authAdminHeaders(extra: HeadersInit = {}) {
  const cfg = config();
  return {
    apikey: cfg.serviceRoleKey,
    Authorization: `Bearer ${cfg.serviceRoleKey}`,
    "Content-Type": "application/json",
    ...extra
  };
}

function pickRandom(items: string[]) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return items[values[0] % items.length];
}

function temporaryPassword() {
  const words = [
    "lake", "mint", "pine", "leaf", "dawn", "dusk", "star", "moon",
    "rain", "snow", "gold", "blue", "lime", "rose", "chef", "fork",
    "pear", "plum", "bean", "bake", "cafe", "sage", "salt", "cake"
  ];
  const symbols = ["!", "#", "$", "%"];
  const first = pickRandom(words);
  const second = pickRandom(words.filter((word) => word !== first));
  const capitalized = first.charAt(0).toUpperCase() + first.slice(1);
  return `${capitalized}${pickRandom(symbols)}${second}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendInviteEmail({
  email,
  displayName,
  role,
  temporaryPassword: password,
  loginUrl,
  isStaff = false
}: {
  email: string;
  displayName: string;
  role: string;
  temporaryPassword: string;
  loginUrl: string;
  isStaff?: boolean;
}) {
  const cfg = config();
  if (!cfg.resendApiKey) {
    return { sent: false, reason: "RESEND_API_KEY is not configured." };
  }

  const safeName = escapeHtml(displayName || email);
  const safeRole = escapeHtml(role);
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(password);
  const safeLoginUrl = escapeHtml(loginUrl);
  const subject = isStaff ? "Your Shift Bay staff login" : "You are invited to Shift Bay";
  const text = [
    `Hello ${displayName || email},`,
    "",
    isStaff ? "You have been invited to view your schedule in Shift Bay." : `You have been invited to Shift Bay as a ${role}.`,
    `Login: ${email}`,
    `Temporary password: ${password}`,
    `Open Shift Bay: ${loginUrl}`,
    "",
    "You will be asked to create a permanent password the first time you sign in."
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1e2a3a;max-width:560px">
      <h1 style="color:#214391">Shift Bay</h1>
      <p>Hello ${safeName},</p>
      <p>${isStaff ? "You have been invited to view your schedule in Shift Bay." : `You have been invited to Shift Bay as a <strong>${safeRole}</strong>.`}</p>
      <p><strong>Login:</strong> ${safeEmail}<br><strong>Temporary password:</strong> ${safePassword}</p>
      <p><a href="${safeLoginUrl}" style="display:inline-block;background:#2864e8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open Shift Bay</a></p>
      <p>You will be asked to create a permanent password the first time you sign in.</p>
    </div>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from: cfg.resendFrom, to: [email], subject, text, html })
    });
    const body = await response.text();
    const parsed = body ? JSON.parse(body) : {};
    if (!response.ok) {
      const message = parsed?.message || parsed?.error || `Resend returned ${response.status}.`;
      return { sent: false, reason: message };
    }
    return { sent: true, id: parsed?.id || "" };
  } catch (error) {
    return { sent: false, reason: String((error as Error)?.message || "Resend could not be reached.") };
  }
}

function dataUpdatedAt(payload: any) {
  const value = payload?.data?.meta?.updatedAt || payload?.state?.meta?.updatedAt || payload?.meta?.updatedAt || payload?.savedAt || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

async function validateSession(request: Request) {
  const cfg = config();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
    const missing = [
      !cfg.supabaseUrl ? "SUPABASE_URL" : "",
      !cfg.serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : ""
    ].filter(Boolean);
    return { ok: false, status: 503, error: `Cloud login is not fully configured. Missing ${missing.join(", ")}.` };
  }
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, error: "No login token was provided." };

  const user = await supabaseJson(`${cfg.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: cfg.anonKey || cfg.serviceRoleKey,
      Authorization: `Bearer ${token}`
    }
  });
  const selectedLocationId = selectedLocationFromRequest(request);
  const membershipQuery = selectedLocationId
    ? `/location_users?location_id=eq.${encodeURIComponent(selectedLocationId)}&user_id=eq.${encodeURIComponent(user.id)}&select=*`
    : `/location_users?user_id=eq.${encodeURIComponent(user.id)}&select=*&order=created_at.asc`;
  const memberships = await supabaseJson(
    membershipQuery,
    { headers: serviceHeaders() }
  );
  const rows = Array.isArray(memberships) ? memberships : [];
  const membership = selectedLocationId
    ? rows[0]
    : (rows.find((row: any) => row.location_id === cfg.locationId) || rows[0] || null);
  if (!membership) return { ok: false, status: 403, error: "This account is not linked to this Shift Bay location." };
  const locationId = membership.location_id || selectedLocationId || cfg.locationId;

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      role: membership.role || "manager",
      passwordChangeRequired: Boolean(membership.password_change_required),
      locationId
    }
  };
}

async function validateAuthUser(request: Request) {
  const cfg = config();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
    const missing = [
      !cfg.supabaseUrl ? "SUPABASE_URL" : "",
      !cfg.serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : ""
    ].filter(Boolean);
    return { ok: false, status: 503, error: `Cloud login is not fully configured. Missing ${missing.join(", ")}.` };
  }
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, error: "No login token was provided." };
  const user = await supabaseJson(`${cfg.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: cfg.anonKey || cfg.serviceRoleKey,
      Authorization: `Bearer ${token}`
    }
  });
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email
    }
  };
}

function selectedLocationFromRequest(request: Request) {
  const url = new URL(request.url);
  return String(request.headers.get("x-shift-bay-location-id") || url.searchParams.get("locationId") || "").trim();
}

async function requireOwner(request: Request) {
  const validated = await validateSession(request);
  if (!validated.ok) return validated;
  if ((validated.user as any).role !== "owner") {
    return { ok: false, status: 403, error: "Only an owner can manage Shift Bay manager access." };
  }
  return validated;
}

async function requireEditor(request: Request) {
  const validated = await validateSession(request);
  if (!validated.ok) return validated;
  const role = String((validated.user as any).role || "").toLowerCase();
  if (!["owner", "manager"].includes(role)) {
    return {
      ok: false,
      status: 403,
      error: "This account has view-only access. You can view and print schedules, but changes will not be saved."
    };
  }
  return validated;
}

async function authAdminJson(path: string, options: RequestInit = {}) {
  const cfg = config();
  const response = await fetch(`${cfg.supabaseUrl}/auth/v1${path}`, {
    ...options,
    headers: {
      ...authAdminHeaders(),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.msg || body?.message || body?.error_description || body?.error || `Supabase Auth request failed with ${response.status}.`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body;
}

async function userEmailById(userId: string) {
  try {
    const user = await authAdminJson(`/admin/users/${encodeURIComponent(userId)}`, { method: "GET" });
    return user?.email || "";
  } catch {
    return "";
  }
}

async function authUserByEmail(email: string) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return null;
  for (let page = 1; page <= 10; page += 1) {
    const result = await authAdminJson(`/admin/users?page=${page}&per_page=100`, { method: "GET" });
    const users = Array.isArray(result?.users) ? result.users : (Array.isArray(result) ? result : []);
    const match = users.find((user: any) => String(user?.email || "").toLowerCase() === target);
    if (match) return match;
    if (users.length < 100) return null;
  }
  return null;
}

async function loadDocumentRow(select = "*", locationId = config().locationId) {
  const cfg = config();
  const rows = await supabaseJson(
    `/scheduler_state_documents?location_id=eq.${encodeURIComponent(locationId)}&document_key=eq.${encodeURIComponent(cfg.documentKey)}&select=${select}`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] : null;
}

function scheduleChangeSummary(previous: JsonRecord = {}, next: JsonRecord = {}) {
  const compare = (key: string) => {
    const before = new Map((Array.isArray(previous[key]) ? previous[key] : []).map((item: any) => [item.id, item]));
    const after = new Map((Array.isArray(next[key]) ? next[key] : []).map((item: any) => [item.id, item]));
    let created = 0;
    let edited = 0;
    let deleted = 0;
    after.forEach((item: any, id: unknown) => {
      if (!before.has(id)) created += 1;
      else if (JSON.stringify(before.get(id)) !== JSON.stringify(item)) edited += 1;
    });
    before.forEach((_item: any, id: unknown) => { if (!after.has(id)) deleted += 1; });
    return { created, edited, deleted };
  };
  const shifts = compare("shifts");
  const openShifts = compare("unassignedShifts");
  const requestOffs = compare("timeOffRequests");
  const employees = compare("employees");
  const templates = compare("templates");
  return {
    shiftsCreated: shifts.created,
    shiftsEdited: shifts.edited,
    shiftsDeleted: shifts.deleted,
    openShiftsCreated: openShifts.created,
    openShiftsEdited: openShifts.edited,
    openShiftsDeleted: openShifts.deleted,
    requestOffsCreated: requestOffs.created,
    requestOffsEdited: requestOffs.edited,
    requestOffsDeleted: requestOffs.deleted,
    employeesChanged: employees.created + employees.edited + employees.deleted,
    templatesChanged: templates.created + templates.edited + templates.deleted
  };
}

function mergeEmployeeProfileState(existingState: JsonRecord = {}, incomingState: JsonRecord = {}, employeeId = "") {
  const incomingEmployees = Array.isArray(incomingState.employees) ? incomingState.employees : [];
  const incomingEmployee = incomingEmployees.find((employee: any) => String(employee?.id || "") === String(employeeId));
  if (!incomingEmployee) return null;
  const existingEmployees = Array.isArray(existingState.employees) ? existingState.employees : [];
  const found = existingEmployees.some((employee: any) => String(employee?.id || "") === String(employeeId));
  return {
    ...existingState,
    employees: found
      ? existingEmployees.map((employee: any) => String(employee?.id || "") === String(employeeId) ? incomingEmployee : employee)
      : [...existingEmployees, incomingEmployee]
  };
}

function mergeSingleEmployeeProfile(existingState: JsonRecord = {}, employee: JsonRecord = {}, employeeId = "") {
  if (!employeeId || String(employee?.id || "") !== String(employeeId)) return null;
  const existingEmployees = Array.isArray(existingState.employees) ? existingState.employees : [];
  const found = existingEmployees.some((item: any) => String(item?.id || "") === String(employeeId));
  return {
    ...existingState,
    employees: found
      ? existingEmployees.map((item: any) => String(item?.id || "") === String(employeeId) ? employee : item)
      : [...existingEmployees, employee]
  };
}

async function logAuditEvent(eventType: string, userId: string, details: JsonRecord = {}, locationId = config().locationId) {
  await supabaseJson("/audit_events", {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify([{
      location_id: locationId,
      user_id: userId,
      event_type: eventType,
      entity_type: "scheduler_state_document",
      details
    }])
  }).catch((error) => {
    console.warn("Audit event was not saved:", error?.message || error);
  });
}

async function handleAuthConfig() {
  const cfg = config();
  return json(200, {
    enabled: Boolean(cfg.supabaseUrl && cfg.anonKey),
    supabaseUrl: cfg.supabaseUrl,
    anonKey: cfg.anonKey,
    defaultLocationId: cfg.locationId,
    missing: [
      !cfg.supabaseUrl ? "SUPABASE_URL" : "",
      !cfg.anonKey ? "SUPABASE_ANON_KEY" : "",
    ].filter(Boolean)
  });
}

async function handleListLocations(request: Request) {
  const validated = await validateSession(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const userId = (validated.user as any).id;
  const memberships = await supabaseJson(
    `/location_users?user_id=eq.${encodeURIComponent(userId)}&select=location_id,role,created_at&order=created_at.asc`,
    { headers: serviceHeaders() }
  );
  const rows = Array.isArray(memberships) ? memberships : [];
  if (!rows.length) return json(200, { ok: true, locations: [] });

  const ids = rows.map((row: any) => row.location_id).filter(Boolean);
  const locations = await supabaseJson(
    `/locations?id=in.(${ids.map((id: string) => encodeURIComponent(id)).join(",")})&select=id,name,timezone`,
    { headers: serviceHeaders() }
  );
  const locationMap = new Map((Array.isArray(locations) ? locations : []).map((location: any) => [location.id, location]));
  return json(200, {
    ok: true,
    selectedLocationId: (validated.user as any).locationId,
    locations: rows.map((row: any) => {
      const location = (locationMap.get(row.location_id) || {}) as any;
      return {
        id: row.location_id,
        name: location.name || "Shift Bay Location",
        timezone: location.timezone || "America/Chicago",
        role: row.role || "manager",
        createdAt: row.created_at
      };
    })
  });
}

function isMissingStaffSchema(error: any) {
  const message = String(error?.message || error || "").toLowerCase();
  return error?.status === 404
    || message.includes("staff_accounts")
    || message.includes("could not find the table")
    || message.includes("schema cache")
    || message.includes("does not exist");
}

async function handleStaffMe(request: Request) {
  const validated = await validateAuthUser(request);
  if (!validated.ok) return json(validated.status || 401, validated);

  const locationId = selectedLocationFromRequest(request) || config().locationId;
  try {
    let rows: any[];
    try {
      rows = await supabaseJson(
        `/staff_accounts?location_id=eq.${encodeURIComponent(locationId)}&user_id=eq.${encodeURIComponent((validated.user as any).id)}&select=id,location_id,user_id,employee_id,legacy_employee_id,display_name,preferred_name,phone,contact_preference,status,password_change_required,phone_visibility,created_at,updated_at`,
        { headers: serviceHeaders() }
      );
    } catch (error) {
      if (!String((error as Error)?.message || "").toLowerCase().includes("phone_visibility")) throw error;
      rows = await supabaseJson(
        `/staff_accounts?location_id=eq.${encodeURIComponent(locationId)}&user_id=eq.${encodeURIComponent((validated.user as any).id)}&select=id,location_id,user_id,employee_id,legacy_employee_id,display_name,preferred_name,phone,contact_preference,status,password_change_required,created_at,updated_at`,
        { headers: serviceHeaders() }
      );
      rows = (Array.isArray(rows) ? rows : []).map((row: any) => ({ ...row, phone_visibility: "managers_only" }));
    }
    const account = Array.isArray(rows) ? rows[0] : null;
    let employee: any = null;
    if (account) {
      const row = await loadDocumentRow("*", locationId);
      const state = (row?.state || {}) as any;
      const employeeId = String(account.legacy_employee_id || account.employee_id || "");
      const employeeRow = (Array.isArray(state.employees) ? state.employees : []).find((item: any) => String(item.id || "") === employeeId);
      if (employeeRow) {
        employee = {
          id: employeeRow.id,
          displayName: [employeeRow.nickname || employeeRow.firstName, employeeRow.lastName].filter(Boolean).join(" ").trim() || account.display_name || "Employee",
          availability: employeeRow.availability || {},
          availabilityEffectiveDate: employeeRow.availabilityEffectiveDate || "",
          availabilityPatterns: Array.isArray(employeeRow.availabilityPatterns) ? employeeRow.availabilityPatterns : [],
          availabilitySchedule: Array.isArray(employeeRow.availabilitySchedule) ? employeeRow.availabilitySchedule : []
        };
      }
    }
    return json(200, {
      ok: true,
      schemaReady: true,
      linked: Boolean(account),
      user: { ...(validated.user as any), passwordChangeRequired: Boolean(account?.password_change_required) },
      locationId,
      account: account || null,
      employee,
      message: account ? "" : "No staff employee profile is linked to this login yet."
    });
  } catch (error) {
    if (isMissingStaffSchema(error)) {
      return json(200, {
        ok: true,
        schemaReady: false,
        linked: false,
        user: validated.user,
        locationId,
        account: null,
        message: "Staff portal tables have not been created yet."
      });
    }
    throw error;
  }
}

function dateKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateFromKey(value: string) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDaysToKey(value: string, days: number) {
  const date = dateFromKey(value);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyFromDate(date);
}

function staffWeekStart(value: string, weekStart: number) {
  const requested = dateFromKey(value);
  const date = requested || new Date();
  const day = date.getUTCDay();
  const offset = (day - Number(weekStart || 0) + 7) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return dateKeyFromDate(date);
}

async function handleStaffSchedule(request: Request) {
  const profileResponse = await handleStaffMe(request);
  const profile = await profileResponse.json();
  if (!profile.ok) return json(profile.status || 401, profile);
  if (!profile.linked || !profile.account) {
    return json(403, { ok: false, error: "This login is not linked to a staff profile yet." });
  }

  const row = await loadDocumentRow("*", profile.locationId);
  if (!row) return json(404, { ok: false, error: "No scheduler data has been created for this location yet." });

  const state = (row.state || {}) as any;
  const weekStart = staffWeekStart(new URL(request.url).searchParams.get("weekStart") || "", Number(state.settings?.weekStart || 0));
  const weekEnd = addDaysToKey(weekStart, 6);
  const employeeId = String(profile.account.legacy_employee_id || profile.account.employee_id || "");
  const roles = new Map((Array.isArray(state.roles) ? state.roles : []).map((role: any) => [String(role.id), role]));
  const shifts = (Array.isArray(state.shifts) ? state.shifts : [])
    .filter((shift: any) => String(shift.employeeId || "") === employeeId && String(shift.date || "") >= weekStart && String(shift.date || "") <= weekEnd)
    .sort((a: any, b: any) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.start || "").localeCompare(String(b.start || "")))
    .map((shift: any) => {
      const role = roles.get(String(shift.roleId)) || {};
      return {
        id: shift.id || "",
        date: shift.date || "",
        start: shift.start || "",
        end: shift.end || "",
        role: role.name || shift.role || "Shift",
        department: shift.department || role.department || "",
        isCloser: Boolean(shift.isCloser),
        isFlexDouble: Boolean(shift.isFlexDouble),
        isLunchCloser: Boolean(shift.isLunchCloser)
      };
    });

  return json(200, {
    ok: true,
    locationId: profile.locationId,
    employee: { id: employeeId, displayName: profile.account.display_name || profile.user.email || "Staff" },
    weekStart,
    weekEnd,
    shifts
  });
}

function validDateKey(value: string) {
  return Boolean(dateFromKey(String(value || "").trim()));
}

async function handleStaffRequestOffs(request: Request) {
  const profileResponse = await handleStaffMe(request);
  const profile = await profileResponse.json();
  if (!profile.ok) return json(profile.status || 401, profile);
  if (!profile.linked || !profile.account?.id) return json(403, { ok: false, error: "This login is not linked to a staff profile yet." });
  const accountId = encodeURIComponent(profile.account.id);
  if (request.method === "GET") {
    const rows = await supabaseJson(`/staff_request_offs?location_id=eq.${encodeURIComponent(profile.locationId)}&staff_account_id=eq.${accountId}&select=id,start_date,end_date,start_time,end_time,note,status,created_at&order=start_date.asc,created_at.desc`, { headers: serviceHeaders() });
    return json(200, { ok: true, requests: (Array.isArray(rows) ? rows : []).map((row: any) => ({ id: row.id, startDate: row.start_date, endDate: row.end_date, startTime: row.start_time || "", endTime: row.end_time || "", note: row.note || "", status: row.status, createdAt: row.created_at })) });
  }
  if (request.method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const requestId = String(body.requestId || "").trim();
    if (!requestId || String(body.status || "") !== "cancelled") return json(400, { ok: false, error: "Only a pending request can be cancelled from the staff portal." });
    const rows = await supabaseJson(`/staff_request_offs?id=eq.${encodeURIComponent(requestId)}&location_id=eq.${encodeURIComponent(profile.locationId)}&staff_account_id=eq.${accountId}&select=id,status`, { headers: serviceHeaders() });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return json(404, { ok: false, error: "Request-off not found." });
    if (String(row.status || "").toLowerCase() !== "pending") return json(409, { ok: false, error: "Only a pending request can be cancelled." });
    const updatedAt = new Date().toISOString();
    await supabaseJson(`/staff_request_offs?id=eq.${encodeURIComponent(requestId)}&location_id=eq.${encodeURIComponent(profile.locationId)}&staff_account_id=eq.${accountId}`, { method: "PATCH", headers: serviceHeaders({ Prefer: "return=minimal" }), body: JSON.stringify({ status: "cancelled", updated_at: updatedAt }) });
    await logAuditEvent("staff_request_off_cancelled", profile.user.id, { requestId }, profile.locationId);
    return json(200, { ok: true, requestId, status: "cancelled" });
  }
  const body = await request.json().catch(() => ({}));
  const startDate = String(body.startDate || "").trim();
  const endDate = String(body.endDate || startDate).trim();
  const startTime = String(body.startTime || "").trim();
  const endTime = String(body.endTime || "").trim();
  const note = String(body.note || "").trim().slice(0, 240);
  if (!validDateKey(startDate) || !validDateKey(endDate)) return json(400, { ok: false, error: "Choose a valid start and end date." });
  if (endDate < startDate) return json(400, { ok: false, error: "The end date cannot be before the start date." });
  if ((startTime && !endTime) || (!startTime && endTime)) return json(400, { ok: false, error: "Enter both times or leave both blank for a full-day request." });
  const rows = await supabaseJson("/staff_request_offs", { method: "POST", headers: serviceHeaders({ Prefer: "return=representation" }), body: JSON.stringify([{ location_id: profile.locationId, staff_account_id: profile.account.id, legacy_employee_id: profile.account.legacy_employee_id || profile.account.employee_id || "", start_date: startDate, end_date: endDate, start_time: startTime, end_time: endTime, note, status: "pending" }]) });
  await logAuditEvent("staff_request_off_submitted", profile.user.id, { startDate, endDate, startTime, endTime }, profile.locationId);
  const row = Array.isArray(rows) ? rows[0] : null;
  return json(201, { ok: true, request: { id: row?.id || "", startDate, endDate, startTime, endTime, note, status: "pending" } });
}

async function handleStaffAvailability(request: Request) {
  const profileResponse = await handleStaffMe(request);
  const profile = await profileResponse.json();
  if (!profile.ok) return json(profile.status || 401, profile);
  if (!profile.linked || !profile.account?.id) return json(403, { ok: false, error: "This login is not linked to a staff profile yet." });
  const queryWeek = new URL(request.url).searchParams.get("weekStart") || "";
  const accountId = encodeURIComponent(profile.account.id);
  if (request.method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const requestId = String(body.requestId || "").trim();
    if (!requestId || body.status !== "cancelled") return json(400, { ok: false, error: "A submission and cancelled status are required." });
    const rows = await supabaseJson("/staff_availability_submissions?id=eq." + encodeURIComponent(requestId) + "&location_id=eq." + encodeURIComponent(profile.locationId) + "&staff_account_id=eq." + accountId + "&select=id,status", { headers: serviceHeaders() });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return json(404, { ok: false, error: "Availability submission not found." });
    if (!["submitted", "pending"].includes(String(row.status || "").toLowerCase())) return json(409, { ok: false, error: "Only a pending submission can be withdrawn." });
    const updatedAt = new Date().toISOString();
    await supabaseJson("/staff_availability_submissions?id=eq." + encodeURIComponent(requestId) + "&location_id=eq." + encodeURIComponent(profile.locationId), { method: "PATCH", headers: serviceHeaders({ Prefer: "return=minimal" }), body: JSON.stringify({ status: "cancelled", updated_at: updatedAt }) });
    await logAuditEvent("staff_availability_submission_withdrawn", profile.user.id, { requestId }, profile.locationId);
    return json(200, { ok: true, requestId, status: "cancelled" });
  }
  const weekStart = String((request.method === "PUT" ? (await request.clone().json().catch(() => ({}))).weekStart : queryWeek) || (request.method === "GET" ? staffWeekStart("", 0) : "")).trim();
  if (!validDateKey(weekStart)) return json(400, { ok: false, error: "Choose a valid week start date." });
  if (request.method === "GET") {
    const rows = await supabaseJson(`/staff_availability_submissions?location_id=eq.${encodeURIComponent(profile.locationId)}&staff_account_id=eq.${accountId}&week_start=eq.${encodeURIComponent(weekStart)}&select=id,week_start,availability,note,status,updated_at`, { headers: serviceHeaders() });
    const row = Array.isArray(rows) ? rows[0] : null;
    return json(200, { ok: true, requestId: row?.id || "", weekStart, availability: row?.availability || {}, note: row?.note || "", status: row?.status || "" });
  }
  const body = await request.json().catch(() => ({}));
  const availability = body.availability && typeof body.availability === "object" ? body.availability : {};
  const note = String(body.note || "").trim().slice(0, 240);
  const rows = await supabaseJson("/staff_availability_submissions?on_conflict=location_id,staff_account_id,week_start", { method: "POST", headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }), body: JSON.stringify([{ location_id: profile.locationId, staff_account_id: profile.account.id, legacy_employee_id: profile.account.legacy_employee_id || profile.account.employee_id || "", week_start: weekStart, availability, note, status: "submitted", updated_at: new Date().toISOString() }]) });
  await logAuditEvent("staff_availability_submitted", profile.user.id, { weekStart }, profile.locationId);
  const row = Array.isArray(rows) ? rows[0] : null;
  return json(200, { ok: true, requestId: row?.id || "", weekStart, availability: row?.availability || availability, note: row?.note || note, status: "submitted" });
}

async function handleManagerStaffRequests(request: Request) {
  const validated = await requireEditor(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });
  const locationId = (validated.user as any).locationId;
  const rows = await supabaseJson(`/staff_request_offs?location_id=eq.${encodeURIComponent(locationId)}&select=id,staff_account_id,legacy_employee_id,start_date,end_date,start_time,end_time,note,status,created_at,reviewed_at&order=status.asc,start_date.asc`, { headers: serviceHeaders() });
  return json(200, { ok: true, requests: (Array.isArray(rows) ? rows : []).map((row: any) => ({ id: row.id, staffAccountId: row.staff_account_id, legacyEmployeeId: row.legacy_employee_id, startDate: row.start_date, endDate: row.end_date, startTime: row.start_time || "", endTime: row.end_time || "", note: row.note || "", status: row.status, createdAt: row.created_at, reviewedAt: row.reviewed_at })) });
}

async function handleManagerStaffAvailability(request: Request) {
  const validated = await requireEditor(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });
  const locationId = (validated.user as any).locationId;
  const rows = await supabaseJson(`/staff_availability_submissions?location_id=eq.${encodeURIComponent(locationId)}&select=id,staff_account_id,legacy_employee_id,week_start,availability,note,status,created_at,updated_at&order=week_start.asc,updated_at.desc`, { headers: serviceHeaders() });
  return json(200, { ok: true, submissions: (Array.isArray(rows) ? rows : []).map((row: any) => ({ id: row.id, staffAccountId: row.staff_account_id, legacyEmployeeId: row.legacy_employee_id, weekStart: row.week_start, availability: row.availability || {}, note: row.note || "", status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })) });
}

async function handleReviewStaffRequest(request: Request) {
  const validated = await requireEditor(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });
  const body = await request.json().catch(() => ({}));
  const requestId = String(body.requestId || "").trim();
  const status = String(body.status || "").trim();
  if (!requestId || !["approved", "denied", "cancelled"].includes(status)) return json(400, { ok: false, error: "A request and valid review status are required." });
  const locationId = (validated.user as any).locationId;
  const rows = await supabaseJson(`/staff_request_offs?id=eq.${encodeURIComponent(requestId)}&location_id=eq.${encodeURIComponent(locationId)}&select=*`, { headers: serviceHeaders() });
  const requestRow = Array.isArray(rows) ? rows[0] : null;
  if (!requestRow) return json(404, { ok: false, error: "Request-off not found." });
  const reviewedAt = new Date().toISOString();
  await supabaseJson(`/staff_request_offs?id=eq.${encodeURIComponent(requestId)}`, { method: "PATCH", headers: serviceHeaders({ Prefer: "return=minimal" }), body: JSON.stringify({ status, reviewed_by: (validated.user as any).id, reviewed_at: reviewedAt, updated_at: reviewedAt }) });
  if (status === "approved") await applyApprovedStaffRequest(locationId, requestRow);
  await logAuditEvent("staff_request_off_reviewed", (validated.user as any).id, { requestId, status }, locationId);
  return json(200, { ok: true, requestId, status });
}

async function applyApprovedStaffRequest(locationId: string, requestRow: any) {
  const document = await loadDocumentRow("*", locationId);
  if (!document?.state) return;
  const state = { ...(document.state as any) };
  const requests = Array.isArray(state.timeOffRequests) ? [...state.timeOffRequests] : [];
  let date = String(requestRow.start_date || "");
  const endDate = String(requestRow.end_date || date);
  while (date && date <= endDate) {
    const duplicate = requests.some((item: any) => String(item.employeeId || "") === String(requestRow.legacy_employee_id || "") && String(item.date || "") === date && String(item.source || "").toLowerCase() === "staff portal");
    if (!duplicate) requests.push({ id: `staff-${requestRow.id}-${date}`, employeeId: requestRow.legacy_employee_id || "", date, start: requestRow.start_time || "", end: requestRow.end_time || "", daypart: requestRow.start_time ? "" : "All day", note: requestRow.note || "", source: "Staff portal" });
    date = addDaysToKey(date, 1);
  }
  state.timeOffRequests = requests;
  const savedAt = new Date().toISOString();
  await supabaseJson("/scheduler_state_documents?on_conflict=location_id,document_key", { method: "POST", headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify([{ location_id: locationId, document_key: config().documentKey, schema_version: Number(document.schema_version || 1), state, saved_at: savedAt, updated_at: savedAt }]) });
}

async function handleLogin(request: Request) {
  const cfg = config();
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (!email || !password) return json(400, { ok: false, error: "Email and password are required." });

  const session = await supabaseJson(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: cfg.anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  const headers = new Headers({ Authorization: `Bearer ${session.access_token}` });
  const requestedLocationId = selectedLocationFromRequest(request);
  if (requestedLocationId) headers.set("x-shift-bay-location-id", requestedLocationId);
  const validated = await validateSession(new Request(request.url, {
    headers
  }));
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });
  return json(200, { ok: true, session, user: validated.user });
}

async function handleStaffLogin(request: Request) {
  const cfg = config();
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (!email || !password) return json(400, { ok: false, error: "Email and password are required." });

  const session = await supabaseJson(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: cfg.anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  const headers = new Headers({ Authorization: `Bearer ${session.access_token}` });
  const requestedLocationId = selectedLocationFromRequest(request);
  if (requestedLocationId) headers.set("x-shift-bay-location-id", requestedLocationId);
  const profileResponse = await handleStaffMe(new Request(request.url, { headers }));
  const profile = await profileResponse.json();
  if (!profile.ok) return json(profile.status || 401, { ok: false, error: profile.error || "Could not load staff profile." });
  return json(200, { ok: true, session, profile });
}

async function handleStaffChangePassword(request: Request) {
  const profileResponse = await handleStaffMe(request);
  const profile = await profileResponse.json();
  if (!profile.ok) return json(profile.status || 401, { ok: false, error: profile.error || "Could not load staff profile." });
  if (!profile.linked || !profile.account?.id) return json(403, { ok: false, error: "This login is not linked to a staff profile yet." });

  const body = await request.json().catch(() => ({}));
  const password = String(body.password || "");
  if (password.length < 8) return json(400, { ok: false, error: "Use a password with at least 8 characters." });

  await authAdminJson(`/admin/users/${encodeURIComponent(profile.user.id)}`, {
    method: "PUT",
    body: JSON.stringify({ password })
  });
  await supabaseJson(
    `/staff_accounts?id=eq.${encodeURIComponent(profile.account.id)}`,
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        password_change_required: false,
        status: "active",
        activated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    }
  );
  return json(200, { ok: true, user: { ...(profile.user || {}), passwordChangeRequired: false } });
}

async function handleStaffPrivacy(request: Request) {
  const profileResponse = await handleStaffMe(request);
  const profile = await profileResponse.json();
  if (!profile.ok) return json(profile.status || 401, profile);
  if (!profile.linked || !profile.account?.id) return json(403, { ok: false, error: "This login is not linked to a staff profile yet." });
  const body = await request.json().catch(() => ({}));
  const phoneVisibility = String(body.phoneVisibility || "").trim();
  if (!["managers_only", "all_staff"].includes(phoneVisibility)) {
    return json(400, { ok: false, error: "Choose whether your phone number is visible to managers only or all staff." });
  }
  const rows = await supabaseJson(`/staff_accounts?id=eq.${encodeURIComponent(profile.account.id)}`, {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ phone_visibility: phoneVisibility, updated_at: new Date().toISOString() })
  });
  const account = Array.isArray(rows) ? rows[0] : null;
  return json(200, { ok: true, phoneVisibility: account?.phone_visibility || phoneVisibility });
}

async function handleChangePassword(request: Request) {
  const validated = await validateSession(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || "");
  if (password.length < 8) return json(400, { ok: false, error: "Use a password with at least 8 characters." });

  await authAdminJson(`/admin/users/${encodeURIComponent((validated.user as any).id)}`, {
    method: "PUT",
    body: JSON.stringify({ password })
  });
  await supabaseJson(
    `/location_users?location_id=eq.${encodeURIComponent((validated.user as any).locationId)}&user_id=eq.${encodeURIComponent((validated.user as any).id)}`,
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({ password_change_required: false })
    }
  );
  await logAuditEvent("manager_password_changed", (validated.user as any).id, { requiredChange: Boolean((validated.user as any).passwordChangeRequired) }, (validated.user as any).locationId);
  return json(200, { ok: true, user: { ...(validated.user as any), passwordChangeRequired: false } });
}

async function handleRefresh(request: Request) {
  const cfg = config();
  const body = await request.json().catch(() => ({}));
  const refreshToken = String(body.refresh_token || "");
  if (!refreshToken) return json(400, { ok: false, error: "Refresh token is required." });

  const session = await supabaseJson(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: cfg.anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const headers = new Headers({ Authorization: `Bearer ${session.access_token}` });
  const requestedLocationId = selectedLocationFromRequest(request);
  if (requestedLocationId) headers.set("x-shift-bay-location-id", requestedLocationId);
  const validated = await validateSession(new Request(request.url, {
    headers
  }));
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });
  return json(200, { ok: true, session, user: validated.user });
}

async function handleStatus(request: Request) {
  const cfg = config();
  const validated = bearerToken(request) ? await validateSession(request) : null;
  const locationId = validated?.ok ? (validated.user as any).locationId : cfg.locationId;
  const row = await loadDocumentRow("saved_at,updated_at", locationId);
  return json(200, {
    ok: true,
    mode: "supabase",
    locationId,
    documentKey: cfg.documentKey,
    updatedAt: row?.updated_at || row?.saved_at || null
  });
}

async function handleLoadState(request: Request) {
  const validated = await validateSession(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const locationId = (validated.user as any).locationId;
  const row = await loadDocumentRow("*", locationId);
  if (!row) return json(404, { error: "No scheduler data file has been created yet." });
  return json(200, {
    app: "restaurant-scheduler",
    schemaVersion: row.schema_version,
    savedAt: row.saved_at,
    savedBy: row.saved_by || null,
    savedByDeviceId: row.saved_by_device_id,
    data: row.state
  });
}

async function handleSaveState(request: Request) {
  const validated = await requireEditor(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const cfg = config();
  const locationId = (validated.user as any).locationId;
  const payload = await request.json();
  let state = (payload?.data || payload?.state || payload) as JsonRecord;
  const saveScope = String(payload?.saveScope || "schedule");
  const employeeId = String(payload?.employeeId || "");
  const employeeProfile = payload?.employeeProfile as JsonRecord | null;
  const baseServerSavedAt = payload?.baseServerSavedAt || (state.meta as any)?.serverSavedAt || "";
  const incomingTime = dataUpdatedAt(payload);
  const existingRow = await loadDocumentRow("state,saved_at,updated_at", locationId);
  const existingSavedAt = existingRow?.saved_at || existingRow?.updated_at || "";
  const profileRequested = saveScope === "employee-profile" && Boolean(employeeId);
  const profileMerge = profileRequested
    ? mergeSingleEmployeeProfile(existingRow?.state as JsonRecord || {}, employeeProfile || {}, employeeId)
    : null;
  if (profileRequested && !profileMerge) {
    return json(400, { ok: false, error: "Employee profile save did not include a valid employee record." });
  }
  if (profileMerge) state = profileMerge;
  const profileOnlySave = Boolean(profileMerge);
  if (!profileOnlySave && baseServerSavedAt && existingSavedAt && Date.parse(existingSavedAt) > Date.parse(baseServerSavedAt) + 1000) {
    return json(409, {
      error: "Rejected stale scheduler data. Refresh the app to load the latest shared file.",
      incomingUpdatedAt: baseServerSavedAt,
      existingUpdatedAt: existingSavedAt
    });
  }
  const existingTime = dataUpdatedAt(existingRow?.state || { savedAt: existingRow?.saved_at || existingRow?.updated_at });
  if (!profileOnlySave && incomingTime && existingTime && incomingTime < existingTime - 1000) {
    return json(409, {
      error: "Rejected stale scheduler data. Refresh the app to load the latest shared file.",
      incomingUpdatedAt: new Date(incomingTime).toISOString(),
      existingUpdatedAt: new Date(existingTime).toISOString()
    });
  }

  const savedAt = new Date().toISOString();
  const body = [{
    location_id: locationId,
    document_key: cfg.documentKey,
    schema_version: Number(payload?.schemaVersion || (state.meta as any)?.schemaVersion || 1),
    state,
    saved_by: (validated.user as any).id,
    saved_by_device_id: payload?.savedByDeviceId || (state.meta as any)?.deviceId || null,
    saved_at: savedAt,
    updated_at: savedAt
  }];
  const changeSummary = scheduleChangeSummary((existingRow?.state || {}) as JsonRecord, state);
  await supabaseJson("/scheduler_state_documents?on_conflict=location_id,document_key", {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(body)
  });
  await logAuditEvent("scheduler_state_saved", (validated.user as any).id, {
    documentKey: cfg.documentKey,
    savedAt,
    savedByEmail: (validated.user as any).email || "",
    savedByRole: (validated.user as any).role || "",
    savedByDeviceId: payload?.savedByDeviceId || (state.meta as any)?.deviceId || null,
    saveScope,
    employeeId: profileOnlySave ? employeeId : null,
    schemaVersion: body[0].schema_version,
    changeSummary
  }, locationId);
  return json(200, { ok: true, savedAt });
}

async function handleRecentAudit(request: Request) {
  const validated = await validateSession(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const locationId = (validated.user as any).locationId;
  const url = `/audit_events?location_id=eq.${encodeURIComponent(locationId)}&select=id,event_type,entity_type,details,created_at,user_id&order=created_at.desc&limit=50`;
  const rows = await supabaseJson(url, { headers: serviceHeaders() });
  const emailCache = new Map<string, string>();
  const events = await Promise.all((Array.isArray(rows) ? rows : []).map(async (row: any) => {
    const details = row.details || {};
    let email = details.savedByEmail || "";
    if (!email && row.user_id) {
      if (!emailCache.has(row.user_id)) emailCache.set(row.user_id, await userEmailById(row.user_id));
      email = emailCache.get(row.user_id) || "";
    }
    return { ...row, user_email: email };
  }));
  return json(200, { ok: true, events });
}

async function handleListManagers(request: Request) {
  const validated = await requireOwner(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const locationId = (validated.user as any).locationId;
  const rows = await supabaseJson(
    `/location_users?location_id=eq.${encodeURIComponent(locationId)}&select=user_id,role,created_at&order=created_at.asc`,
    { headers: serviceHeaders() }
  );
  const managers = await Promise.all((Array.isArray(rows) ? rows : []).map(async (row: any) => ({
    userId: row.user_id,
    email: await userEmailById(row.user_id),
    role: row.role,
    createdAt: row.created_at
  })));
  return json(200, { ok: true, managers });
}

async function handleInviteManager(request: Request) {
  const validated = await requireOwner(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const cfg = config();
  const locationId = (validated.user as any).locationId;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "manager").trim().toLowerCase();
  if (!email || !email.includes("@")) return json(400, { ok: false, error: "Enter a valid email address." });
  if (!["owner", "manager", "viewer"].includes(role)) return json(400, { ok: false, error: "Choose owner, manager, or viewer." });

  const password = temporaryPassword();
  let reusedExistingLogin = false;
  let createdUser: any = null;
  try {
    createdUser = await authAdminJson("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          shift_bay_location_id: locationId,
          shift_bay_role: role
        }
      })
    });
  } catch (error) {
    const message = String((error as Error)?.message || "").toLowerCase();
    if (!message.includes("already") && !message.includes("registered") && !message.includes("exists")) throw error;
    createdUser = await authUserByEmail(email);
    reusedExistingLogin = true;
    if (!createdUser) return json(409, { ok: false, error: "That email already has a Supabase login, but Shift Bay could not find it to relink." });
    await authAdminJson(`/admin/users/${encodeURIComponent(createdUser.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        password,
        email_confirm: true,
        user_metadata: {
          ...(createdUser.user_metadata || {}),
          shift_bay_location_id: locationId,
          shift_bay_role: role
        }
      })
    });
  }
  const userId = createdUser?.id || createdUser?.user?.id;
  if (!userId) return json(502, { ok: false, error: "Supabase created or found the login but did not return a user ID to link." });

  await supabaseJson("/location_users?on_conflict=location_id,user_id", {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify([{
      location_id: locationId,
      user_id: userId,
      role,
      password_change_required: true
    }])
  });
  const emailResult = await sendInviteEmail({
    email,
    displayName: email,
    role,
    temporaryPassword: password,
    loginUrl: cfg.siteUrl
  });
  await logAuditEvent(reusedExistingLogin ? "manager_login_relinked" : "manager_login_created", (validated.user as any).id, { email, role, userId }, locationId);
  return json(200, {
    ok: true,
    manager: { userId, email, role },
    temporaryPassword: password,
    loginUrl: cfg.siteUrl,
    reusedExistingLogin,
    inviteEmailSent: emailResult.sent,
    inviteEmailId: emailResult.id || "",
    inviteEmailError: emailResult.sent ? "" : emailResult.reason || ""
  });
}

async function handleUpdateManager(request: Request) {
  const validated = await requireOwner(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const locationId = (validated.user as any).locationId;
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  const role = String(body.role || "").trim().toLowerCase();
  if (!userId) return json(400, { ok: false, error: "Manager user ID is required." });
  if (!["owner", "manager", "viewer"].includes(role)) return json(400, { ok: false, error: "Choose owner, manager, or viewer." });

  await supabaseJson(
    `/location_users?location_id=eq.${encodeURIComponent(locationId)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({ role })
    }
  );
  await logAuditEvent("manager_role_updated", (validated.user as any).id, { userId, role }, locationId);
  return json(200, { ok: true });
}

async function handleRemoveManager(request: Request) {
  const validated = await requireOwner(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const locationId = (validated.user as any).locationId;
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  if (!userId) return json(400, { ok: false, error: "Manager user ID is required." });
  if (userId === (validated.user as any).id) return json(400, { ok: false, error: "You cannot remove your own owner access here." });

  await supabaseJson(
    `/location_users?location_id=eq.${encodeURIComponent(locationId)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: serviceHeaders({ Prefer: "return=minimal" })
    }
  );
  await logAuditEvent("manager_access_removed", (validated.user as any).id, { userId }, locationId);
  return json(200, { ok: true });
}

async function handleListStaffAccounts(request: Request) {
  const validated = await requireEditor(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const locationId = (validated.user as any).locationId;
  try {
    const rows = await supabaseJson(
      `/staff_accounts?location_id=eq.${encodeURIComponent(locationId)}&select=id,user_id,legacy_employee_id,display_name,status,phone_visibility,password_change_required,invited_at,activated_at,created_at,updated_at&order=display_name.asc`,
      { headers: serviceHeaders() }
    );
    const staff = await Promise.all((Array.isArray(rows) ? rows : []).map(async (row: any) => ({
      id: row.id,
      userId: row.user_id,
      email: await userEmailById(row.user_id),
      legacyEmployeeId: row.legacy_employee_id,
      displayName: row.display_name,
      status: row.status,
      phoneVisibility: row.phone_visibility || "managers_only",
      passwordChangeRequired: Boolean(row.password_change_required),
      invitedAt: row.invited_at,
      activatedAt: row.activated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })));
    return json(200, { ok: true, staff });
  } catch (error) {
    if (isMissingStaffSchema(error)) return json(200, { ok: true, schemaReady: false, staff: [] });
    throw error;
  }
}

async function handleStaffProfileUpdate(request: Request) { const profileResponse = await handleStaffMe(request); const profile = await profileResponse.json(); if (!profile.ok) return json(profile.status || 401, profile); if (!profile.linked || !profile.account || !profile.account.id) return json(403, { ok: false, error: "This login is not linked to a staff profile yet." }); const body = await request.json().catch(() => ({})); const preferredName = String(body.preferredName || "").trim().slice(0, 80); const phone = String(body.phone || "").trim().slice(0, 40); const contactPreference = String(body.contactPreference || "in_app").trim(); if (!["sms", "email", "in_app"].includes(contactPreference)) return json(400, { ok: false, error: "Choose a valid contact preference." }); const rows = await supabaseJson("/staff_accounts?id=eq." + encodeURIComponent(profile.account.id), { method: "PATCH", headers: serviceHeaders({ Prefer: "return=representation" }), body: JSON.stringify({ preferred_name: preferredName, phone, contact_preference: contactPreference, updated_at: new Date().toISOString() }) }); const account = Array.isArray(rows) ? rows[0] : null; await logAuditEvent("staff_profile_updated", profile.user.id, { contactPreference }, profile.locationId); return json(200, { ok: true, profile: { preferredName: account && account.preferred_name || preferredName, phone: account && account.phone || phone, contactPreference: account && account.contact_preference || contactPreference } }); }

async function handleStaffDirectory(request: Request) {
  const profileResponse = await handleStaffMe(request);
  const profile = await profileResponse.json();
  if (!profile.ok) return json(profile.status || 401, profile);
  if (!profile.linked || !profile.account) return json(403, { ok: false, error: "This login is not linked to a staff profile yet." });

  const row = await loadDocumentRow("*", profile.locationId);
  const state = (row?.state || {}) as any;
  const employees = Array.isArray(state.employees) ? state.employees : [];
  const accountRows = await supabaseJson(
    "/staff_accounts?location_id=eq." + encodeURIComponent(profile.locationId) + "&select=legacy_employee_id,phone,phone_visibility,status,display_name",
    { headers: serviceHeaders() }
  );
  const accounts = new Map((Array.isArray(accountRows) ? accountRows : []).map((account: any) => [String(account.legacy_employee_id || ""), account]));
  const currentEmployeeId = String(profile.account.legacy_employee_id || profile.account.employee_id || "");
  const entries = employees
    .filter((employee: any) => employee.active !== false && !employee.archived)
    .map((employee: any) => {
      const id = String(employee.id || "");
      const account = accounts.get(id) || {};
      const phoneVisible = id === currentEmployeeId || account.phone_visibility === "all_staff";
      return {
        displayName: [employee.nickname || employee.firstName, employee.lastName].filter(Boolean).join(" ").trim() || account.display_name || "Employee",
        phone: phoneVisible ? String(account.phone || employee.phone || "") : "",
        phoneVisible
      };
    })
    .sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));
  return json(200, { ok: true, entries });
}

async function handleRemoveStaffAccount(request: Request) {
  const validated = await requireEditor(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const locationId = (validated.user as any).locationId;
  const body = await request.json().catch(() => ({}));
  const accountId = String(body.accountId || "").trim();
  const userId = String(body.userId || "").trim();
  if (!accountId || !userId) return json(400, { ok: false, error: "Staff account details are required." });

  const rows = await supabaseJson(
    "/staff_accounts?id=eq." + encodeURIComponent(accountId) +
      "&location_id=eq." + encodeURIComponent(locationId) +
      "&select=id,user_id,legacy_employee_id,display_name",
    { headers: serviceHeaders() }
  );
  const account = Array.isArray(rows) ? rows[0] : null;
  if (!account) return json(404, { ok: false, error: "That staff login is no longer linked to this location." });
  if (String(account.user_id || "") !== userId) return json(400, { ok: false, error: "The staff login details did not match." });

  const otherLinks = await supabaseJson("/staff_accounts?user_id=eq." + encodeURIComponent(userId) + "&select=id,location_id", { headers: serviceHeaders() });
  const userDeleted = !Array.isArray(otherLinks) || otherLinks.length <= 1;
  if (userDeleted) {
    await authAdminJson("/admin/users/" + encodeURIComponent(userId), { method: "DELETE" });
  }
  await supabaseJson(
    "/staff_accounts?id=eq." + encodeURIComponent(accountId) +
      "&location_id=eq." + encodeURIComponent(locationId),
    { method: "DELETE", headers: serviceHeaders({ Prefer: "return=minimal" }) }
  ).catch(() => null);
  await logAuditEvent("staff_login_removed", (validated.user as any).id, {
    userId,
    legacyEmployeeId: account.legacy_employee_id || "",
    displayName: account.display_name || ""
  }, locationId);
  return json(200, { ok: true, userDeleted });
}

async function handleInviteStaff(request: Request) {
  const validated = await requireEditor(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const cfg = config();
  const locationId = (validated.user as any).locationId;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const legacyEmployeeId = String(body.legacyEmployeeId || "").trim();
  const displayName = String(body.displayName || "").trim();
  if (!email || !email.includes("@")) return json(400, { ok: false, error: "Enter a valid staff email address." });
  if (!legacyEmployeeId) return json(400, { ok: false, error: "Choose an employee to link." });
  if (!displayName) return json(400, { ok: false, error: "Employee display name is required." });

  const password = temporaryPassword();
  let reusedExistingLogin = false;
  let createdUser: any = null;
  try {
    createdUser = await authAdminJson("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          shift_bay_staff: true,
          shift_bay_location_id: locationId,
          shift_bay_legacy_employee_id: legacyEmployeeId
        }
      })
    });
  } catch (error) {
    const message = String((error as Error)?.message || "").toLowerCase();
    if (!message.includes("already") && !message.includes("registered") && !message.includes("exists")) throw error;
    createdUser = await authUserByEmail(email);
    reusedExistingLogin = true;
    if (!createdUser) return json(409, { ok: false, error: "That email already has a Supabase login, but Shift Bay could not find it to link." });
    await authAdminJson(`/admin/users/${encodeURIComponent(createdUser.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        password,
        email_confirm: true,
        user_metadata: {
          ...(createdUser.user_metadata || {}),
          shift_bay_staff: true,
          shift_bay_location_id: locationId,
          shift_bay_legacy_employee_id: legacyEmployeeId
        }
      })
    });
  }

  const userId = createdUser?.id || createdUser?.user?.id;
  if (!userId) return json(502, { ok: false, error: "Supabase created or found the staff login but did not return a user ID to link." });

  const existingByEmployee = await supabaseJson(
    `/staff_accounts?location_id=eq.${encodeURIComponent(locationId)}&legacy_employee_id=eq.${encodeURIComponent(legacyEmployeeId)}&select=id,user_id`,
    { headers: serviceHeaders() }
  ).catch((error) => {
    if (isMissingStaffSchema(error)) throw Object.assign(new Error("Staff account tables have not been created yet. Run staff-accounts-mvp.sql first."), { status: 400 });
    throw error;
  });
  const existing = Array.isArray(existingByEmployee) ? existingByEmployee[0] : null;
  const accountBody = {
    location_id: locationId,
    user_id: userId,
    legacy_employee_id: legacyEmployeeId,
    display_name: displayName,
    status: "invited",
    password_change_required: true,
    invited_by: (validated.user as any).id,
    invited_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  let account: any = null;
  if (existing?.id) {
    const updated = await supabaseJson(`/staff_accounts?id=eq.${encodeURIComponent(existing.id)}`, {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(accountBody)
    });
    account = Array.isArray(updated) ? updated[0] : null;
  } else {
    const inserted = await supabaseJson("/staff_accounts?on_conflict=location_id,user_id", {
      method: "POST",
      headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify([accountBody])
    });
    account = Array.isArray(inserted) ? inserted[0] : null;
  }

  const emailResult = await sendInviteEmail({
    email,
    displayName,
    role: "staff",
    temporaryPassword: password,
    loginUrl: `${cfg.siteUrl.replace(/\/$/, "")}/staff.html`,
    isStaff: true
  });
  await logAuditEvent(reusedExistingLogin ? "staff_login_relinked" : "staff_login_created", (validated.user as any).id, { email, userId, legacyEmployeeId, displayName }, locationId);
  return json(200, {
    ok: true,
    staff: {
      id: account?.id || "",
      userId,
      email,
      legacyEmployeeId,
      displayName,
      status: "invited",
      passwordChangeRequired: true
    },
    temporaryPassword: password,
    loginUrl: `${cfg.siteUrl.replace(/\/$/, "")}/staff.html`,
    reusedExistingLogin,
    inviteEmailSent: emailResult.sent,
    inviteEmailId: emailResult.id || "",
    inviteEmailError: emailResult.sent ? "" : emailResult.reason || ""
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const path = routePath(request);
    if (path === "/auth/config" && request.method === "GET") return await handleAuthConfig();
    if (path === "/auth/login" && request.method === "POST") return await handleLogin(request);
    if (path === "/auth/refresh" && request.method === "POST") return await handleRefresh(request);
    if (path === "/auth/change-password" && request.method === "POST") return await handleChangePassword(request);
    if (path === "/staff/login" && request.method === "POST") return await handleStaffLogin(request);
    if (path === "/staff/change-password" && request.method === "POST") return await handleStaffChangePassword(request);
    if (path === "/staff/privacy" && request.method === "PATCH") return await handleStaffPrivacy(request);
    if (path === "/auth/session" && request.method === "GET") {
      const result = await validateSession(request);
      return json(result.ok ? 200 : result.status || 401, result);
    }
    if (path === "/locations" && request.method === "GET") return await handleListLocations(request);
    if (path === "/staff/me" && request.method === "GET") return await handleStaffMe(request);
   if (path === "/staff/schedule" && request.method === "GET") return await handleStaffSchedule(request);
   if (path === "/staff/directory" && request.method === "GET") return await handleStaffDirectory(request);
    if (path === "/staff/request-offs" && ["GET", "POST", "PATCH"].includes(request.method)) return await handleStaffRequestOffs(request);
    if (path === "/staff/availability" && ["GET", "PUT", "PATCH"].includes(request.method)) return await handleStaffAvailability(request);
    if (path === "/staff-requests" && request.method === "GET") return await handleManagerStaffRequests(request);
    if (path === "/staff-availability" && request.method === "GET") return await handleManagerStaffAvailability(request);
    if (path === "/staff-requests/review" && request.method === "POST") return await handleReviewStaffRequest(request);
    if (path === "/staff/profile" && request.method === "PATCH") return await handleStaffProfileUpdate(request);
    if (path === "/status" && request.method === "GET") return await handleStatus(request);
    if (path === "/state" && request.method === "GET") return await handleLoadState(request);
    if (path === "/state" && (request.method === "PUT" || request.method === "POST")) return await handleSaveState(request);
    if (path === "/audit/recent" && request.method === "GET") return await handleRecentAudit(request);
    if (path === "/managers" && request.method === "GET") return await handleListManagers(request);
    if (path === "/managers/invite" && request.method === "POST") return await handleInviteManager(request);
    if (path === "/managers/role" && request.method === "POST") return await handleUpdateManager(request);
    if (path === "/managers/remove" && request.method === "POST") return await handleRemoveManager(request);
    if (path === "/staff-accounts" && request.method === "GET") return await handleListStaffAccounts(request);
    if (path === "/staff-accounts/invite" && request.method === "POST") return await handleInviteStaff(request);
    if (path === "/staff-accounts/remove" && request.method === "POST") return await handleRemoveStaffAccount(request);
    if (path === "/parse-time-off-pdf") return json(501, { error: "PDF request-off imports still require the local Shift Bay server for now." });
    return json(404, { error: `Unknown Shift Bay API route: ${path}` });
  } catch (error) {
    return json((error as any).status || 500, { ok: false, error: (error as Error).message || "Unexpected Shift Bay API error." });
  }
});
