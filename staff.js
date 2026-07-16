const STAFF_SESSION_KEY = "shiftBay.staffSession.v1";
const MANAGER_SESSION_KEY = "shiftBay.supabaseSession.v1";
const SELECTED_LOCATION_KEY = "shiftBay.selectedLocationId.v1";
const LEGACY_SELECTED_LOCATION_KEY = "shiftBay.selectedLocationId";
const DEMO_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";
const STAFF_CONFIG = window.SHIFT_BAY_CONFIG || {};
const STAFF_API_BASE = String(STAFF_CONFIG.apiBase || "").replace(/\/$/, "");

const loginCard = document.getElementById("loginCard");
const staffApp = document.getElementById("staffApp");
const loginForm = document.getElementById("staffLoginForm");
const loginMessage = document.getElementById("staffLoginMessage");
const staffIdentity = document.getElementById("staffIdentity");
const staffStatus = document.getElementById("staffStatus");
const staffScheduleList = document.getElementById("staffScheduleList");
const signOutButton = document.getElementById("staffSignOut");
const demoPreviewCard = document.getElementById("demoPreviewCard");
const demoEmployeeSelect = document.getElementById("demoEmployeeSelect");
const demoPreviewButton = document.getElementById("demoPreviewButton");

let demoState = null;

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  if (STAFF_API_BASE && path.startsWith("/api/")) return `${STAFF_API_BASE}${path.slice(4)}`;
  return path;
}

function selectedLocationId() {
  return String(localStorage.getItem(SELECTED_LOCATION_KEY) || localStorage.getItem(LEGACY_SELECTED_LOCATION_KEY) || STAFF_CONFIG.locationId || "").trim();
}

function setMessage(message) {
  loginMessage.hidden = !message;
  loginMessage.textContent = message || "";
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(STAFF_SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function readManagerSession() {
  try {
    return JSON.parse(localStorage.getItem(MANAGER_SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function writeSession(session) {
  if (session) localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(STAFF_SESSION_KEY);
}

async function fetchWithSession(path, session, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const locationId = selectedLocationId();
  if (locationId) headers["x-shift-bay-location-id"] = locationId;
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const response = await fetch(apiUrl(path), { ...options, headers });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error || body.message || `Request failed with ${response.status}.`);
  return body;
}

async function staffFetch(path, options = {}) {
  return fetchWithSession(path, readSession(), options);
}

async function signIn(email, password) {
  const locationId = selectedLocationId();
  const headers = locationId ? { "x-shift-bay-location-id": locationId } : {};
  const response = await fetch(apiUrl("/api/staff/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.error || "Could not sign in.");
  writeSession(body.session);
  return body.profile || body;
}

function showSignedOut() {
  loginCard.hidden = false;
  staffApp.hidden = true;
  setMessage("");
}

function showSignedIn(profile) {
  loginCard.hidden = true;
  staffApp.hidden = false;
  const email = profile?.user?.email || "Signed in";
  const displayName = profile?.account?.display_name || "";
  staffIdentity.textContent = displayName ? `${displayName} (${email})` : email;
  staffStatus.classList.toggle("is-ready", Boolean(profile?.linked));
  if (!profile?.schemaReady) {
    staffStatus.textContent = "Staff portal database tables are not active yet. The login shell is ready, but staff requests cannot be saved until the schema is installed.";
  } else if (!profile?.linked) {
    staffStatus.textContent = "This login is not linked to an employee profile yet. A manager will need to connect it before the staff portal can show schedule details.";
  } else {
    staffStatus.textContent = "Staff profile linked. Schedule, request-off, and availability tools can be enabled next.";
  }
  renderScheduleList([]);
}

function roleNameById(roleId) {
  return (demoState?.roles || []).find((role) => role.id === roleId)?.name || "Shift";
}

function employeeName(employee) {
  return [employee?.nickname || employee?.firstName, employee?.lastName].filter(Boolean).join(" ").trim() || "Employee";
}

function formatShiftLine(shift) {
  const role = roleNameById(shift.roleId);
  const date = shift.date || "";
  const time = [shift.start, shift.end].filter(Boolean).join(" - ");
  return `${date} | ${role}${time ? ` | ${time}` : ""}`;
}

function renderScheduleList(shifts) {
  if (!staffScheduleList) return;
  if (!shifts.length) {
    staffScheduleList.innerHTML = "<p>No upcoming shifts are available in this preview yet.</p>";
    return;
  }
  staffScheduleList.innerHTML = shifts
    .map((shift) => `<div class="staff-shift-row"><strong>${roleNameById(shift.roleId)}</strong><span>${shift.date || ""}</span><span>${[shift.start, shift.end].filter(Boolean).join(" - ")}</span></div>`)
    .join("");
}

function showDemoPreview(employee) {
  const shifts = (demoState?.shifts || [])
    .filter((shift) => shift.employeeId === employee.id)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.start || "").localeCompare(String(b.start || "")));
  loginCard.hidden = true;
  staffApp.hidden = false;
  staffIdentity.textContent = `${employeeName(employee)} (demo preview)`;
  staffStatus.classList.add("is-ready");
  staffStatus.textContent = "Demo staff preview. This is using fake sandbox data and does not require a real staff login.";
  renderScheduleList(shifts);
}

function normalizeStateEnvelope(envelope) {
  return envelope?.data || envelope?.state || envelope || {};
}

async function loadDemoPreviewOptions() {
  if (!demoPreviewCard || selectedLocationId() !== DEMO_LOCATION_ID) return;
  const managerSession = readManagerSession();
  if (!managerSession?.access_token) return;
  try {
    const envelope = await fetchWithSession("/api/state", managerSession, { cache: "no-store" });
    demoState = normalizeStateEnvelope(envelope);
    const employees = (demoState.employees || [])
      .filter((employee) => employee.active !== false && !employee.archived)
      .sort((a, b) => employeeName(a).localeCompare(employeeName(b)));
    if (!employees.length) return;
    demoEmployeeSelect.innerHTML = employees.map((employee) => `<option value="${employee.id}">${employeeName(employee)}</option>`).join("");
    demoPreviewCard.hidden = false;
  } catch (error) {
    demoPreviewCard.hidden = false;
    demoPreviewCard.innerHTML = `<h2>Demo Staff Preview</h2><p>Open the demo location in the manager app first, then return here to preview a fake staff member.</p>`;
  }
}

async function loadStaffProfile() {
  const session = readSession();
  if (!session?.access_token) {
    showSignedOut();
    return;
  }
  try {
    const profile = await staffFetch("/api/staff/me");
    showSignedIn(profile);
  } catch (error) {
    writeSession(null);
    showSignedOut();
    setMessage(error.message || "Please sign in again.");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  const email = document.getElementById("staffEmail").value.trim();
  const password = document.getElementById("staffPassword").value;
  try {
    await signIn(email, password);
    await loadStaffProfile();
  } catch (error) {
    setMessage(error.message || "Could not sign in.");
  }
});

signOutButton.addEventListener("click", () => {
  writeSession(null);
  showSignedOut();
  loadDemoPreviewOptions();
});

demoPreviewButton?.addEventListener("click", () => {
  const employee = (demoState?.employees || []).find((item) => item.id === demoEmployeeSelect.value);
  if (employee) showDemoPreview(employee);
});

loadStaffProfile().then(loadDemoPreviewOptions);
