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
const staffWeekTitle = document.getElementById("staffWeekTitle");
const previousWeekButton = document.getElementById("staffPreviousWeek");
const nextWeekButton = document.getElementById("staffNextWeek");
const refreshScheduleButton = document.getElementById("staffRefreshSchedule");
const saveStaffPrivacyButton = document.getElementById("saveStaffPrivacy");
const staffPrivacyMessage = document.getElementById("staffPrivacyMessage");
const signOutButton = document.getElementById("staffSignOut");
const demoPreviewCard = document.getElementById("demoPreviewCard");
const demoEmployeeSelect = document.getElementById("demoEmployeeSelect");
const demoPreviewButton = document.getElementById("demoPreviewButton");
const staffPasswordDialog = document.getElementById("staffPasswordDialog");
const staffPasswordForm = document.getElementById("staffPasswordForm");
const staffPasswordMessage = document.getElementById("staffPasswordMessage");

let demoState = null;
let currentStaffWeekStart = "";
let currentStaffProfile = null;

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

function setPasswordMessage(message) {
  if (!staffPasswordMessage) return;
  staffPasswordMessage.hidden = !message;
  staffPasswordMessage.textContent = message || "";
}

function setPrivacyMessage(message) {
  if (!staffPrivacyMessage) return;
  staffPrivacyMessage.hidden = !message;
  staffPrivacyMessage.textContent = message || "";
}

function setPhoneVisibility(value) {
  const selected = value === "all_staff" ? "all_staff" : "managers_only";
  document.querySelectorAll("input[name=phoneVisibility]").forEach((input) => {
    input.checked = input.value === selected;
  });
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

async function changeStaffPassword(password) {
  const result = await staffFetch("/api/staff/change-password", {
    method: "POST",
    body: JSON.stringify({ password })
  });
  return result.profile || result;
}

function showPasswordDialog() {
  if (!staffPasswordDialog?.open) staffPasswordDialog?.showModal();
  setPasswordMessage("");
  document.getElementById("newStaffPassword")?.focus();
}

function hidePasswordDialog() {
  staffPasswordDialog?.close();
  if (staffPasswordForm) staffPasswordForm.reset();
  setPasswordMessage("");
}

function showSignedOut() {
  loginCard.hidden = false;
  staffApp.hidden = true;
  setMessage("");
}

function showSignedIn(profile) {
  loginCard.hidden = true;
  staffApp.hidden = false;
  if (profile?.user?.passwordChangeRequired) {
    showPasswordDialog();
  } else {
    hidePasswordDialog();
  }
  currentStaffProfile = profile;
  setPhoneVisibility(profile?.account?.phone_visibility || "managers_only");
  setPrivacyMessage("");
  const email = profile?.user?.email || "Signed in";
  const displayName = profile?.account?.display_name || "";
  staffIdentity.textContent = displayName ? `${displayName} (${email})` : email;
  staffStatus.classList.toggle("is-ready", Boolean(profile?.linked));
  if (!profile?.schemaReady) {
    staffStatus.textContent = "Staff portal database tables are not active yet. The login shell is ready, but staff requests cannot be saved until the schema is installed.";
  } else if (!profile?.linked) {
    staffStatus.textContent = "This login is not linked to an employee profile yet. A manager will need to connect it before the staff portal can show schedule details.";
  } else {
    staffStatus.textContent = "Staff profile linked. Loading your schedule...";
  }
  renderScheduleList([]);
  loadStaffSchedule();
}

function roleNameById(roleId) {
  return (demoState?.roles || []).find((role) => role.id === roleId)?.name || "Shift";
}

function employeeName(employee) {
  return [employee?.nickname || employee?.firstName, employee?.lastName].filter(Boolean).join(" ").trim() || "Employee";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[character]));
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatWeekRange(startKey, endKey) {
  if (!startKey || !endKey) return "This week";
  const start = new Date(`${startKey}T12:00:00`);
  const end = new Date(`${endKey}T12:00:00`);
  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function formatStaffDate(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
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
    staffScheduleList.innerHTML = "<div class=\"staff-empty-state\"><strong>No shifts scheduled</strong><span>This week is currently clear.</span></div>";
    return;
  }
  const grouped = new Map();
  shifts.forEach((shift) => {
    if (!grouped.has(shift.date)) grouped.set(shift.date, []);
    grouped.get(shift.date).push(shift);
  });
  staffScheduleList.innerHTML = [...grouped.entries()].map(([date, dayShifts]) => `
    <section class="staff-day-group">
      <h3>${escapeHtml(formatStaffDate(date))}</h3>
      ${dayShifts.map((shift) => {
        const flags = [shift.isCloser ? "Closer" : "", shift.isFlexDouble ? "Flex" : "", shift.isLunchCloser ? "Lunch closer" : ""].filter(Boolean);
        return `<div class="staff-shift-row">
          <div><strong>${escapeHtml(shift.role)}</strong>${shift.department ? `<small>${escapeHtml(shift.department)}</small>` : ""}</div>
          <span>${escapeHtml([shift.start, shift.end].filter(Boolean).join(" - ") || "Time to be posted")}</span>
          ${flags.length ? `<em>${escapeHtml(flags.join(" · "))}</em>` : ""}
        </div>`;
      }).join("")}
    </section>`).join("");
}

async function loadStaffSchedule() {
  if (!readSession()?.access_token || !currentStaffProfile?.linked) return;
  try {
    const query = currentStaffWeekStart ? `?weekStart=${encodeURIComponent(currentStaffWeekStart)}` : "";
    const result = await staffFetch(`/api/staff/schedule${query}`);
    currentStaffWeekStart = result.weekStart || currentStaffWeekStart;
    if (staffWeekTitle) staffWeekTitle.textContent = formatWeekRange(result.weekStart, result.weekEnd);
    renderScheduleList(result.shifts || []);
    staffStatus.classList.add("is-ready");
    staffStatus.textContent = "Your schedule is up to date. Request-off and availability tools will appear here as they are enabled.";
  } catch (error) {
    staffStatus.classList.remove("is-ready");
    staffStatus.textContent = error.message || "Could not load your schedule.";
  }
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
  renderScheduleList(shifts.map((shift) => ({
    ...shift,
    role: roleNameById(shift.roleId),
    department: shift.department || "",
    isCloser: Boolean(shift.isCloser),
    isFlexDouble: Boolean(shift.isFlexDouble),
    isLunchCloser: Boolean(shift.isLunchCloser)
  })));
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

staffPasswordDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
});

staffPasswordForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("newStaffPassword")?.value || "";
  const confirm = document.getElementById("confirmStaffPassword")?.value || "";
  if (password.length < 8) {
    setPasswordMessage("Use at least 8 characters.");
    return;
  }
  if (password !== confirm) {
    setPasswordMessage("The passwords do not match.");
    return;
  }
  const button = document.getElementById("staffPasswordSubmit");
  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }
  try {
    setPasswordMessage("Saving password...");
    await changeStaffPassword(password);
    hidePasswordDialog();
    await loadStaffProfile();
  } catch (error) {
    setPasswordMessage(error.message || "Could not save password.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Save Password";
    }
  }
});

signOutButton.addEventListener("click", () => {
  writeSession(null);
  currentStaffProfile = null;
  currentStaffWeekStart = "";
  hidePasswordDialog();
  showSignedOut();
  loadDemoPreviewOptions();
});

demoPreviewButton?.addEventListener("click", () => {
  const employee = (demoState?.employees || []).find((item) => item.id === demoEmployeeSelect.value);
  if (employee) showDemoPreview(employee);
});

previousWeekButton?.addEventListener("click", () => {
  if (!currentStaffWeekStart) return;
  currentStaffWeekStart = addDays(currentStaffWeekStart, -7);
  loadStaffSchedule();
});

nextWeekButton?.addEventListener("click", () => {
  if (!currentStaffWeekStart) return;
  currentStaffWeekStart = addDays(currentStaffWeekStart, 7);
  loadStaffSchedule();
});

refreshScheduleButton?.addEventListener("click", () => loadStaffSchedule());

saveStaffPrivacyButton?.addEventListener("click", async () => {
  const selected = document.querySelector("input[name=phoneVisibility]:checked")?.value || "managers_only";
  saveStaffPrivacyButton.disabled = true;
  setPrivacyMessage("Saving...");
  try {
    const result = await staffFetch("/api/staff/privacy", {
      method: "PATCH",
      body: JSON.stringify({ phoneVisibility: selected })
    });
    if (currentStaffProfile?.account) currentStaffProfile.account.phone_visibility = result.phoneVisibility || selected;
    setPhoneVisibility(result.phoneVisibility || selected);
    setPrivacyMessage("Privacy setting saved.");
  } catch (error) {
    setPrivacyMessage(error.message || "Could not save privacy setting.");
  } finally {
    saveStaffPrivacyButton.disabled = false;
  }
});

loadStaffProfile().then(loadDemoPreviewOptions);
