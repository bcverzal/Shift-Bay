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
    siteUrl: env("SHIFT_BAY_SITE_URL", "https://shift-bay.netlify.app"),
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

function temporaryPassword(length = 16) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
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
    ? `/location_users?location_id=eq.${encodeURIComponent(selectedLocationId)}&user_id=eq.${encodeURIComponent(user.id)}&select=location_id,role`
    : `/location_users?user_id=eq.${encodeURIComponent(user.id)}&select=location_id,role&order=created_at.asc`;
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
      locationId
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

async function loadDocumentRow(select = "*", locationId = config().locationId) {
  const cfg = config();
  const rows = await supabaseJson(
    `/scheduler_state_documents?location_id=eq.${encodeURIComponent(locationId)}&document_key=eq.${encodeURIComponent(cfg.documentKey)}&select=${select}`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] : null;
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
  const state = (payload?.data || payload?.state || payload) as JsonRecord;
  const baseServerSavedAt = payload?.baseServerSavedAt || (state.meta as any)?.serverSavedAt || "";
  const incomingTime = dataUpdatedAt(payload);
  const existingRow = await loadDocumentRow("state,saved_at,updated_at", locationId);
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
    location_id: locationId,
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
  const createdUser = await authAdminJson("/admin/users", {
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
  const userId = createdUser?.id || createdUser?.user?.id;
  if (!userId) return json(502, { ok: false, error: "Supabase created the login but did not return a user ID to link." });

  await supabaseJson("/location_users?on_conflict=location_id,user_id", {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify([{
      location_id: locationId,
      user_id: userId,
      role
    }])
  });
  await logAuditEvent("manager_login_created", (validated.user as any).id, { email, role, userId }, locationId);
  return json(200, { ok: true, manager: { userId, email, role }, temporaryPassword: password, loginUrl: cfg.siteUrl });
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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const path = routePath(request);
    if (path === "/auth/config" && request.method === "GET") return await handleAuthConfig();
    if (path === "/auth/login" && request.method === "POST") return await handleLogin(request);
    if (path === "/auth/refresh" && request.method === "POST") return await handleRefresh(request);
    if (path === "/auth/session" && request.method === "GET") {
      const result = await validateSession(request);
      return json(result.ok ? 200 : result.status || 401, result);
    }
    if (path === "/locations" && request.method === "GET") return await handleListLocations(request);
    if (path === "/status" && request.method === "GET") return await handleStatus(request);
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
