// Shift Bay hosted API bridge.
//
// Deploy as a Supabase Edge Function named `shift-bay-api`.
// Required secrets:
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY
// - SHIFT_BAY_LOCATION_ID
// - SHIFT_BAY_DOCUMENT_KEY optional, defaults to primary

type JsonRecord = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    documentKey: env("SHIFT_BAY_DOCUMENT_KEY", "primary")
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

function dataUpdatedAt(payload: any) {
  const value = payload?.data?.meta?.updatedAt || payload?.state?.meta?.updatedAt || payload?.meta?.updatedAt || payload?.savedAt || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

async function validateSession(request: Request) {
  const cfg = config();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !cfg.locationId) {
    const missing = [
      !cfg.supabaseUrl ? "SUPABASE_URL" : "",
      !cfg.serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : "",
      !cfg.locationId ? "SHIFT_BAY_LOCATION_ID" : ""
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
  const memberships = await supabaseJson(
    `/location_users?location_id=eq.${encodeURIComponent(cfg.locationId)}&user_id=eq.${encodeURIComponent(user.id)}&select=role`,
    { headers: serviceHeaders() }
  );
  const membership = Array.isArray(memberships) ? memberships[0] : null;
  if (!membership) return { ok: false, status: 403, error: "This account is not linked to this Shift Bay location." };

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      role: membership.role || "manager",
      locationId: cfg.locationId
    }
  };
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

async function loadDocumentRow(select = "*") {
  const cfg = config();
  const rows = await supabaseJson(
    `/scheduler_state_documents?location_id=eq.${encodeURIComponent(cfg.locationId)}&document_key=eq.${encodeURIComponent(cfg.documentKey)}&select=${select}`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function logAuditEvent(eventType: string, userId: string, details: JsonRecord = {}) {
  const cfg = config();
  await supabaseJson("/audit_events", {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify([{
      location_id: cfg.locationId,
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
    locationId: cfg.locationId,
    missing: [
      !cfg.supabaseUrl ? "SUPABASE_URL" : "",
      !cfg.anonKey ? "SUPABASE_ANON_KEY" : "",
      !cfg.locationId ? "SHIFT_BAY_LOCATION_ID" : ""
    ].filter(Boolean)
  });
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
  const validated = await validateSession(new Request(request.url, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  }));
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });
  return json(200, { ok: true, session, user: validated.user });
}

async function handleStatus() {
  const cfg = config();
  const row = await loadDocumentRow("saved_at,updated_at");
  return json(200, {
    ok: true,
    mode: "supabase",
    locationId: cfg.locationId,
    documentKey: cfg.documentKey,
    updatedAt: row?.updated_at || row?.saved_at || null
  });
}

async function handleLoadState(request: Request) {
  const validated = await validateSession(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const row = await loadDocumentRow("*");
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
  const payload = await request.json();
  const state = (payload?.data || payload?.state || payload) as JsonRecord;
  const baseServerSavedAt = payload?.baseServerSavedAt || (state.meta as any)?.serverSavedAt || "";
  const incomingTime = dataUpdatedAt(payload);
  const existingRow = await loadDocumentRow("state,saved_at,updated_at");
  const existingSavedAt = existingRow?.saved_at || existingRow?.updated_at || "";
  if (baseServerSavedAt && existingSavedAt && Date.parse(existingSavedAt) > Date.parse(baseServerSavedAt) + 1000) {
    return json(409, {
      error: "Rejected stale scheduler data. Refresh the app to load the latest shared file.",
      incomingUpdatedAt: baseServerSavedAt,
      existingUpdatedAt: existingSavedAt
    });
  }
  const existingTime = dataUpdatedAt(existingRow?.state || { savedAt: existingRow?.saved_at || existingRow?.updated_at });
  if (incomingTime && existingTime && incomingTime < existingTime - 1000) {
    return json(409, {
      error: "Rejected stale scheduler data. Refresh the app to load the latest shared file.",
      incomingUpdatedAt: new Date(incomingTime).toISOString(),
      existingUpdatedAt: new Date(existingTime).toISOString()
    });
  }

  const savedAt = new Date().toISOString();
  const body = [{
    location_id: cfg.locationId,
    document_key: cfg.documentKey,
    schema_version: Number(payload?.schemaVersion || (state.meta as any)?.schemaVersion || 1),
    state,
    saved_by: (validated.user as any).id,
    saved_by_device_id: payload?.savedByDeviceId || (state.meta as any)?.deviceId || null,
    saved_at: savedAt,
    updated_at: savedAt
  }];
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
    schemaVersion: body[0].schema_version
  });
  return json(200, { ok: true, savedAt });
}

async function handleRecentAudit(request: Request) {
  const validated = await validateSession(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const cfg = config();
  const url = `/audit_events?location_id=eq.${encodeURIComponent(cfg.locationId)}&select=id,event_type,entity_type,details,created_at,user_id&order=created_at.desc&limit=50`;
  const events = await supabaseJson(url, { headers: serviceHeaders() });
  return json(200, { ok: true, events });
}

async function handleListManagers(request: Request) {
  const validated = await requireOwner(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const cfg = config();
  const rows = await supabaseJson(
    `/location_users?location_id=eq.${encodeURIComponent(cfg.locationId)}&select=user_id,role,created_at&order=created_at.asc`,
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
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "manager").trim().toLowerCase();
  if (!email || !email.includes("@")) return json(400, { ok: false, error: "Enter a valid email address." });
  if (!["owner", "manager", "viewer"].includes(role)) return json(400, { ok: false, error: "Choose owner, manager, or viewer." });

  const invitedUser = await authAdminJson("/invite", {
    method: "POST",
    body: JSON.stringify({
      email,
      data: {
        shift_bay_location_id: cfg.locationId,
        shift_bay_role: role
      }
    })
  });
  const userId = invitedUser?.id || invitedUser?.user?.id;
  if (!userId) return json(502, { ok: false, error: "Supabase sent the invite but did not return a user ID to link." });

  await supabaseJson("/location_users?on_conflict=location_id,user_id", {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify([{
      location_id: cfg.locationId,
      user_id: userId,
      role
    }])
  });
  await logAuditEvent("manager_invited", (validated.user as any).id, { email, role, userId });
  return json(200, { ok: true, manager: { userId, email, role } });
}

async function handleUpdateManager(request: Request) {
  const validated = await requireOwner(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const cfg = config();
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  const role = String(body.role || "").trim().toLowerCase();
  if (!userId) return json(400, { ok: false, error: "Manager user ID is required." });
  if (!["owner", "manager", "viewer"].includes(role)) return json(400, { ok: false, error: "Choose owner, manager, or viewer." });

  await supabaseJson(
    `/location_users?location_id=eq.${encodeURIComponent(cfg.locationId)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({ role })
    }
  );
  await logAuditEvent("manager_role_updated", (validated.user as any).id, { userId, role });
  return json(200, { ok: true });
}

async function handleRemoveManager(request: Request) {
  const validated = await requireOwner(request);
  if (!validated.ok) return json(validated.status || 401, { ok: false, error: validated.error });

  const cfg = config();
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  if (!userId) return json(400, { ok: false, error: "Manager user ID is required." });
  if (userId === (validated.user as any).id) return json(400, { ok: false, error: "You cannot remove your own owner access here." });

  await supabaseJson(
    `/location_users?location_id=eq.${encodeURIComponent(cfg.locationId)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: serviceHeaders({ Prefer: "return=minimal" })
    }
  );
  await logAuditEvent("manager_access_removed", (validated.user as any).id, { userId });
  return json(200, { ok: true });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const path = routePath(request);
    if (path === "/auth/config" && request.method === "GET") return await handleAuthConfig();
    if (path === "/auth/login" && request.method === "POST") return await handleLogin(request);
    if (path === "/auth/session" && request.method === "GET") {
      const result = await validateSession(request);
      return json(result.ok ? 200 : result.status || 401, result);
    }
    if (path === "/status" && request.method === "GET") return await handleStatus();
    if (path === "/state" && request.method === "GET") return await handleLoadState(request);
    if (path === "/state" && (request.method === "PUT" || request.method === "POST")) return await handleSaveState(request);
    if (path === "/audit/recent" && request.method === "GET") return await handleRecentAudit(request);
    if (path === "/managers" && request.method === "GET") return await handleListManagers(request);
    if (path === "/managers/invite" && request.method === "POST") return await handleInviteManager(request);
    if (path === "/managers/role" && request.method === "POST") return await handleUpdateManager(request);
    if (path === "/managers/remove" && request.method === "POST") return await handleRemoveManager(request);
    if (path === "/parse-time-off-pdf") return json(501, { error: "PDF request-off imports still require the local Shift Bay server for now." });
    return json(404, { error: `Unknown Shift Bay API route: ${path}` });
  } catch (error) {
    return json((error as any).status || 500, { ok: false, error: (error as Error).message || "Unexpected Shift Bay API error." });
  }
});
