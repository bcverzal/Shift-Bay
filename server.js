const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { loadEnvFile } = require("./config/load-env");
const { createSchedulerStore } = require("./storage");

const ROOT = __dirname;
loadEnvFile(ROOT);
const DATA_DIR = path.join(ROOT, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DATA_FILE = path.join(DATA_DIR, "restaurant-scheduler-data.json");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const STORAGE_MODE = (process.env.SHIFT_BAY_STORAGE_MODE || "local-json").trim().toLowerCase();
const schedulerStore = createSchedulerStore({ root: ROOT, dataDir: DATA_DIR, backupDir: BACKUP_DIR, dataFile: DATA_FILE });

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const PDFJS_PATH = path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs");

function ensureDataFolders() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body, null, 2));
}

function supabaseServerConfig() {
  return {
    url: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    locationId: process.env.SHIFT_BAY_LOCATION_ID || ""
  };
}

function authConfigPayload() {
  const config = supabaseServerConfig();
  return {
    enabled: Boolean(config.url && config.anonKey),
    supabaseUrl: config.url,
    anonKey: config.anonKey,
    locationId: config.locationId,
    missing: [
      !config.url ? "SUPABASE_URL" : "",
      !config.anonKey ? "SUPABASE_ANON_KEY" : "",
      !config.locationId ? "SHIFT_BAY_LOCATION_ID" : ""
    ].filter(Boolean)
  };
}

async function supabaseJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.error_description || body?.details || `Supabase request failed with ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

function bearerToken(request) {
  const match = String(request.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function selectedLocationFromRequest(request) {
  const url = new URL(request.url || "/", `http://${request.headers?.host || "localhost"}`);
  return String(request.headers["x-shift-bay-location-id"] || url.searchParams.get("locationId") || "").trim();
}

async function validateSupabaseSession(request) {
  const config = supabaseServerConfig();
  const token = bearerToken(request);
  if (!config.url || !config.serviceRoleKey || !config.locationId) {
    const missing = [];
    if (!config.url) missing.push("SUPABASE_URL");
    if (!config.serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!config.locationId) missing.push("SHIFT_BAY_LOCATION_ID");
    return { ok: false, status: 503, error: `Cloud login is not fully configured. Missing ${missing.join(", ")}.` };
  }
  if (!token) return { ok: false, status: 401, error: "No login token was provided." };

  const user = await supabaseJson(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey || config.serviceRoleKey,
      Authorization: `Bearer ${token}`
    }
  });
  const selectedLocationId = selectedLocationFromRequest(request);
  const membershipUrl = selectedLocationId
    ? `${config.url}/rest/v1/location_users?location_id=eq.${encodeURIComponent(selectedLocationId)}&user_id=eq.${encodeURIComponent(user.id)}&select=*`
    : `${config.url}/rest/v1/location_users?user_id=eq.${encodeURIComponent(user.id)}&select=*&order=created_at.asc`;
  const memberships = await supabaseJson(
    membershipUrl,
    {
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`
      }
    }
  );
  const rows = Array.isArray(memberships) ? memberships : [];
  const membership = selectedLocationId
    ? rows[0]
    : (rows.find((row) => row.location_id === config.locationId) || rows[0] || null);
  if (!membership) return { ok: false, status: 403, error: "This account is not linked to this Shift Bay location." };
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      role: membership.role || "manager",
      passwordChangeRequired: Boolean(membership.password_change_required),
      locationId: membership.location_id || selectedLocationId || config.locationId
    }
  };
}

async function validateSupabaseAuthUser(request) {
  const config = supabaseServerConfig();
  const token = bearerToken(request);
  if (!config.url || !config.serviceRoleKey) {
    const missing = [];
    if (!config.url) missing.push("SUPABASE_URL");
    if (!config.serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    return { ok: false, status: 503, error: `Cloud login is not fully configured. Missing ${missing.join(", ")}.` };
  }
  if (!token) return { ok: false, status: 401, error: "No login token was provided." };
  const user = await supabaseJson(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey || config.serviceRoleKey,
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

async function listUserLocations(request) {
  const validated = await validateSupabaseSession(request);
  if (!validated.ok) return validated;
  const config = supabaseServerConfig();
  const userId = validated.user.id;
  const memberships = await supabaseJson(
    `${config.url}/rest/v1/location_users?user_id=eq.${encodeURIComponent(userId)}&select=location_id,role,created_at&order=created_at.asc`,
    {
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`
      }
    }
  );
  const rows = Array.isArray(memberships) ? memberships : [];
  if (!rows.length) return { ok: true, selectedLocationId: validated.user.locationId, locations: [] };
  const ids = rows.map((row) => row.location_id).filter(Boolean);
  const locations = await supabaseJson(
    `${config.url}/rest/v1/locations?id=in.(${ids.map((id) => encodeURIComponent(id)).join(",")})&select=id,name,timezone`,
    {
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`
      }
    }
  );
  const locationMap = new Map((Array.isArray(locations) ? locations : []).map((location) => [location.id, location]));
  return {
    ok: true,
    selectedLocationId: validated.user.locationId,
    locations: rows.map((row) => {
      const location = locationMap.get(row.location_id) || {};
      return {
        id: row.location_id,
        name: location.name || "Shift Bay Location",
        timezone: location.timezone || "America/Chicago",
        role: row.role || "viewer",
        createdAt: row.created_at || ""
      };
    })
  };
}

function isMissingStaffSchema(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return error?.status === 404
    || message.includes("staff_accounts")
    || message.includes("could not find the table")
    || message.includes("schema cache")
    || message.includes("does not exist");
}

async function staffAccountForUser(request) {
  const validated = await validateSupabaseAuthUser(request);
  if (!validated.ok) return validated;
  const config = supabaseServerConfig();
  const locationId = selectedLocationFromRequest(request) || config.locationId;
  try {
    const headers = { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` };
    let rows;
    try {
      rows = await supabaseJson(
        `${config.url}/rest/v1/staff_accounts?location_id=eq.${encodeURIComponent(locationId)}&user_id=eq.${encodeURIComponent(validated.user.id)}&select=id,location_id,user_id,employee_id,legacy_employee_id,display_name,status,phone_visibility,created_at,updated_at`,
        { headers }
      );
    } catch (error) {
      if (!String(error?.message || "").toLowerCase().includes("phone_visibility")) throw error;
      rows = await supabaseJson(
        `${config.url}/rest/v1/staff_accounts?location_id=eq.${encodeURIComponent(locationId)}&user_id=eq.${encodeURIComponent(validated.user.id)}&select=id,location_id,user_id,employee_id,legacy_employee_id,display_name,status,created_at,updated_at`,
        { headers }
      );
      rows = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, phone_visibility: "managers_only" }));
    }
    const account = Array.isArray(rows) ? rows[0] : null;
    return {
      ok: true,
      schemaReady: true,
      linked: Boolean(account),
      user: validated.user,
      locationId,
      account: account || null,
      message: account ? "" : "No staff employee profile is linked to this login yet."
    };
  } catch (error) {
    if (isMissingStaffSchema(error)) {
      return {
        ok: true,
        schemaReady: false,
        linked: false,
        user: validated.user,
        locationId,
        account: null,
        message: "Staff portal tables have not been created yet."
      };
    }
    throw error;
  }
}

function staffDateFromKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function staffDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function staffAddDays(value, days) {
  const date = staffDateFromKey(value);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return staffDateKey(date);
}

function staffWeekStart(value, weekStart) {
  const requested = staffDateFromKey(value);
  const date = requested || new Date();
  const offset = (date.getUTCDay() - Number(weekStart || 0) + 7) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return staffDateKey(date);
}

async function staffScheduleForUser(request) {
  const profile = await staffAccountForUser(request);
  if (!profile.ok) return profile;
  if (!profile.linked || !profile.account) {
    return { ok: false, status: 403, error: "This login is not linked to a staff profile yet." };
  }
  const locationId = profile.locationId;
  const config = supabaseServerConfig();
  const rows = await supabaseJson(
    `${config.url}/rest/v1/scheduler_state_documents?location_id=eq.${encodeURIComponent(locationId)}&document_key=eq.primary&select=state,saved_at,updated_at`,
    { headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` } }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ok: false, status: 404, error: "No scheduler data has been created for this location yet." };
  const state = row.state || {};
  const weekStart = staffWeekStart(new URL(request.url).searchParams.get("weekStart") || "", Number(state.settings?.weekStart || 0));
  const weekEnd = staffAddDays(weekStart, 6);
  const employeeId = String(profile.account.legacy_employee_id || profile.account.employee_id || "");
  const roles = new Map((Array.isArray(state.roles) ? state.roles : []).map((role) => [String(role.id), role]));
  const shifts = (Array.isArray(state.shifts) ? state.shifts : [])
    .filter((shift) => String(shift.employeeId || "") === employeeId && String(shift.date || "") >= weekStart && String(shift.date || "") <= weekEnd)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.start || "").localeCompare(String(b.start || "")))
    .map((shift) => {
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
  return {
    ok: true,
    locationId,
    employee: { id: employeeId, displayName: profile.account.display_name || profile.user.email || "Staff" },
    weekStart,
    weekEnd,
    shifts
  };
}

async function staffPrivacyForUser(request) {
  const profile = await staffAccountForUser(request);
  if (!profile.ok) return profile;
  if (!profile.linked || !profile.account?.id) return { ok: false, status: 403, error: "This login is not linked to a staff profile yet." };
  let body = {};
  try { body = JSON.parse(await readRequestBody(request) || "{}"); } catch { body = {}; }
  const phoneVisibility = String(body.phoneVisibility || "").trim();
  if (!["managers_only", "all_staff"].includes(phoneVisibility)) {
    return { ok: false, status: 400, error: "Choose whether your phone number is visible to managers only or all staff." };
  }
  const config = supabaseServerConfig();
  const rows = await supabaseJson(`${config.url}/rest/v1/staff_accounts?id=eq.${encodeURIComponent(profile.account.id)}`, {
    method: "PATCH",
    headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ phone_visibility: phoneVisibility, updated_at: new Date().toISOString() })
  });
  const account = Array.isArray(rows) ? rows[0] : null;
  return { ok: true, phoneVisibility: account?.phone_visibility || phoneVisibility };
}

async function requireCloudUser(request, response) {
  if (STORAGE_MODE !== "supabase") return true;
  try {
    const result = await validateSupabaseSession(request);
    if (!result.ok) {
      sendJson(response, result.status || 401, { ok: false, error: result.error });
      return false;
    }
    request.shiftBayUser = result.user;
    return true;
  } catch (error) {
    sendJson(response, error.status || 401, { ok: false, error: error.message || "Cloud login is required." });
    return false;
  }
}

async function requireCloudEditor(request, response) {
  if (!(await requireCloudUser(request, response))) return false;
  const role = String(request.shiftBayUser?.role || "").toLowerCase();
  if (!["owner", "manager"].includes(role)) {
    sendJson(response, 403, { ok: false, error: "This account has view-only access. You can view and print schedules, but changes will not be saved." });
    return false;
  }
  return true;
}

async function signInWithSupabasePassword(email, password) {
  const config = supabaseServerConfig();
  if (!config.url || !config.anonKey) {
    const missing = [];
    if (!config.url) missing.push("SUPABASE_URL");
    if (!config.anonKey) missing.push("SUPABASE_ANON_KEY");
    const error = new Error(`Cloud login is not configured. Missing ${missing.join(", ")}.`);
    error.status = 503;
    throw error;
  }
  if (!email || !password) {
    const error = new Error("Email and password are required.");
    error.status = 400;
    throw error;
  }
  return supabaseJson(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
}

async function refreshSupabaseSession(refreshToken) {
  const config = supabaseServerConfig();
  if (!config.url || !config.anonKey) {
    const missing = [];
    if (!config.url) missing.push("SUPABASE_URL");
    if (!config.anonKey) missing.push("SUPABASE_ANON_KEY");
    const error = new Error(`Cloud login is not configured. Missing ${missing.join(", ")}.`);
    error.status = 503;
    throw error;
  }
  if (!refreshToken) {
    const error = new Error("Refresh token is required.");
    error.status = 400;
    throw error;
  }
  return supabaseJson(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
}

async function changeSupabasePassword(request) {
  const validated = await validateSupabaseSession(request);
  if (!validated.ok) return validated;
  const rawBody = await readRequestBody(request);
  const parsed = JSON.parse(rawBody || "{}");
  const password = String(parsed.password || "");
  if (password.length < 8) return { ok: false, status: 400, error: "Use a password with at least 8 characters." };
  const config = supabaseServerConfig();
  await supabaseJson(`${config.url}/auth/v1/admin/users/${encodeURIComponent(validated.user.id)}`, {
    method: "PUT",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password })
  });
  await supabaseJson(
    `${config.url}/rest/v1/location_users?location_id=eq.${encodeURIComponent(validated.user.locationId)}&user_id=eq.${encodeURIComponent(validated.user.id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ password_change_required: false })
    }
  );
  return { ok: true, user: { ...validated.user, passwordChangeRequired: false } };
}

async function userEmailById(userId) {
  const config = supabaseServerConfig();
  if (!config.url || !config.serviceRoleKey || !userId) return "";
  try {
    const user = await supabaseJson(`${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`
      }
    });
    return user?.email || "";
  } catch {
    return "";
  }
}

async function authUserByEmail(email) {
  const config = supabaseServerConfig();
  const target = String(email || "").trim().toLowerCase();
  if (!config.url || !config.serviceRoleKey || !target) return null;
  for (let page = 1; page <= 10; page += 1) {
    const result = await supabaseJson(`${config.url}/auth/v1/admin/users?page=${page}&per_page=100`, {
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`
      }
    });
    const users = Array.isArray(result?.users) ? result.users : (Array.isArray(result) ? result : []);
    const match = users.find((user) => String(user?.email || "").toLowerCase() === target);
    if (match) return match;
    if (users.length < 100) return null;
  }
  return null;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function saveDataFile(data) {
  ensureDataFolders();
  if (fs.existsSync(DATA_FILE)) {
    const backupName = `restaurant-scheduler-data-${timestampForFile()}.json`;
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, backupName));
  }
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempFile, DATA_FILE);
}

function dataUpdatedAt(payload) {
  return Date.parse(payload?.data?.meta?.updatedAt || payload?.state?.meta?.updatedAt || payload?.meta?.updatedAt || payload?.savedAt || "");
}

function existingDataUpdatedAt() {
  if (!fs.existsSync(DATA_FILE)) return 0;
  try {
    return dataUpdatedAt(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  } catch {
    return 0;
  }
}

function pythonCandidates() {
  const candidates = [];
  if (process.env.SHIFT_BAY_PYTHON) candidates.push({ command: process.env.SHIFT_BAY_PYTHON, args: [] });
  candidates.push({
    command: path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"),
    args: []
  });
  candidates.push({ command: "python", args: [] });
  candidates.push({ command: "py", args: ["-3"] });
  return candidates.filter((candidate) => candidate.command && (candidate.command === "python" || candidate.command === "py" || fs.existsSync(candidate.command)));
}

function runPythonJson(scriptPath, payload) {
  const candidates = pythonCandidates();
  return new Promise((resolve, reject) => {
    let index = 0;
    const tryNext = (lastError = null) => {
      if (index >= candidates.length) {
        reject(lastError || new Error("Python is not available for PDF parsing."));
        return;
      }
      const candidate = candidates[index++];
      const child = spawn(candidate.command, [...candidate.args, scriptPath], {
        cwd: ROOT,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", tryNext);
      child.on("close", (code) => {
        if (code !== 0) {
          tryNext(new Error(stderr.trim() || `PDF parser exited with code ${code}.`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(new Error(`PDF parser returned unreadable output. ${error.message}`));
        }
      });
      child.stdin.end(JSON.stringify(payload));
    };
    tryNext();
  });
}

async function loadPdfJs() {
  if (!globalThis.DOMMatrix) {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
      multiplySelf() { return this; }
      preMultiplySelf() { return this; }
      translateSelf() { return this; }
      scaleSelf() { return this; }
      rotateSelf() { return this; }
      invertSelf() { return this; }
      transformPoint(point) { return point; }
    };
  }
  if (!globalThis.ImageData) globalThis.ImageData = class ImageData {};
  if (!globalThis.Path2D) globalThis.Path2D = class Path2D {};
  if (!fs.existsSync(PDFJS_PATH)) throw new Error("PDF parser library is not available.");
  return import(pathToFileURL(PDFJS_PATH).href);
}

function cleanCell(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeImportDate(value) {
  const match = cleanCell(value).match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || !day || !year) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function splitReportName(value) {
  const text = cleanCell(value).replace(/^,+|,+$/g, "");
  if (!text) return { firstName: "", lastName: "" };
  if (text.includes(",")) {
    const [lastName, firstName] = text.split(",", 2).map(cleanCell);
    return { firstName, lastName };
  }
  const parts = text.split(/\s+/);
  return { firstName: parts.shift() || "", lastName: parts.join(" ") };
}

function normalizeRequestTimeLabel(value) {
  const match = cleanCell(value).match(/^(\d{1,2})(?::?(\d{2}))?\s*(a|am|p|pm)$/i);
  if (!match) return cleanCell(value).toUpperCase();
  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const period = match[3].toLowerCase().startsWith("p") ? "PM" : "AM";
  if (hour > 12) hour -= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute.padStart(2, "0")} ${period}`;
}

function requestDaypart(info) {
  const text = cleanCell(info);
  if (/\bAll\s+Day\b/i.test(text)) return "All day";
  const range = text.match(/\b(\d{1,2}(?::?\d{2})?\s*(?:a|am|p|pm))\s*(?:to|-|until|through|thru)\s*(\d{1,2}(?::?\d{2})?\s*(?:a|am|p|pm))\b/i);
  return range ? `${normalizeRequestTimeLabel(range[1])} to ${normalizeRequestTimeLabel(range[2])}` : "";
}

function columnForX(x) {
  if (x < 122) return "submitted";
  if (x < 150) return "recurring";
  if (x < 205) return "employee";
  if (x < 248) return "date";
  if (x < 295) return "info";
  if (x < 340) return "note";
  if (x < 452) return "approvedBy";
  return "";
}

function joinColumnItems(items) {
  return items
    .sort((a, b) => (b.y - a.y) || (a.x - b.x))
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowToRequest(row, fileName) {
  const byColumn = {};
  row.forEach((item) => {
    const column = columnForX(item.x);
    if (!column) return;
    if (!byColumn[column]) byColumn[column] = [];
    byColumn[column].push(item);
  });
  const cells = Object.fromEntries(Object.entries(byColumn).map(([key, items]) => [key, joinColumnItems(items)]));
  cells.employee = cleanCell(cells.employee).replace(/\bEmployee\b/gi, "").trim();
  cells.date = cleanCell(cells.date).replace(/\bDOB\b/gi, "").trim();
  cells.info = cleanCell(cells.info).replace(/\bInformation\b/gi, "").trim();
  cells.note = cleanCell(cells.note).replace(/\bNote\b/gi, "").trim();
  cells.approvedBy = cleanCell(cells.approvedBy).replace(/\bApproved\b|\bBy\b/gi, "").trim();
  if (!cells.employee || !cells.date || !cells.info) return null;
  if (/^Employee$/i.test(cells.employee)) return null;
  const date = normalizeImportDate(cells.date) || normalizeImportDate(cells.info);
  if (!date) return null;
  const { firstName, lastName } = splitReportName(cells.employee);
  if (!firstName && !lastName) return null;
  const statusMatch = cleanCell(`${cells.info} ${cells.note} ${cells.approvedBy}`).match(/\b(Active|Pending|Denied|Canceled|Cancelled)\b/i);
  const note = cleanCell(cells.note).replace(/\b(Active|Pending|Denied|Canceled|Cancelled)\b$/i, "").trim();
  return {
    firstName,
    lastName,
    date,
    daypart: requestDaypart(cells.info),
    note,
    status: statusMatch ? statusMatch[1][0].toUpperCase() + statusMatch[1].slice(1).toLowerCase() : "",
    approvedBy: cleanCell(cells.approvedBy).replace(/\b(Active|Pending|Denied|Canceled|Cancelled)\b/i, "").trim(),
    recurring: cells.recurring || "",
    source: `Ctuit RO PDF: ${fileName}`
  };
}

function parsePageItems(items, fileName) {
  const textItems = items
    .map((item) => ({
      text: cleanCell(item.str),
      x: Number(item.transform?.[4]) || 0,
      y: Number(item.transform?.[5]) || 0
    }))
    .filter((item) => item.text);
  const anchors = textItems
    .filter((item) => item.x >= 65 && item.x < 120 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(item.text))
    .sort((a, b) => b.y - a.y);
  const requests = [];
  anchors.forEach((anchor, index) => {
    const nextY = anchors[index + 1]?.y ?? 80;
    const previousY = anchors[index - 1]?.y;
    const rowTop = previousY ? Math.min(anchor.y + 24, anchor.y + ((previousY - anchor.y) * 0.5)) : anchor.y + 34;
    const previousGap = previousY ? previousY - anchor.y : 999;
    const noteTop = previousY
      ? (previousGap < 70 ? anchor.y + 12 : Math.min(previousY - 14, anchor.y + 140))
      : anchor.y + 140;
    const rowItems = textItems.filter((item) => {
      const column = columnForX(item.x);
      if (column === "note") return item.y <= noteTop && item.y > nextY + 4;
      return item.y <= rowTop && item.y > nextY + 4;
    });
    const request = rowToRequest(rowItems, fileName);
    if (request) requests.push(request);
  });
  return requests;
}

function pageItemsToText(items) {
  return items
    .map((item) => ({
      text: cleanCell(item.str),
      x: Number(item.transform?.[4]) || 0,
      y: Number(item.transform?.[5]) || 0
    }))
    .filter((item) => item.text)
    .sort((a, b) => (b.y - a.y) || (a.x - b.x))
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCtuitChrome(text) {
  return cleanCell(text)
    .replace(/https:\/\/radar\.ctuit\.com\/\S+/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2},\s+\d{1,2}:\d{2}\s+[AP]M\s+Time Off Requests\b/gi, " ")
    .replace(/\bRadar\b|\bLabor Scheduling\b|\bHeart of America\b/gi, " ")
    .replace(/\bView Schedules\b|\bBuilder\b|\bTemplates\b|\bQuick Notes\b|\bSchedules\b|\bReports\b|\bCharts\b/gi, " ")
    .replace(/\bDate Submitted\b|\bRecurring\b|\bEmployee\b|\bDOB\b|\bInformation\b|\bNote\b|\bApproved By\b/gi, " ")
    .replace(/\bBlocked Dates\b|\bNo blocked dates found\b/gi, " ")
    .replace(/\bTime Off Requests\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRequestChunk(chunk, fileName) {
  let text = stripCtuitChrome(chunk);
  const submitted = text.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s+[AP]M)\s+(.+)$/i);
  if (!submitted) return null;
  text = submitted[3].trim();
  let recurring = "";
  if (/^Weekly\b/i.test(text)) {
    recurring = "Weekly";
    text = text.replace(/^Weekly\b/i, "").trim();
  }
  const requestDateMatch = text.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
  if (!requestDateMatch) return null;
  const employeeText = cleanCell(text.slice(0, requestDateMatch.index));
  const date = normalizeImportDate(requestDateMatch[0]);
  let rest = cleanCell(text.slice(requestDateMatch.index + requestDateMatch[0].length));
  if (!employeeText || !date || /^Date\b/i.test(employeeText)) return null;
  const daypartMatch = rest.match(/\b(All\s+Day|\d{1,2}(?::?\d{2})?\s*(?:A|P)M?\s*(?:to|-|until|through|thru)\s*\d{1,2}(?::?\d{2})?\s*(?:A|P)M?)\b/i);
  if (!daypartMatch) return null;
  const daypart = requestDaypart(daypartMatch[0]);
  let note = cleanCell(rest.slice(daypartMatch.index + daypartMatch[0].length));
  let status = "";
  if (/\bApprove\s+Disallow\b/i.test(note)) status = "Pending";
  const statusMatch = note.match(/\b(Active|Pending|Denied|Canceled|Cancelled)\b/i);
  if (statusMatch) status = statusMatch[1][0].toUpperCase() + statusMatch[1].slice(1).toLowerCase();
  note = note
    .replace(/\bGrace\s+Cole\b/gi, " ")
    .replace(/\bApprove\s+Disallow\b/gi, " ")
    .replace(/\bManager Note:\b/gi, " ")
    .replace(/\b(Active|Pending|Denied|Canceled|Cancelled)\b/gi, " ")
    .replace(/\b\d+\s+\d+\b/g, " ")
    .trim();
  const { firstName, lastName } = splitReportName(employeeText);
  if (!firstName && !lastName) return null;
  return {
    firstName,
    lastName,
    date,
    daypart,
    note,
    status,
    approvedBy: /Grace\s+Cole/i.test(rest) ? "Grace Cole" : "",
    recurring,
    source: `Ctuit RO PDF: ${fileName}`
  };
}

function parseTimeOffText(text, fileName) {
  const cleaned = stripCtuitChrome(text);
  const starts = [...cleaned.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M\b/g)].map((match) => match.index);
  const requests = [];
  starts.forEach((start, index) => {
    const end = starts[index + 1] ?? cleaned.length;
    const request = parseRequestChunk(cleaned.slice(start, end), fileName);
    if (request) requests.push(request);
  });
  return requests;
}

async function parseTimeOffPdfPayload(payload) {
  const pdfjs = await loadPdfJs();
  const results = [];
  const errors = [];
  for (const [index, item] of (payload.files || []).entries()) {
    const fileName = cleanCell(item.name) || `request-off-${index + 1}.pdf`;
    try {
      const data = Uint8Array.from(Buffer.from(item.dataBase64 || "", "base64"));
      const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
      const requests = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        requests.push(...parsePageItems(content.items || [], fileName));
      }
      results.push({ fileName, pages: document.numPages, requests });
    } catch (error) {
      errors.push({ fileName, error: error.message || "Could not parse PDF." });
    }
  }
  const requests = [];
  const seen = new Set();
  let duplicates = 0;
  results.forEach((result) => {
    result.requests.forEach((request) => {
      const key = [request.firstName, request.lastName, request.date, request.daypart, request.note]
        .map((value) => cleanCell(value).toLowerCase())
        .join("|");
      if (seen.has(key)) {
        duplicates++;
        return;
      }
      seen.add(key);
      requests.push(request);
    });
  });
  return { requests, source: "Ctuit RO PDF", diagnostics: { files: results, errors, duplicates } };
}

function serveStatic(request, response) {
  const requestPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^[/\\]+/, "");
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const cacheControl = [".html", ".js", ".css"].includes(ext) ? "no-store" : "public, max-age=60";
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": cacheControl
    });
    response.end(content);
  });
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/auth/config") {
    sendJson(response, 200, authConfigPayload());
    return;
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    try {
      const rawBody = await readRequestBody(request);
      const parsed = JSON.parse(rawBody || "{}");
      const session = await signInWithSupabasePassword(String(parsed.email || "").trim(), String(parsed.password || ""));
      const fakeRequest = {
        url: request.url,
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "x-shift-bay-location-id": request.headers["x-shift-bay-location-id"] || ""
        }
      };
      const validated = await validateSupabaseSession(fakeRequest);
      if (!validated.ok) {
        sendJson(response, validated.status || 401, { ok: false, error: validated.error });
        return;
      }
      sendJson(response, 200, { ok: true, session, user: validated.user });
    } catch (error) {
      sendJson(response, error.status || 401, { ok: false, error: error.message || "Could not sign in." });
    }
    return;
  }
  if (url.pathname === "/api/auth/refresh" && request.method === "POST") {
    try {
      const rawBody = await readRequestBody(request);
      const parsed = JSON.parse(rawBody || "{}");
      const session = await refreshSupabaseSession(String(parsed.refresh_token || ""));
      const fakeRequest = {
        url: request.url,
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "x-shift-bay-location-id": request.headers["x-shift-bay-location-id"] || ""
        }
      };
      const validated = await validateSupabaseSession(fakeRequest);
      if (!validated.ok) {
        sendJson(response, validated.status || 401, { ok: false, error: validated.error });
        return;
      }
      sendJson(response, 200, { ok: true, session, user: validated.user });
    } catch (error) {
      sendJson(response, error.status || 401, { ok: false, error: error.message || "Could not refresh login." });
    }
    return;
  }
  if (url.pathname === "/api/auth/change-password" && request.method === "POST") {
    try {
      const result = await changeSupabasePassword(request);
      sendJson(response, result.ok ? 200 : result.status || 400, result);
    } catch (error) {
      sendJson(response, error.status || 400, { ok: false, error: error.message || "Could not change password." });
    }
    return;
  }
  if (url.pathname === "/api/auth/session") {
    try {
      const result = await validateSupabaseSession(request);
      if (!result.ok) {
        sendJson(response, result.status || 401, { ok: false, error: result.error });
        return;
      }
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error.status || 401, { ok: false, error: error.message || "Could not verify login." });
    }
    return;
  }
  if (url.pathname === "/api/locations" && request.method === "GET") {
    try {
      const result = await listUserLocations(request);
      if (!result.ok) {
        sendJson(response, result.status || 401, { ok: false, error: result.error });
        return;
      }
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error.status || 400, { ok: false, error: error.message || "Could not list locations." });
    }
    return;
  }
  if (url.pathname === "/api/staff/login" && request.method === "POST") {
    try {
      const rawBody = await readRequestBody(request);
      const parsed = JSON.parse(rawBody || "{}");
      const session = await signInWithSupabasePassword(String(parsed.email || "").trim(), String(parsed.password || ""));
      const fakeRequest = {
        url: request.url,
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "x-shift-bay-location-id": request.headers["x-shift-bay-location-id"] || ""
        }
      };
      const profile = await staffAccountForUser(fakeRequest);
      if (!profile.ok) {
        sendJson(response, profile.status || 401, { ok: false, error: profile.error });
        return;
      }
      sendJson(response, 200, { ok: true, session, profile });
    } catch (error) {
      sendJson(response, error.status || 401, { ok: false, error: error.message || "Could not sign in." });
    }
    return;
  }
  if (url.pathname === "/api/staff/me" && request.method === "GET") {
    try {
      const result = await staffAccountForUser(request);
      sendJson(response, result.ok ? 200 : result.status || 401, result);
    } catch (error) {
      sendJson(response, error.status || 400, { ok: false, error: error.message || "Could not load staff profile." });
    }
    return;
  }
  if (url.pathname === "/api/staff/schedule" && request.method === "GET") {
    try {
      const result = await staffScheduleForUser(request);
      sendJson(response, result.ok ? 200 : result.status || 400, result);
    } catch (error) {
      sendJson(response, error.status || 400, { ok: false, error: error.message || "Could not load staff schedule." });
    }
    return;
  }
  if (url.pathname === "/api/staff/privacy" && request.method === "PATCH") {
    try {
      const result = await staffPrivacyForUser(request);
      sendJson(response, result.ok ? 200 : result.status || 400, result);
    } catch (error) {
      sendJson(response, error.status || 400, { ok: false, error: error.message || "Could not save phone privacy setting." });
    }
    return;
  }
  if (url.pathname === "/api/status") {
    sendJson(response, 200, await schedulerStore.status(request.shiftBayUser || null));
    return;
  }
  if (url.pathname === "/api/state" && request.method === "GET") {
    if (!(await requireCloudUser(request, response))) return;
    const result = await schedulerStore.loadState(request.shiftBayUser);
    if (!result.exists) {
      sendJson(response, 404, { error: "No scheduler data file has been created yet." });
      return;
    }
    sendJson(response, 200, result.payload);
    return;
  }
  if (url.pathname === "/api/state" && (request.method === "PUT" || request.method === "POST")) {
    if (!(await requireCloudEditor(request, response))) return;
    try {
      const rawBody = await readRequestBody(request);
      const parsed = JSON.parse(rawBody);
      const result = await schedulerStore.saveState(parsed, request.shiftBayUser || null);
      if (result.stale) {
        sendJson(response, 409, {
          error: "Rejected stale scheduler data. Refresh the app to load the latest shared file.",
          incomingUpdatedAt: result.incomingUpdatedAt,
          existingUpdatedAt: result.existingUpdatedAt
        });
        return;
      }
      sendJson(response, 200, { ok: true, savedAt: result.savedAt || new Date().toISOString() });
    } catch (error) {
      sendJson(response, 400, { error: error.message || "Could not save scheduler data." });
    }
    return;
  }
  if (url.pathname === "/api/audit/recent" && request.method === "GET") {
    if (!(await requireCloudUser(request, response))) return;
    if (typeof schedulerStore.recentAuditEvents !== "function") {
      sendJson(response, 404, { error: "Recent cloud activity is not available in local JSON mode." });
      return;
    }
    try {
      const rows = await schedulerStore.recentAuditEvents(50, request.shiftBayUser);
      const emailCache = new Map();
      const events = await Promise.all((Array.isArray(rows) ? rows : []).map(async (row) => {
        const details = row.details || {};
        let email = details.savedByEmail || "";
        if (!email && row.user_id) {
          if (!emailCache.has(row.user_id)) emailCache.set(row.user_id, await userEmailById(row.user_id));
          email = emailCache.get(row.user_id) || "";
        }
        return { ...row, user_email: email };
      }));
      sendJson(response, 200, { ok: true, events });
    } catch (error) {
      sendJson(response, error.status || 400, { error: error.message || "Could not load recent cloud activity." });
    }
    return;
  }
  if (url.pathname === "/api/parse-time-off-pdf" && request.method === "POST") {
    try {
      const rawBody = await readRequestBody(request);
      const parsed = JSON.parse(rawBody);
      const result = await parseTimeOffPdfPayload(parsed);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { error: error.message || "Could not parse request-off PDF." });
    }
    return;
  }
  sendJson(response, 404, { error: "Unknown API endpoint." });
}

const server = http.createServer((request, response) => {
  if (request.url.startsWith("/api/")) {
    handleApi(request, response);
    return;
  }
  serveStatic(request, response);
});

ensureDataFolders();
server.listen(PORT, HOST, () => {
  console.log(`Shift Bay is running at http://localhost:${PORT}`);
  console.log(`Listening on ${HOST}. Set HOST=0.0.0.0 only when another computer must connect to this server directly.`);
  console.log(`Data file: ${DATA_FILE}`);
});
