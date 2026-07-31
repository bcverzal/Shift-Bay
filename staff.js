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
let selectedStaffAvailabilityDayIndex = 0;
const staffAvailabilityWeekStart = document.getElementById("staffAvailabilityWeekStart");
const staffAvailabilityPatternSelect = document.getElementById("staffAvailabilityPatternSelect");
const staffAvailabilityPatternName = document.getElementById("staffAvailabilityPatternName");
const staffAvailabilityRepeatWeeks = document.getElementById("staffAvailabilityRepeatWeeks");
const staffAvailabilityEffectiveDate = document.getElementById("staffAvailabilityEffectiveDate");
const staffAvailabilityPatternList = document.getElementById("staffAvailabilityPatternList");
const saveStaffAvailabilityPatternButton = document.getElementById("saveStaffAvailabilityPattern");
const deleteStaffAvailabilityPatternButton = document.getElementById("deleteStaffAvailabilityPattern");
const newStaffAvailabilityPatternButton = document.getElementById("newStaffAvailabilityPattern");
const staffLiveAvailabilitySummary = document.getElementById("staffLiveAvailabilitySummary");
const staffAvailabilityApprovalSummary = document.getElementById("staffAvailabilityApprovalSummary");
const submitStaffAvailabilityButton = document.getElementById("submitStaffAvailability");

let demoState = null;
let currentStaffWeekStart = "";
let currentStaffProfile = null;
let activeStaffTimeInput = null;

function staffAvailabilityPatternKey() {
  const account = currentStaffProfile?.account || {};
  return `shiftBay.staffAvailabilityPatterns.${account.id || account.email || "current"}`;
}

function readStaffAvailabilityPatterns() {
  try {
    const value = JSON.parse(localStorage.getItem(staffAvailabilityPatternKey()) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeStaffAvailabilityPatterns(patterns) {
  localStorage.setItem(staffAvailabilityPatternKey(), JSON.stringify(patterns.slice(0, 4)));
}

function renderStaffAvailabilityPatterns(selectedId = "") {
  const patterns = readStaffAvailabilityPatterns();
  if (staffAvailabilityPatternSelect) {
    staffAvailabilityPatternSelect.innerHTML = `<option value="">Unsaved current entries</option>${patterns.map((pattern) => `<option value="${escapeHtml(pattern.id)}">${escapeHtml(pattern.name)} - ${Number(pattern.repeatWeeks) === 1 ? "Every week" : `Every ${Number(pattern.repeatWeeks)} weeks`}</option>`).join("")}`;
    staffAvailabilityPatternSelect.value = selectedId;
  }
  const selectedPattern = patterns.find((pattern) => pattern.id === selectedId);
  const pending = ["submitted", "pending", "awaiting_approval"].includes(String(selectedPattern?.submissionStatus || "").toLowerCase());
  if (submitStaffAvailabilityButton) submitStaffAvailabilityButton.disabled = !selectedId || pending;
  if (deleteStaffAvailabilityPatternButton) deleteStaffAvailabilityPatternButton.hidden = !selectedId || pending;
  if (!staffAvailabilityPatternList) return;
  staffAvailabilityPatternList.innerHTML = patterns.length
    ? patterns.map((pattern) => { const status = String(pattern.submissionStatus || "").toLowerCase(); const statusText = ["submitted", "pending", "awaiting_approval"].includes(status) ? "Awaiting approval" : "Saved draft"; return `<button type="button" class="staff-availability-pattern-card${pattern.id === selectedId ? " selected" : ""}${statusText === "Awaiting approval" ? " pending" : ""}" data-staff-availability-pattern-id="${escapeHtml(pattern.id)}"><strong>${escapeHtml(pattern.name || "Untitled availability")}</strong><span>${statusText} · ${Number(pattern.repeatWeeks) === 1 ? "Every week" : `Every ${Number(pattern.repeatWeeks)} weeks`}${pattern.effectiveDate ? ` · starts ${escapeHtml(pattern.effectiveDate)}` : ""}</span></button>`; }).join("")
    : `<div class="staff-empty-state"><strong>No Availability Profiles saved</strong><span>Save this editor as a named profile to reuse it later.</span></div>`;
  staffAvailabilityPatternList.querySelectorAll("[data-staff-availability-pattern-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.staffAvailabilityPatternId;
      if (staffAvailabilityPatternSelect) {
        staffAvailabilityPatternSelect.value = id;
        staffAvailabilityPatternSelect.dispatchEvent(new Event("change"));
      }
    });
  });
}

function renderStaffManagerAvailability(employee = null) {
  if (!staffLiveAvailabilitySummary) return;
  const patterns = Array.isArray(employee?.availabilityPatterns)
    ? employee.availabilityPatterns.filter((pattern) => pattern && pattern.active !== false)
    : [];
  const currentDate = employee?.availabilityEffectiveDate || "";
  if (!patterns.length && !Object.keys(employee?.availability || {}).length) {
    staffLiveAvailabilitySummary.hidden = false;
    staffLiveAvailabilitySummary.innerHTML = `<div><strong>Live availability</strong><small>No approved availability has been set yet.</small></div>`;
    return;
  }
  const patternText = patterns.length
    ? patterns.map((pattern) => `<span class="staff-manager-availability-chip"><strong>${escapeHtml(pattern.name || "Approved availability")}</strong><small>${Number(pattern.repeatWeeks) === 1 ? "Every week" : `Every ${Number(pattern.repeatWeeks)} weeks`}${pattern.effectiveDate ? ` · starts ${escapeHtml(pattern.effectiveDate)}` : ""}</small></span>`).join("")
    : `<span class="staff-manager-availability-chip"><strong>Current approved availability</strong><small>${currentDate ? `Starts ${escapeHtml(currentDate)}` : "Used for scheduling"}</small></span>`;
  staffLiveAvailabilitySummary.innerHTML = `<div><strong>Live availability</strong><small>This is the availability currently used for scheduling. Saved drafts remain private until submitted and approved.</small></div><div class="staff-manager-availability-list">${patternText}</div>`;
  staffLiveAvailabilitySummary.hidden = false;
}

function renderStaffAvailabilityApproval(status = "", weekStart = "", requestId = "") {
  if (!staffAvailabilityApprovalSummary) return;
  const normalized = String(status || "").toLowerCase();
  const waiting = normalized === "submitted" || normalized === "pending";
  staffAvailabilityApprovalSummary.hidden = !waiting;
  staffAvailabilityApprovalSummary.innerHTML = waiting
    ? `<strong>Submitted weeks awaiting approval</strong><span>${weekStart ? `Week starting ${escapeHtml(weekStart)} is waiting for manager review.` : "Your submitted availability is waiting for manager review."}</span><button type="button" class="staff-small-action" data-withdraw-staff-availability="${escapeHtml(requestId)}">Withdraw submission</button>`
    : "";
  if (waiting) staffAvailabilityApprovalSummary.querySelector("[data-withdraw-staff-availability]")?.addEventListener("click", async () => {
    if (!requestId || !window.confirm("Withdraw this availability submission? It will return to your saved profiles.")) return;
    const button = staffAvailabilityApprovalSummary.querySelector("[data-withdraw-staff-availability]");
    if (button) button.disabled = true;
    try {
      await staffFetch("/api/staff/availability", { method: "PATCH", body: JSON.stringify({ requestId, status: "cancelled" }) });
      writeStaffAvailabilityPatterns(readStaffAvailabilityPatterns().map((pattern) => pattern.submissionRequestId === requestId ? { ...pattern, submissionStatus: "", submissionRequestId: "" } : pattern));
      renderStaffAvailabilityPatterns();
      renderStaffAvailabilityApproval();
      setWorkflowMessage(staffAvailabilityMessage, "Submission withdrawn. The saved availability is available to edit or delete.");
    } catch (error) {
      if (button) button.disabled = false;
      setWorkflowMessage(staffAvailabilityMessage, error.message || "Could not withdraw the submission.");
    }
  });
}

function staffTimeMinutes(value = "") {
  const match = String(value).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = String(match[3] || "").toLowerCase().replace(/\./g, "");
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function staffDisplayTime(minutes) {
  const hour24 = Math.floor(minutes / 60) % 24;
  return `${hour24 % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour24 >= 12 ? "PM" : "AM"}`;
}

function staffTimePicker() {
  let picker = document.getElementById("staffTimePicker");
  if (!picker) {
    picker = document.createElement("div");
    picker.id = "staffTimePicker";
    picker.className = "staff-time-picker";
    document.body.appendChild(picker);
    picker.addEventListener("wheel", (event) => {
      // Keep the picker open while the user scrolls through its 15-minute options.
      // The page-level scroll closer must not treat this as leaving the field.
      event.stopPropagation();
    }, { passive: true });
    document.addEventListener("mousedown", (event) => { if (!event.target.closest("#staffTimePicker") && event.target !== activeStaffTimeInput) closeStaffTimePicker(); });
    window.addEventListener("resize", closeStaffTimePicker);
    window.addEventListener("scroll", (event) => {
      if (event.target?.closest?.("#staffTimePicker")) return;
      closeStaffTimePicker();
    }, true);
  }
  return picker;
}

function attachStaffTimePicker(input) {
  if (!input || input.dataset.staffTimePickerAttached) return;
  input.dataset.staffTimePickerAttached = "true";
  input.setAttribute("autocomplete", "off");
  input.addEventListener("focus", () => openStaffTimePicker(input));
  input.addEventListener("click", () => openStaffTimePicker(input));
  input.addEventListener("keydown", (event) => { if (event.key === "Escape") closeStaffTimePicker(); });
}

function openStaffTimePicker(input) {
  activeStaffTimeInput = input;
  const picker = staffTimePicker();
  const selected = staffTimeMinutes(input.value);
  picker.innerHTML = Array.from({ length: 96 }, (_, index) => index * 15).map((minutes) => `<button type="button" class="staff-time-option${selected === minutes ? " selected" : ""}" data-staff-time-minutes="${minutes}">${staffDisplayTime(minutes)}</button>`).join("");
  picker.querySelectorAll("[data-staff-time-minutes]").forEach((button) => button.addEventListener("click", () => {
    input.value = staffDisplayTime(Number(button.dataset.staffTimeMinutes));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    closeStaffTimePicker();
  }));
  const rect = input.getBoundingClientRect();
  picker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 210))}px`;
  picker.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 300)}px`;
  picker.classList.add("open");
  picker.querySelector(".selected")?.scrollIntoView({ block: "center" });
}

function closeStaffTimePicker() {
  document.getElementById("staffTimePicker")?.classList.remove("open");
  activeStaffTimeInput = null;
}

function wireStaffTimePickers(root = document) {
  root.querySelectorAll("[data-time-picker]").forEach(attachStaffTimePicker);
}

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
  renderStaffManagerAvailability(null);
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
  renderStaffManagerAvailability(profile?.employee);
  renderStaffAvailabilityPatterns("");
  renderStaffAvailabilityWorkspace(profile?.employee?.availability || {});
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
    const ranges = Array.isArray(availability[index])
      ? availability[index]
      : String(availability[index] || "").split(",").map((value) => {
        const [start, end] = value.trim().split("-");
        return { start, end };
      }).filter((range) => range.start && range.end);
    const windowMarkup = (ranges.length ? ranges : [{}]).map((range, windowIndex) => `<div class="staff-availability-window" data-staff-availability-window="${windowIndex}">
      <label><span>Start</span><input type="text" data-time-picker data-staff-availability-day="${index}" data-staff-availability-slot="${windowIndex}" value="${escapeHtml(staffDisplayValue(range.start))}" placeholder="Not available" aria-label="${day} window ${windowIndex + 1} start time; leave blank if unavailable"></label>
      <span class="staff-availability-time-separator" aria-hidden="true">to</span>
      <label><span>End</span><input type="text" data-time-picker data-staff-availability-day="${index}" data-staff-availability-end-slot="${windowIndex}" value="${escapeHtml(staffDisplayValue(range.end))}" placeholder="Not available" aria-label="${day} window ${windowIndex + 1} end time; leave blank if unavailable"></label>
      ${windowIndex > 0 ? `<button type="button" class="staff-small-action staff-remove-window" data-remove-staff-window="${index}" aria-label="Remove ${day} window ${windowIndex + 1}" title="Remove this availability window">&times;</button>` : ""}
    </div>`).join("");
    return `<div class="staff-availability-day" data-staff-availability-row="${index}">
      <strong>${day}</strong>
      <div class="staff-availability-window-list">${windowMarkup}<button type="button" class="staff-add-window" data-add-staff-window="${index}">+ Add another time</button></div>
      <small class="staff-availability-help">Leave both times blank for no availability.</small>
      <div class="staff-availability-presets" aria-label="${day} availability presets">
        <button type="button" class="staff-small-action" data-staff-availability-preset="open" data-staff-availability-day="${index}">Open</button>
        <button type="button" class="staff-small-action" data-staff-availability-preset="am" data-staff-availability-day="${index}">AM</button>
        <button type="button" class="staff-small-action" data-staff-availability-preset="pm" data-staff-availability-day="${index}">PM</button>
        <button type="button" class="staff-small-action" data-staff-availability-preset="unavailable" data-staff-availability-day="${index}">Unavailable</button>
      </div>
    </div>`;
  }).join("");
  staffAvailabilityDays.querySelectorAll("[data-staff-availability-preset]").forEach((button) => {
      button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const day = button.dataset.staffAvailabilityDay;
      const row = staffAvailabilityDays.querySelector(`[data-staff-availability-row="${day}"]`);
      const window = row?.querySelector(".staff-availability-window");
      const values = { open: ["00:00", "23:59"], unavailable: ["", ""], am: ["07:00", "15:00"], pm: ["15:00", "23:59"] };
      if (window) {
        const [start, end] = values[button.dataset.staffAvailabilityPreset] || ["", ""];
        window.querySelector('[data-staff-availability-slot]')?.setAttribute("value", staffDisplayValue(start));
        window.querySelector('[data-staff-availability-slot]') && (window.querySelector('[data-staff-availability-slot]').value = staffDisplayValue(start));
        window.querySelector('[data-staff-availability-end-slot]') && (window.querySelector('[data-staff-availability-end-slot]').value = staffDisplayValue(end));
        row.querySelectorAll(".staff-availability-window").forEach((extra, index) => { if (index > 0) extra.remove(); });
      }
    });
  });
  staffAvailabilityDays.querySelectorAll("[data-add-staff-window]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".staff-availability-day");
      if (!row || row.querySelectorAll(".staff-availability-window").length >= 4) return;
      const day = button.dataset.addStaffWindow;
      const windowIndex = row.querySelectorAll(".staff-availability-window").length;
      button.insertAdjacentHTML("beforebegin", `<div class="staff-availability-window" data-staff-availability-window="${windowIndex}"><label><span>Start</span><input type="text" data-time-picker data-staff-availability-day="${day}" data-staff-availability-slot="${windowIndex}" aria-label="${days[day]} window ${windowIndex + 1} start time"></label><span class="staff-availability-time-separator" aria-hidden="true">to</span><label><span>End</span><input type="text" data-time-picker data-staff-availability-day="${day}" data-staff-availability-end-slot="${windowIndex}" aria-label="${days[day]} window ${windowIndex + 1} end time"></label><button type="button" class="staff-small-action staff-remove-window" data-remove-staff-window="${day}" aria-label="Remove ${days[day]} window ${windowIndex + 1}" title="Remove this availability window">&times;</button></div>`);
      row.querySelectorAll("[data-time-picker]").forEach(attachStaffTimePicker);
      if (row.querySelectorAll(".staff-availability-window").length >= 4) button.hidden = true;
    });
  });
  wireStaffTimePickers(staffAvailabilityDays);
  staffAvailabilityDays.querySelectorAll("[data-remove-staff-window]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".staff-availability-day");
      const window = button.closest(".staff-availability-window");
      if (!row || !window || row.querySelectorAll(".staff-availability-window").length <= 1) return;
      window.remove();
      row.querySelector("[data-add-staff-window]")?.removeAttribute("hidden");
    });
  });
}

function renderStaffAvailabilityWorkspace(availability = {}) {
  if (!staffAvailabilityDays) return;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const selectedDay = Math.max(0, Math.min(6, Number(selectedStaffAvailabilityDayIndex) || 0));
  const rangesFor = (index) => {
    const raw = Array.isArray(availability[index]) ? availability[index] : String(availability[index] || "").split(",").map((value) => {
      const [start, end] = value.trim().split("-");
      return { start, end };
    });
    return raw.filter((range) => range?.start && range?.end);
  };
  const summary = (ranges) => !ranges.length ? "Not available" : ranges.length > 1 ? `${ranges.length} availability windows` : `${staffDisplayValue(ranges[0].start)} to ${staffDisplayValue(ranges[0].end)}`;
  const windowMarkup = (day, index, ranges) => (ranges.length ? ranges : [{}]).map((range, windowIndex) => `<div class="staff-availability-window" data-staff-availability-window="${windowIndex}"><label><span>Start</span><input type="text" data-time-picker data-staff-availability-day="${index}" data-staff-availability-slot="${windowIndex}" value="${escapeHtml(staffDisplayValue(range.start))}" placeholder="Not available" aria-label="${day} window ${windowIndex + 1} start time"></label><span class="staff-availability-time-separator" aria-hidden="true">to</span><label><span>End</span><input type="text" data-time-picker data-staff-availability-day="${index}" data-staff-availability-end-slot="${windowIndex}" value="${escapeHtml(staffDisplayValue(range.end))}" placeholder="Not available" aria-label="${day} window ${windowIndex + 1} end time"></label>${windowIndex > 0 ? `<button type="button" class="staff-small-action staff-remove-window" data-remove-staff-window="${index}" aria-label="Remove ${day} window ${windowIndex + 1}">&times;</button>` : ""}</div>`).join("");
  const ordered = [selectedDay, ...days.map((_, index) => index).filter((index) => index !== selectedDay)];
  staffAvailabilityDays.innerHTML = `<div class="staff-availability-day-toolbar"><span>Editing <strong>${days[selectedDay]}</strong></span><div class="staff-availability-shared-presets"><button type="button" class="staff-small-action" data-staff-editor-preset="open">Open</button><button type="button" class="staff-small-action" data-staff-editor-preset="am">AM</button><button type="button" class="staff-small-action" data-staff-editor-preset="pm">PM</button><button type="button" class="staff-small-action" data-staff-editor-preset="unavailable">Unavailable</button></div></div><div class="staff-availability-day-list">${ordered.map((index) => `<section class="staff-availability-day${index === selectedDay ? " selected" : ""}" data-staff-availability-row="${index}"><button type="button" class="staff-availability-day-heading" data-staff-availability-day-select="${index}"><strong>${days[index]}</strong><span>${escapeHtml(summary(rangesFor(index)))}</span></button><div class="staff-availability-day-editor"><div class="staff-availability-window-list">${windowMarkup(days[index], index, rangesFor(index))}<button type="button" class="staff-add-window" data-add-staff-window="${index}">+ Add another time</button></div><small>Leave both times blank if unavailable.</small></div></section>`).join("")}</div>`;
  staffAvailabilityDays.querySelectorAll("[data-staff-availability-day-select]").forEach((button) => button.addEventListener("click", () => {
    selectedStaffAvailabilityDayIndex = Number(button.dataset.staffAvailabilityDaySelect) || 0;
    renderStaffAvailabilityWorkspace(readAvailabilityDays());
  }));
  staffAvailabilityDays.querySelectorAll("[data-staff-editor-preset]").forEach((button) => button.addEventListener("click", () => {
    const values = { open: ["00:00", "23:59"], am: ["07:00", "15:00"], pm: ["15:00", "23:59"], unavailable: ["", ""] };
    const [start, end] = values[button.dataset.staffEditorPreset] || ["", ""];
    const row = staffAvailabilityDays.querySelector(`[data-staff-availability-row="${selectedStaffAvailabilityDayIndex}"]`);
    const window = row?.querySelector(".staff-availability-window");
    if (!window) return;
    window.querySelector("[data-staff-availability-slot]").value = staffDisplayValue(start);
    window.querySelector("[data-staff-availability-end-slot]").value = staffDisplayValue(end);
    row.querySelectorAll(".staff-availability-window").forEach((extra, index) => { if (index > 0) extra.remove(); });
    row.querySelector("[data-staff-availability-day-select] span").textContent = button.dataset.staffEditorPreset === "unavailable" ? "Not available" : button.textContent;
  }));
  staffAvailabilityDays.querySelectorAll("[data-add-staff-window]").forEach((button) => button.addEventListener("click", () => {
    const row = button.closest(".staff-availability-day");
    if (!row || row.querySelectorAll(".staff-availability-window").length >= 4) return;
    const day = button.dataset.addStaffWindow;
    const windowIndex = row.querySelectorAll(".staff-availability-window").length;
    button.insertAdjacentHTML("beforebegin", `<div class="staff-availability-window" data-staff-availability-window="${windowIndex}"><label><span>Start</span><input type="text" data-time-picker data-staff-availability-day="${day}" data-staff-availability-slot="${windowIndex}" aria-label="${days[day]} window ${windowIndex + 1} start time"></label><span class="staff-availability-time-separator">to</span><label><span>End</span><input type="text" data-time-picker data-staff-availability-day="${day}" data-staff-availability-end-slot="${windowIndex}" aria-label="${days[day]} window ${windowIndex + 1} end time"></label><button type="button" class="staff-small-action staff-remove-window" data-remove-staff-window="${day}">&times;</button></div>`);
    row.querySelectorAll("[data-time-picker]").forEach(attachStaffTimePicker);
    if (row.querySelectorAll(".staff-availability-window").length >= 4) button.hidden = true;
    wireStaffAvailabilityRemoveButtons();
  }));
  staffAvailabilityDays.querySelectorAll("[data-time-picker]").forEach(attachStaffTimePicker);
  wireStaffAvailabilityRemoveButtons();
}

function wireStaffAvailabilityRemoveButtons() {
  staffAvailabilityDays?.querySelectorAll("[data-remove-staff-window]").forEach((button) => button.addEventListener("click", () => {
    const row = button.closest(".staff-availability-day");
    const window = button.closest(".staff-availability-window");
    if (!row || !window || row.querySelectorAll(".staff-availability-window").length <= 1) return;
    window.remove();
    row.querySelector("[data-add-staff-window]")?.removeAttribute("hidden");
  }));
}

function readAvailabilityDays() {
  const availability = {};
  document.querySelectorAll("[data-staff-availability-day][data-staff-availability-slot]").forEach((input) => {
    const day = input.dataset.staffAvailabilityDay;
    const end = input.closest(".staff-availability-window")?.querySelector("[data-staff-availability-end-slot]")?.value || "";
    if (input.value && end) (availability[day] ||= []).push({ start: input.value, end });
  });
  return availability;
}

function staffNativeTime(value = "") {
  const minutes = staffTimeMinutes(value);
  return minutes == null ? "" : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function staffDisplayValue(value = "") {
  const minutes = staffTimeMinutes(value);
  return minutes == null ? "" : staffDisplayTime(minutes);
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
    const canCancel = String(request.status || "").toLowerCase() === "pending";
    return `<div class="staff-workflow-row"><div><strong>${escapeHtml(range)}</strong><span>${escapeHtml(time)}</span>${request.note ? `<small>${escapeHtml(request.note)}</small>` : ""}</div><div class="staff-workflow-actions"><em class="staff-request-status status-${escapeHtml(request.status)}">${escapeHtml(request.status)}</em>${canCancel ? `<button type="button" class="staff-small-action" data-staff-cancel-request="${escapeHtml(request.id)}">Cancel</button>` : ""}</div></div>`;
  }).join("");
  staffRequestList.querySelectorAll("[data-staff-cancel-request]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = window.confirm("Cancel this request-off? The request will remain in your history as cancelled.");
      if (!confirmed) return;
      button.disabled = true;
      setWorkflowMessage(staffRequestMessage, "Cancelling request...");
      try {
        await staffFetch("/api/staff/request-offs", { method: "PATCH", body: JSON.stringify({ requestId: button.dataset.staffCancelRequest, status: "cancelled" }) });
        setWorkflowMessage(staffRequestMessage, "Request cancelled.");
        await loadStaffWorkflow();
      } catch (error) {
        button.disabled = false;
        setWorkflowMessage(staffRequestMessage, error.message || "Could not cancel request-off.");
      }
    });
  });
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
    renderStaffAvailabilityPatterns();
    const managerAvailability = currentStaffProfile?.employee?.availability || {};
    renderStaffAvailabilityApproval(result.status || "", result.weekStart || weekStart, result.requestId || "");
    renderStaffAvailabilityWorkspace(result.status ? (result.availability || {}) : managerAvailability);
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
  if (DEMO_PORTAL_MODE) writeStaffAvailabilityPatterns(employee.availabilityPatterns || []);
  renderVisibleProfile({ employee });
  renderStaffManagerAvailability(employee);
  renderStaffAvailabilityPatterns("");
  const pendingAvailability = (employee.availabilitySubmissions || [])
    .find((submission) => ["submitted", "pending"].includes(String(submission.status || "").toLowerCase()));
  renderStaffAvailabilityApproval(pendingAvailability?.status || "", pendingAvailability?.weekStart || "", pendingAvailability?.id || "");
  renderStaffAvailabilityWorkspace(employee?.availability || {});
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
  const selectedId = staffAvailabilityPatternSelect?.value || "";
  if (!selectedId) { setWorkflowMessage(staffAvailabilityMessage, "Save and select an availability before submitting it."); return; }
  const pattern = readStaffAvailabilityPatterns().find((item) => item.id === selectedId);
  if (!pattern || ["submitted", "pending", "awaiting_approval"].includes(String(pattern.submissionStatus || "").toLowerCase())) { setWorkflowMessage(staffAvailabilityMessage, "This availability is already waiting for manager approval."); return; }
  const weekStart = staffAvailabilityWeekStart?.value || currentStaffWeekStart || "";
  const submissionWeek = staffAvailabilityEffectiveDate?.value || weekStart;
  const note = document.getElementById("staffAvailabilityNote")?.value || "";
  setWorkflowMessage(staffAvailabilityMessage, "Submitting for approval...");
  try {
    const result = await staffFetch("/api/staff/availability", { method: "PUT", body: JSON.stringify({ weekStart: submissionWeek, availability: pattern.availability || {}, note, patternId: pattern.id }) });
    writeStaffAvailabilityPatterns(readStaffAvailabilityPatterns().map((item) => item.id === selectedId ? { ...item, submissionStatus: "submitted", submissionRequestId: result.requestId || "", submittedWeekStart: submissionWeek } : item));
    renderStaffAvailabilityPatterns();
    renderStaffAvailabilityApproval("submitted", submissionWeek, result.requestId || "");
    setWorkflowMessage(staffAvailabilityMessage, "Selected availability submitted for manager review.");
  } catch (error) { setWorkflowMessage(staffAvailabilityMessage, error.message || "Could not submit availability."); }
});

saveStaffAvailabilityPatternButton?.addEventListener("click", () => {
  const name = staffAvailabilityPatternName?.value.trim() || `Availability ${readStaffAvailabilityPatterns().length + 1}`;
  const patterns = readStaffAvailabilityPatterns();
  const existing = patterns.find((pattern) => pattern.name.toLowerCase() === name.toLowerCase());
  const pattern = {
    id: existing?.id || `pattern-${Date.now()}`,
    name,
    repeatWeeks: Math.max(1, Math.min(4, Number(staffAvailabilityRepeatWeeks?.value) || 1)),
    effectiveDate: staffAvailabilityEffectiveDate?.value || currentStaffWeekStart || "",
    availability: readAvailabilityDays(),
    submissionStatus: existing?.submissionStatus || "",
    submissionRequestId: existing?.submissionRequestId || "",
    submittedWeekStart: existing?.submittedWeekStart || "",
    updatedAt: new Date().toISOString()
  };
  const next = existing
    ? patterns.map((item) => item.id === existing.id ? pattern : item)
    : [pattern, ...patterns].slice(0, 4);
  writeStaffAvailabilityPatterns(next);
  renderStaffAvailabilityPatterns(pattern.id);
  if (staffAvailabilityPatternSelect) staffAvailabilityPatternSelect.value = pattern.id;
  setWorkflowMessage(staffAvailabilityMessage, `Saved "${name}" as a private availability profile. Submit a week when you want your manager to review it.`);
});

staffAvailabilityPatternSelect?.addEventListener("change", () => {
  const pattern = readStaffAvailabilityPatterns().find((item) => item.id === staffAvailabilityPatternSelect.value);
  if (!pattern) {
    if (staffAvailabilityPatternName) staffAvailabilityPatternName.value = "";
    if (staffAvailabilityRepeatWeeks) staffAvailabilityRepeatWeeks.value = "1";
    if (staffAvailabilityEffectiveDate) staffAvailabilityEffectiveDate.value = currentStaffWeekStart || "";
    if (deleteStaffAvailabilityPatternButton) deleteStaffAvailabilityPatternButton.hidden = true;
    renderStaffAvailabilityPatterns("");
    return;
  }
  if (staffAvailabilityPatternName) staffAvailabilityPatternName.value = pattern.name;
  if (staffAvailabilityRepeatWeeks) staffAvailabilityRepeatWeeks.value = String(pattern.repeatWeeks || 1);
  if (staffAvailabilityEffectiveDate) staffAvailabilityEffectiveDate.value = pattern.effectiveDate || currentStaffWeekStart || "";
  renderStaffAvailabilityWorkspace(pattern.availability || {});
  renderStaffAvailabilityPatterns(pattern.id);
  setWorkflowMessage(staffAvailabilityMessage, `Loaded "${pattern.name}". This profile remains private until you submit a week.`);
});

newStaffAvailabilityPatternButton?.addEventListener("click", () => {
  if (staffAvailabilityPatternSelect) staffAvailabilityPatternSelect.value = "";
  if (staffAvailabilityPatternName) staffAvailabilityPatternName.value = "";
  if (staffAvailabilityRepeatWeeks) staffAvailabilityRepeatWeeks.value = "1";
  if (staffAvailabilityEffectiveDate) staffAvailabilityEffectiveDate.value = currentStaffWeekStart || "";
  if (deleteStaffAvailabilityPatternButton) deleteStaffAvailabilityPatternButton.hidden = true;
  renderStaffAvailabilityPatterns("");
  renderStaffAvailabilityWorkspace(currentStaffProfile?.employee?.availability || {});
  setWorkflowMessage(staffAvailabilityMessage, "New private availability profile ready.");
});

deleteStaffAvailabilityPatternButton?.addEventListener("click", () => {
  const id = staffAvailabilityPatternSelect?.value;
  if (!id) return;
  const pattern = readStaffAvailabilityPatterns().find((item) => item.id === id);
  if (!pattern || !window.confirm(`Delete the private availability profile "${pattern.name}"?`)) return;
  writeStaffAvailabilityPatterns(readStaffAvailabilityPatterns().filter((item) => item.id !== id));
  renderStaffAvailabilityPatterns();
  setWorkflowMessage(staffAvailabilityMessage, `Deleted "${pattern.name}".`);
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

wireStaffTimePickers();
loadStaffProfile().then(loadDemoPreviewOptions);
