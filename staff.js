const STAFF_SESSION_KEY = "shiftBay.staffSession.v1";
const MANAGER_SESSION_KEY = "shiftBay.supabaseSession.v1";
const SELECTED_LOCATION_KEY = "shiftBay.selectedLocationId.v1";
const LEGACY_SELECTED_LOCATION_KEY = "shiftBay.selectedLocationId";
const DEMO_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";
const DEMO_PORTAL_MODE = new URLSearchParams(window.location.search).get("demo") === "1";
const STAFF_CONFIG = window.SHIFT_BAY_CONFIG || {};
const STAFF_API_BASE = String(STAFF_CONFIG.apiBase || "").replace(/\/$/, "");

const loginCard = document.getElementById("loginCard");
const staffApp = document.getElementById("staffApp");
const loginForm = document.getElementById("staffLoginForm");
const loginMessage = document.getElementById("staffLoginMessage");
const staffIdentity = document.getElementById("staffIdentity");
const staffStatus = document.getElementById("staffStatus");
const staffScheduleList = document.getElementById("staffScheduleList");
const staffScheduleEmployee = document.getElementById("staffScheduleEmployee");
const staffDirectoryList = document.getElementById("staffDirectoryList");
const staffPreferredName = document.getElementById("staffPreferredName");
const staffPhoneNumber = document.getElementById("staffPhoneNumber");
const staffContactPreference = document.getElementById("staffContactPreference");
const saveStaffProfileButton = document.getElementById("saveStaffProfile");
const staffProfileMessage = document.getElementById("staffProfileMessage");
const staffVisibleProfile = document.getElementById("staffVisibleProfile");
const staffWeekTitle = document.getElementById("staffWeekTitle");
const previousWeekButton = document.getElementById("staffPreviousWeek");
const nextWeekButton = document.getElementById("staffNextWeek");
const refreshScheduleButton = document.getElementById("staffRefreshSchedule");
const saveStaffPrivacyButton = document.getElementById("saveStaffPrivacy");
const staffPrivacyMessage = document.getElementById("staffPrivacyMessage");
const signOutButton = document.getElementById("staffSignOut");
const returnManagerButton = document.getElementById("staffReturnManager");
const demoPreviewCard = document.getElementById("demoPreviewCard");
const demoEmployeeSelect = document.getElementById("demoEmployeeSelect");
const demoPreviewButton = document.getElementById("demoPreviewButton");
const demoPortalSwitcher = document.getElementById("demoPortalSwitcher");
const demoPortalEmployeeSelect = document.getElementById("demoPortalEmployeeSelect");
const demoPortalPreviewButton = document.getElementById("demoPortalPreviewButton");
const staffPasswordDialog = document.getElementById("staffPasswordDialog");
const staffPasswordForm = document.getElementById("staffPasswordForm");
const staffPasswordMessage = document.getElementById("staffPasswordMessage");
const staffRequestOffForm = document.getElementById("staffRequestOffForm");
const staffRequestMessage = document.getElementById("staffRequestMessage");
const staffRequestList = document.getElementById("staffRequestList");
const staffAvailabilityForm = document.getElementById("staffAvailabilityForm");
const staffAvailabilityMessage = document.getElementById("staffAvailabilityMessage");
const staffAvailabilityDays = document.getElementById("staffAvailabilityDays");
const staffAvailabilityWeekStart = document.getElementById("staffAvailabilityWeekStart");

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

function setWorkflowMessage(element, message) {
  if (!element) return;
  element.hidden = !message;
  element.textContent = message || "";
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
  if (demoPortalSwitcher) demoPortalSwitcher.hidden = true;
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
  renderVisibleProfile({ profile });
 setPhoneVisibility(profile?.account?.phone_visibility || "managers_only");
  if (staffPreferredName) staffPreferredName.value = profile?.account?.preferred_name || "";
  if (staffPhoneNumber) staffPhoneNumber.value = profile?.account?.phone || "";
  if (staffContactPreference) staffContactPreference.value = profile?.account?.contact_preference || "in_app";
 setPrivacyMessage("");
  const email = profile?.user?.email || "Signed in";
  const displayName = profile?.account?.display_name || "";
  staffIdentity.textContent = displayName ? `${displayName} (${email})` : email;
  if (staffScheduleEmployee) staffScheduleEmployee.textContent = displayName || profile?.employee?.displayName || "Your assigned schedule";
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
  loadStaffDirectory();
  loadStaffWorkflow();
}

function roleNameById(roleId) {
  return (demoState?.roles || []).find((role) => role.id === roleId)?.name || "Shift";
}

function employeeName(employee) {
  return [employee?.nickname || employee?.firstName, employee?.lastName].filter(Boolean).join(" ").trim() || "Employee";
}

function renderVisibleProfile({ employee = null, profile = null } = {}) {
  if (!staffVisibleProfile) return;
  const account = profile?.account || {};
  const displayName = employee ? employeeName(employee) : account.display_name || account.preferred_name || profile?.user?.email || "Employee";
  const phone = employee ? (employee.phone || account.phone || "") : account.phone || "";
  const contactPreference = account.contact_preference || "";
  const rows = [
    ["Name", displayName],
    ["Phone", phone || "Not provided"],
    ["Contact preference", contactPreference ? contactPreference.replace("_", " ") : "Not set"]
  ];
  staffVisibleProfile.innerHTML = `<div class="staff-visible-profile-heading">Information visible to you</div>${rows.map(([label, value]) => `<div class="staff-visible-profile-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}`;
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

function renderAvailabilityDays(availability = {}) {
  if (!staffAvailabilityDays) return;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  staffAvailabilityDays.innerHTML = days.map((day, index) => {
    const value = Array.isArray(availability[index])
      ? availability[index].map((range) => `${range.start || ""}-${range.end || ""}`).join(", ")
      : String(availability[index] || "");
    return `<label><span>${day}</span><input data-staff-availability-day="${index}" value="${escapeHtml(value)}" placeholder="7a-2p, 5p-10p or blank"></label>`;
  }).join("");
}

function readAvailabilityDays() {
  const availability = {};
  document.querySelectorAll("[data-staff-availability-day]").forEach((input) => {
    availability[input.dataset.staffAvailabilityDay] = input.value.trim();
  });
  return availability;
}

function renderStaffRequests(requests = []) {
  if (!staffRequestList) return;
  if (!requests.length) {
    staffRequestList.innerHTML = `<div class="staff-empty-state"><strong>No request-offs submitted</strong><span>Your submitted requests will appear here.</span></div>`;
    return;
  }
  staffRequestList.innerHTML = requests.map((request) => {
    const range = request.startDate === request.endDate ? request.startDate : `${request.startDate} - ${request.endDate}`;
    const time = request.startTime && request.endTime ? ` | ${request.startTime} - ${request.endTime}` : " | Full day";
    return `<div class="staff-workflow-row"><div><strong>${escapeHtml(range)}</strong><span>${escapeHtml(time)}</span>${request.note ? `<small>${escapeHtml(request.note)}</small>` : ""}</div><em class="staff-request-status status-${escapeHtml(request.status)}">${escapeHtml(request.status)}</em></div>`;
  }).join("");
}

async function loadStaffWorkflow() {
  if (!currentStaffProfile?.linked) return;
  try {
    const requests = await staffFetch("/api/staff/request-offs");
    renderStaffRequests(requests.requests || []);
  } catch (error) {
    setWorkflowMessage(staffRequestMessage, error.message || "Could not load request-offs.");
  }
  try {
    const weekStart = staffAvailabilityWeekStart?.value || currentStaffWeekStart || "";
    const result = await staffFetch(`/api/staff/availability${weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : ""}`);
    if (staffAvailabilityWeekStart && result.weekStart) staffAvailabilityWeekStart.value = result.weekStart;
    renderAvailabilityDays(result.availability || {});
    const note = document.getElementById("staffAvailabilityNote");
    if (note) note.value = result.note || "";
  } catch (error) {
    setWorkflowMessage(staffAvailabilityMessage, error.message || "Could not load availability.");
  }
}

function showDemoPreview(employee) {
  const shifts = (demoState?.shifts || [])
    .filter((shift) => shift.employeeId === employee.id)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.start || "").localeCompare(String(b.start || "")));
  loginCard.hidden = true;
  staffApp.hidden = false;
  if (returnManagerButton) returnManagerButton.hidden = false;
  staffIdentity.textContent = `${employeeName(employee)} (demo preview)`;
  if (staffScheduleEmployee) staffScheduleEmployee.textContent = employeeName(employee);
  if (demoEmployeeSelect) demoEmployeeSelect.value = employee.id;
  if (demoPortalEmployeeSelect) demoPortalEmployeeSelect.value = employee.id;
  renderVisibleProfile({ employee });
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
    const options = employees.map((employee) => `<option value="${employee.id}">${employeeName(employee)}</option>`).join("");
    demoEmployeeSelect.innerHTML = options;
    if (demoPortalEmployeeSelect) demoPortalEmployeeSelect.innerHTML = options;
    demoPreviewCard.hidden = false;
    if (demoPortalSwitcher) demoPortalSwitcher.hidden = !DEMO_PORTAL_MODE;
    if (DEMO_PORTAL_MODE) showDemoPreview(employees[0]);
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
    await loadStaffDirectory();
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

returnManagerButton?.addEventListener("click", () => {
  window.location.href = "index.html";
});

demoPreviewButton?.addEventListener("click", () => {
  const employee = (demoState?.employees || []).find((item) => item.id === demoEmployeeSelect.value);
  if (employee) showDemoPreview(employee);
});

demoPortalPreviewButton?.addEventListener("click", () => {
  const employee = (demoState?.employees || []).find((item) => item.id === demoPortalEmployeeSelect?.value);
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

const staffTabButtons = [...document.querySelectorAll("[data-staff-tab]")];
const staffSubtabButtons = [...document.querySelectorAll("[data-staff-subtab]")];
const staffSubtabBars = [...document.querySelectorAll("[data-staff-subtabs]")];
const staffPanels = [...document.querySelectorAll(".staff-grid > article")];

function selectStaffTab(tabName) {
  const visibleIndexes = tabName === "schedule" ? [0] : tabName === "directory" ? [3] : tabName === "information" ? [4, 5] : [1, 2];
  staffPanels.forEach((panel, index) => { panel.hidden = !visibleIndexes.includes(index); });
  staffTabButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.staffTab === tabName));
  staffSubtabBars.forEach((bar) => { bar.hidden = bar.dataset.staffSubtabs !== tabName; });
  const activeSubtab = tabName === "information" ? "profile" : tabName === "requests" ? "request-off" : "";
  if (activeSubtab) selectStaffSubtab(activeSubtab);
}

function selectStaffSubtab(subtabName) {
  staffSubtabButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.staffSubtab === subtabName));
  const visibleIndexes = subtabName === "profile" ? [4] : subtabName === "privacy" ? [5] : subtabName === "request-off" ? [1] : [2];
  staffPanels.forEach((panel, index) => {
    if (visibleIndexes.includes(index)) panel.hidden = false;
    else if (index !== 0 && index !== 3) panel.hidden = true;
  });
}

staffTabButtons.forEach((button) => button.addEventListener("click", () => selectStaffTab(button.dataset.staffTab)));
staffSubtabButtons.forEach((button) => button.addEventListener("click", () => selectStaffSubtab(button.dataset.staffSubtab)));
selectStaffTab("schedule");

staffRequestOffForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const startDate = document.getElementById("staffRequestStartDate")?.value || "";
  const endDate = document.getElementById("staffRequestEndDate")?.value || startDate;
  const startTime = document.getElementById("staffRequestStartTime")?.value || "";
  const endTime = document.getElementById("staffRequestEndTime")?.value || "";
  const note = document.getElementById("staffRequestNote")?.value || "";
  setWorkflowMessage(staffRequestMessage, "Submitting...");
  try {
    await staffFetch("/api/staff/request-offs", { method: "POST", body: JSON.stringify({ startDate, endDate, startTime, endTime, note }) });
    staffRequestOffForm.reset();
    setWorkflowMessage(staffRequestMessage, "Request submitted for manager review.");
    await loadStaffWorkflow();
  } catch (error) {
    setWorkflowMessage(staffRequestMessage, error.message || "Could not submit request-off.");
  }
});

staffAvailabilityForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const weekStart = staffAvailabilityWeekStart?.value || "";
  const note = document.getElementById("staffAvailabilityNote")?.value || "";
  setWorkflowMessage(staffAvailabilityMessage, "Saving...");
  try {
    await staffFetch("/api/staff/availability", { method: "PUT", body: JSON.stringify({ weekStart, availability: readAvailabilityDays(), note }) });
    setWorkflowMessage(staffAvailabilityMessage, "Availability submitted for manager review.");
  } catch (error) {
    setWorkflowMessage(staffAvailabilityMessage, error.message || "Could not save availability.");
  }
});

async function loadStaffDirectory() {
saveStaffProfileButton && saveStaffProfileButton.addEventListener("click", async function () { const result = await staffFetch("/api/staff/profile", { method: "PATCH", body: JSON.stringify({ preferredName: staffPreferredName ? staffPreferredName.value : "", phone: staffPhoneNumber ? staffPhoneNumber.value : "", contactPreference: staffContactPreference ? staffContactPreference.value : "in_app" }) }); if (currentStaffProfile && currentStaffProfile.account && result.profile) { currentStaffProfile.account.preferred_name = result.profile.preferredName; currentStaffProfile.account.phone = result.profile.phone; currentStaffProfile.account.contact_preference = result.profile.contactPreference; } if (staffProfileMessage) { staffProfileMessage.hidden = false; staffProfileMessage.textContent = "Profile saved."; } await loadStaffDirectory(); });
  if (!staffDirectoryList || !currentStaffProfile || !currentStaffProfile.linked) return;
  try {
    const result = await staffFetch("/api/staff/directory");
    staffDirectoryList.textContent = "";
    (result.entries || []).forEach((entry) => {
      const row = document.createElement("div");
      row.className = "staff-directory-row";
      const name = document.createElement("strong");
      name.textContent = entry.displayName || "Employee";
      const phone = document.createElement("span");
      phone.textContent = entry.phoneVisible && entry.phone ? entry.phone : "Phone hidden";
      row.append(name, phone);
      staffDirectoryList.appendChild(row);
    });
  } catch (error) {
    staffDirectoryList.textContent = String(error.message || "Could not load the staff directory.");
  }
}

loadStaffProfile().then(loadDemoPreviewOptions);
