const STORE_KEY = "restaurantScheduler.v1";
const CLOUD_RECOVERY_KEY = `${STORE_KEY}.cloudRecovery`;
const STAFF_RESET_KEY = "restaurantScheduler.staffReset.20260611";
const FOH_TEMPLATE_SEED_KEY = "restaurantScheduler.fohTemplateSeed.20260611";
const ACTIVE_WEEK_KEY = "restaurantScheduler.activeWeek.v1";
const AUTH_SESSION_KEY = "shiftBay.supabaseSession.v1";
const SELECTED_LOCATION_KEY = "shiftBay.selectedLocationId.v1";
const DEMO_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";
const COLLAPSED_ROLE_GROUPS_KEY = "restaurantScheduler.collapsedRoleGroups.v1";
const EXPANDED_TEMPLATE_SETS_KEY = "restaurantScheduler.expandedTemplateSets.v1";
const COLLAPSED_TEMPLATE_DAYS_KEY = "restaurantScheduler.collapsedTemplateDays.v1";
const DISMISSED_ISSUES_KEY = "restaurantScheduler.dismissedIssues.v1";
const COLLAPSED_SETTINGS_SECTIONS_KEY = "restaurantScheduler.collapsedSettingsSections.v1";
const DAY_FOCUS_SHOW_OPEN_KEY = "restaurantScheduler.dayFocusShowOpen.v1";
const DAY_FOCUS_SORT_KEY = "restaurantScheduler.dayFocusSort.v1";
const DATA_SCHEMA_VERSION = 2;
const PUBLIC_CONFIG = window.SHIFT_BAY_CONFIG || {};
const HOSTED_API_BASE = String(PUBLIC_CONFIG.apiBase || "").replace(/\/$/, "");
const LOCAL_TEST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const IS_LOCAL_TEST_HOST = LOCAL_TEST_HOSTS.has(location.hostname);
const SERVER_STORAGE_ENABLED = (location.protocol === "http:" || location.protocol === "https:") &&
  (!IS_LOCAL_TEST_HOST || PUBLIC_CONFIG.enableCloudOnLocal === true);
const NORMALIZED_QUERY = new URLSearchParams(window.location.search);
const NORMALIZED_EMPLOYEE_SHADOW_MODE = NORMALIZED_QUERY.get("normalizedEmployees") === "shadow";
const NORMALIZED_SCHEDULE_SHADOW_MODE = NORMALIZED_QUERY.get("normalizedSchedule") === "shadow";
const NORMALIZED_AVAILABILITY_SHADOW_MODE = NORMALIZED_QUERY.get("normalizedAvailability") === "shadow";
const NORMALIZED_SCHEDULE_MODE = NORMALIZED_QUERY.get("normalizedSchedule");
// The compatibility snapshot remains the proven scheduler source. Normalized
// schedule records stay behind an explicit URL opt-in during cutover.
const LEGACY_SNAPSHOT_OVERRIDE = NORMALIZED_QUERY.get("legacySnapshot") === "1";
const NORMALIZED_AVAILABILITY_READ_MODE = !LEGACY_SNAPSHOT_OVERRIDE && !NORMALIZED_AVAILABILITY_SHADOW_MODE && NORMALIZED_QUERY.get("normalizedAvailability") !== "legacy";
const NORMALIZED_SCHEDULE_READ_MODE = !LEGACY_SNAPSHOT_OVERRIDE && !NORMALIZED_SCHEDULE_SHADOW_MODE &&
  ["read", "direct-sandbox", "direct-sandbox-revision", "atomic-sandbox-revision"].includes(NORMALIZED_SCHEDULE_MODE);
const NORMALIZED_SCHEDULE_REVISION_CANARY_MODE = !IS_LOCAL_TEST_HOST &&
  NORMALIZED_QUERY.get("normalizedSchedule") === "direct-sandbox-revision";
const NORMALIZED_SCHEDULE_ATOMIC_CANARY_MODE = !IS_LOCAL_TEST_HOST &&
  NORMALIZED_QUERY.get("normalizedSchedule") === "atomic-sandbox-revision";
// Direct writes are a controlled Sandbox-only canary. The normal application
// continues to write the compatibility snapshot while this path is proven.
const NORMALIZED_SCHEDULE_DIRECT_WRITE_MODE = !IS_LOCAL_TEST_HOST &&
  ["direct-sandbox", "direct-sandbox-revision", "atomic-sandbox-revision"].includes(NORMALIZED_QUERY.get("normalizedSchedule"));
const NORMALIZED_LIVE_CANARY_MODE = NORMALIZED_AVAILABILITY_READ_MODE || NORMALIZED_SCHEDULE_READ_MODE;
let normalizedScheduleReadState = "off";
let normalizedAvailabilityReadState = "off";

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  if (HOSTED_API_BASE && path.startsWith("/api/")) return `${HOSTED_API_BASE}${path.slice(4)}`;
  return path;
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MEALS = ["Breakfast", "Lunch", "Dinner", "Brunch"];
const DEPARTMENTS = ["FOH", "BOH", "Exec"];
const MIN_REST_AFTER_CLOSE_HOURS = 10;
const OPENING_SHIFT_CUTOFF_MINUTES = 10 * 60;
const CLOSING_SHIFT_CUTOFF_MINUTES = 9 * 60 + 30;
const FLOOR_PLAN_NOTE_LIMIT = 30;
const FLOOR_PLAN_NOTE_EXTRA_LIMIT = 28;

let state = loadState();
let authConfig = null;
let authRequired = false;
let authSession = loadAuthSession();
let currentUser = null;
let currentLoginEmail = authSession?.email || "";
let availableLocations = [];
let selectedLocationId = loadSelectedLocationId();
const CURRENT_READ_SOURCE = LEGACY_SNAPSHOT_OVERRIDE
  ? "legacy-snapshot"
  : NORMALIZED_SCHEDULE_ATOMIC_CANARY_MODE
    ? "normalized-sandbox-atomic-revision"
  : NORMALIZED_SCHEDULE_REVISION_CANARY_MODE
    ? "normalized-sandbox-direct-revision"
    : NORMALIZED_SCHEDULE_DIRECT_WRITE_MODE
    ? "normalized-sandbox-direct"
    : NORMALIZED_LIVE_CANARY_MODE
    ? "normalized"
    : "snapshot";
// A compatibility snapshot or a direct-write canary can intentionally read a
// different source from the browser's last cached schedule. Do not paint that
// cached schedule first, otherwise a shift can briefly appear in the wrong
// place before hydration replaces it with the selected source.
const DEFER_INITIAL_RENDER_FOR_READ_OVERRIDE = SERVER_STORAGE_ENABLED &&
  (LEGACY_SNAPSHOT_OVERRIDE || NORMALIZED_SCHEDULE_DIRECT_WRITE_MODE);
let initialReadSourceHydrationPending = DEFER_INITIAL_RENDER_FOR_READ_OVERRIDE;
let serverStorageReady = !SERVER_STORAGE_ENABLED;
let serverSaveTimer = null;
let serverSaveInFlight = false;
let serverSavePending = false;
let queuedMutationFingerprint = "";
let inFlightMutationFingerprint = "";
let lastConfirmedMutationFingerprint = "";
let employeeProfileSavePriority = false;
let cloudSaveBlockedByStale = false;
let authRefreshInFlight = null;
let lastKnownServerSavedAt = "";
let lastKnownServerState = null;
let cloudFreshnessCheckInFlight = false;
let skipLocalRecoveryOnce = false;
let lastKnownNormalizedScheduleRevision = null;
let storageStatus = SERVER_STORAGE_ENABLED ? "connecting" : "local";
let storageStatusDetail = SERVER_STORAGE_ENABLED ? "Connecting to shared scheduler file..." : (IS_LOCAL_TEST_HOST ? "Local test mode: this browser is not saving to the cloud." : "Using this browser's local storage.");
let currentDate = loadLocalActiveWeek(state.settings.weekStart);
let currentMonth = new Date();

function readSourceKey() {
  return `${STORE_KEY}.readSource.${selectedLocationId || "unknown"}`;
}

let selectedCell = null;
let selectedShiftId = null;
let selectedTimeOffRequestId = null;
let pendingDeleteShiftId = null;
let pendingDeleteTimeOffRequestId = null;
let clipboardShift = null;
let clipboardTimeOffRequest = null;
let undoStack = [];
let dragShiftId = null;
let dragUnassignedShiftId = null;
let dragPaint = null;
let dragScrollFrame = null;
let dragScrollVelocity = 0;
let dragGridScrollLock = null;
let mouseOpenShiftDrag = null;
let mouseAssignedShiftDrag = null;
let mouseTimeOffDrag = null;
let openShiftClickTimer = null;
let suppressNextOpenShiftClickId = null;
let selectedUnassignedShiftId = null;
let pendingDeleteUnassignedShiftId = null;
let openShiftBayRoleFocusId = "";
let draggingScheduleRoleGroupId = null;
let suppressRoleGroupClickId = null;
let lastOpenShiftPointerDownAt = 0;
let activeTimeInput = null;
let trainingPlanSuggestions = [];
let templateSuggestions = [];
let projectionsDirty = false;
let pendingTrayWarning = null;
let issueCursor = -1;
let issuePopoverOpen = false;
let scheduleReturnContext = null;
let gridFiltersStayOpen = false;
let gridFiltersChangedWhileOpen = false;
let recentActivityDetailsVisible = false;
let recentActivityEvents = [];
let focusedDateKey = "";
let dayFocusTimelineDrag = null;
let dayFocusShowOpenShifts = loadDayFocusShowOpenShifts();
let dayFocusSortMode = loadDayFocusSortMode();
let dayFocusExpandedEligibleShiftIds = new Set();
let employeeWeeklyAvailabilityWeekKey = "";
let selectedAvailabilityPatternId = "";
let selectedAvailabilityDayIndex = 0;
let availabilityEditingPatternId = "";
let availabilitySaveRequested = false;
let submitAvailabilityPatternRequested = false;
let deactivateAvailabilityPatternRequested = false;
let employeeFormCleanSnapshot = "";
let employeeFormDirty = false;
let employeeFormHydrating = false;
let employeeNewProfileDraft = false;
const collapsedScheduleRoleGroups = loadCollapsedScheduleRoleGroups();
const expandedTemplateSets = loadExpandedTemplateSets();
const collapsedTemplateDays = loadCollapsedTemplateDays();
let dismissedScheduleIssues = loadDismissedScheduleIssues();

const $ = (id) => document.getElementById(id);

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function loadDayFocusShowOpenShifts() {
  try {
    const saved = localStorage.getItem(DAY_FOCUS_SHOW_OPEN_KEY);
    return saved == null ? true : saved === "true";
  } catch {
    return true;
  }
}

function saveDayFocusShowOpenShifts() {
  try {
    localStorage.setItem(DAY_FOCUS_SHOW_OPEN_KEY, String(dayFocusShowOpenShifts));
  } catch {
    // Display preference only.
  }
}

function loadDayFocusSortMode() {
  try {
    const saved = localStorage.getItem(DAY_FOCUS_SORT_KEY);
    return saved === "alpha" ? "alpha" : "start";
  } catch {
    return "start";
  }
}

function saveDayFocusSortMode() {
  try {
    localStorage.setItem(DAY_FOCUS_SORT_KEY, dayFocusSortMode);
  } catch {
    // Display preference only.
  }
}
function getDeviceId() {
  const key = "restaurantScheduler.deviceId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = uid("device");
    localStorage.setItem(key, id);
  }
  return id;
}

function loadLocalActiveWeek(weekStart) {
  const deviceWeek = state?.localPreferences?.[getDeviceId()]?.activeWeek;
  if (SERVER_STORAGE_ENABLED && deviceWeek && /^\d{4}-\d{2}-\d{2}$/.test(deviceWeek)) {
    return startOfWeek(parseDateKey(deviceWeek), weekStart);
  }
  const latestSharedWeek = latestSharedActiveWeek();
  if (SERVER_STORAGE_ENABLED && latestSharedWeek) {
    return startOfWeek(parseDateKey(latestSharedWeek), weekStart);
  }
  try {
    const saved = localStorage.getItem(ACTIVE_WEEK_KEY);
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
      return startOfWeek(parseDateKey(saved), weekStart);
    }
  } catch {
    // Fall back to this week if local storage is unavailable.
  }
  if (deviceWeek && /^\d{4}-\d{2}-\d{2}$/.test(deviceWeek)) {
    return startOfWeek(parseDateKey(deviceWeek), weekStart);
  }
  return startOfWeek(new Date(), weekStart);
}

function latestSharedActiveWeek() {
  const preferences = Object.values(state?.localPreferences || {})
    .filter((item) => item?.activeWeek && /^\d{4}-\d{2}-\d{2}$/.test(item.activeWeek))
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
  return preferences[0]?.activeWeek || "";
}

function saveLocalActiveWeek(options = {}) {
  try {
    localStorage.setItem(ACTIVE_WEEK_KEY, formatDateKey(currentDate));
  } catch {
    // The schedule still works if the browser refuses local storage.
  }
  state.localPreferences = state.localPreferences || {};
  state.localPreferences[getDeviceId()] = {
    ...(state.localPreferences[getDeviceId()] || {}),
    activeWeek: formatDateKey(currentDate),
    updatedAt: nowIso(),
    updatedBy: currentSaveActor()
  };
  if (options.shared && SERVER_STORAGE_ENABLED && serverStorageReady) {
    saveState();
  }
}

function loadCollapsedScheduleRoleGroups() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_ROLE_GROUPS_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedScheduleRoleGroups() {
  try {
    localStorage.setItem(COLLAPSED_ROLE_GROUPS_KEY, JSON.stringify([...collapsedScheduleRoleGroups]));
  } catch {
    // Collapsing still works for this session if local storage is unavailable.
  }
}

function loadExpandedTemplateSets() {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPANDED_TEMPLATE_SETS_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function saveExpandedTemplateSets() {
  try {
    localStorage.setItem(EXPANDED_TEMPLATE_SETS_KEY, JSON.stringify([...expandedTemplateSets]));
  } catch {
    // Template expansion still works for this session if local storage is unavailable.
  }
}

function loadCollapsedTemplateDays() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_TEMPLATE_DAYS_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedTemplateDays() {
  try {
    localStorage.setItem(COLLAPSED_TEMPLATE_DAYS_KEY, JSON.stringify([...collapsedTemplateDays]));
  } catch {
    // Day collapse still works for this session if local storage is unavailable.
  }
}

function templateDayCollapseKey(templateId, dayIndex) {
  return `${templateId}:${Number(dayIndex)}`;
}

function setCurrentWeek(date, options = {}) {
  currentDate = startOfWeek(date, state.settings.weekStart);
  saveLocalActiveWeek({ shared: options.shared !== false });
}

function defaultState() {
  const roles = [
    { id: uid("role"), name: "Server", department: "FOH", color: "#2563eb", defaultRate: 0 },
    { id: uid("role"), name: "Host", department: "FOH", color: "#059669", defaultRate: 0 },
    { id: uid("role"), name: "Busser", department: "FOH", color: "#7c3aed", defaultRate: 0 },
    { id: uid("role"), name: "Bartender", department: "FOH", color: "#db2777", defaultRate: 0 },
    { id: uid("role"), name: "Expo", department: "FOH", color: "#ea580c", defaultRate: 0 },
    { id: uid("role"), name: "Banquet Server", department: "FOH", color: "#0891b2", defaultRate: 0 },
    { id: uid("role"), name: "BOH Block", department: "BOH", color: "#64748b", defaultRate: 0 },
    { id: uid("role"), name: "Manager", department: "Exec", color: "#b45309", defaultRate: 0 }
  ];
  const roleByName = Object.fromEntries(roles.map((role) => [role.name, role.id]));
  return {
    meta: {
      schemaVersion: DATA_SCHEMA_VERSION,
      documentId: uid("scheduleData"),
      deviceId: getDeviceId(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    },
    settings: {
      weekStart: 2,
      nameDisplay: "full",
      visibleDepartments: ["FOH"],
      visibleRoleIds: [],
      groupEmployeesByRole: false,
      hideUnavailableEmployees: false,
      showUnavailablePanel: false,
      showWeeklyRoleSummary: true,
      hideDefaultAvailabilityBlocks: false,
      employeeRosterCollapsed: false,
      openShiftBaySort: "meal",
      scheduleRoleOrder: [],
      printRoleOrder: [],
      problemFocusMode: false,
      ignoreWarnings: false,
      showUntilVolumeInShiftEditor: false,
      showShiftNameFields: false,
      autoSetCloserEndTime: true,
      closerEndBufferMinutes: 60,
      floorPlanCleanupMinutes: 90,
      flexDoubleEndTime: "7:00 PM",
      lunchCloserEndTime: "5:00 PM",
      closerTrainingRule: "onePerDay",
      scheduleZoom: 1,
      dragScrollSpeed: 5,
      staffingBuffer: 1,
      mealPeriods: defaultMealPeriods(),
      defaultCoverage: {},
      closerRequirements: defaultCloserRequirements(),
      projectionRules: {},
      floorPlanPrintRules: defaultFloorPlanPrintRules(),
      floorPlanCrossRoleNotes: defaultFloorPlanNoteSettings(roles),
      trainingRequirements: {}
    },
    roles,
    employees: [],
    templates: [],
    shifts: [],
    unassignedShifts: [],
    salesProjections: {},
    timeOffRequests: [],
    dailyNotes: {},
    coverageRequirements: {},
    scheduleHistory: [],
    localPreferences: {}
  };
}

function defaultMealPeriods() {
  const normal = [
    { name: "Breakfast", start: "7:00 AM", end: "10:30 AM" },
    { name: "Lunch", start: "10:30 AM", end: "4:00 PM" },
    { name: "Dinner", start: "4:00 PM", end: "10:00 PM" }
  ];
  const periods = {};
  DAYS.forEach((_, index) => {
    periods[index] = index === 0
      ? [
          { name: "Brunch", start: "8:00 AM", end: "1:30 PM" },
          { name: "Dinner", start: "4:00 PM", end: "10:00 PM" }
        ]
      : normal.map((period) => ({ ...period }));
  });
  return periods;
}

function defaultFloorPlanPrintRules() {
  return {
    0: ["am", "pm"],
    1: ["all"],
    2: ["all"],
    3: ["all"],
    4: ["all"],
    5: ["am", "pm"],
    6: ["am", "pm"]
  };
}

function defaultFloorPlanNoteSettings(roles = null) {
  const sourceRoles = roles || state?.roles || [];
  const settings = {};
  sourceRoles.filter((role) => role.department === "FOH").forEach((role) => {
    settings[role.id] = role.name !== "Expo";
  });
  return settings;
}

function defaultCloserRequirements() {
  return {
    0: 1,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 2,
    6: 1
  };
}

function loadState() {
  const saved = localStorage.getItem(STORE_KEY);
  if (!saved) {
    const fresh = defaultState();
    applyOneTimeStaffReset(fresh);
    return fresh;
  }
  try {
    const parsed = JSON.parse(saved);
    const loaded = normalizeLoadedState(parsed);
    applyOneTimeStaffReset(loaded);
    return loaded;
  } catch {
    const fresh = defaultState();
    applyOneTimeStaffReset(fresh);
    return fresh;
  }
}

function normalizeLoadedState(parsed = {}) {
  const base = defaultState();
  const loaded = {
    ...base,
    ...parsed,
    settings: {
      ...base.settings,
      ...(parsed.settings || {}),
      mealPeriods: { ...base.settings.mealPeriods, ...(parsed.settings?.mealPeriods || {}) },
      defaultCoverage: parsed.settings?.defaultCoverage || base.settings.defaultCoverage,
      closerRequirements: parsed.settings?.closerRequirements || base.settings.closerRequirements,
      projectionRules: parsed.settings?.projectionRules || base.settings.projectionRules,
      floorPlanPrintRules: parsed.settings?.floorPlanPrintRules || base.settings.floorPlanPrintRules,
      floorPlanCrossRoleNotes: { ...base.settings.floorPlanCrossRoleNotes, ...(parsed.settings?.floorPlanCrossRoleNotes || {}) },
      trainingRequirements: parsed.settings?.trainingRequirements || base.settings.trainingRequirements
    },
    templates: normalizeTemplates(parsed.templates || base.templates),
    roles: parsed.roles || base.roles,
    employees: parsed.employees || [],
    shifts: parsed.shifts || [],
    salesProjections: parsed.salesProjections || {},
    unassignedShifts: parsed.unassignedShifts || [],
    timeOffRequests: parsed.timeOffRequests || [],
    dailyNotes: parsed.dailyNotes && typeof parsed.dailyNotes === "object" && !Array.isArray(parsed.dailyNotes)
      ? parsed.dailyNotes
      : {},
    coverageRequirements: parsed.coverageRequirements || {},
    scheduleHistory: parsed.scheduleHistory || [],
    localPreferences: parsed.localPreferences || {}
  };
  migrateState(loaded, parsed);
  ensureDefaultRoles(loaded);
  return loaded;
}

function migrateState(loadedState, parsed = {}) {
  const baseMeta = defaultState().meta;
  loadedState.meta = {
    ...baseMeta,
    ...(parsed.meta || {}),
    schemaVersion: DATA_SCHEMA_VERSION,
    deviceId: getDeviceId(),
    updatedAt: parsed.meta?.updatedAt || nowIso()
  };
  ["roles", "employees", "templates", "shifts", "unassignedShifts", "timeOffRequests", "scheduleHistory"].forEach((collection) => {
    loadedState[collection] = normalizeRecordCollection(loadedState[collection] || []);
  });
  loadedState.dailyNotes = Object.fromEntries(
    Object.entries(loadedState.dailyNotes || {})
      .map(([dateKey, note]) => [String(dateKey), String(note || "").trim()])
      .filter(([dateKey, note]) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && note)
  );
  loadedState.templates = (loadedState.templates || []).map((template) => ({
    ...template,
    shifts: normalizeRecordCollection(template.shifts || [], "templateShift")
  }));
  loadedState.employees = (loadedState.employees || []).map((employee) => ({
    ...employee,
    departments: normalizeEmployeeDepartments(employee, loadedState.roles),
    canClose: Boolean(employee.canClose),
    canLunchClose: Boolean(employee.canLunchClose),
    noDoubles: Boolean(employee.noDoubles),
    alwaysPrintFloorEndTime: Boolean(employee.alwaysPrintFloorEndTime),
    emergencyRoleIds: Array.isArray(employee.emergencyRoleIds) ? employee.emergencyRoleIds : [],
    roleMealTraining: employee.roleMealTraining && typeof employee.roleMealTraining === "object" ? employee.roleMealTraining : {}
  }));
  loadedState.shifts = (loadedState.shifts || []).map((shift) => ({
    ...shift,
    training: normalizeShiftTraining(shift.training),
    isCloser: Boolean(shift.isCloser),
    isLunchCloser: Boolean(shift.isLunchCloser),
    isFlexDouble: Boolean(shift.isFlexDouble)
  }));
  loadedState.unassignedShifts = (loadedState.unassignedShifts || []).map((shift) => ({
    ...shift,
    training: normalizeShiftTraining(shift.training),
    isCloser: Boolean(shift.isCloser),
    isLunchCloser: Boolean(shift.isLunchCloser),
    isFlexDouble: Boolean(shift.isFlexDouble)
  }));
  loadedState.templates = (loadedState.templates || []).map((template) => ({
    ...template,
    shifts: (template.shifts || []).map((shift) => ({
      ...shift,
      isCloser: Boolean(shift.isCloser),
      isLunchCloser: Boolean(shift.isLunchCloser),
      isFlexDouble: Boolean(shift.isFlexDouble)
    }))
  }));
  if (!Array.isArray(loadedState.settings.visibleRoleIds)) loadedState.settings.visibleRoleIds = [];
  if (!Array.isArray(loadedState.settings.scheduleRoleOrder)) loadedState.settings.scheduleRoleOrder = [];
  loadedState.settings.scheduleRoleOrder = normalizeScheduleRoleOrder(loadedState.settings.scheduleRoleOrder, loadedState.roles, loadedState.settings.visibleDepartments);
  if (!Array.isArray(loadedState.settings.printRoleOrder)) loadedState.settings.printRoleOrder = defaultPrintRoleOrder(loadedState.roles, loadedState.settings.visibleDepartments);
  loadedState.settings.printRoleOrder = normalizePrintRoleOrder(loadedState.settings.printRoleOrder, loadedState.roles, loadedState.settings.visibleDepartments);
  loadedState.settings.groupEmployeesByRole = Boolean(loadedState.settings.groupEmployeesByRole);
  if (!["meal", "dayTime", "role", "time"].includes(loadedState.settings.openShiftBaySort)) loadedState.settings.openShiftBaySort = "meal";
}

function normalizeShiftTraining(training = {}) {
  return {
    ...training,
    isTraining: Boolean(training?.isTraining),
    segmentEnd: normalizeTime(training?.segmentEnd || "")
  };
}

function normalizeRecordCollection(records, prefix = "record") {
  return (records || []).map((record) => ({
    ...record,
    id: record.id || uid(prefix),
    createdAt: record.createdAt || nowIso(),
    updatedAt: record.updatedAt || record.createdAt || nowIso()
  }));
}

function normalizeEmployeeDepartments(employee, roles = state?.roles || []) {
  const saved = Array.isArray(employee.departments) ? employee.departments.filter((department) => DEPARTMENTS.includes(department)) : [];
  if (saved.length) return [...new Set(saved)];
  const roleDepartments = (employee.roleTraining || [])
    .map((roleId) => roles.find((role) => role.id === roleId)?.department)
    .filter(Boolean);
  return roleDepartments.length ? [...new Set(roleDepartments)] : ["FOH"];
}

function employeeIsEmergencyOnlyForRole(employee, roleId) {
  return Boolean(employee?.emergencyRoleIds?.includes(roleId));
}

function employeeMealsForRole(employee, roleId) {
  const roleMeals = employee?.roleMealTraining?.[roleId];
  if (Array.isArray(roleMeals) && roleMeals.length) return roleMeals;
  return employee?.mealTraining || [];
}

function applyOneTimeStaffReset(loadedState) {
  if (localStorage.getItem(STAFF_RESET_KEY)) return;
  loadedState.employees = [];
  loadedState.shifts = [];
  loadedState.unassignedShifts = [];
  loadedState.timeOffRequests = [];
  localStorage.setItem(STAFF_RESET_KEY, new Date().toISOString());
}

function applyOneTimeFohTemplateSeed(loadedState) {
  if (localStorage.getItem(FOH_TEMPLATE_SEED_KEY)) return;
  const server = loadedState.roles.find((role) => role.name.toLowerCase() === "server");
  const bartender = loadedState.roles.find((role) => role.name.toLowerCase() === "bartender");
  if (!server || !bartender) return;
  const makeShift = (dayIndex, role, start, end) => ({
    id: uid("templateShift"),
    dayIndex,
    department: "FOH",
    roleId: role.id,
    start: normalizeTime(start),
    end: normalizeTime(end),
    untilVolume: false,
    color: role.color || "#2563eb"
  });
  const shifts = [
    makeShift(1, server, "6:30am", "11am"),
    makeShift(1, server, "8am", "1pm"),
    makeShift(1, server, "11am", "3pm"),
    makeShift(1, server, "11am", "3pm"),
    makeShift(1, bartender, "5pm", "8pm"),
    makeShift(1, server, "5pm", "9:30pm"),

    makeShift(2, server, "6:30am", "11am"),
    makeShift(2, server, "6:45am", "11am"),
    makeShift(2, server, "9am", "4pm"),
    makeShift(2, server, "11am", "3pm"),
    makeShift(2, server, "11am", "3pm"),
    makeShift(2, bartender, "5pm", "8pm"),
    makeShift(2, server, "5pm", "9:30pm"),

    makeShift(3, server, "6:30am", "11am"),
    makeShift(3, server, "7:30am", "11am"),
    makeShift(3, server, "8:30am", "1pm"),
    makeShift(3, server, "11am", "3pm"),
    makeShift(3, server, "11am", "3pm"),
    makeShift(3, bartender, "5pm", "8pm"),
    makeShift(3, server, "5pm", "9:30pm"),

    makeShift(4, server, "6:30am", "11am"),
    makeShift(4, server, "7:30am", "11am"),
    makeShift(4, server, "9am", "1pm"),
    makeShift(4, server, "11am", "3pm"),
    makeShift(4, server, "11am", "3pm"),
    makeShift(4, bartender, "5pm", "8pm"),
    makeShift(4, server, "5pm", "9:30pm"),

    makeShift(5, server, "6:30am", "11am"),
    makeShift(5, server, "7:30am", "11am"),
    makeShift(5, server, "9am", "1pm"),
    makeShift(5, server, "11am", "3pm"),
    makeShift(5, server, "11am", "3pm"),
    makeShift(5, bartender, "4pm", "10pm"),
    makeShift(5, bartender, "5pm", "10pm"),
    makeShift(5, server, "5pm", "11pm"),
    makeShift(5, server, "5pm", "11pm"),

    makeShift(6, server, "6:30am", "11am"),
    makeShift(6, server, "7:30am", "11am"),
    makeShift(6, bartender, "4pm", "10pm"),
    makeShift(6, server, "5pm", "10:30pm"),

    makeShift(0, server, "6:30am", "11am"),
    makeShift(0, server, "7:30am", "11am"),
    makeShift(0, server, "8am", "12pm"),
    makeShift(0, server, "8:30am", "12:30pm"),
    makeShift(0, server, "9am", "2pm"),
    makeShift(0, server, "9am", "2pm"),
    makeShift(0, server, "9am", "2pm"),
    makeShift(0, server, "9am", "2pm"),
    makeShift(0, server, "4pm", "9:30pm")
  ];
  loadedState.templates = (loadedState.templates || []).filter((template) => template.name !== "FOH Regular Week");
  loadedState.templates.unshift({
    id: uid("template"),
    name: "FOH Regular Week",
    shifts
  });
  localStorage.setItem(FOH_TEMPLATE_SEED_KEY, new Date().toISOString());
}

function ensureDefaultRoles(loadedState) {
  const required = [
    { name: "Expo", department: "FOH", color: "#ea580c", defaultRate: 0 },
    { name: "Banquet Server", department: "FOH", color: "#0891b2", defaultRate: 0 }
  ];
  required.forEach((role) => {
    if (!loadedState.roles.some((item) => item.name.toLowerCase() === role.name.toLowerCase())) {
      loadedState.roles.push({ id: uid("role"), ...role });
    }
  });
}

function normalizeTemplates(templates) {
  return (templates || []).map((template) => {
    if (Array.isArray(template.shifts)) {
      return {
        ...template,
        shifts: template.shifts.map((shift) => ({
          ...shift,
          id: shift.id || uid("templateShift"),
          dayIndex: Number(shift.dayIndex ?? 2),
          isLunchCloser: Boolean(shift.isLunchCloser),
          isFlexDouble: Boolean(shift.isFlexDouble)
        }))
      };
    }
    return {
      id: template.id || uid("template"),
      name: template.name || "Template",
      shifts: [{
        id: uid("templateShift"),
        dayIndex: Number(template.dayIndex ?? 2),
        department: template.department || "FOH",
        roleId: template.roleId,
        start: template.start || "7:00 AM",
        end: template.end || "Until Volume",
        untilVolume: Boolean(template.untilVolume),
        isCloser: Boolean(template.isCloser),
        isLunchCloser: Boolean(template.isLunchCloser),
        isFlexDouble: Boolean(template.isFlexDouble),
        color: template.color
      }]
    };
  });
}

function currentAccessRole() {
  if (!authRequired) return "owner";
  return String(currentUser?.role || "").trim().toLowerCase();
}

function canEditScheduler() {
  return ["owner", "manager"].includes(currentAccessRole());
}

function readOnlyMessage() {
  return "This account has view-only access. You can view and print schedules, but changes will not be saved.";
}

function showReadOnlyNotice() {
  showConflict(readOnlyMessage());
}

function currentSaveActor() {
  return currentUser ? {
    id: currentUser.id || "",
    email: currentUser.email || "",
    role: currentAccessRole() || "manager"
  } : null;
}

// Rendering is frequent and often changes only the screen. Keep volatile
// metadata out of this fingerprint so those redraws do not become full cloud
// schedule writes.
function schedulerMutationFingerprint(candidate = state) {
  if (!candidate || typeof candidate !== "object") return "";
  const snapshot = { ...candidate };
  delete snapshot.meta;
  return JSON.stringify(snapshot);
}

function saveState(options = {}) {
  if (!canEditScheduler()) {
    if (options.immediate || options.notice) showReadOnlyNotice();
    setStorageStatus("saved", readOnlyMessage());
    return Promise.resolve(false);
  }
  state.meta = {
    ...(state.meta || {}),
    schemaVersion: DATA_SCHEMA_VERSION,
    deviceId: getDeviceId(),
    updatedAt: nowIso(),
    updatedBy: currentSaveActor()
  };
  migrateState(state, state);
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (SERVER_STORAGE_ENABLED && serverStorageReady) {
    const mutationFingerprint = schedulerMutationFingerprint(state);
    // Profile-only saves merge one employee record on the server, so they can
    // safely proceed while this browser's broader schedule snapshot is stale.
    if (cloudSaveBlockedByStale && options.scope !== "employee-profile") {
      refreshBlockedCloudRecovery(state);
      setStorageStatus("stale", "CLOUD SAVE REJECTED. Refresh before making more edits.");
      return Promise.resolve(false);
    }
    if (options.immediate) {
      clearTimeout(serverSaveTimer);
      queuedMutationFingerprint = "";
      return persistStateToServer(options);
    }
    // renderAll() is also used for navigation, selection, and layout redraws.
    // Do not write the same schedule snapshot again just because the screen
    // was repainted.
    if (mutationFingerprint === lastConfirmedMutationFingerprint && !serverSaveInFlight && !serverSavePending && !serverSaveTimer) {
      return Promise.resolve(true);
    }
    queueServerSave();
  }
  else if (!SERVER_STORAGE_ENABLED) setStorageStatus("local");
  return Promise.resolve();
}

function setStorageStatus(status, detail = "") {
  storageStatus = status;
  storageStatusDetail = detail;
  updateStorageStatus();
}

function storageStatusLabel(status) {
  const labels = {
    connecting: "Cloud connecting",
    saving: "Cloud saving",
    saved: "Cloud saved",
    error: "Cloud save issue",
    stale: "CLOUD SAVE REJECTED",
    local: "LOCAL MODE"
  };
  const label = labels[status] || "Storage";
  if (SERVER_STORAGE_ENABLED && IS_LOCAL_TEST_HOST) {
    if (status === "error") return "Cloud issue | Local app";
    if (status === "local") return "LOCAL MODE";
    return label + " | Local app";
  }
  return label;
}

function storageStatusTitle() {
  const localCloudPrefix = SERVER_STORAGE_ENABLED && IS_LOCAL_TEST_HOST
    ? "This is the local Shift Bay app, but it is connected to the shared Supabase cloud for the selected location."
    : "";
  if (storageStatusDetail) return [localCloudPrefix, storageStatusDetail].filter(Boolean).join(" ");
  if (storageStatus === "saved") return [localCloudPrefix, "Cloud connected. Schedule data is saving to Supabase."].filter(Boolean).join(" ");
  if (storageStatus === "saving") return [localCloudPrefix, "Saving schedule changes to Supabase."].filter(Boolean).join(" ");
  if (storageStatus === "local") return IS_LOCAL_TEST_HOST ? "LOCAL TEST MODE: changes are only in this browser and will not sync to the cloud." : "LOCAL MODE: changes are only on this computer and will not sync.";
  if (storageStatus === "stale") return "CLOUD SAVE REJECTED: this window is behind a newer shared schedule. Refresh before making more edits. Your rejected edits are preserved for review.";
  if (storageStatus === "error") return "Cloud storage is not available. Browser backup is still saved locally.";
  return "Storage status";
}
function updateStorageStatus() {
  const button = $("storageStatusBtn");
  const label = $("storageStatusText");
  if (!button || !label) return;
  label.textContent = storageStatusLabel(storageStatus);
  button.className = `storage-status storage-status-${storageStatus}`;
  button.title = storageStatusTitle();
  button.dataset.detail = storageStatusTitle();
  button.setAttribute("aria-label", `Storage status: ${label.textContent}`);
}

function serverEnvelope(options = {}) {
  const sourceState = options.stateOverride || state;
  const employeeId = options.employeeId || "";
  const employeeProfile = options.scope === "employee-profile" && employeeId
    ? sourceState.employees.find((employee) => String(employee?.id || "") === String(employeeId)) || null
    : null;
  return {
    app: "restaurant-scheduler",
    schemaVersion: DATA_SCHEMA_VERSION,
    savedAt: nowIso(),
    savedByDeviceId: getDeviceId(),
    savedBy: currentSaveActor(),
    baseServerSavedAt: lastKnownServerSavedAt || state.meta?.serverSavedAt || "",
    saveScope: options.scope || "schedule",
    saveMode: NORMALIZED_SCHEDULE_DIRECT_WRITE_MODE && options.scope !== "employee-profile"
      ? (NORMALIZED_SCHEDULE_ATOMIC_CANARY_MODE
        ? "normalized-sandbox-atomic-revision"
        : (NORMALIZED_SCHEDULE_REVISION_CANARY_MODE ? "normalized-sandbox-direct-revision" : "normalized-sandbox-direct"))
      : "snapshot-bridge",
    normalizedScheduleRevision: (NORMALIZED_SCHEDULE_REVISION_CANARY_MODE || NORMALIZED_SCHEDULE_ATOMIC_CANARY_MODE)
      ? lastKnownNormalizedScheduleRevision
      : null,
    employeeId,
    // Send the exact profile being saved. The server deliberately ignores the
    // rest of the browser's schedule snapshot for this scoped operation.
    employeeProfile,
    data: sourceState
  };
}

async function persistEmployeeProfileToServer(employee) {
  if (!canEditScheduler()) {
    setStorageStatus("saved", readOnlyMessage());
    showReadOnlyNotice();
    return false;
  }
  if (!SERVER_STORAGE_ENABLED || !serverStorageReady) {
    setEmployeeSaveDebugStatus("Cloud request did not start: cloud storage is not ready", "failed");
    return false;
  }

  const saveAttemptId = `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  setEmployeeSaveDebugStatus(`Cloud request started [${saveAttemptId}]`);

  // A profile write must never be folded into the debounced whole-schedule
  // save. Claim priority before waiting so another large schedule request
  // cannot repeatedly jump ahead of this smaller, targeted profile update.
  employeeProfileSavePriority = true;
  clearTimeout(serverSaveTimer);
  const startedAt = Date.now();
  while (serverSaveInFlight && Date.now() - startedAt < 15000) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  if (serverSaveInFlight) {
    employeeProfileSavePriority = false;
    setStorageStatus("error", "Employee profile save is waiting on another cloud request. Try again in a moment.");
    return false;
  }

  serverSaveInFlight = true;
  setStorageStatus("saving", "Saving employee profile...");
  try {
    const response = await authFetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app: "restaurant-scheduler",
        schemaVersion: DATA_SCHEMA_VERSION,
        savedAt: nowIso(),
        savedByDeviceId: getDeviceId(),
        savedBy: currentSaveActor(),
        baseServerSavedAt: lastKnownServerSavedAt || state.meta?.serverSavedAt || "",
        saveScope: "employee-profile",
        saveAttemptId,
        employeeId: employee.id,
        employeeProfile: employee
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Employee profile save failed: ${response.status}`);
    if (result.savedAt) {
      // This endpoint saves an employee override, not the scheduler document.
      // Do not advance the schedule document timestamp here: doing so makes a
      // profile-only save look like a newer unsaved schedule after refresh.
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      if (lastKnownServerState?.employees) {
        lastKnownServerState.employees = lastKnownServerState.employees.map((item) => String(item?.id || "") === String(employee?.id || "") ? cloneSchedulerState(employee) : item);
      }
    }
    setStorageStatus("saved", "Employee profile saved to the shared scheduler data file.");
    setEmployeeSaveDebugStatus(`Cloud save confirmed [${saveAttemptId}]`, "confirmed");
    return true;
  } catch (error) {
    const message = error?.message || "Could not save the employee profile to the shared scheduler data file.";
    setStorageStatus("error", message);
    setEmployeeSaveDebugStatus(`Cloud save failed [${saveAttemptId}]: ${message}`, "failed");
    showConflict(message);
    return false;
  } finally {
    serverSaveInFlight = false;
    employeeProfileSavePriority = false;
    if (serverSavePending) {
      serverSavePending = false;
      queueServerSave();
    }
  }
}

function queueServerSave() {
  if (cloudSaveBlockedByStale) {
    setStorageStatus("stale", "CLOUD SAVE REJECTED. Refresh before making more edits.");
    return;
  }
  const mutationFingerprint = schedulerMutationFingerprint(state);
  if (mutationFingerprint === inFlightMutationFingerprint) return;
  if (mutationFingerprint === lastConfirmedMutationFingerprint) return;
  if (serverSaveTimer && queuedMutationFingerprint === mutationFingerprint) return;
  clearTimeout(serverSaveTimer);
  queuedMutationFingerprint = mutationFingerprint;
  setStorageStatus("saving", "Saving to the shared scheduler data file...");
  serverSaveTimer = setTimeout(() => {
    serverSaveTimer = null;
    queuedMutationFingerprint = "";
    persistStateToServer();
  }, 500);
}

async function persistStateToServer(options = {}) {
  if (!canEditScheduler()) {
    setStorageStatus("saved", readOnlyMessage());
    showReadOnlyNotice();
    return false;
  }
  if (!SERVER_STORAGE_ENABLED || !serverStorageReady) return false;
  if (cloudSaveBlockedByStale && options.scope !== "employee-profile") return false;
  const mutationFingerprint = schedulerMutationFingerprint(state);
  if (serverSaveInFlight) {
    // A profile save must not be reported as failed just because a queued
    // scheduler save is already using the connection. Wait for that request,
    // then send the profile merge as the last write.
    if (options.immediate && options.scope === "employee-profile") {
      const startedAt = Date.now();
      while (serverSaveInFlight && Date.now() - startedAt < 15000) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      if (!serverSaveInFlight) return persistStateToServer(options);
    }
    if (mutationFingerprint === inFlightMutationFingerprint) return false;
    serverSavePending = true;
    return false;
  }
  if (!options.immediate && mutationFingerprint === lastConfirmedMutationFingerprint) return true;
  serverSaveInFlight = true;
  inFlightMutationFingerprint = mutationFingerprint;
  const requestState = cloneSchedulerState(state);
  let saved = false;
  try {
    const response = await authFetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serverEnvelope({ ...options, stateOverride: requestState }))
    });
    if (response.status === 401) { handleAuthRequired(); throw new Error("Cloud login is required."); }
    if (response.status === 403) {
      const forbidden = await response.json().catch(() => ({}));
      throw new Error(forbidden.error || readOnlyMessage());
    }
    if (response.status === 409) {
      const conflict = await response.json().catch(() => ({}));
      const recovery = createCloudRecovery(state, lastKnownServerSavedAt, conflict.existingUpdatedAt || "");
      try {
        const latestResponse = await authFetch("/api/state", { cache: "no-store" });
        if (latestResponse.ok) {
          const latestEnvelope = await latestResponse.json();
          recovery.changes = stateCollectionChanges(state, normalizeLoadedState(latestEnvelope.data || latestEnvelope));
        }
      } catch {
        // The full change list can still be computed after the user refreshes.
      }
      saveCloudRecovery(recovery);
      cloudSaveBlockedByStale = true;
      setStorageStatus("stale", "CLOUD SAVE REJECTED. Refresh before making more edits.");
      showStaleRecoveryAlert(recovery, true);
      return false;
    }
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const serverError = String(errorBody?.error || errorBody?.message || "").trim();
      if (response.status === 546) {
        throw new Error("Cloud save was stopped by Supabase resource limits. The normalized Sandbox save was not completed; refresh and retry once.");
      }
      throw new Error(serverError ? `Save failed: ${response.status} - ${serverError}` : `Save failed: ${response.status}`);
    }
    const result = await response.json().catch(() => ({}));
    if (result.savedAt) {
      lastKnownServerSavedAt = result.savedAt;
      state.meta = { ...(state.meta || {}), serverSavedAt: result.savedAt };
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      lastKnownServerState = requestState;
    }
    lastConfirmedMutationFingerprint = mutationFingerprint;
    if (Number.isInteger(Number(result.normalizedScheduleRevision))) {
      lastKnownNormalizedScheduleRevision = Number(result.normalizedScheduleRevision);
    }
    if (options.scope !== "employee-profile") clearCloudRecovery();
    if (options.scope === "employee-profile" && cloudSaveBlockedByStale) {
      setStorageStatus("stale", "Employee profile saved. Refresh before editing schedule data in this window.");
    } else if (result.normalizedDirect) {
      setStorageStatus("saved", "Saved directly to normalized Sandbox schedule records.");
    } else {
      setStorageStatus("saved", "Connected to the shared scheduler data file.");
    }
    saved = true;
  } catch (error) {
    setStorageStatus("error", error?.message || "Could not save to the shared scheduler file. Browser backup is still saved locally.");
    showConflict(error?.message || "Could not save to the shared scheduler file. Your browser copy is still saved locally.");
  } finally {
    serverSaveInFlight = false;
    inFlightMutationFingerprint = "";
    // A targeted employee save may be waiting behind this whole-schedule
    // request. Let it run next; it will resume any pending schedule save once
    // the profile is safely confirmed.
    if (!employeeProfileSavePriority && serverSavePending) {
      serverSavePending = false;
      queueServerSave();
    }
  }
  return saved;
}

async function saveNow() {
  if (!canEditScheduler()) {
    showReadOnlyNotice();
    return false;
  }
  const button = $("saveNowBtn");
  if (button) {
    button.disabled = true;
    button.className = "account-menu-action saving";
    button.textContent = "Saving...";
  }
  const saved = SERVER_STORAGE_ENABLED ? await saveState({ immediate: true }) : (saveState(), true);
  if (button) {
    button.disabled = false;
    button.className = `account-menu-action ${saved || !SERVER_STORAGE_ENABLED ? "saved" : "error"}`;
    button.textContent = saved || !SERVER_STORAGE_ENABLED ? "Saved" : "Save Issue";
    setTimeout(() => {
      button.className = "account-menu-action";
      button.textContent = "Sync now";
    }, 1800);
  }
  showConflict(SERVER_STORAGE_ENABLED
    ? (saved ? "Saved current scheduler data to the shared file." : "Save issue: the browser backup is saved locally, but the shared file did not confirm.")
    : "Saved current scheduler data to this browser only. Use http://localhost:8787 for shared-file saving.");
}

function flushServerSaveOnClose() {
  if (!canEditScheduler()) return;
  if (!SERVER_STORAGE_ENABLED || !serverStorageReady) return;
  // A normalized canary has revision-based conflict protection. Sending a
  // second keepalive write while its page is closing can race the confirmed
  // save (or a different test tab) and needlessly keep the database busy.
  // The normal snapshot path still gets its close-time safety flush.
  if (NORMALIZED_SCHEDULE_DIRECT_WRITE_MODE) return;
  try {
    const payload = JSON.stringify(serverEnvelope());
    if (HOSTED_API_BASE) {
      fetch(apiUrl("/api/state"), {
        method: "POST",
        headers: authRequestHeaders({ "Content-Type": "application/json" }),
        body: payload,
        keepalive: true
      });
    } else if (navigator.sendBeacon) {
      navigator.sendBeacon(apiUrl("/api/state"), new Blob([payload], { type: "application/json" }));
    }
  } catch {
    // Normal saves still protect the browser copy; this is only a close-window flush.
  }
}

function warnBeforeLeavingWithUnsavedCloudChanges(event) {
  const hasUnconfirmedSave = SERVER_STORAGE_ENABLED && canEditScheduler() && (storageStatus === "saving" || storageStatus === "error" || serverSaveInFlight || serverSavePending);
  if (!hasUnconfirmedSave) return;
  flushServerSaveOnClose();
  event.preventDefault();
  event.returnValue = "Shift Bay has changes that have not been confirmed by the cloud yet.";
  return event.returnValue;
}

function warnBeforeLeavingWithUnsavedEmployeeChanges(event) {
  if (!employeeFormHasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = "This employee profile has unsaved changes.";
  return event.returnValue;
}

function loadAuthSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveAuthSession(session) {
  authSession = session;
  try {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Login still works for the current window if local storage is unavailable.
  }
}

function clearAuthSession() {
  authSession = null;
  currentUser = null;
  currentLoginEmail = "";
  try {
    localStorage.removeItem(AUTH_SESSION_KEY);
  } catch {
    // Nothing else to do.
  }
}

function loadSelectedLocationId() {
  try {
    return localStorage.getItem(SELECTED_LOCATION_KEY) || "";
  } catch {
    return "";
  }
}

function saveSelectedLocationId(locationId = "") {
  selectedLocationId = String(locationId || "").trim();
  try {
    if (selectedLocationId) localStorage.setItem(SELECTED_LOCATION_KEY, selectedLocationId);
    else localStorage.removeItem(SELECTED_LOCATION_KEY);
  } catch {}
}

function currentLocationRecord() {
  return availableLocations.find((location) => location.id === selectedLocationId) || availableLocations[0] || null;
}

function currentLocationName() {
  return currentLocationRecord()?.name || "Shift Bay Location";
}

function selectedLocationHeaders() {
  return selectedLocationId ? { "X-Shift-Bay-Location-Id": selectedLocationId } : {};
}

function resetWorkspaceForLocationSwitch() {
  state = defaultState();
  selectedCell = null;
  selectedShiftId = null;
  selectedUnassignedShiftId = null;
  selectedTimeOffRequestId = null;
  pendingDeleteShiftId = null;
  pendingDeleteUnassignedShiftId = null;
  pendingDeleteTimeOffRequestId = null;
  clipboardShift = null;
  clipboardTimeOffRequest = null;
  undoStack = [];
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {}
  currentDate = loadLocalActiveWeek(state.settings.weekStart);
  renderAll();
  updateZoomVisibility();
}
function shortAccountName(email = "") {
  return String(email || "").split("@")[0] || "Account";
}

function accountInitial(email = "") {
  return shortAccountName(email).slice(0, 1).toUpperCase() || "?";
}

function setLoginMessage(message = "", detail = "") {
  const messageEl = $("loginMessage");
  const diagnostics = $("loginDiagnostics");
  if (messageEl) messageEl.textContent = message;
  if (diagnostics) diagnostics.textContent = detail || message || "";
}

function showLoginOverlay(message = "") {
  const overlay = $("loginOverlay");
  if (overlay) overlay.hidden = false;
  if (message) setLoginMessage(message);
  window.setTimeout(() => $("loginEmail")?.focus(), 50);
}

function hideLoginOverlay() {
  const overlay = $("loginOverlay");
  if (overlay) overlay.hidden = true;
  setLoginMessage("");
}

function setPasswordChangeMessage(message = "") {
  const target = $("passwordChangeMessage");
  if (target) target.textContent = message;
}

function showPasswordChangeDialog() {
  hideLoginOverlay();
  setPasswordChangeMessage("");
  const dialog = $("passwordChangeDialog");
  if (!dialog) return;
  dialog.dataset.loginEmail = currentLoginEmail || currentUser?.email || authSession?.email || authSession?.user?.email || "";
  if (!dialog.open) dialog.showModal();
  window.setTimeout(() => $("newManagerPassword")?.focus(), 50);
}

function hidePasswordChangeDialog() {
  const dialog = $("passwordChangeDialog");
  if (dialog?.open) dialog.close();
  setPasswordChangeMessage("");
  if ($("newManagerPassword")) $("newManagerPassword").value = "";
  if ($("confirmManagerPassword")) $("confirmManagerPassword").value = "";
}

function closeAccountMenu() {
  const menu = $("accountMenu");
  if (menu) menu.open = false;
}
function isDemoLocation() {
  return selectedLocationId === DEMO_LOCATION_ID;
}

function setNormalizedScheduleReadBadge(readState = "off") {
  normalizedScheduleReadState = readState;
  updateNormalizedReadBadge();
}

function updateNormalizedReadBadge() {
  const badge = $("normalizedReadBadge");
  if (!badge) return;
  const enabled = Boolean(NORMALIZED_LIVE_CANARY_MODE && (
    (NORMALIZED_SCHEDULE_READ_MODE && normalizedScheduleReadState !== "off") ||
    (NORMALIZED_AVAILABILITY_READ_MODE && normalizedAvailabilityReadState !== "off")
  ));
  badge.hidden = !enabled;
  if (!enabled) {
    badge.dataset.state = "";
    return;
  }
  const labels = {
    requested: "Read check...",
    active: "Normalized Read",
    unavailable: "Read unavailable",
    availabilityRequested: "Availability check...",
    availabilityActive: "Normalized Availability Read",
    availabilityUnavailable: "Availability read unavailable"
  };
  const readState = NORMALIZED_AVAILABILITY_READ_MODE && normalizedAvailabilityReadState !== "off" && !NORMALIZED_SCHEDULE_READ_MODE
    ? normalizedAvailabilityReadState
    : normalizedScheduleReadState;
  badge.textContent = labels[readState] || labels.requested;
  badge.dataset.state = readState;
  document.body.dataset.normalizedScheduleRead = normalizedScheduleReadState;
  document.body.dataset.normalizedAvailabilityRead = normalizedAvailabilityReadState;
}

function normalizedEmployeeShadowValue(employee = {}) {
  const roleIds = (value) => Array.from(new Set(Array.isArray(value) ? value.map(String) : [])).sort();
  const availability = {};
  for (let dayIndex = 0; dayIndex <= 6; dayIndex++) {
    const windows = Array.isArray(employee.availability?.[dayIndex]) ? employee.availability[dayIndex] : [];
    availability[dayIndex] = windows.map((window) => ({
      start: String(window?.start || ""),
      end: String(window?.end || "")
    }));
  }
  const roleMealTraining = Object.fromEntries(
    Object.entries(employee.roleMealTraining || {})
      .map(([roleId, meals]) => [String(roleId), Array.isArray(meals) ? meals.map(String).sort() : []])
      // A missing meal-training entry and an empty entry both mean no meal
      // training. The normalized capability table can return the latter.
      .filter(([, meals]) => meals.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
  return {
    id: String(employee.id || ""),
    // This is intentionally limited to the fields proven by the Sandbox
    // migration. Profile, pay, rules, and availability-pattern fields remain
    // snapshot-backed until their own migration work is complete.
    roleTraining: roleIds(employee.roleTraining),
    trainerRoles: roleIds(employee.trainerRoles),
    emergencyRoleIds: roleIds(employee.emergencyRoleIds),
    roleMealTraining,
    availability
  };
}

function normalizedEmployeeShadowDifferences(snapshotEmployees = [], normalizedEmployees = []) {
  const snapshotById = new Map((snapshotEmployees || []).map((employee) => [String(employee.id || ""), normalizedEmployeeShadowValue(employee)]));
  const normalizedById = new Map((normalizedEmployees || []).map((employee) => [String(employee.id || ""), normalizedEmployeeShadowValue(employee)]));
  const differences = [];
  snapshotById.forEach((snapshotEmployee, id) => {
    if (!normalizedById.has(id)) {
      differences.push(`${displayName(snapshotEmployee) || id}: missing from normalized data`);
      return;
    }
    if (JSON.stringify(snapshotEmployee) !== JSON.stringify(normalizedById.get(id))) {
      differences.push(`${displayName(snapshotEmployee) || id}: normalized fields differ`);
    }
  });
  normalizedById.forEach((employee, id) => {
    if (!snapshotById.has(id)) differences.push(`${displayName(employee) || id}: missing from snapshot data`);
  });
  return differences;
}

async function runNormalizedEmployeeShadowCheck() {
  if (!NORMALIZED_EMPLOYEE_SHADOW_MODE) return;
  if (!isDemoLocation()) {
    showAppAlert({
      title: "Normalized employee check is Sandbox-only",
      message: "Switch to the Sandbox location before using the normalized employee shadow check.",
      type: "warning"
    });
    return;
  }
  try {
    const response = await authFetch("/api/normalized/employees", { method: "GET", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Could not load normalized employee records.");
    const differences = normalizedEmployeeShadowDifferences(state.employees || [], payload.employees || []);
    document.body.dataset.normalizedEmployeeShadow = differences.length ? "mismatch" : "clean";
    window.__shiftBayNormalizedEmployeeShadow = { checkedAt: payload.generatedAt || nowIso(), differences };
    if (differences.length) {
      showAppAlert({
        title: "Sandbox normalized employee mismatch",
        message: `The scheduler is still reading the cloud snapshot. ${differences.length} normalized employee difference${differences.length === 1 ? "" : "s"} need review before any read-source switch.`,
        items: differences.slice(0, 20),
        type: "warning"
      });
      return;
    }
    showAppAlert({
      title: "Sandbox normalized employee check passed",
      message: `${payload.employees?.length || 0} employee records match the current cloud snapshot for the fields migrated in this phase. The scheduler is still using the snapshot; no read source has been switched.`,
      type: "info"
    });
  } catch (error) {
    document.body.dataset.normalizedEmployeeShadow = "error";
    showAppAlert({
      title: "Normalized employee check could not run",
      message: error.message || "Could not load normalized employee records.",
      type: "warning"
    });
  }
}

function saveStaffSession(session, email = "") {
  const normalized = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
    email: session.user?.email || email,
    locationId: session.locationId || ""
  };
  try {
    localStorage.setItem("shiftBay.staffSession.v1", JSON.stringify(normalized));
  } catch {
    // The staff page can still use the redirect if storage is unavailable.
  }
}

function normalizedScheduleShadowValue(schedule = {}) {
  const clean = (value) => String(value || "");
  const sortById = (items) => (Array.isArray(items) ? items : []).map((item) => ({
    id: clean(item?.id),
    employeeId: clean(item?.employeeId),
    roleId: clean(item?.roleId),
    date: clean(item?.date),
    start: clean(item?.start),
    end: clean(item?.end),
    notes: clean(item?.notes),
    reason: clean(item?.reason || item?.note),
    source: clean(item?.source),
    daypart: clean(item?.daypart),
    kind: clean(item?.kind || (item?.blockType ? "block" : "ro")),
    blockType: clean(item?.blockType),
    shiftLabel: clean(item?.shiftLabel),
    // Older snapshot shifts can omit department; their long-standing default
    // is FOH, which the normalized migration writes explicitly.
    department: clean(item?.department || "FOH"),
    allDay: item?.allDay !== false,
    untilVolume: Boolean(item?.untilVolume),
    isCloser: Boolean(item?.isCloser),
    isLunchCloser: Boolean(item?.isLunchCloser),
    isFlexDouble: Boolean(item?.isFlexDouble),
    color: item?.color || null,
    dayIndex: Number(item?.dayIndex || 0),
    sortOrder: Number(item?.sortOrder || 0),
    meals: Array.isArray(item?.meals) ? item.meals.map(String).sort() : [],
    training: item?.training || {}
  })).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  return {
    shifts: sortById(schedule.shifts),
    unassignedShifts: sortById(schedule.unassignedShifts),
    timeOffRequests: sortById(schedule.timeOffRequests),
    templates: (Array.isArray(schedule.templates) ? schedule.templates : []).map((template) => ({
      id: clean(template?.id), name: clean(template?.name), active: template?.active !== false,
      shifts: sortById((template?.shifts || []).map((shift, sortOrder) => ({ ...shift, sortOrder: Number(shift?.sortOrder ?? sortOrder) })))
    })).sort((left, right) => left.id.localeCompare(right.id))
  };
}

function normalizedScheduleShadowDifferences(snapshot = {}, normalized = {}) {
  const source = normalizedScheduleShadowValue(snapshot);
  const shadow = normalizedScheduleShadowValue(normalized);
  const differences = [];
  ["shifts", "unassignedShifts", "timeOffRequests", "templates"].forEach((key) => {
    const sourceById = new Map(source[key].map((item) => [item.id, item]));
    const shadowById = new Map(shadow[key].map((item) => [item.id, item]));
    sourceById.forEach((sourceItem, id) => {
      const shadowItem = shadowById.get(id);
      if (!shadowItem) {
        differences.push(`${key} ${id}: missing from normalized data`);
        return;
      }
      const fields = [...new Set([...Object.keys(sourceItem), ...Object.keys(shadowItem)])]
        .filter((field) => JSON.stringify(sourceItem[field]) !== JSON.stringify(shadowItem[field]));
      if (fields.length) differences.push(`${key} ${id}: ${fields.join(", ")} differ`);
    });
    shadowById.forEach((_shadowItem, id) => {
      if (!sourceById.has(id)) differences.push(`${key} ${id}: missing from snapshot data`);
    });
  });
  return differences;
}

async function runNormalizedScheduleShadowCheck() {
  if (!NORMALIZED_SCHEDULE_SHADOW_MODE) return;
  if (!isDemoLocation()) {
    showAppAlert({ title: "Normalized schedule check is Sandbox-only", message: "Switch to the Sandbox location before using the normalized schedule shadow check.", type: "warning" });
    return;
  }
  try {
    const response = await authFetch("/api/normalized/schedule", { method: "GET", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Could not load normalized schedule records.");
    const differences = normalizedScheduleShadowDifferences(state, payload);
    document.body.dataset.normalizedScheduleShadow = differences.length ? "mismatch" : "clean";
    window.__shiftBayNormalizedScheduleShadow = { checkedAt: payload.generatedAt || nowIso(), differences };
    if (differences.length) {
      showAppAlert({ title: "Sandbox normalized schedule mismatch", message: `The scheduler is still reading the cloud snapshot. ${differences.length} normalized schedule area${differences.length === 1 ? "" : "s"} need review before any read-source switch.`, items: differences, type: "warning" });
      return;
    }
    showAppAlert({ title: "Sandbox normalized schedule check passed", message: "Assigned shifts, Shift Bay shifts, ROs, blocks, and templates match the current snapshot. The scheduler is still using the snapshot; no read source has been switched.", type: "info" });
  } catch (error) {
    document.body.dataset.normalizedScheduleShadow = "error";
    showAppAlert({ title: "Normalized schedule check could not run", message: error.message || "Could not load normalized schedule records.", type: "warning" });
  }
}

function normalizedAvailabilityShadowValue(employee = {}) {
  const patterns = availabilityPatternsForEmployee(employee).map((pattern, index) => {
    const id = `availability-profile:${employee.id}:${pattern.id || index + 1}`;
    const windows = DAYS.flatMap((_day, dayIndex) => {
      const ranges = Array.isArray(pattern.availability?.[dayIndex]) ? pattern.availability[dayIndex] : [];
      return ranges
        .filter((range) => range && (range.start || range.end))
        .map((range, sortOrder) => ({
          dayIndex,
          start: String(range.start || ""),
          end: String(range.end || ""),
          available: true,
          sortOrder
        }));
    }).sort((left, right) => left.dayIndex - right.dayIndex || left.sortOrder - right.sortOrder);
    const status = pattern.active !== false
      ? "active"
      : pattern.approvalStatus === "approved" || pattern.approved === true
        ? "approved"
        : ["submitted", "pending"].includes(pattern.approvalStatus)
          ? "submitted"
          : "draft";
    return {
      id,
      name: String(pattern.name || ""),
      windows,
      assignment: status === "draft" ? null : {
        id: `availability-assignment:${employee.id}:${pattern.id || index + 1}`,
        effectiveDate: normalizeAvailabilityEffectiveDate(pattern.effectiveDate || ""),
        repeatWeeks: Math.max(1, Math.min(4, Number(pattern.repeatWeeks) || 1)),
        status
      }
    };
  });
  return patterns.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizedAvailabilityShadowDifferences(snapshotEmployees = [], normalizedEmployees = []) {
  const snapshotById = new Map((snapshotEmployees || []).map((employee) => [String(employee.id || ""), employee]));
  const normalizedById = new Map((normalizedEmployees || []).map((employee) => [String(employee.id || ""), employee]));
  const differences = [];
  snapshotById.forEach((snapshotEmployee, employeeId) => {
    const expected = normalizedAvailabilityShadowValue(snapshotEmployee);
    const actual = (normalizedById.get(employeeId)?.availabilityProfiles || []).map((profile) => ({
      id: String(profile.id || ""),
      name: String(profile.name || ""),
      windows: (Array.isArray(profile.windows) ? profile.windows : []).map((window) => ({
        dayIndex: Number(window.dayIndex),
        start: String(window.start || ""),
        end: String(window.end || ""),
        available: window.available !== false,
        sortOrder: Number(window.sortOrder || 0)
      })).sort((left, right) => left.dayIndex - right.dayIndex || left.sortOrder - right.sortOrder),
      assignment: (Array.isArray(profile.assignments) ? profile.assignments : [profile.assignment])
        .filter(Boolean)
        .map((assignment) => ({
          id: String(assignment.id || ""),
          effectiveDate: normalizeAvailabilityEffectiveDate(assignment.effectiveDate || ""),
          repeatWeeks: Math.max(1, Math.min(4, Number(assignment.repeatWeeks) || 1)),
          status: String(assignment.status || "")
        }))
        .sort((left, right) => left.id.localeCompare(right.id))[0] || null
    })).sort((left, right) => left.id.localeCompare(right.id));
    if (!normalizedById.has(employeeId)) {
      differences.push(`${displayName(snapshotEmployee) || employeeId}: missing from normalized availability data`);
      return;
    }
    const actualById = new Map(actual.map((profile) => [profile.id, profile]));
    expected.forEach((expectedProfile) => {
      const actualProfile = actualById.get(expectedProfile.id);
      if (!actualProfile) {
        differences.push(`${displayName(snapshotEmployee) || employeeId}: ${expectedProfile.name} missing from normalized availability data`);
        return;
      }
      const fields = ["name", "windows", "assignment"]
        .filter((field) => JSON.stringify(expectedProfile[field]) !== JSON.stringify(actualProfile[field]));
      if (fields.length) differences.push(`${displayName(snapshotEmployee) || employeeId} / ${expectedProfile.name}: ${fields.join(", ")} differ`);
      actualById.delete(expectedProfile.id);
    });
    actualById.forEach((profile) => differences.push(`${displayName(snapshotEmployee) || employeeId}: unexpected ${profile.name || profile.id} in normalized availability data`));
  });
  normalizedById.forEach((employee, employeeId) => {
    if (!snapshotById.has(employeeId)) differences.push(`${employeeId}: normalized availability employee is missing from snapshot data`);
  });
  return differences;
}

async function runNormalizedAvailabilityShadowCheck() {
  if (!NORMALIZED_AVAILABILITY_SHADOW_MODE) return;
  if (!isDemoLocation()) {
    showAppAlert({ title: "Normalized availability check is Sandbox-only", message: "Switch to the Sandbox location before using the normalized availability shadow check.", type: "warning" });
    return;
  }
  try {
    const response = await authFetch("/api/normalized/availability", { method: "GET", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Could not load normalized availability records.");
    const differences = normalizedAvailabilityShadowDifferences(state.employees || [], payload.employees || []);
    document.body.dataset.normalizedAvailabilityShadow = differences.length ? "mismatch" : "clean";
    window.__shiftBayNormalizedAvailabilityShadow = { checkedAt: payload.generatedAt || nowIso(), differences };
    if (differences.length) {
      showAppAlert({
        title: "Sandbox normalized availability mismatch",
        message: `The scheduler is still reading the cloud snapshot. ${differences.length} normalized availability difference${differences.length === 1 ? "" : "s"} need review before any read-source switch.`,
        items: differences,
        type: "warning"
      });
      return;
    }
    const profileCount = (payload.employees || []).reduce((count, employee) => count + (employee.availabilityProfiles || []).length, 0);
    showAppAlert({
      title: "Sandbox normalized availability check passed",
      message: `${profileCount} availability profile${profileCount === 1 ? "" : "s"} match the current cloud snapshot. The scheduler is still using the snapshot; no read source has been switched.`,
      type: "info"
    });
  } catch (error) {
    document.body.dataset.normalizedAvailabilityShadow = "error";
    showAppAlert({ title: "Normalized availability check could not run", message: error.message || "Could not load normalized availability records.", type: "warning" });
  }
}

function normalizedAvailabilityReadPatterns(employee, normalizedEmployee) {
  const prefix = `availability-profile:${employee.id}:`;
  return (normalizedEmployee?.availabilityProfiles || []).map((profile) => {
    const id = String(profile.id || "").startsWith(prefix)
      ? String(profile.id).slice(prefix.length)
      : String(profile.id || "");
    const availability = emptyAvailability();
    (Array.isArray(profile.windows) ? profile.windows : []).forEach((window) => {
      const dayIndex = Number(window.dayIndex);
      if (dayIndex < 0 || dayIndex > 6) return;
      if (!Array.isArray(availability[dayIndex])) availability[dayIndex] = [];
      if (window.available !== false) availability[dayIndex].push({ start: String(window.start || ""), end: String(window.end || "") });
    });
    const assignment = (Array.isArray(profile.assignments) ? profile.assignments : [profile.assignment]).filter(Boolean)[0] || null;
    const status = String(assignment?.status || "").toLowerCase();
    return {
      id,
      name: String(profile.name || "Availability"),
      availability,
      repeatWeeks: assignment ? Math.max(1, Math.min(4, Number(assignment.repeatWeeks) || 1)) : null,
      effectiveDate: assignment?.effectiveDate ? normalizeAvailabilityEffectiveDate(assignment.effectiveDate) : "",
      active: status === "active",
      approved: status === "approved",
      approvalStatus: status
    };
  });
}

async function applyNormalizedAvailabilityRead(serverState) {
  if (!NORMALIZED_AVAILABILITY_READ_MODE) return;
  normalizedAvailabilityReadState = "availabilityRequested";
  updateNormalizedReadBadge();
  try {
    const response = await authFetch("/api/normalized/availability", { method: "GET", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Could not load normalized availability records.");
    const normalizedByEmployee = new Map((payload.employees || []).map((employee) => [String(employee.id || ""), employee]));
    const missing = [];
    const employees = (serverState.employees || []).map((employee) => {
      const normalizedEmployee = normalizedByEmployee.get(String(employee.id || ""));
      if (!normalizedEmployee) {
        missing.push(displayName(employee) || employee.id || "Employee");
        return employee;
      }
      return { ...employee, availabilityPatterns: normalizedAvailabilityReadPatterns(employee, normalizedEmployee) };
    });
    if (missing.length) throw new Error(`Normalized availability is missing ${missing.length} employee${missing.length === 1 ? "" : "s"}: ${missing.slice(0, 5).join(", ")}.`);
    normalizedAvailabilityReadState = "availabilityActive";
    updateNormalizedReadBadge();
    return { ...serverState, employees };
  } catch (error) {
    console.warn("Normalized availability fallback:", error?.message || error);
    normalizedAvailabilityReadState = "availabilityUnavailable";
    updateNormalizedReadBadge();
    return serverState;
  }
}

function demoRoleId(name) {
  return state.roles.find((role) => role.name.toLowerCase() === String(name).toLowerCase())?.id || "";
}

function makeDemoAvailability(days = null) {
  const availability = {};
  for (let day = 0; day <= 6; day++) availability[day] = [];
  if (!days) {
    for (let day = 0; day <= 6; day++) availability[day] = [{ start: "12:00 AM", end: "11:59 PM" }];
    return availability;
  }
  Object.entries(days).forEach(([day, windows]) => {
    availability[day] = windows;
  });
  return availability;
}

function buildDemoEmployee(firstName, lastName, roleNames, options = {}) {
  return {
    id: uid("employee"),
    firstName,
    lastName,
    nickname: options.nickname || "",
    phone: options.phone || "(555) 010-0000",
    birthday: options.birthday || "",
    departments: options.departments || ["FOH"],
    active: true,
    archived: false,
    callWeekly: Boolean(options.callWeekly),
    noDoubles: Boolean(options.noDoubles),
    canClose: Boolean(options.canClose),
    canLunchClose: Boolean(options.canLunchClose),
    alwaysPrintFloorEndTime: Boolean(options.alwaysPrintFloorEndTime),
    roleTraining: roleNames.map(demoRoleId).filter(Boolean),
    trainerRoles: (options.trainerRoles || []).map(demoRoleId).filter(Boolean),
    emergencyRoleIds: (options.emergencyRoleIds || []).map(demoRoleId).filter(Boolean),
    mealTraining: options.mealTraining || ["Breakfast", "Lunch", "Dinner", "Brunch"],
    roleMealTraining: options.roleMealTraining || {},
    availability: options.availability || makeDemoAvailability(),
    availabilityPatterns: options.availabilityPatterns || [],
    availabilitySubmissions: options.availabilitySubmissions || [],
    weeklyAvailability: {},
    weeklyRules: [],
    payRates: {},
    managerNotes: options.managerNotes || "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function buildDemoTemplateShift(dayIndex, roleName, start, end, flags = {}) {
  const roleId = demoRoleId(roleName);
  const role = roleById(roleId) || {};
  return {
    id: uid("templateShift"),
    dayIndex,
    department: role.department || "FOH",
    roleId,
    start,
    end,
    untilVolume: false,
    isCloser: Boolean(flags.isCloser),
    isFlexDouble: Boolean(flags.isFlexDouble),
    isLunchCloser: Boolean(flags.isLunchCloser),
    color: role.color || "#2563eb",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function buildDemoShift(date, employee, roleName, start, end, flags = {}) {
  const roleId = demoRoleId(roleName);
  const role = roleById(roleId) || {};
  return {
    id: uid(flags.open ? "openShift" : "shift"),
    date,
    employeeId: flags.open ? "" : employee?.id,
    department: role.department || "FOH",
    roleId,
    shiftLabel: flags.shiftLabel || roleName,
    start,
    end,
    untilVolume: false,
    isCloser: Boolean(flags.isCloser),
    isFlexDouble: Boolean(flags.isFlexDouble),
    isLunchCloser: Boolean(flags.isLunchCloser),
    color: role.color || "#2563eb",
    meals: flags.meals || [],
    notes: flags.notes || "",
    training: flags.training || { isTraining: false, segmentEnd: "" },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function buildDemoSchedulerState() {
  const demo = defaultState();
  state = demo;
  const employees = [
    buildDemoEmployee("Alex", "Rivera", ["Server", "Bartender"], {
      canClose: true,
      canLunchClose: true,
      trainerRoles: ["Server"],
      managerNotes: "Demo: alternating availability weeks. Compare the two live tabs above.",
      availabilityPatterns: [
        {
          id: "demo-alex-alternating-a",
          name: "Alternating - Open Week",
          availability: makeDemoAvailability(),
          repeatWeeks: 2,
          active: true,
          effectiveDate: "2026-07-27"
        },
        {
          id: "demo-alex-alternating-b",
          name: "Alternating - School Week",
          availability: makeDemoAvailability({ 1: [{ start: "4:00 PM", end: "10:00 PM" }], 2: [{ start: "4:00 PM", end: "10:00 PM" }], 4: [{ start: "4:00 PM", end: "10:00 PM" }], 5: [{ start: "4:00 PM", end: "11:59 PM" }] }),
          repeatWeeks: 2,
          active: true,
          effectiveDate: "2026-08-03"
        }
      ]
    }),
    buildDemoEmployee("Morgan", "Lane", ["Server"], {
      canClose: true,
      managerNotes: "Demo: live availability plus an approved change that starts two weeks from now.",
      availabilityPatterns: [
        {
          id: "demo-morgan-live",
          name: "Live - Regular Week",
          availability: makeDemoAvailability(),
          repeatWeeks: 1,
          active: true,
          effectiveDate: "2026-07-27"
        },
        {
          id: "demo-morgan-future-approved",
          name: "Approved - Starts in 2 Weeks",
          availability: makeDemoAvailability({ 1: [{ start: "4:00 PM", end: "10:00 PM" }], 2: [{ start: "4:00 PM", end: "10:00 PM" }], 3: [{ start: "4:00 PM", end: "10:00 PM" }], 4: [{ start: "4:00 PM", end: "10:00 PM" }], 5: [{ start: "4:00 PM", end: "11:59 PM" }] }),
          repeatWeeks: 1,
          active: true,
          effectiveDate: "2026-08-13",
          active: false,
          approvalStatus: "approved",
          approved: true
        }
      ]
    }),
    buildDemoEmployee("Taylor", "Brooks", ["Host", "Expo"], {
      canLunchClose: true,
      managerNotes: "Demo: live availability plus a submitted availability waiting for approval.",
      availabilityPatterns: [{
        id: "demo-taylor-live",
        name: "Live - Host Week",
        availability: makeDemoAvailability({ 0: [{ start: "9:00 AM", end: "2:00 PM" }], 1: [{ start: "9:00 AM", end: "2:00 PM" }], 2: [{ start: "9:00 AM", end: "2:00 PM" }], 3: [{ start: "9:00 AM", end: "2:00 PM" }], 4: [{ start: "9:00 AM", end: "2:00 PM" }], 5: [{ start: "9:00 AM", end: "2:00 PM" }], 6: [{ start: "9:00 AM", end: "2:00 PM" }] }),
        repeatWeeks: 1,
        active: true,
        effectiveDate: "2026-07-27"
      }],
      availabilitySubmissions: [{
        id: "demo-taylor-pending",
        weekStart: "2026-08-10",
        status: "submitted",
        note: "Demo pending manager approval",
        availability: makeDemoAvailability({ 0: [{ start: "11:00 AM", end: "6:00 PM" }], 1: [{ start: "11:00 AM", end: "6:00 PM" }], 2: [{ start: "11:00 AM", end: "6:00 PM" }], 3: [{ start: "11:00 AM", end: "6:00 PM" }], 4: [{ start: "11:00 AM", end: "6:00 PM" }], 5: [{ start: "11:00 AM", end: "6:00 PM" }], 6: [] })
      }]
    }),
    buildDemoEmployee("Jordan", "Kim", ["Busser"], { availability: makeDemoAvailability({ 2: [{ start: "4:00 PM", end: "11:59 PM" }], 5: [{ start: "4:00 PM", end: "11:59 PM" }], 6: [{ start: "9:00 AM", end: "11:59 PM" }] }) }),
    buildDemoEmployee("Casey", "Stone", ["Bartender", "Server"], {
      canClose: true,
      noDoubles: true,
      managerNotes: "Demo: saved availability draft that is inactive and available to activate later.",
      availabilityPatterns: [{
        id: "demo-casey-inactive-draft",
        name: "College Break Draft",
        availability: makeDemoAvailability({ 0: [{ start: "10:00 AM", end: "6:00 PM" }], 1: [{ start: "10:00 AM", end: "6:00 PM" }], 2: [{ start: "10:00 AM", end: "6:00 PM" }], 3: [{ start: "10:00 AM", end: "6:00 PM" }], 4: [{ start: "10:00 AM", end: "6:00 PM" }], 5: [{ start: "10:00 AM", end: "6:00 PM" }], 6: [{ start: "10:00 AM", end: "6:00 PM" }] }),
        repeatWeeks: null,
        active: false,
        effectiveDate: ""
      }]
    }),
    buildDemoEmployee("Riley", "Chen", ["Server", "Banquet Server"], { canClose: true }),
    buildDemoEmployee("Sam", "Patel", ["Host", "Expo"], { canLunchClose: true }),
    buildDemoEmployee("Jamie", "Ortiz", ["Server"], { managerNotes: "Demo trainee candidate." }),
    buildDemoEmployee("Avery", "Quinn", ["Host"], { callWeekly: true, availability: makeDemoAvailability({}) }),
    buildDemoEmployee("Devin", "Moore", ["Busser", "Banquet Server"], { availability: makeDemoAvailability({ 4: [{ start: "11:00 AM", end: "5:00 PM" }], 5: [{ start: "11:00 AM", end: "11:59 PM" }], 6: [{ start: "11:00 AM", end: "11:59 PM" }] }) })
  ];
  const byName = Object.fromEntries(employees.map((employee) => [`${employee.firstName} ${employee.lastName}`, employee]));
  demo.employees = employees;
  demo.templates = [{
    id: uid("template"),
    name: "Standard Demo Week",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    shifts: [
      buildDemoTemplateShift(2, "Server", "6:30 AM", "11:00 AM"),
      buildDemoTemplateShift(2, "Server", "11:00 AM", "3:00 PM"),
      buildDemoTemplateShift(2, "Host", "9:00 AM", "2:00 PM"),
      buildDemoTemplateShift(2, "Bartender", "5:00 PM", "9:30 PM", { isCloser: true }),
      buildDemoTemplateShift(3, "Server", "8:00 AM", "1:00 PM"),
      buildDemoTemplateShift(3, "Server", "4:00 PM", "9:30 PM", { isCloser: true }),
      buildDemoTemplateShift(3, "Busser", "5:00 PM", "9:00 PM"),
      buildDemoTemplateShift(4, "Server", "9:00 AM", "3:00 PM", { isLunchCloser: true }),
      buildDemoTemplateShift(4, "Banquet Server", "4:30 PM", "9:00 PM"),
      buildDemoTemplateShift(5, "Server", "9:00 AM", "7:00 PM", { isFlexDouble: true }),
      buildDemoTemplateShift(5, "Bartender", "4:00 PM", "11:00 PM", { isCloser: true }),
      buildDemoTemplateShift(5, "Expo", "4:00 PM", "8:00 PM"),
      buildDemoTemplateShift(6, "Host", "9:00 AM", "2:00 PM"),
      buildDemoTemplateShift(6, "Server", "5:00 PM", "10:30 PM", { isCloser: true }),
      buildDemoTemplateShift(0, "Server", "9:00 AM", "2:00 PM"),
      buildDemoTemplateShift(0, "Busser", "9:00 AM", "2:00 PM")
    ]
  }];
  demo.shifts = [
    buildDemoShift("2026-07-21", byName["Alex Rivera"], "Server", "6:30 AM", "11:00 AM"),
    buildDemoShift("2026-07-21", byName["Morgan Lane"], "Server", "11:00 AM", "3:00 PM"),
    buildDemoShift("2026-07-21", byName["Taylor Brooks"], "Host", "9:00 AM", "2:00 PM"),
    buildDemoShift("2026-07-22", byName["Casey Stone"], "Bartender", "5:00 PM", "9:30 PM", { isCloser: true }),
    buildDemoShift("2026-07-23", byName["Riley Chen"], "Banquet Server", "4:30 PM", "9:00 PM"),
    buildDemoShift("2026-07-24", byName["Alex Rivera"], "Server", "9:00 AM", "7:00 PM", { isFlexDouble: true }),
    buildDemoShift("2026-07-24", byName["Sam Patel"], "Expo", "4:00 PM", "8:00 PM"),
    buildDemoShift("2026-07-25", byName["Jordan Kim"], "Busser", "5:00 PM", "10:00 PM"),
    buildDemoShift("2026-07-26", byName["Morgan Lane"], "Server", "9:00 AM", "2:00 PM", { isLunchCloser: true })
  ];
  demo.unassignedShifts = [
    buildDemoShift("2026-07-21", null, "Bartender", "5:00 PM", "9:30 PM", { open: true, isCloser: true }),
    buildDemoShift("2026-07-22", null, "Server", "4:00 PM", "9:30 PM", { open: true, isCloser: true }),
    buildDemoShift("2026-07-23", null, "Busser", "5:00 PM", "9:00 PM", { open: true }),
    buildDemoShift("2026-07-24", null, "Server", "5:00 PM", "11:00 PM", { open: true, isCloser: true }),
    buildDemoShift("2026-07-25", null, "Host", "9:00 AM", "2:00 PM", { open: true }),
    buildDemoShift("2026-07-26", null, "Banquet Server", "11:00 AM", "3:00 PM", { open: true })
  ];
  demo.timeOffRequests = [{
    id: uid("timeoff"),
    employeeId: byName["Jamie Ortiz"].id,
    date: "2026-07-25",
    daypart: "All day",
    note: "Demo request off",
    source: "Demo seed"
  }, {
    id: uid("timeoff"),
    employeeId: byName["Avery Quinn"].id,
    date: "2026-07-23",
    daypart: "Partial day",
    start: "8:00 AM",
    end: "3:00 PM",
    allDay: false,
    note: "Demo partial request off",
    source: "Demo seed"
  }, {
    id: uid("block"),
    employeeId: byName["Devin Moore"].id,
    date: "2026-07-24",
    kind: "block",
    source: "Day Block",
    blockType: "Off-site Demo Event",
    daypart: "All day",
    allDay: true,
    start: "",
    end: "",
    note: "Demo day block"
  }];
  demo.settings.groupEmployeesByRole = true;
  demo.settings.scheduleRoleOrder = demo.roles.filter((role) => role.department === "FOH").map((role) => role.id);
  demo.settings.printRoleOrder = demo.settings.scheduleRoleOrder;
  demo.meta.updatedAt = nowIso();
  return demo;
}

async function resetDemoData() {
  if (!isDemoLocation() || currentAccessRole() !== "owner") return showConflict("Demo reset is only available to the owner inside the sandbox location.");
  const confirmed = await showAppConfirm({
    title: "Reset Demo Data",
    message: "Replace the sandbox with fresh fake employees, shifts, request offs, blocks, and demo Shift Bay shifts? This will not touch the real restaurant.",
    confirmText: "Reset Sandbox",
    cancelText: "Cancel"
  });
  if (!confirmed) return;
  pushUndo();
  state = buildDemoSchedulerState();
  currentDate = parseDateKey("2026-07-21");
  saveLocalActiveWeek({ shared: false });
  renderAll();
  updateZoomVisibility();
  await saveState({ immediate: true });
  showConflict("Sandbox reset with fresh demo data.");
}

function renderLocationSwitcher() {
  const label = $("accountLocationLabel");
  const select = $("locationSwitcher");
  if (!label || !select) return;
  const canSwitch = currentUser && availableLocations.length > 1;
  label.hidden = !canSwitch;
  if (!canSwitch) {
    select.innerHTML = "";
    return;
  }
  select.innerHTML = availableLocations.map((location) => {
    const selected = location.id === selectedLocationId ? "selected" : "";
    return `<option value="${escapeHtml(location.id)}" ${selected}>${escapeHtml(location.name || "Shift Bay Location")}</option>`;
  }).join("");
}

async function loadUserLocations() {
  if (!authRequired || !authSession?.access_token) return [];
  const result = await fetchJson("/api/locations", {
    cache: "no-store",
    headers: authRequestHeaders()
  });
  availableLocations = Array.isArray(result.locations) ? result.locations : [];
  const allowed = availableLocations.some((location) => location.id === selectedLocationId);
  const nextLocationId = allowed ? selectedLocationId : (result.selectedLocationId || currentUser?.locationId || availableLocations[0]?.id || "");
  saveSelectedLocationId(nextLocationId);
  const activeLocation = currentLocationRecord();
  if (currentUser && activeLocation) {
    currentUser = {
      ...currentUser,
      role: activeLocation.role || currentUser.role,
      locationId: activeLocation.id,
      locationName: activeLocation.name || currentUser.locationName || "Shift Bay Location"
    };
  }
  renderLocationSwitcher();
  return availableLocations;
}

async function handleLocationSwitcherChange(event) {
  const nextLocationId = String(event.target.value || "").trim();
  if (!nextLocationId || nextLocationId === selectedLocationId) return;
  clearTimeout(serverSaveTimer);
  serverSavePending = false;
  saveSelectedLocationId(nextLocationId);
  const activeLocation = currentLocationRecord();
  if (currentUser && activeLocation) {
    currentUser = {
      ...currentUser,
      role: activeLocation.role || currentUser.role,
      locationId: activeLocation.id,
      locationName: activeLocation.name || currentUser.locationName || "Shift Bay Location"
    };
  }
  serverStorageReady = false;
  lastKnownServerSavedAt = "";
  skipLocalRecoveryOnce = true;
  setStorageStatus("connecting", `Switching to ${currentLocationName()}...`);
  updateAccountUi();
  closeAccountMenu();
  resetWorkspaceForLocationSwitch();
  await hydrateStateFromServer();
}
function updateAccountUi() {
  document.body.classList.toggle("viewer-read-only", currentAccessRole() === "viewer");
  const employeeSaveDebugStatus = $("employeeSaveDebugStatus");
  if (employeeSaveDebugStatus && currentAccessRole() !== "owner") employeeSaveDebugStatus.hidden = true;
  const avatar = $("accountAvatar");
  const title = $("accountMenuTitle");
  const status = $("accountMenuStatus");
  const signIn = $("signInMenuBtn");
  const signOut = $("signOutBtn");
  const recent = $("recentActivityBtn");
  const managers = $("manageManagersBtn");
  const resetDemo = $("resetDemoDataBtn");
  const sandboxStaffPortal = $("sandboxStaffPortalBtn");
  const sandboxBadge = $("sandboxBadge");
  renderLocationSwitcher();
  if (sandboxBadge) sandboxBadge.hidden = !isDemoLocation();
  if (!NORMALIZED_LIVE_CANARY_MODE) setNormalizedScheduleReadBadge("off");
  else if (NORMALIZED_SCHEDULE_READ_MODE && normalizedScheduleReadState === "off") setNormalizedScheduleReadBadge("requested");
  if (currentUser) {
    if (avatar) avatar.textContent = accountInitial(currentUser.email);
    if (title) title.textContent = shortAccountName(currentUser.email);
    const role = currentAccessRole() || "manager";
    const locationName = currentLocationName();
    if (status) status.textContent = role === "viewer" ? `viewer | ${locationName} | View and print only` : `${role} | ${locationName}`;
    if (signIn) signIn.hidden = true;
    if (signOut) signOut.hidden = false;
    if (recent) recent.hidden = false;
    if (managers) managers.hidden = currentUser.role !== "owner";
    if (resetDemo) resetDemo.hidden = !(role === "owner" && isDemoLocation());
    if (sandboxStaffPortal) sandboxStaffPortal.hidden = !isDemoLocation();
    return;
  }
  document.body.classList.remove("viewer-read-only");
  if (avatar) avatar.textContent = authRequired ? "?" : "L";
  if (title) title.textContent = authRequired ? "Shift Bay Account" : "Local Mode";
  if (status) status.textContent = authRequired ? "Sign in to load cloud schedule data." : "Using this device or local server.";
  if (signIn) signIn.hidden = !authRequired;
  if (signOut) signOut.hidden = true;
  if (recent) recent.hidden = authRequired;
  if (managers) managers.hidden = true;
  if (resetDemo) resetDemo.hidden = true;
  if (sandboxStaffPortal) sandboxStaffPortal.hidden = true;
  if (sandboxBadge) sandboxBadge.hidden = true;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(apiUrl(url), options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body?.error_description || body?.error || body?.message || `Request failed with ${response.status}.`);
  }
  return body;
}

function authRequestHeaders(extra = {}) {
  const headers = { ...selectedLocationHeaders(), ...extra };
  if (authSession?.access_token) headers.Authorization = `Bearer ${authSession.access_token}`;
  return headers;
}

function authSessionExpiresSoon() {
  if (!authRequired || !authSession?.expires_at) return false;
  return Number(authSession.expires_at) <= Math.floor(Date.now() / 1000) + 120;
}

async function refreshAuthSession(force = false) {
  if (!authRequired || !authSession?.refresh_token) return false;
  if (!force && !authSessionExpiresSoon()) return true;
  if (authRefreshInFlight) return authRefreshInFlight;
  authRefreshInFlight = (async () => {
    const result = await fetchJson("/api/auth/refresh", {
      method: "POST",
      headers: { ...selectedLocationHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: authSession.refresh_token })
    });
    const session = result.session;
    if (!session?.access_token) throw new Error("Cloud login refresh did not return a session.");
    saveAuthSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token || authSession.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
      email: session.user?.email || authSession.email || currentUser?.email || ""
    });
    currentUser = result.user || currentUser;
    await loadUserLocations().catch(() => []);
    updateAccountUi();
    return true;
  })();
  try {
    return await authRefreshInFlight;
  } finally {
    authRefreshInFlight = null;
  }
}

async function authFetch(path, options = {}) {
  if (authRequired) await refreshAuthSession();
  let response = await fetch(apiUrl(path), {
    ...options,
    headers: authRequestHeaders(options.headers || {})
  });
  if (response.status === 401 && authSession?.refresh_token && await refreshAuthSession(true).catch(() => false)) {
    response = await fetch(apiUrl(path), {
      ...options,
      headers: authRequestHeaders(options.headers || {})
    });
  }
  return response;
}

function handleAuthRequired(message = "Your cloud session expired. Sign in again to continue.") {
  clearAuthSession();
  currentUser = null;
  updateAccountUi();
  showLoginOverlay(message);
}

async function validateAuthSession(session = authSession) {
  if (!session?.access_token) throw new Error("No saved login session.");
  await refreshAuthSession();
  const response = await authFetch("/api/auth/session", { method: "GET" });
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(result?.error || "Could not verify login.");
  currentUser = result.user;
  currentLoginEmail = result.user?.email || currentLoginEmail || authSession?.email || "";
  await loadUserLocations().catch(() => []);
  updateAccountUi();
  return result.user;
}

async function signInWithPassword(email, password) {
  if (!authConfig?.enabled) throw new Error("Cloud login is missing the Supabase anon key setup.");
  const normalizedEmail = String(email || "").trim();
  const normalizedPassword = String(password || "");
  if (!normalizedEmail || !normalizedPassword) throw new Error("Email and password are required.");
  const result = await fetchJson("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email: normalizedEmail, password: normalizedPassword })
  });
  const session = result.session;
  if (!session?.access_token) throw new Error("Supabase did not return a login session.");
  if (result.accountType === "staff") {
    currentLoginEmail = result.profile?.user?.email || normalizedEmail;
    clearAuthSession();
    saveStaffSession({ ...session, locationId: result.profile?.locationId || "" }, email);
    window.location.href = "staff.html";
    return { redirectingToStaffPortal: true };
  }
  currentLoginEmail = normalizedEmail;
  saveAuthSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
    email: session.user?.email || email
  });
  currentUser = result.user || null;
  if (!currentUser) await validateAuthSession(authSession);
  await loadUserLocations().catch(() => []);
  updateAccountUi();
  return currentUser;
}

async function changeRequiredPassword(password) {
  const result = await fetchJson("/api/auth/change-password", {
    method: "POST",
    headers: authRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ password })
  });
  currentUser = result.user || { ...(currentUser || {}), passwordChangeRequired: false };
  updateAccountUi();
  return currentUser;
}

async function initializeAuth() {
  try {
    const [config, status] = await Promise.all([
      fetchJson("/api/auth/config"),
      fetchJson("/api/status")
    ]);
    authConfig = config;
    authRequired = status?.mode === "supabase";
    if (!authRequired) {
      hideLoginOverlay();
      updateAccountUi();
      return true;
    }
    if (!authConfig.enabled) {
      clearAuthSession();
      updateAccountUi();
      showLoginOverlay(`Cloud login needs setup: ${authConfig.missing.join(", ")}.`);
      return false;
    }
    if (authSession?.access_token) {
      try {
        await validateAuthSession(authSession);
        if (currentUser?.passwordChangeRequired) {
          showPasswordChangeDialog();
          return false;
        }
        hideLoginOverlay();
        return true;
      } catch {
        clearAuthSession();
      }
    }
    updateAccountUi();
    showLoginOverlay("Sign in to open the cloud scheduler.");
    return false;
  } catch (error) {
    authRequired = true;
    clearAuthSession();
    updateAccountUi();
    if (window.location.protocol === "file:") {
      showLoginOverlay("Open Shift Bay through the local server link.");
      setLoginMessage("Open Shift Bay through the local server link.", "Use http://localhost:8798/ for this cloud-login test. The file version cannot reach the app server.");
    } else {
      showLoginOverlay("Could not check cloud login status.");
      setLoginMessage("Could not check cloud login status.", error.message);
    }
    return false;
  }
}
async function hydrateStateFromServer() {
  if (!SERVER_STORAGE_ENABLED) return;
  setStorageStatus("connecting", "Connecting to the shared scheduler data file...");
  try {
    const statePath = NORMALIZED_SCHEDULE_READ_MODE ? "/api/state?normalizedSchedule=read" : "/api/state";
    let response = await authFetch(statePath, { cache: "no-store" });
    let normalizedSnapshotFallback = false;
    if (!response.ok && NORMALIZED_SCHEDULE_READ_MODE && !LEGACY_SNAPSHOT_OVERRIDE) {
      // The compatibility document is deliberately retained during cutover.
      // A transient normalized-read failure must not leave a manager staring at
      // an empty scheduler when the proven snapshot is still available.
      response = await authFetch("/api/state", { cache: "no-store" });
      normalizedSnapshotFallback = response.ok;
    }
    if (response.ok) {
      const envelope = await response.json();
      setNormalizedScheduleReadBadge(envelope.readSource === "normalized-sandbox" || envelope.readSource === "normalized-live-canary" ? "active" : "unavailable");
      let serverState = normalizeLoadedState(envelope.data || envelope);
      // The primary schedule document is connected at this point. Availability
      // normalization is a separate read and should not make the cloud status
      // look like an unsaved change while that secondary request finishes.
      setStorageStatus(
        "saved",
        normalizedSnapshotFallback
          ? "Normalized data was temporarily unavailable. Loaded the protected compatibility snapshot."
          : envelope.readSource === "normalized-sandbox"
            ? "Loaded normalized Sandbox schedule data."
            : envelope.readSource === "normalized-live-canary"
              ? "Loaded normalized schedule data."
              : "Loaded the shared scheduler data file."
      );
      serverState = await applyNormalizedAvailabilityRead(serverState) || serverState;
      const serverSavedAt = envelope.savedAt || envelope.updatedAt || "";
      if (Number.isInteger(Number(envelope.normalizedScheduleRevision))) {
        lastKnownNormalizedScheduleRevision = Number(envelope.normalizedScheduleRevision);
      }
      serverState.meta = { ...(serverState.meta || {}), serverSavedAt };
      const previousReadSource = localStorage.getItem(readSourceKey()) || "";
      const readSourceChanged = Boolean(previousReadSource && previousReadSource !== CURRENT_READ_SOURCE);
      localStorage.setItem(readSourceKey(), CURRENT_READ_SOURCE);
      const skipLocalRecovery = skipLocalRecoveryOnce;
      skipLocalRecoveryOnce = false;
      const recovery = readCloudRecovery();
      if (LEGACY_SNAPSHOT_OVERRIDE && recovery?.autoReapplyPending) {
        // The explicit compatibility URL is used to inspect or roll back the
        // read source. Preserve any prior browser recovery for diagnostics,
        // but never auto-replay it after a deliberate source-switch test.
        recovery.autoReapplyPending = false;
        recovery.presentedAt = nowIso();
        recovery.quarantinedByLegacySnapshot = true;
        saveCloudRecovery(recovery);
      }
      if (recovery?.autoReapplyPending && recovery.baseData) {
        state = serverState;
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        serverStorageReady = true;
        cloudSaveBlockedByStale = false;
        lastKnownServerSavedAt = serverSavedAt;
        lastKnownServerState = cloneSchedulerState(serverState);
        lastConfirmedMutationFingerprint = schedulerMutationFingerprint(serverState);
        const restored = await reapplyCloudRecoveryAfterRefresh(recovery, serverState, serverSavedAt);
        currentDate = loadLocalActiveWeek(state.settings.weekStart);
        saveLocalActiveWeek({ shared: false });
        finishInitialReadSourceHydrationRender();
        if (!restored?.saved) showStaleRecoveryAlert(readCloudRecovery() || recovery);
        return;
      }
      // `legacySnapshot=1` is a diagnostic rollback view, not a competing
      // browser edit. Never turn that deliberate source switch into a stale
      // recovery prompt or an attempted cloud save.
      // The direct Sandbox canary intentionally does not update the legacy
      // snapshot. Comparing its normalized save timestamp to that older
      // snapshot makes a successful direct write look like stale browser data.
      if (!LEGACY_SNAPSHOT_OVERRIDE && !NORMALIZED_SCHEDULE_DIRECT_WRITE_MODE && !readSourceChanged && !skipLocalRecovery && localStateIsNewerThanServer(state, serverState)) {
        // A browser copy can be newer than the shared document because another
        // device saved first. Never push that copy automatically on startup:
        // doing so creates an immediate 409 and can overwrite another user's
        // work if the server's guard is ever bypassed. Preserve it for review.
        const newerBrowserRecovery = createCloudRecovery(state, state.meta?.serverSavedAt || "", serverSavedAt);
        newerBrowserRecovery.changes = stateCollectionChanges(state, serverState);
        saveCloudRecovery(newerBrowserRecovery);
        state = serverState;
        state.meta = { ...(state.meta || {}), serverSavedAt };
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        serverStorageReady = true;
        cloudSaveBlockedByStale = false;
        lastKnownServerSavedAt = serverSavedAt;
        lastConfirmedMutationFingerprint = schedulerMutationFingerprint(serverState);
        setStorageStatus("saved", "Loaded the latest shared schedule. An older browser copy was preserved for recovery.");
        showStaleRecoveryAlert(newerBrowserRecovery);
        currentDate = loadLocalActiveWeek(state.settings.weekStart);
        saveLocalActiveWeek({ shared: false });
        finishInitialReadSourceHydrationRender();
        return;
      }
      lastKnownServerSavedAt = serverSavedAt;
      lastKnownServerState = cloneSchedulerState(serverState);
      lastConfirmedMutationFingerprint = schedulerMutationFingerprint(serverState);
      cloudSaveBlockedByStale = false;
      state = serverState;
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      serverStorageReady = true;
      // A load must remain read-only. Client-side normalization can make a
      // correctly loaded document look structurally different, so writing it
      // back here creates needless saves and false stale conflicts.
      currentDate = loadLocalActiveWeek(state.settings.weekStart);
      saveLocalActiveWeek({ shared: false });
      finishInitialReadSourceHydrationRender();
      const pendingRecovery = readCloudRecovery();
      if (pendingRecovery && !pendingRecovery.presentedAt && !NORMALIZED_SCHEDULE_DIRECT_WRITE_MODE) {
        if (!pendingRecovery.changes?.length) {
          pendingRecovery.changes = stateCollectionChanges(pendingRecovery.data, serverState);
          saveCloudRecovery(pendingRecovery);
        }
        showStaleRecoveryAlert(pendingRecovery);
      }
      return;
    }
    setNormalizedScheduleReadBadge("unavailable");
    if (NORMALIZED_AVAILABILITY_READ_MODE) {
      normalizedAvailabilityReadState = "availabilityUnavailable";
      updateNormalizedReadBadge();
    }
    if (response.status === 404) {
      const createCleanLocation = skipLocalRecoveryOnce;
      skipLocalRecoveryOnce = false;
      if (createCleanLocation) {
        state = defaultState();
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        finishInitialReadSourceHydrationRender();
      }
      serverStorageReady = true;
      lastKnownServerSavedAt = "";
      setStorageStatus("saving", "Creating the first shared scheduler data file...");
      await persistStateToServer();
      return;
    }
    if (response.status === 401 || response.status === 403) { handleAuthRequired(); return; }
    throw new Error(`Load failed: ${response.status}`);
  } catch {
    if (NORMALIZED_SCHEDULE_READ_MODE && NORMALIZED_LIVE_CANARY_MODE) setNormalizedScheduleReadBadge("unavailable");
    if (NORMALIZED_AVAILABILITY_READ_MODE && NORMALIZED_LIVE_CANARY_MODE) {
      normalizedAvailabilityReadState = "availabilityUnavailable";
      updateNormalizedReadBadge();
    }
    skipLocalRecoveryOnce = false;
    serverStorageReady = false;
    setStorageStatus("error", "Could not reach the shared scheduler file. Browser backup is still saved locally.");
    showConflict("Could not reach the shared scheduler file. This window is using its browser backup for now.");
    finishInitialReadSourceHydrationRender();
  }
}

function finishInitialReadSourceHydrationRender() {
  initialReadSourceHydrationPending = false;
  renderAll({ skipSave: true });
  updateZoomVisibility();
}

function localStateIsNewerThanServer(localState, serverState) {
  const localServerSavedAt = Date.parse(localState?.meta?.serverSavedAt || "");
  const serverSavedAt = Date.parse(serverState?.meta?.serverSavedAt || "");
  if (serverSavedAt) {
    if (!localServerSavedAt) return false;
    if (localServerSavedAt < serverSavedAt - 1000) return false;
    if (Math.abs(localServerSavedAt - serverSavedAt) <= 1000) return false;
  }
  const localTime = Date.parse(localState?.meta?.updatedAt || "");
  const serverTime = Date.parse(serverState?.meta?.updatedAt || "");
  if (!localTime || !serverTime) return false;
  if (localTime <= serverTime + 1000) return false;
  const localCounts = stateRecordCount(localState);
  const serverCounts = stateRecordCount(serverState);
  return localCounts > serverCounts || localTime > serverTime + 5000;
}

function hasUnsavedSchedulerChanges() {
  if (!lastKnownServerState) return false;
  return REBASABLE_STATE_COLLECTIONS.some((key) => !sameSchedulerValue(state[key] || [], lastKnownServerState[key] || []))
    || REBASABLE_STATE_OBJECTS.some((key) => !sameSchedulerValue(state[key] || {}, lastKnownServerState[key] || {}));
}

async function checkForNewerSharedSchedule() {
  if (!SERVER_STORAGE_ENABLED || !serverStorageReady || cloudFreshnessCheckInFlight || serverSaveInFlight || serverSavePending || cloudSaveBlockedByStale) return;
  if (document.visibilityState === "hidden") return;
  cloudFreshnessCheckInFlight = true;
  try {
    const response = await authFetch("/api/status", { cache: "no-store" });
    if (!response.ok) return;
    const status = await response.json().catch(() => ({}));
    const remoteSavedAt = String(status.updatedAt || "");
    if (!remoteSavedAt || !lastKnownServerSavedAt || Date.parse(remoteSavedAt) <= Date.parse(lastKnownServerSavedAt) + 1000) return;
    if (employeeFormHasUnsavedChanges()) {
      setStorageStatus("saving", "A newer shared schedule is available. Save or discard this employee profile before refreshing.");
      return;
    }
    if (hasUnsavedSchedulerChanges()) {
      const recovery = createCloudRecovery(state, lastKnownServerSavedAt, remoteSavedAt, lastKnownServerState);
      recovery.changes = stateCollectionChanges(state, lastKnownServerState);
      saveCloudRecovery(recovery);
    }
    await hydrateStateFromServer();
  } catch {
    // A transient network failure should not interrupt schedule work. The next
    // focus, reconnect, or interval check will try again.
  } finally {
    cloudFreshnessCheckInFlight = false;
  }
}

function stateRecordCount(candidate) {
  return ["employees", "shifts", "unassignedShifts", "timeOffRequests"].reduce((sum, key) => {
    return sum + (Array.isArray(candidate?.[key]) ? candidate[key].length : 0);
  }, 0);
}

function pushUndo() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 50) undoStack.shift();
}

function restoreUndo() {
  const snapshot = undoStack.pop();
  if (!snapshot) return;
  state = JSON.parse(snapshot);
  saveState();
  renderAll();
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfWeek(date, weekStart) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (d.getDay() - Number(weekStart) + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function weekDates() {
  return Array.from({ length: 7 }, (_, i) => addDays(currentDate, i));
}

function dateForWeekday(dayIndex) {
  const match = weekDates().find((date) => date.getDay() === Number(dayIndex));
  return formatDateKey(match || currentDate);
}

function displayDate(date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function displayName(employee) {
  if (!employee) return "Unassigned";
  const first = cleanCell(employee.nickname) || cleanCell(employee.firstName);
  const last = cleanCell(employee.lastName);
  if (state.settings.nameDisplay === "first") return first || last || fullEmployeeName(employee);
  if (state.settings.nameDisplay === "firstInitial") return `${first || cleanCell(employee.firstName)} ${last ? `${last[0]}.` : ""}`.trim();
  return [first || cleanCell(employee.firstName), last].filter(Boolean).join(" ") || fullEmployeeName(employee);
}

function firstEmployeeSearchLetter(employee) {
  const name = displayName(employee) || fullEmployeeName(employee) || "";
  return name.trim().charAt(0).toLowerCase();
}

function employeeOptionLabel(employee) {
  return cleanCell(displayName(employee)) ||
    cleanCell(fullEmployeeName(employee)) ||
    cleanCell(employee?.firstName) ||
    cleanCell(employee?.nickname) ||
    "Unnamed employee";
}

function fullEmployeeName(employee) {
  if (!employee) return "";
  return `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
}

function roleById(id) {
  return state.roles.find((role) => role.id === id);
}

function employeeById(id) {
  return state.employees.find((employee) => employee.id === id);
}

function schedulableEmployees() {
  return state.employees.filter((employee) => employee.active !== false && !employee.archived);
}

function isPrintableScheduledEmployee(employeeId) {
  const employee = employeeById(employeeId);
  return Boolean(employee && employee.active !== false && !employee.archived);
}

function sortedEmployeesForSelect(employees = schedulableEmployees()) {
  return [...employees].sort((a, b) => employeeOptionLabel(a).localeCompare(employeeOptionLabel(b), undefined, { sensitivity: "base" }));
}

function templateById(id) {
  return state.templates.find((template) => template.id === id);
}

function normalizeTime(value, fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/until\s*volume/i.test(text)) return "Until Volume";
  const compact = text.toLowerCase().replace(/\s+/g, "");
  if (compact === "cl" || compact === "close" || compact === "closing") return "11:59 PM";
  const match = compact.match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
  if (!match) return text;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const suffix = match[3];
  if (suffix?.startsWith("p") && hour < 12) hour += 12;
  if (suffix?.startsWith("a") && hour === 12) hour = 0;
  if (!suffix && hour > 23) return text;
  const displayHour = hour % 12 || 12;
  const ampm = hour >= 12 ? "PM" : "AM";
  return `${displayHour}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function minutesFromTime(value) {
  if (!value || /until\s*volume/i.test(value)) return null;
  const normalized = normalizeTime(value);
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function timeFromMinutes(minutes) {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const displayHour = hour % 12 || 12;
  const ampm = hour >= 12 ? "PM" : "AM";
  return `${displayHour}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (aStart == null || bStart == null) return false;
  const endA = aEnd == null ? aStart + 1 : aEnd;
  const endB = bEnd == null ? bStart + 1 : bEnd;
  return aStart < endB && bStart < endA;
}

function getShiftRange(shift) {
  return {
    start: minutesFromTime(shift.start),
    end: shift.untilVolume ? null : minutesFromTime(shift.end)
  };
}

function getCoverageRange(shift) {
  const start = minutesFromTime(shift.start);
  let end = shift.untilVolume ? 1440 : minutesFromTime(shift.end);
  if (start != null && end != null && end <= start) end += 1440;
  return { start, end };
}

function trainingShiftMatchesTrainerShift(trainingShift, trainerShift) {
  if (!trainingShift?.training?.isTraining || !trainerShift) return false;
  if (trainingShift.id === trainerShift.id) return false;
  if (trainingShift.training.trainerId !== trainerShift.employeeId) return false;
  if (trainingShift.date !== trainerShift.date) return false;
  if (trainingShift.roleId !== trainerShift.roleId) return false;
  const trainingRange = getCoverageRange(trainingShift);
  const trainerRange = getCoverageRange(trainerShift);
  return rangesOverlap(trainingRange.start, trainingRange.end, trainerRange.start, trainerRange.end);
}

function getMealCoverageRange(shift) {
  const start = minutesFromTime(shift.start);
  if (start == null) return { start: null, end: null };
  let end = minutesFromTime(shift.end);
  if (shift.untilVolume) {
    const periods = getMealPeriodsForDate(shift.date);
    if (shift.isFlexDouble) {
      end = periods.reduce((latest, period) => Math.max(latest, period.endMinutes), start);
    } else {
      end = estimatedUntilVolumeEnd(shift);
    }
  }
  if (end != null && end <= start) end += 1440;
  return { start, end };
}

function getTimelineRange(shift) {
  const start = minutesFromTime(shift.start);
  if (start == null) return { start: null, end: null };
  let end = shift.untilVolume ? estimatedUntilVolumeEnd(shift) : minutesFromTime(shift.end);
  if (end == null || end <= start) {
    const coverage = getMealCoverageRange(shift);
    end = coverage.end;
  }
  if (end != null && end <= start) end += 1440;
  return { start, end: end ?? start + 60 };
}

function getMealPeriodsForDate(dateKey) {
  const dayIndex = parseDateKey(dateKey).getDay();
  return (state.settings.mealPeriods?.[dayIndex] || [])
    .map((period) => ({
      ...period,
      startMinutes: minutesFromTime(period.start),
      endMinutes: minutesFromTime(period.end)
    }))
    .filter((period) => period.name && period.startMinutes != null && period.endMinutes != null);
}

function defaultCloserEndTimeForDate(dateKey) {
  const periods = getMealPeriodsForDate(dateKey);
  if (!periods.length) return "";
  const dinner = periods.find((period) => String(period.name).toLowerCase() === "dinner");
  const closingEnd = dinner?.endMinutes ?? periods.reduce((latest, period) => Math.max(latest, period.endMinutes), 0);
  const buffer = Number(state.settings.closerEndBufferMinutes ?? 60) || 0;
  return timeFromMinutes(closingEnd + buffer);
}

function getMealsForShift(shift) {
  const range = getMealCoverageRange(shift);
  if (range.start == null || range.end == null) return [];
  return getMealPeriodsForDate(shift.date)
    .filter((period) => rangesOverlap(range.start, range.end, period.startMinutes, period.endMinutes))
    .map((period) => period.name);
}

function fohRoles() {
  return state.roles.filter((role) => role.department === "FOH");
}

function employeeAvailability(employee, dayIndex, dateKey = "") {
  if (!employee) return [];
  if (dateKey) {
    const weekKey = formatDateKey(startOfWeek(parseDateKey(dateKey), state.settings.weekStart));
    const override = employee.weeklyAvailability?.[weekKey];
    if (override && Object.prototype.hasOwnProperty.call(employee.weeklyAvailability || {}, weekKey)) return override[dayIndex] || [];
  }
  if (employee.callWeekly) return [];
  if (dateKey) {
    const patternAvailability = availabilityFromPatternsForDate(employee, dateKey);
    if (patternAvailability) return patternAvailability;
  }
  if (dateKey && Array.isArray(employee.availabilitySchedule)) {
    const version = employee.availabilitySchedule
      .filter((item) => item && item.effectiveDate && item.effectiveDate <= dateKey)
      .sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)))[0];
    if (version) return version.availability?.[dayIndex] || [];
  }
  return employee.availability?.[dayIndex] || [];
}

function unavailableRangesForEmployeeDate(employee, dateKey) {
  const dayIndex = parseDateKey(dateKey).getDay();
  const ranges = employeeAvailability(employee, dayIndex, dateKey)
    .map((range) => ({
      start: minutesFromTime(range.start),
      end: minutesFromTime(range.end)
    }))
    .filter((range) => range.start != null && range.end != null)
    .map((range) => ({
      start: Math.max(0, Math.min(1440, range.start)),
      end: Math.max(0, Math.min(1440, range.end <= range.start || range.end >= 1439 ? 1440 : range.end))
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  if (!ranges.length) return [{ start: 0, end: 1440 }];
  const merged = [];
  ranges.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  });
  const unavailable = [];
  let cursor = 0;
  merged.forEach((range) => {
    if (range.start > cursor) unavailable.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  });
  if (cursor < 1440) unavailable.push({ start: cursor, end: 1440 });
  return unavailable;
}

function unavailableRangeLabel(range) {
  if (range.start <= 0 && range.end >= 1440) return "All day";
  if (range.start <= 0) return `Before ${timeFromMinutes(range.end)}`;
  if (range.end >= 1440) return `After ${timeFromMinutes(range.start)}`;
  return `${timeFromMinutes(range.start)}-${timeFromMinutes(range.end)}`;
}

function renderUnavailableBadge(employee, dateKey) {
  if (state.settings.hideDefaultAvailabilityBlocks && employeeUsesDefaultAvailability(employee, dateKey)) return "";
  const ranges = unavailableRangesForEmployeeDate(employee, dateKey);
  if (!ranges.length) return "";
  const allDay = ranges.some((range) => range.start <= 0 && range.end >= 1440);
  return `
    <div class="unavailable-badge ${allDay ? "unavailable-all-day" : "unavailable-part-day"}" title="Unavailable: ${ranges.map(unavailableRangeLabel).join(", ")}">
      <strong>Unavailable</strong>
      <span>${ranges.map(unavailableRangeLabel).join(", ")}</span>
    </div>
  `;
}

function employeeUsesDefaultAvailability(employee, dateKey = "") {
  if (!employee || employee.callWeekly) return false;
  const hasRegularAvailability = Object.values(employee.availability || {}).some((ranges) => Array.isArray(ranges) && ranges.length);
  if (hasRegularAvailability) return false;
  if (dateKey) {
    const weekKey = formatDateKey(startOfWeek(parseDateKey(dateKey), state.settings.weekStart));
    const hasWeeklyAvailability = Object.values(employee.weeklyAvailability?.[weekKey] || {}).some((ranges) => Array.isArray(ranges) && ranges.length);
    if (hasWeeklyAvailability) return false;
  }
  return true;
}

function employeeHasAvailabilityForDate(employee, dateKey) {
  const dayIndex = parseDateKey(dateKey).getDay();
  return employeeAvailability(employee, dayIndex, dateKey).some((range) => {
    const start = minutesFromTime(range.start);
    let end = minutesFromTime(range.end);
    if (start != null && end != null && end <= start) end += 1440;
    return start != null && end != null && end > start;
  });
}

function isScheduleBlock(request = {}) {
  return request.kind === "block" || request.source === "Day Block";
}

function scheduleBlockType(request = {}) {
  return cleanCell(request.blockType || request.type || request.daypart || "Day Block");
}

function timeOffShortLabel(request = {}) {
  return isScheduleBlock(request) ? "BLOCK" : "RO";
}

function timeOffLongLabel(request = {}) {
  return isScheduleBlock(request) ? scheduleBlockType(request) : "Request off";
}

function requestOffIsFullDay(request = {}) {
  if (isScheduleBlock(request) && request.allDay === false) return false;
  const daypart = String(request.daypart || request.type || request.duration || "").trim();
  if (!daypart) return true;
  return /\b(all\s*day|full\s*day|entire\s*day)\b/i.test(daypart);
}

function requestOffTimelineRange(request = {}, dateKey = request.date) {
  const shortLabel = timeOffShortLabel(request);
  if (requestOffIsFullDay(request)) return { start: 0, end: 1440, label: `${shortLabel} all day` };
  const daypart = normalizeMealName(request.daypart || request.type || request.duration || "");
  const periods = getMealPeriodsForDate(dateKey).filter((period) => period.name === daypart);
  if (periods.length) {
    const start = Math.min(...periods.map((period) => period.startMinutes));
    const end = Math.max(...periods.map((period) => period.endMinutes));
    return { start, end, label: `${shortLabel} ${daypart}` };
  }
  const explicitStart = minutesFromTime(request.start || "");
  let explicitEnd = minutesFromTime(request.end || "");
  if (explicitStart != null && explicitEnd != null) {
    if (explicitEnd <= explicitStart) explicitEnd += 1440;
    return { start: Math.max(0, explicitStart), end: Math.min(1440, explicitEnd), label: shortLabel };
  }
  const text = `${request.daypart || ""} ${request.note || ""}`;
  const timeRange = parseTextTimeRange(text);
  if (timeRange) return { ...timeRange, label: shortLabel };
  return { start: 0, end: 1440, label: `${shortLabel} ${cleanCell(request.daypart || request.note || "partial")}` };
}

function parseTextTimeRange(text = "") {
  const matches = String(text).match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)\b/gi);
  if (!matches || matches.length < 2) return null;
  const start = minutesFromTime(matches[0]);
  let end = minutesFromTime(matches[1]);
  if (start == null || end == null) return null;
  if (end <= start) end += 1440;
  return { start: Math.max(0, start), end: Math.min(1440, end) };
}

function employeeHasFullDayRequestOff(employeeId, dateKey) {
  return timeOffForEmployeeDate(employeeId, dateKey).some(requestOffIsFullDay);
}

function employeeHasUsableAvailabilityForDate(employee, dateKey) {
  return employeeHasAvailabilityForDate(employee, dateKey) && !employeeHasFullDayRequestOff(employee.id, dateKey);
}

function employeeHasAvailabilityForWeek(employee) {
  return weekDates().some((date) => employeeHasUsableAvailabilityForDate(employee, formatDateKey(date)));
}

function renderRoleCapabilityStrip(employee) {
  const fohRoles = state.roles.filter((role) => role.department === "FOH");
  if (!fohRoles.length) return "";
  const trainedRoles = new Set(employee.roleTraining || []);
  const trainingRoles = new Set(state.shifts
    .filter((shift) => shift.training?.isTraining && (shift.training.traineeId || shift.employeeId) === employee.id)
    .map((shift) => shift.roleId));
  return `
    <div class="role-capability-strip" aria-label="FOH role capabilities">
      ${fohRoles.map((role) => {
        const trained = trainedRoles.has(role.id);
        const emergencyOnly = trained && employeeIsEmergencyOnlyForRole(employee, role.id);
        const training = !trained && trainingRoles.has(role.id);
        const className = emergencyOnly ? "emergency" : trained ? "trained" : training ? "training" : "";
        const title = emergencyOnly ? `${role.name} emergency only` : trained ? role.name : training ? `${role.name} training in progress` : `${role.name} not trained`;
        return `<span class="role-capability ${className}" style="${trained || training ? `--role-color:${role.color || "#64748b"}` : ""}" title="${title}"></span>`;
      }).join("")}
    </div>
  `;
}

function rangeInsideAvailabilityByDay(employee, dayIndex, start, end, dateKey = "") {
  const ranges = employeeAvailability(employee, dayIndex, dateKey);
  if (!ranges.length || start == null || end == null) return false;
  return ranges.some((range) => {
    const availableStart = minutesFromTime(range.start);
    let availableEnd = minutesFromTime(range.end);
    if (availableStart != null && availableEnd != null && availableEnd <= availableStart) availableEnd += 1440;
    return availableStart != null && availableEnd != null && start >= availableStart && end <= availableEnd;
  });
}

function rangeInsideAvailability(employee, dateKey, shift) {
  const ranges = employeeAvailability(employee, parseDateKey(dateKey).getDay(), dateKey);
  if (!ranges.length) return false;
  const shiftRange = getShiftRange(shift);
  if (shiftRange.start == null || shiftRange.end == null) return true;
  return ranges.some((range) => {
    const start = minutesFromTime(range.start);
    let end = minutesFromTime(range.end);
    if (start != null && end != null && end <= start) end += 1440;
    return start != null && end != null && shiftRange.start >= start && shiftRange.end <= end;
  });
}

function weeklyRuleWarnings(employee, proposedShift) {
  const rules = employee?.weeklyRules || [];
  if (!rules.length || !proposedShift.date) return [];
  const warnings = [];
  rules.forEach((rule) => {
    const maxWorkDays = Number(rule.maxWorkDays) || 0;
    const days = (rule.days || []).map(Number);
    const proposedDay = parseDateKey(proposedShift.date).getDay();
    if (!maxWorkDays || !days.includes(proposedDay)) return;
    const weekStart = startOfWeek(parseDateKey(proposedShift.date), state.settings.weekStart);
    const weekEnd = formatDateKey(addDays(weekStart, 6));
    const weekStartKey = formatDateKey(weekStart);
    const workedDays = new Set(
      state.shifts
        .filter((shift) => (
          shift.id !== proposedShift.id &&
          shift.employeeId === proposedShift.employeeId &&
          shift.date >= weekStartKey &&
          shift.date <= weekEnd &&
          days.includes(parseDateKey(shift.date).getDay())
        ))
        .map((shift) => shift.date)
    );
    workedDays.add(proposedShift.date);
    if (workedDays.size > maxWorkDays) {
      const label = rule.note ? ` (${rule.note})` : "";
      const dayNames = days.map((day) => DAYS[day].slice(0, 3)).join("/");
      warnings.push(`${displayName(employee)} is limited to ${maxWorkDays} work day${maxWorkDays === 1 ? "" : "s"} across ${dayNames} each week${label}.`);
    }
  });
  return warnings;
}

function requestOffOverlapsShift(request, shift) {
  if (!request || !shift || request.date !== shift.date) return false;
  if (requestOffIsFullDay(request)) return true;
  const requestRange = requestOffTimelineRange(request, request.date);
  const shiftRange = getCoverageRange(shift);
  if (requestRange.start == null || requestRange.end == null || shiftRange.start == null || shiftRange.end == null) return true;
  return rangesOverlap(requestRange.start, requestRange.end, shiftRange.start, shiftRange.end);
}

function timeOffWarnings(employee, proposedShift) {
  const requests = (state.timeOffRequests || []).filter((request) => (
    request.employeeId === employee?.id &&
    request.date === proposedShift.date &&
    requestOffOverlapsShift(request, proposedShift)
  ));
  if (!requests.length) return [];
  return requests.map((request) => {
    const label = isScheduleBlock(request) ? `${scheduleBlockType(request)} block` : "Ctuit time off";
    const daypart = request.daypart && !isScheduleBlock(request) ? ` ${request.daypart}` : "";
    const time = isScheduleBlock(request) && !requestOffIsFullDay(request) ? ` ${request.start || ""}-${request.end || ""}` : "";
    const note = request.note ? ` (${request.note})` : "";
    return `${displayName(employee)} has ${label}${daypart}${time} on ${displayDate(parseDateKey(request.date))}${note}.`;
  });
}

function sameEmployeeOverlapWarnings(proposedShift) {
  if (!proposedShift.employeeId || !proposedShift.date) return [];
  const range = getCoverageRange(proposedShift);
  if (range.start == null || range.end == null) return [];
  return state.shifts
    .filter((item) => (
      item.id !== proposedShift.id &&
      item.employeeId === proposedShift.employeeId &&
      item.date === proposedShift.date
    ))
    .filter((item) => {
      const otherRange = getCoverageRange(item);
      return rangesOverlap(range.start, range.end, otherRange.start, otherRange.end);
    })
    .map((item) => {
      const otherRole = roleById(item.roleId);
      return `Overlaps with ${otherRole?.name || "another shift"} ${item.start}-${item.untilVolume ? "Until Volume" : item.end}.`;
    });
}

function shiftEndForRest(shift) {
  const range = getCoverageRange(shift);
  if (range.end != null && range.end !== 1440) return range.end;
  const start = minutesFromTime(shift.start);
  return start != null && start >= 15 * 60 ? 23 * 60 : range.end;
}

function isOpeningShift(shift) {
  const start = minutesFromTime(shift.start);
  return start != null && start <= OPENING_SHIFT_CUTOFF_MINUTES;
}

function isClosingShift(shift) {
  if (shift.isCloser) return true;
  const end = shiftEndForRest(shift);
  const start = minutesFromTime(shift.start);
  return (end != null && end >= CLOSING_SHIFT_CUTOFF_MINUTES) || (shift.untilVolume && start != null && start >= 15 * 60);
}

function restHoursBetweenShifts(previousShift, nextShift) {
  const previousEnd = shiftEndForRest(previousShift);
  const nextStart = minutesFromTime(nextShift.start);
  if (previousEnd == null || nextStart == null) return null;
  const dayGap = Math.round((parseDateKey(nextShift.date) - parseDateKey(previousShift.date)) / 86400000);
  return ((dayGap * 1440) + nextStart - previousEnd) / 60;
}

function clopenWarnings(employee, proposedShift) {
  if (!employee?.id || !proposedShift.date) return [];
  const warnings = [];
  const previousDate = formatDateKey(addDays(parseDateKey(proposedShift.date), -1));
  const nextDate = formatDateKey(addDays(parseDateKey(proposedShift.date), 1));
  const related = state.shifts.filter((shift) => shift.id !== proposedShift.id && shift.employeeId === employee.id);
  if (isOpeningShift(proposedShift)) {
    related
      .filter((shift) => shift.date === previousDate && isClosingShift(shift))
      .forEach((shift) => {
        const rest = restHoursBetweenShifts(shift, proposedShift);
        if (rest == null || rest < MIN_REST_AFTER_CLOSE_HOURS) {
          warnings.push(`${displayName(employee)} may clopen: closes ${displayDate(parseDateKey(shift.date))} ${shift.start}-${shift.untilVolume ? "Vol" : shift.end}, then opens ${proposedShift.start}.`);
        }
      });
  }
  if (isClosingShift(proposedShift)) {
    related
      .filter((shift) => shift.date === nextDate && isOpeningShift(shift))
      .forEach((shift) => {
        const rest = restHoursBetweenShifts(proposedShift, shift);
        if (rest == null || rest < MIN_REST_AFTER_CLOSE_HOURS) {
          warnings.push(`${displayName(employee)} may clopen: closes ${displayDate(parseDateKey(proposedShift.date))} ${proposedShift.start}-${proposedShift.untilVolume ? "Vol" : proposedShift.end}, then opens ${shift.start}.`);
        }
      });
  }
  return warnings;
}

function validateShift(shift, options = {}) {
  const employee = employeeById(shift.employeeId);
  const role = roleById(shift.roleId);
  const errors = [];
  const warnings = [];
  if (!employee) errors.push("Choose an employee.");
  if (!role) errors.push("Choose a role.");
  if (employee && role) {
    const trainingMessages = [];
    if (!normalizeEmployeeDepartments(employee).includes(shift.department || role.department || "FOH")) {
      trainingMessages.push(`${displayName(employee)} is not marked for ${shift.department || role.department || "this department"}.`);
    }
    if (!employee.roleTraining?.includes(role.id)) trainingMessages.push(`${displayName(employee)} is not trained as ${role.name}.`);
    const trainedMealsForRole = employeeMealsForRole(employee, role.id);
    const missingMeals = getMealsForShift(shift).filter((meal) => !trainedMealsForRole.includes(meal));
    if (missingMeals.length) trainingMessages.push(`${displayName(employee)} is not trained for ${missingMeals.join(", ")}.`);
    if (shift.training?.isTraining) {
      // A trainee is expected to be missing this training; warn only on trainer setup below.
    } else if (shift.department === "FOH") errors.push(...trainingMessages);
    else warnings.push(...trainingMessages);
  }
  if (closerTrainingWarningNeeded(employee, shift)) {
    warnings.push(`${displayName(employee)} is not marked as trained to close.`);
  }
  if (employee && shiftNeedsLunchCloserTraining(shift) && !employee.canLunchClose && !shift.training?.isTraining) {
    warnings.push(`${displayName(employee)} is not marked as available for lunch closing.`);
  }
  if (employee && !rangeInsideAvailability(employee, shift.date, shift)) {
    warnings.push(`${displayName(employee)} is outside normal availability.`);
  }
  if (employee?.noDoubles && employeeHasAnyShiftOnDate(employee.id, shift.date, shift.id)) {
    warnings.push(`${displayName(employee)} is marked No Doubles and is already scheduled that day.`);
  }
  if (employee) warnings.push(...timeOffWarnings(employee, shift));
  if (shift.training?.isTraining) {
    const trainee = employeeById(shift.training.traineeId);
    const trainer = employeeById(shift.training.trainerId);
    if (!trainee && !trainer) warnings.push("Training shift needs both a trainee and a trainer.");
    else if (trainee && !trainer) warnings.push(`${displayName(trainee)} is marked as training, but no trainer is assigned.`);
    else if (!trainee && trainer) warnings.push(`${displayName(trainer)} is marked as training someone, but no trainee is assigned.`);
    if (trainer && !trainer.trainerRoles?.includes(shift.roleId)) warnings.push(`${displayName(trainer)} is not marked as a trainer for ${role?.name || "this role"}.`);
  }
  if (employee) warnings.push(...weeklyRuleWarnings(employee, shift));
  if (employee) warnings.push(...sameEmployeeOverlapWarnings(shift));
  if (employee) warnings.push(...clopenWarnings(employee, shift));
  if (options.targetHasShift) errors.push("That spot already has a shift. Open the shift to edit it instead.");
  return { errors, warnings };
}

function shiftNeedsLunchCloserTraining(shift) {
  return Boolean(shift.isLunchCloser);
}

function dayHasTrainedCloser(shift) {
  if (!shift?.date) return false;
  return state.shifts.some((item) => {
    if (item.id === shift.id || item.date !== shift.date || !item.isCloser) return false;
    const employee = employeeById(item.employeeId);
    return Boolean(employee?.canClose);
  });
}

function closerTrainingWarningNeeded(employee, shift) {
  if (!employee || !shift.isCloser || employee.canClose || shift.training?.isTraining) return false;
  if ((state.settings.closerTrainingRule || "onePerDay") === "allClosers") return true;
  return !dayHasTrainedCloser(shift);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function showAppConfirm({ title = "Warning", message = "This change has warnings.", items = [], confirmText = "Continue Anyway", cancelText = "Cancel" } = {}) {
  const dialog = $("warningConfirmDialog");
  if (!dialog) return Promise.resolve(false);
  $("warningConfirmTitle").textContent = title;
  $("warningConfirmMessage").textContent = message;
  $("warningConfirmList").innerHTML = items.length
    ? items.map((item) => `<div>${escapeHtml(item)}</div>`).join("")
    : "";
  $("warningConfirmProceedBtn").textContent = confirmText;
  $("warningConfirmCancelBtn").textContent = cancelText;
  return new Promise((resolve) => {
    const cleanup = (value) => {
      $("warningConfirmProceedBtn").onclick = null;
      $("warningConfirmCancelBtn").onclick = null;
      dialog.oncancel = null;
      dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    $("warningConfirmProceedBtn").onclick = () => cleanup(true);
    $("warningConfirmCancelBtn").onclick = () => cleanup(false);
    dialog.oncancel = (event) => {
      event.preventDefault();
      cleanup(false);
    };
    dialog.onclose = () => cleanup(false);
    dialog.showModal();
  });
}

function showAppChoice({ title = "Choose Action", message = "", items = [], choices = [] } = {}) {
  const dialog = $("warningConfirmDialog");
  if (!dialog || !choices.length) return Promise.resolve("");
  $("warningConfirmTitle").textContent = title;
  $("warningConfirmMessage").textContent = message;
  $("warningConfirmList").innerHTML = items.length
    ? items.map((item) => `<div>${escapeHtml(item)}</div>`).join("")
    : "";
  const actions = dialog.querySelector(".app-confirm-actions");
  const original = actions.innerHTML;
  actions.innerHTML = choices.map((choice, index) => (
    `<button type="button" class="${index === 0 ? "primary" : ""}" data-choice-value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</button>`
  )).join("");
  return new Promise((resolve) => {
    const cleanup = (value) => {
      dialog.oncancel = null;
      dialog.onclose = null;
      actions.innerHTML = original;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    actions.querySelectorAll("[data-choice-value]").forEach((button) => {
      button.onclick = () => cleanup(button.dataset.choiceValue);
    });
    dialog.oncancel = (event) => {
      event.preventDefault();
      cleanup("");
    };
    dialog.onclose = () => cleanup("");
    dialog.showModal();
  });
}

async function confirmWarnings(warnings, options = {}) {
  if (!warnings.length) return true;
  if (state.settings.ignoreWarnings) {
    showConflict(`Developer mode allowed warning-level change: ${warnings.join(" ")}`);
    return true;
  }
  const confirmText = options.confirmText || "Continue Anyway";
  return showAppConfirm({
    title: options.title || "Warning",
    message: options.message || "This change has warnings. Continue anyway?",
    items: warnings,
    confirmText
  });
}

function employeeFormSnapshot() {
  const form = $("employeeForm");
  if (!form) return "";
  const values = Array.from(form.querySelectorAll("input, select, textarea"))
    .filter((field) => field.type !== "file" && field.id !== "weeklyAvailabilityWeek")
    .map((field, index) => {
      const dataKey = Object.entries(field.dataset || {})
        .find(([key]) => /availability|rule|pay|training|role|department/i.test(key));
      return {
        key: field.id || field.name || (dataKey ? `${dataKey[0]}:${dataKey[1]}` : `field:${index}`),
        value: field.type === "checkbox" || field.type === "radio" ? Boolean(field.checked) : field.value
      };
    });
  values.push({ key: "weeklyAvailabilityVisible", value: !Boolean($("weeklyAvailabilityFieldset")?.hidden) });
  return JSON.stringify(values);
}

function markEmployeeFormDirty() {
  if (employeeFormHydrating) return;
  employeeFormDirty = true;
}

function markEmployeeFormClean() {
  employeeFormCleanSnapshot = employeeFormSnapshot();
  employeeFormDirty = false;
}

async function submitEmployeeFormDirectly() {
  const form = $("employeeForm");
  if (!form || typeof form.onsubmit !== "function") {
    showConflict("The employee save action is not available. Refresh Shift Bay and try again.");
    return false;
  }
  try {
    return await form.onsubmit.call(form, {
      preventDefault() {},
      target: form,
      currentTarget: form
    });
  } catch (error) {
    console.error("Employee profile save failed", error);
    showConflict(`Employee profile could not be saved: ${error?.message || "unknown save error"}`);
    return false;
  }
}

function employeeFormHasUnsavedChanges() {
  const form = $("employeeForm");
  if (!form || !employeeFormCleanSnapshot || !employeeFormDirty) return false;
  return employeeFormSnapshot() !== employeeFormCleanSnapshot;
}

async function confirmDiscardEmployeeChanges() {
  if (!employeeFormHasUnsavedChanges()) return true;
  return showAppConfirm({
    title: "Unsaved Employee Changes",
    message: "This employee profile has changes that have not been saved. Leave without saving them?",
    confirmText: "Leave Without Saving",
    cancelText: "Stay"
  });
}

function weekDateKeys() {
  return weekDates().map(formatDateKey);
}

function loadDismissedScheduleIssues() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_ISSUES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id) : [];
  } catch {
    return [];
  }
}

function saveDismissedScheduleIssues() {
  localStorage.setItem(DISMISSED_ISSUES_KEY, JSON.stringify(dismissedScheduleIssues.slice(-80)));
}

function issueId(issue) {
  return [
    issue.type || "issue",
    issue.shiftId || "",
    issue.date || "",
    issue.roleId || "",
    issue.meal || "",
    issue.message || ""
  ].join("|");
}

function dismissedIssueIds() {
  return new Set(dismissedScheduleIssues.map((item) => item.id));
}

function collectScheduleIssues() {
  const dates = weekDateKeys();
  const issues = [];
  dates.forEach((dateKey) => {
    coverageShortfalls(dateKey).forEach((item) => {
      const role = roleById(item.roleId);
      issues.push({
        type: "coverage",
        date: dateKey,
        roleId: item.roleId,
        meal: item.meal,
        message: `${displayDate(parseDateKey(dateKey))} ${item.meal}: ${role?.name || "Role"} needs ${item.need}, scheduled ${item.have}.`
      });
    });
  });
  state.shifts
    .filter((shift) => dates.includes(shift.date))
    .forEach((shift) => {
      const employee = employeeById(shift.employeeId);
      const result = validateShift(shift);
      [...result.errors, ...result.warnings].forEach((message) => {
        issues.push({
          type: result.errors.includes(message) ? "error" : "warning",
          shiftId: shift.id,
          employeeId: shift.employeeId,
          roleId: shift.roleId,
          date: shift.date,
          message: `${displayName(employee)}: ${message}`
        });
      });
    });
  return issues.map((issue) => ({ ...issue, id: issueId(issue) }));
}

function activeScheduleIssues() {
  const dismissed = dismissedIssueIds();
  return collectScheduleIssues().filter((issue) => !dismissed.has(issue.id));
}

function dismissScheduleIssue(issue) {
  if (!issue?.id) return;
  dismissedScheduleIssues = [
    ...dismissedScheduleIssues.filter((item) => item.id !== issue.id),
    { id: issue.id, message: issue.message, type: issue.type, dismissedAt: nowIso() }
  ].slice(-80);
  saveDismissedScheduleIssues();
}

function restoreDismissedIssue(id) {
  dismissedScheduleIssues = dismissedScheduleIssues.filter((item) => item.id !== id);
  saveDismissedScheduleIssues();
  renderSettings();
  renderIssueIndicator();
}

function shiftIssueMessages(shift) {
  const result = validateShift(shift);
  return [...result.errors, ...result.warnings];
}

function renderIssueIndicator() {
  const button = $("issueBtn");
  if (!button) return;
  const issues = activeScheduleIssues();
  $("issueCount").textContent = String(issues.length);
  button.hidden = issues.length === 0;
  button.title = issues.length ? `${issues.length} schedule issue${issues.length === 1 ? "" : "s"}. Click to review.` : "No schedule issues";
  if (!issues.length) {
    issueCursor = -1;
    issuePopoverOpen = false;
    renderIssuePopover([]);
  } else if (issuePopoverOpen) {
    if (issueCursor < 0 || issueCursor >= issues.length) issueCursor = 0;
    renderIssuePopover(issues);
  }
}

function toggleIssuePopover() {
  const issues = activeScheduleIssues();
  if (!issues.length) {
    renderIssueIndicator();
    showConflict("No schedule issues found for this week.");
    return;
  }
  issuePopoverOpen = !issuePopoverOpen;
  if (issueCursor < 0 || issueCursor >= issues.length) issueCursor = 0;
  renderIssuePopover(issues);
}

function moveIssueCursor(delta) {
  const issues = activeScheduleIssues();
  if (!issues.length) return renderIssueIndicator();
  issuePopoverOpen = true;
  issueCursor = ((issueCursor < 0 ? 0 : issueCursor) + delta + issues.length) % issues.length;
  renderIssuePopover(issues);
}

function renderIssuePopover(issues = activeScheduleIssues()) {
  const popover = $("issuePopover");
  if (!popover) return;
  popover.onclick = (event) => event.stopPropagation();
  popover.onpointerdown = (event) => event.stopPropagation();
  if (!issuePopoverOpen || !issues.length) {
    popover.hidden = true;
    popover.innerHTML = "";
    return;
  }
  const issue = issues[issueCursor] || issues[0];
  const label = issue.type === "error" ? "Blocked" : issue.type === "coverage" ? "Coverage" : "Warning";
  const employeeAction = issueEmployeeShortcut(issue);
  popover.hidden = false;
  positionIssuePopover(popover);
  popover.innerHTML = `
    <div class="issue-popover-head">
      <strong>${label}</strong>
      <span>${issueCursor + 1} / ${issues.length}</span>
    </div>
    <div class="issue-popover-message">${escapeHtml(issue.message)}</div>
    <div class="issue-popover-actions">
      <button type="button" data-issue-prev title="Previous issue" aria-label="Previous issue">&#8249;</button>
      <button type="button" data-issue-focus>Show</button>
      ${employeeAction ? `<button type="button" data-issue-employee>${escapeHtml(employeeAction.label)}</button>` : ""}
      <button type="button" data-issue-next title="Next issue" aria-label="Next issue">&#8250;</button>
      <button type="button" class="issue-dismiss-circle" data-issue-dismiss title="Mark read" aria-label="Mark notification read">X</button>
    </div>
  `;
  popover.querySelector("[data-issue-prev]")?.addEventListener("click", () => moveIssueCursor(-1));
  popover.querySelector("[data-issue-next]")?.addEventListener("click", () => moveIssueCursor(1));
  popover.querySelector("[data-issue-focus]")?.addEventListener("click", () => focusScheduleIssue(issue, issueCursor + 1, issues.length, { announce: false }));
  popover.querySelector("[data-issue-employee]")?.addEventListener("click", () => openIssueEmployeeShortcut(issue, employeeAction));
  popover.querySelector("[data-issue-dismiss]")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.classList.add("confirming");
    window.setTimeout(() => {
      dismissScheduleIssue(issue);
      const nextIssues = activeScheduleIssues();
      if (issueCursor >= nextIssues.length) issueCursor = Math.max(0, nextIssues.length - 1);
      renderSettings();
      renderIssueIndicator();
    }, 180);
  });
}

function issueEmployeeShortcut(issue) {
  if (!issue?.employeeId || !employeeById(issue.employeeId)) return null;
  const message = issue.message || "";
  if (/trained to close/i.test(message)) return { label: "Fix Profile", targetId: "employeeCanClose" };
  if (/available for lunch closing|lunch closer/i.test(message)) return { label: "Fix Profile", targetId: "employeeCanLunchClose" };
  if (/no doubles|already scheduled that day/i.test(message)) return { label: "Fix Profile", targetId: "employeeNoDoubles" };
  if (/normal availability|outside normal availability/i.test(message)) return { label: "Fix Profile", targetId: "availabilityEditor" };
  if (/not marked for|not trained as|not trained for/i.test(message)) return { label: "Fix Profile", targetId: "employeeTrainingSection" };
  if (/trainer for|No trainer/i.test(message)) return { label: "Fix Profile", targetId: "trainerRoles" };
  if (/work day|clopen|time off|already has|overlap/i.test(message)) return { label: "Fix Profile", targetId: "employeeManagerNotes" };
  return { label: "Fix Profile", targetId: "employeeForm" };
}

function openIssueEmployeeShortcut(issue, action = issueEmployeeShortcut(issue)) {
  const employee = employeeById(issue?.employeeId);
  if (!employee) return;
  scheduleReturnContext = captureScheduleReturnContext(issue);
  issuePopoverOpen = false;
  renderIssuePopover([]);
  loadEmployee(employee.id);
  activateTab("employees");
  showScheduleReturnButton();
  window.setTimeout(() => focusEmployeeProfileTarget(action?.targetId, issue), 80);
}

function captureScheduleReturnContext(issue = {}) {
  const grid = $("scheduleGrid");
  return {
    selectedShiftId: issue.shiftId || selectedShiftId,
    selectedCell,
    week: formatDateKey(currentDate),
    scrollLeft: grid?.scrollLeft || 0,
    scrollTop: grid?.scrollTop || 0
  };
}

function employeeProfileTabForTarget(targetId = "") {
  if (["availabilityEditor", "weeklyAvailabilityEditor", "employeeCallWeekly", "weeklyAvailabilityFieldset", "regularAvailabilityFieldset"].includes(targetId)) return "availability";
  if (["employeeTrainingSection", "employeeRoleChecks", "employeeMealTrainingSection"].includes(targetId)) return "roles";
  if (["trainerRoles", "employeeTrainerChecks"].includes(targetId)) return "training";
  if (["employeePayRates"].includes(targetId)) return "pay";
  if (["weeklyRuleEditor"].includes(targetId)) return "rules";
  if (["employeeManagerNotes"].includes(targetId)) return "notes";
  return "profile";
}

function focusEmployeeProfileTarget(targetId) {
  activateEmployeeProfileTab(employeeProfileTabForTarget(targetId));
  const target = targetId ? $(targetId) : $("employeeForm");
  const focusTarget = target?.matches?.("input, select, textarea, button") ? target : target?.querySelector?.("input, select, textarea, button");
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  focusTarget?.focus?.({ preventScroll: true });
}

function showScheduleReturnButton() {
  let button = $("scheduleReturnBtn");
  if (!button) {
    button = document.createElement("button");
    button.id = "scheduleReturnBtn";
    button.type = "button";
    button.className = "schedule-return-button";
    button.textContent = "Return to schedule";
    button.onclick = returnToScheduleContext;
    document.body.appendChild(button);
  }
  button.hidden = !scheduleReturnContext;
}

function returnToScheduleContext() {
  if (!scheduleReturnContext) return;
  const context = scheduleReturnContext;
  scheduleReturnContext = null;
  if (context.week) setCurrentWeek(parseDateKey(context.week), { shared: false });
  selectedShiftId = context.selectedShiftId || null;
  selectedCell = context.selectedCell || null;
  activateTab("schedule");
  renderSchedule();
  showScheduleReturnButton();
  window.setTimeout(() => {
    const grid = $("scheduleGrid");
    if (grid) {
      grid.scrollLeft = context.scrollLeft || 0;
      grid.scrollTop = context.scrollTop || 0;
    }
    if (context.selectedShiftId) {
      document.querySelector(`[data-shift-id="${context.selectedShiftId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
  }, 50);
}

function positionIssuePopover(popover = $("issuePopover")) {
  const button = $("issueBtn");
  if (!popover || !button) return;
  const rect = button.getBoundingClientRect();
  const width = Math.min(360, Math.max(280, window.innerWidth - 24));
  const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
  const top = Math.max(58, rect.bottom + 10);
  popover.style.setProperty("--issue-popover-left", `${left}px`);
  popover.style.setProperty("--issue-popover-top", `${top}px`);
  popover.style.setProperty("--issue-popover-width", `${width}px`);
  const arrowLeft = Math.min(Math.max(18, rect.left + rect.width / 2 - left - 7), width - 26);
  popover.style.setProperty("--issue-popover-arrow-left", `${arrowLeft}px`);
}

function focusScheduleIssue(issue, number, total, options = {}) {
  activateTab("schedule");
  if (issue.shiftId) {
    selectedShiftId = issue.shiftId;
    selectedCell = null;
    pendingDeleteShiftId = null;
    renderSchedule();
  }
  window.setTimeout(() => {
    const target = issue.shiftId
      ? document.querySelector(`[data-shift-id="${issue.shiftId}"]`)
      : document.querySelector(`[data-coverage-date="${issue.date}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }, 50);
  if (options.announce !== false) showConflict(`Issue ${number} of ${total}: ${issue.message}`);
}

function renderAll(options = {}) {
  normalizeSavedEmployeePhones();
  bindPhoneFormatters();
  renderTabs();
  renderSettings();
  renderRoles();
  renderEmployees();
  renderTemplates();
  renderSchedule();
  renderIssueIndicator();
  renderMonthly();
  renderScheduleHistory();
  renderStaffingAnalysis();
  renderFloorPlan();
  if (!options.skipSave) saveState();
}

function renderAllPreservingScheduleScroll() {
  const grid = $("scheduleGrid");
  const scrollTop = grid?.scrollTop || 0;
  const scrollLeft = grid?.scrollLeft || 0;
  renderAll();
  const nextGrid = $("scheduleGrid");
  if (!nextGrid) return;
  nextGrid.scrollTop = Math.max(0, Math.min(scrollTop, nextGrid.scrollHeight - nextGrid.clientHeight));
  nextGrid.scrollLeft = Math.max(0, Math.min(scrollLeft, nextGrid.scrollWidth - nextGrid.clientWidth));
}

function renderSchedulePreservingGridScroll() {
  const grid = $("scheduleGrid");
  const scrollTop = grid?.scrollTop || 0;
  const scrollLeft = grid?.scrollLeft || 0;
  renderSchedule();
  const nextGrid = $("scheduleGrid");
  if (!nextGrid) return;
  nextGrid.scrollTop = Math.max(0, Math.min(scrollTop, nextGrid.scrollHeight - nextGrid.clientHeight));
  nextGrid.scrollLeft = Math.max(0, Math.min(scrollLeft, nextGrid.scrollWidth - nextGrid.clientWidth));
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = async () => {
      if (!(await requestActivateTab(tab.dataset.tab))) return;
      if (tab.dataset.tab === "monthly") renderMonthly();
      if (tab.dataset.tab === "floorplans") {
        // Carry the focused single-day date across once, but let Floor Plans
        // keep its own date after the user starts browsing there.
        if (focusedDateKey) syncFloorPlanDateToActiveWeek({ handoffDateKey: focusedDateKey });
        renderFloorPlan();
      }
    };
  });
}

async function requestActivateTab(tabName) {
  const activeTab = document.querySelector(".tab.active")?.dataset.tab || "";
  if (activeTab === "employees" && tabName !== "employees" && !(await confirmDiscardEmployeeChanges())) return false;
  activateTab(tabName);
  return true;
}

function activateTab(tabName) {
  document.querySelectorAll(".tab, .panel").forEach((el) => el.classList.remove("active"));
  document.querySelector(`[data-tab="${tabName}"]`)?.classList.add("active");
  $(tabName)?.classList.add("active");
  updateZoomVisibility(tabName);
  updateStickyEmployeeName();
}

function updateZoomVisibility(tabName = document.querySelector(".tab.active")?.dataset.tab) {
  if ($("zoomControls")) $("zoomControls").hidden = tabName !== "schedule";
  updateCompactPreviewButton();
}

function updateCompactPreviewButton() {
  const button = $("compactViewBtn");
  if (!button) return;
  const isCompactPreview = document.body.classList.contains("compact-preview");
  button.textContent = isCompactPreview ? "Grid View" : "Compact";
  button.title = isCompactPreview ? "Return to the schedule grid" : "Compact schedule preview";
  button.setAttribute("aria-label", button.title);
  button.classList.toggle("active", isCompactPreview);
}

function enterDayFocus(dateKey = selectedCell?.date || formatDateKey(currentDate)) {
  // A day view request always leaves compact preview first so the grid cannot
  // remain hidden behind the print-style layer.
  if (document.body.classList.contains("compact-preview")) clearPrintView();
  focusedDateKey = dateKey;
  selectedCell = null;
  selectedShiftId = null;
  renderSchedule();
}

function exitDayFocus() {
  focusedDateKey = "";
  renderSchedule();
}

function updateScheduleViewToggle() {
  const toggle = $("scheduleViewToggle");
  if (!toggle) return;
  toggle.hidden = document.body.classList.contains("compact-preview");
  $("weekViewBtn")?.classList.toggle("active", !focusedDateKey);
  $("dayViewBtn")?.classList.toggle("active", Boolean(focusedDateKey));
  if ($("dayViewBtn")) $("dayViewBtn").title = `Open Day View for ${displayDate(parseDateKey(selectedCell?.date || formatDateKey(currentDate)))}`;
}

function scheduleRailWidgetElements() {
  return ["scheduleViewToggle", "printFilters", "dayFocusToolRail", "roleJumpStrip"]
    .map((id) => $(id))
    .filter((element) => element && !element.hidden);
}

function layoutScheduleRail() {
  const schedulePanel = $("schedule");
  const rail = $("scheduleRail");
  if (!schedulePanel?.classList.contains("active") || !rail || document.body.classList.contains("compact-preview")) return;
  // Keep the rail intentionally stationary until its layout is redesigned.
  // This prevents bay expansion, selection panels, and view switches from
  // moving the widgets or leaving them stranded below the viewport.
  rail.style.left = "3px";
  rail.style.top = "300px";
}
function renderScheduleControls() {
  $("weekPicker").value = formatDateKey(currentDate);
  const dates = weekDates();
  if ($("weekLabel")) $("weekLabel").textContent = `${displayDate(dates[0])} - ${displayDate(dates[6])}`;
  if ($("openShiftBaySort")) $("openShiftBaySort").value = state.settings.openShiftBaySort || "meal";
  $("quickTemplate").innerHTML = state.templates.map((template) => `<option value="${template.id}">${template.name}</option>`).join("");
  if ($("problemFocusBtn")) $("problemFocusBtn").textContent = state.settings.problemFocusMode ? "Show All Shifts" : "Focus Problems";
  renderUnassignedShiftTray();
  updateScheduleViewToggle();
  applyScheduleZoom();
}

function renderUnassignedShiftTray() {
  const tray = $("unassignedShiftTray");
  if (!tray) return;
  tray.ondblclick = (event) => {
    window.clearTimeout(openShiftClickTimer);
    openShiftClickTimer = null;
    const card = event.target.closest("[data-unassigned-shift-id]");
    if (card) {
      event.stopPropagation();
      const staged = state.unassignedShifts.find((shift) => shift.id === card.dataset.unassignedShiftId);
      if (staged) {
        selectedUnassignedShiftId = staged.id;
        selectedShiftId = null;
        selectedTimeOffRequestId = null;
        selectedCell = null;
        pendingDeleteUnassignedShiftId = null;
        pendingDeleteShiftId = null;
        document.querySelectorAll(".unassigned-shift-card").forEach((item) => {
          item.classList.toggle("selected", item.dataset.unassignedShiftId === staged.id);
          item.classList.remove("pending-delete");
          if (item !== card) item.querySelector(":scope > .delete-confirm-button")?.remove();
        });
        card.querySelector(":scope > .delete-confirm-button")?.remove();
        openStagedShiftDialog(staged);
      }
      return;
    }
    openStagedShiftDialog();
  };
  tray.onclick = (event) => {
    const card = event.target.closest("[data-unassigned-shift-id]");
    if (!card) return;
    event.stopPropagation();
    if (suppressNextOpenShiftClickId === card.dataset.unassignedShiftId) {
      suppressNextOpenShiftClickId = null;
      return;
    }
    if (card.dataset.mouseDragging === "true") return;
    if (event.target.closest(".delete-start-button")) {
      document.querySelectorAll(".unassigned-shift-card.pending-delete").forEach((openCard) => {
        if (openCard !== card) {
          openCard.classList.remove("pending-delete");
          openCard.querySelector(":scope > .delete-confirm-button")?.remove();
        }
      });
      document.querySelectorAll(".shift-card.pending-delete").forEach((openCard) => {
        openCard.classList.remove("pending-delete");
        openCard.querySelector(".shift-delete-options")?.remove();
      });
      document.querySelectorAll(".unassigned-shift-card.selected").forEach((selectedCard) => {
        if (selectedCard !== card) selectedCard.classList.remove("selected");
      });
      pendingDeleteUnassignedShiftId = card.dataset.unassignedShiftId;
      pendingDeleteShiftId = null;
      selectedUnassignedShiftId = card.dataset.unassignedShiftId;
      selectedShiftId = null;
      selectedCell = null;
      card.classList.add("selected", "pending-delete");
      if (!card.querySelector(":scope > .delete-confirm-button")) {
        card.insertAdjacentHTML("beforeend", `<button class="delete-confirm-button" type="button" title="Confirm delete" aria-label="Confirm delete bay shift">X</button>`);
      }
      return;
    }
    if (event.target.closest(".delete-confirm-button")) {
      pushUndo();
      state.unassignedShifts = (state.unassignedShifts || []).filter((shift) => shift.id !== card.dataset.unassignedShiftId);
      if (selectedUnassignedShiftId === card.dataset.unassignedShiftId) selectedUnassignedShiftId = null;
      pendingDeleteUnassignedShiftId = null;
      renderAll();
      return;
    }
    if (pendingDeleteUnassignedShiftId === card.dataset.unassignedShiftId) {
      pendingDeleteUnassignedShiftId = null;
      card.classList.remove("pending-delete");
      card.querySelector(":scope > .delete-confirm-button")?.remove();
      return;
    }
    window.clearTimeout(openShiftClickTimer);
    const clickUnassignedShiftId = card.dataset.unassignedShiftId;
    openShiftClickTimer = window.setTimeout(() => {
      openShiftClickTimer = null;
      const currentCard = document.querySelector(`[data-unassigned-shift-id="${clickUnassignedShiftId}"]`);
      if (!currentCard || currentCard.dataset.mouseDragging === "true") return;
      if (selectedUnassignedShiftId === clickUnassignedShiftId) {
        clearOpenShiftSelectionAfterClick();
        return;
      }
      selectOpenShiftWithoutFullRender(clickUnassignedShiftId);
    }, 140);
  };
  tray.onpointerdown = (event) => {
    const card = event.target.closest("[data-unassigned-shift-id]");
    if (card) {
      lastOpenShiftPointerDownAt = Date.now();
      beginMouseOpenShiftDrag(event, card);
    }
  };
  tray.onmousedown = (event) => {
    const card = event.target.closest("[data-unassigned-shift-id]");
    if (!card) return;
    if (Date.now() - lastOpenShiftPointerDownAt < 250) return;
    beginMouseOpenShiftDrag(event, card);
  };
  tray.ondragstart = (event) => {
    const card = event.target.closest("[data-unassigned-shift-id]");
    if (!card || event.target.closest("button")) {
      event.preventDefault();
      return;
    }
    dragShiftId = null;
    dragUnassignedShiftId = card.dataset.unassignedShiftId;
    selectedUnassignedShiftId = card.dataset.unassignedShiftId;
    selectedShiftId = null;
    selectedCell = null;
    pendingDeleteShiftId = null;
    pendingTrayWarning = null;
    beginOpenShiftDrag();
    event.dataTransfer.setData("text/unassigned-shift", card.dataset.unassignedShiftId);
    event.dataTransfer.effectAllowed = "move";
  };
  tray.ondragend = () => endAnyDrag();
  tray.ondragover = (event) => {
    if (!dragShiftId) return;
    event.preventDefault();
    tray.classList.add("drag-target");
  };
  tray.ondragleave = (event) => {
    if (!tray.contains(event.relatedTarget)) tray.classList.remove("drag-target");
  };
  tray.ondrop = (event) => {
    event.preventDefault();
    tray.classList.remove("drag-target");
    const shiftId = event.dataTransfer.getData("text/shift") || dragShiftId;
    if (!shiftId) return;
    unassignShift(shiftId);
    endAnyDrag();
  };
  tray.onwheel = scrollOpenShiftBayWithWheel;
  const shifts = currentWeekOpenShifts();
  renderOpenShiftBaySummary(shifts);
  renderOpenShiftRoleJump(shifts);
  tray.innerHTML = shifts.length ? shifts.map(renderUnassignedShiftCard).join("") : `<span class="tray-empty">Choose a template and add it here, or double-click to create one open shift.</span>`;
  if (openShiftBayRoleFocusId && shifts.some((shift) => shift.roleId === openShiftBayRoleFocusId)) {
    requestAnimationFrame(() => { tray.scrollLeft = 0; });
  }
  renderSelectedStagedShiftInfo();
}

function currentWeekOpenShifts() {
  const weekStartKey = formatDateKey(currentDate);
  const weekEndKey = formatDateKey(addDays(currentDate, 6));
  const comparator = openShiftBayComparator(state.settings.openShiftBaySort || "meal");
  const shifts = (state.unassignedShifts || [])
    .filter((shift) => shift.date >= weekStartKey && shift.date <= weekEndKey);
  const useSkippedQueue = shifts.length > 1;
  return shifts.sort((a, b) => {
    if (useSkippedQueue) {
      const aSkipped = Boolean(a.skippedAt);
      const bSkipped = Boolean(b.skippedAt);
      if (aSkipped !== bSkipped) return aSkipped ? 1 : -1;
      if (aSkipped && bSkipped) return String(a.skippedAt).localeCompare(String(b.skippedAt));
    }
    if (openShiftBayRoleFocusId) {
      const aFocused = a.roleId === openShiftBayRoleFocusId ? 0 : 1;
      const bFocused = b.roleId === openShiftBayRoleFocusId ? 0 : 1;
      if (aFocused !== bFocused) return aFocused - bFocused;
    }
    return comparator(a, b);
  });
}

function openShiftBayComparator(sortMode) {
  const byDayTime = (a, b) => a.date.localeCompare(b.date) || (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0);
  const byTime = (a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0) || a.date.localeCompare(b.date);
  const byRole = (a, b) => compareRoleIdsByScheduleOrder(a.roleId, b.roleId) || byDayTime(a, b);
  const byMeal = (a, b) => openShiftMealRank(a) - openShiftMealRank(b) || byDayTime(a, b);
  if (sortMode === "role") return byRole;
  if (sortMode === "time") return byTime;
  if (sortMode === "dayTime") return byDayTime;
  return byMeal;
}

function openShiftMealRank(shift) {
  const order = ["Breakfast", "Lunch", "Dinner", "Brunch"];
  const meals = getMealsForShift(shift);
  const ranks = meals.map((meal) => {
    const index = order.findIndex((item) => item.toLowerCase() === String(meal).toLowerCase());
    return index === -1 ? 99 : index;
  });
  return ranks.length ? Math.min(...ranks) : 99;
}

function renderOpenShiftBaySummary(shifts) {
  const summary = $("openShiftBaySummary");
  const clearButton = $("clearOpenShiftBayBtn");
  const autoAssignButton = $("autoAssignCleanBayBtn");
  if (!summary) return;
  const roleCounts = new Map();
  shifts.forEach((shift) => {
    const roleName = roleById(shift.roleId)?.name || "Role";
    roleCounts.set(roleName, (roleCounts.get(roleName) || 0) + 1);
  });
  const countText = `${shifts.length} bay shift${shifts.length === 1 ? "" : "s"}`;
  const roleText = Array.from(roleCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([roleName, count]) => `${count} ${roleName}`)
    .join(", ");
  summary.textContent = roleText ? `${countText}: ${roleText}` : countText;
  if (clearButton) clearButton.disabled = !shifts.length;
  if (autoAssignButton) autoAssignButton.disabled = !shifts.length;
}

function renderOpenShiftRoleJump(shifts) {
  const target = $("openShiftRoleJump");
  if (!target) return;
  if ((state.settings.openShiftBaySort || "meal") !== "role") {
    target.hidden = true;
    target.innerHTML = "";
    openShiftBayRoleFocusId = "";
    return;
  }
  const roleCounts = new Map();
  shifts.forEach((shift) => {
    if (!shift.roleId) return;
    roleCounts.set(shift.roleId, (roleCounts.get(shift.roleId) || 0) + 1);
  });
  const roles = [...roleCounts.keys()]
    .map((roleId) => roleById(roleId))
    .filter(Boolean)
    .sort(compareRolesByScheduleOrder);
  if (!roles.length) {
    target.hidden = true;
    target.innerHTML = "";
    openShiftBayRoleFocusId = "";
    return;
  }
  if (openShiftBayRoleFocusId && !roleCounts.has(openShiftBayRoleFocusId)) openShiftBayRoleFocusId = "";
  target.hidden = false;
  target.innerHTML = `
    <span><span class="rail-label-short">FOCUS</span><span class="rail-label-full">Focus</span></span>
    <button type="button" class="${openShiftBayRoleFocusId ? "" : "selected"}" data-open-shift-role-jump="" data-role-tooltip="All">All</button>
    ${roles.map((role) => `
      <button type="button" class="${openShiftBayRoleFocusId === role.id ? "selected" : ""}" data-open-shift-role-jump="${role.id}" style="--role-color:${role.color || "#2563eb"}" data-role-tooltip="${escapeHtml(role.name)}">
        ${escapeHtml(role.name)} <strong>${roleCounts.get(role.id) || 0}</strong>
      </button>
    `).join("")}
  `;
  target.onmouseenter = () => {
    window.clearTimeout(renderOpenShiftRoleJump.closeTimer);
    target.classList.add("rail-expanded");
  };
  target.onmouseleave = () => {
    window.clearTimeout(renderOpenShiftRoleJump.closeTimer);
    renderOpenShiftRoleJump.closeTimer = window.setTimeout(() => target.classList.remove("rail-expanded"), 180);
  };
  target.querySelectorAll("[data-open-shift-role-jump]").forEach((button) => {
    button.onclick = () => {
      openShiftBayRoleFocusId = button.dataset.openShiftRoleJump || "";
      window.clearTimeout(renderOpenShiftRoleJump.closeTimer);
      target.classList.remove("rail-expanded");
      button.blur();
      renderSchedule();
    };
  });
}

function renderUnassignedShiftCard(shift) {
  const role = roleById(shift.roleId);
  const recent = recentEmployeesForStagedShift(shift).slice(0, 2).map((item) => displayName(item.employee)).join(", ");
  const showSkipped = Boolean(shift.skippedAt) && currentWeekOpenShifts().length > 1;
  return `
    <div class="unassigned-shift-card ${selectedUnassignedShiftId === shift.id ? "selected" : ""} ${pendingDeleteUnassignedShiftId === shift.id ? "pending-delete" : ""} ${showSkipped ? "skipped" : ""}" draggable="false" data-unassigned-shift-id="${shift.id}" style="--shift-color:${shiftColor(shift)}">
      <button class="delete-start-button" type="button" title="Delete this bay shift" aria-label="Start delete bay shift">Ã—</button>
      <strong>${role?.name || "Role"}${shift.isCloser ? " | Close" : ""}${shift.isFlexDouble ? " | Flex" : ""}${shift.training?.isTraining ? " | Training" : ""}</strong>
      <span>${displayDate(parseDateKey(shift.date))}</span>
      <em>${shift.start} - ${shift.untilVolume ? "Vol" : shift.end}</em>
      ${showSkipped ? `<small class="skip-pill">Skipped</small>` : ""}
      ${recent ? `<small>Recent: ${recent}</small>` : ""}
      ${pendingDeleteUnassignedShiftId === shift.id ? `<button class="delete-confirm-button" type="button" title="Confirm delete" aria-label="Confirm delete bay shift">X</button>` : ""}
    </div>
  `;
}

function scrollOpenShiftBayWithWheel(event) {
  const tray = $("unassignedShiftTray");
  if (!tray) return;
  if (tray.scrollWidth <= tray.clientWidth) return;
  const horizontalDelta = event.deltaX || event.deltaY;
  if (!horizontalDelta) return;
  event.preventDefault();
  event.stopPropagation();
  tray.scrollLeft += horizontalDelta;
}

function beginOpenShiftDrag() {
  document.body.classList.add("dragging-open-shift");
  highlightBestOpenShiftDragTargets();
}

function suppressSelectionWhileDragging(event) {
  if (event.type === "dragstart" && event.target.closest?.(".unassigned-shift-card, .shift-card, .time-off-badge")) return;
  if (!dragShiftId && !dragUnassignedShiftId && !mouseOpenShiftDrag && !mouseAssignedShiftDrag && !mouseTimeOffDrag) return;
  event.preventDefault();
}

function endAnyDrag() {
  dragShiftId = null;
  dragUnassignedShiftId = null;
  dragPaint = null;
  dragScrollVelocity = 0;
  dragGridScrollLock = null;
  if (dragScrollFrame) cancelAnimationFrame(dragScrollFrame);
  dragScrollFrame = null;
  document.body.classList.remove("dragging-open-shift");
  document.body.classList.remove("dragging-assigned-shift");
  clearCopyPaintPreviewCards();
  document.querySelectorAll(".day-cell, .employee-name").forEach((el) => el.classList.remove("drag-valid", "drag-warning", "drag-invalid", "drag-best-target"));
  if (mouseOpenShiftDrag?.ghost) mouseOpenShiftDrag.ghost.remove();
  if (mouseOpenShiftDrag?.sourceCard) {
    mouseOpenShiftDrag.sourceCard.dataset.mouseDragging = "false";
    mouseOpenShiftDrag.sourceCard.classList.remove("drag-source-hidden");
  }
  mouseOpenShiftDrag = null;
  if (mouseAssignedShiftDrag?.ghost) mouseAssignedShiftDrag.ghost.remove();
  if (mouseAssignedShiftDrag?.liveCard) restoreLiveAssignedShiftDragCard(mouseAssignedShiftDrag);
  if (mouseAssignedShiftDrag?.sourceCard) {
    mouseAssignedShiftDrag.sourceCard.dataset.mouseDragging = "false";
    mouseAssignedShiftDrag.sourceCard.classList.remove("drag-source-hidden");
  }
  mouseAssignedShiftDrag = null;
  if (mouseTimeOffDrag?.ghost) mouseTimeOffDrag.ghost.remove();
  if (mouseTimeOffDrag?.sourceBadge) {
    mouseTimeOffDrag.sourceBadge.dataset.mouseDragging = "false";
    mouseTimeOffDrag.sourceBadge.classList.remove("drag-source-hidden");
  }
  mouseTimeOffDrag = null;
}

function lockGridScrollForDrag() {
  const grid = $("scheduleGrid");
  if (!grid) return;
  dragGridScrollLock = {
    top: grid.scrollTop,
    left: grid.scrollLeft
  };
}

function restoreGridScrollDuringDrag() {
  const grid = $("scheduleGrid");
  if (!grid || !dragGridScrollLock) return;
  if (grid.scrollTop !== dragGridScrollLock.top) grid.scrollTop = dragGridScrollLock.top;
  if (grid.scrollLeft !== dragGridScrollLock.left) grid.scrollLeft = dragGridScrollLock.left;
}

function updateGridScrollLockFromCurrentPosition() {
  const grid = $("scheduleGrid");
  if (!grid || !dragGridScrollLock) return;
  dragGridScrollLock.top = grid.scrollTop;
  dragGridScrollLock.left = grid.scrollLeft;
}

function beginMouseOpenShiftDrag(event, card) {
  if (mouseOpenShiftDrag) return;
  if (event.button !== 0 || event.target.closest("button")) return;
  const unassignedId = card.dataset.unassignedShiftId;
  if (!unassignedId || pendingDeleteUnassignedShiftId === unassignedId) return;
  window.clearTimeout(openShiftClickTimer);
  openShiftClickTimer = null;
  mouseOpenShiftDrag = {
    unassignedId,
    sourceCard: card,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - card.getBoundingClientRect().left,
    offsetY: event.clientY - card.getBoundingClientRect().top,
    active: false,
    target: null,
    suppressClick: false
  };
  document.addEventListener("pointermove", moveMouseOpenShiftDrag);
  document.addEventListener("pointerup", finishMouseOpenShiftDrag, { once: true });
  document.addEventListener("pointercancel", cancelMouseOpenShiftDrag, { once: true });
}

function activateMouseOpenShiftDrag(event) {
  if (!mouseOpenShiftDrag || mouseOpenShiftDrag.active) return;
  mouseOpenShiftDrag.active = true;
  mouseOpenShiftDrag.suppressClick = true;
  dragShiftId = null;
  dragUnassignedShiftId = mouseOpenShiftDrag.unassignedId;
  selectedUnassignedShiftId = mouseOpenShiftDrag.unassignedId;
  selectedShiftId = null;
  selectedCell = null;
  pendingDeleteShiftId = null;
  pendingTrayWarning = null;
  beginOpenShiftDrag();
  lockGridScrollForDrag();
  const ghost = createDragGhost(mouseOpenShiftDrag.sourceCard, event, mouseOpenShiftDrag);
  document.body.append(ghost);
  mouseOpenShiftDrag.ghost = ghost;
  mouseOpenShiftDrag.sourceCard.dataset.mouseDragging = "true";
  mouseOpenShiftDrag.sourceCard.classList.add("drag-source-hidden");
  renderSelectedStagedShiftInfo();
  updateMouseOpenShiftGhost(event);
  restoreGridScrollDuringDrag();
}

function createDragGhost(sourceCard, event, dragState) {
  const ghost = sourceCard.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.classList.remove("drag-source-hidden");
  ghost.dataset.mouseDragging = "false";
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  ghost.querySelectorAll("*").forEach((element) => {
    element.style.visibility = "visible";
  });
  ghost.style.width = `${sourceCard.offsetWidth}px`;
  ghost.style.height = `${sourceCard.offsetHeight}px`;
  ghost.style.left = `${event.clientX - (dragState.offsetX || 0)}px`;
  ghost.style.top = `${event.clientY - (dragState.offsetY || 0)}px`;
  ghost.style.position = "fixed";
  ghost.style.pointerEvents = "none";
  ghost.style.visibility = "visible";
  ghost.style.display = "block";
  ghost.style.opacity = "0.96";
  ghost.style.zIndex = "2147483647";
  return ghost;
}

function moveMouseOpenShiftDrag(event) {
  if (!mouseOpenShiftDrag) return;
  const distance = Math.hypot(event.clientX - mouseOpenShiftDrag.startX, event.clientY - mouseOpenShiftDrag.startY);
  if (!mouseOpenShiftDrag.active && distance > 4) activateMouseOpenShiftDrag(event);
  if (!mouseOpenShiftDrag.active) return;
  event.preventDefault();
  updateMouseOpenShiftGhost(event);
  updateDragAutoScroll(event);
  previewMouseOpenShiftTarget(event);
  restoreGridScrollDuringDrag();
}

function updateMouseOpenShiftGhost(event) {
  const ghost = mouseOpenShiftDrag?.ghost;
  if (!ghost) return;
  ghost.style.left = `${event.clientX - (mouseOpenShiftDrag.offsetX || 0)}px`;
  ghost.style.top = `${event.clientY - (mouseOpenShiftDrag.offsetY || 0)}px`;
}

function startLiveAssignedShiftDragCard(drag, event) {
  const card = drag?.sourceCard;
  if (!card || drag.liveCard) return;
  const rect = card.getBoundingClientRect();
  const placeholder = card.cloneNode(false);
  placeholder.className = "drag-card-placeholder";
  placeholder.style.width = `${rect.width}px`;
  placeholder.style.height = `${rect.height}px`;
  card.parentElement?.insertBefore(placeholder, card);
  drag.placeholder = placeholder;
  drag.originalParent = placeholder.parentElement;
  drag.liveCard = true;
  drag.width = rect.width;
  drag.height = rect.height;
  card.classList.add("drag-live-card");
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
  card.style.left = `${event.clientX - (drag.offsetX || 0)}px`;
  card.style.top = `${event.clientY - (drag.offsetY || 0)}px`;
  document.body.append(card);
}

function updateLiveAssignedShiftDragCard(event) {
  const drag = mouseAssignedShiftDrag;
  const card = drag?.sourceCard;
  if (!card || !drag?.liveCard) return;
  card.style.left = `${event.clientX - (drag.offsetX || 0)}px`;
  card.style.top = `${event.clientY - (drag.offsetY || 0)}px`;
}

function restoreLiveAssignedShiftDragCard(drag) {
  const card = drag?.sourceCard;
  if (!card) return;
  card.classList.remove("drag-live-card");
  card.style.width = "";
  card.style.height = "";
  card.style.left = "";
  card.style.top = "";
  if (drag.placeholder?.parentElement) {
    drag.placeholder.replaceWith(card);
  }
}

function previewMouseOpenShiftTarget(event) {
  const target = openShiftDropTargetFromPoint(event.clientX, event.clientY);
  if (mouseOpenShiftDrag?.target === target) return;
  document.querySelectorAll(".day-cell, .employee-name").forEach((el) => el.classList.remove("drag-valid", "drag-warning", "drag-invalid"));
  mouseOpenShiftDrag.target = target;
  if (!target) return;
  previewOpenShiftAssignmentTarget(target, target.dataset.employeeId);
}

function openShiftDropTargetFromPoint(x, y) {
  const element = document.elementFromPoint(x, y);
  return element?.closest?.(".day-cell[data-employee-id], .employee-name[data-employee-id]") || null;
}

function assignedShiftDropTargetFromPoint(x, y) {
  const element = document.elementFromPoint(x, y);
  const directTarget = element?.closest?.(".day-cell[data-employee-id][data-date]");
  if (directTarget) return directTarget;
  const offsets = [
    [0, -18],
    [0, 18],
    [-18, 0],
    [18, 0],
    [-18, -18],
    [18, -18],
    [-18, 18],
    [18, 18]
  ];
  for (const [offsetX, offsetY] of offsets) {
    const nearby = document.elementFromPoint(x + offsetX, y + offsetY)?.closest?.(".day-cell[data-employee-id][data-date]");
    if (nearby) return nearby;
  }
  return null;
}

function assignedShiftEmployeeTargetFromPoint(x, y) {
  return document.elementFromPoint(x, y)?.closest?.(".employee-name[data-employee-id]") || null;
}

function previewOpenShiftAssignmentTarget(element, employeeId) {
  const source = state.unassignedShifts.find((shift) => shift.id === dragUnassignedShiftId);
  if (!source || !employeeId) return;
  const result = validateShift(stagedShiftToShift(source, employeeId));
  element.classList.remove("drag-valid", "drag-warning", "drag-invalid");
  if (result.errors.length) element.classList.add("drag-invalid");
  else if (result.warnings.length) element.classList.add("drag-warning");
  else element.classList.add("drag-valid");
}

function finishMouseOpenShiftDrag(event) {
  document.removeEventListener("pointermove", moveMouseOpenShiftDrag);
  document.removeEventListener("pointercancel", cancelMouseOpenShiftDrag);
  const drag = mouseOpenShiftDrag;
  if (!drag) return;
  if (!drag.active) {
    mouseOpenShiftDrag = null;
    return;
  }
  event.preventDefault();
  suppressNextOpenShiftClickId = drag.unassignedId;
  const target = openShiftDropTargetFromPoint(event.clientX, event.clientY);
  if (target?.dataset.employeeId) {
    assignUnassignedShift(drag.unassignedId, target.dataset.employeeId);
    endAnyDrag();
  } else {
    endAnyDrag();
  }
  window.setTimeout(() => {
    if (drag.sourceCard) drag.sourceCard.dataset.mouseDragging = "false";
  }, 0);
}

function cancelMouseOpenShiftDrag() {
  document.removeEventListener("pointermove", moveMouseOpenShiftDrag);
  document.removeEventListener("pointerup", finishMouseOpenShiftDrag);
  endAnyDrag();
}

function beginMouseTimeOffPaintDrag(event, badge, request) {
  if (mouseTimeOffDrag || event.button !== 0 || !event.shiftKey || event.target.closest("button")) return;
  badge.setPointerCapture?.(event.pointerId);
  mouseTimeOffDrag = {
    requestId: request.id,
    sourceEmployeeId: request.employeeId,
    sourceBadge: badge,
    paintedTargets: new Map(),
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - badge.getBoundingClientRect().left,
    offsetY: event.clientY - badge.getBoundingClientRect().top,
    active: false
  };
  document.addEventListener("pointermove", moveMouseTimeOffPaintDrag);
  document.addEventListener("pointerup", finishMouseTimeOffPaintDrag, { once: true });
  document.addEventListener("pointercancel", cancelMouseTimeOffPaintDrag, { once: true });
}

function activateMouseTimeOffPaintDrag(event) {
  if (!mouseTimeOffDrag || mouseTimeOffDrag.active) return;
  mouseTimeOffDrag.active = true;
  mouseTimeOffDrag.sourceBadge.releasePointerCapture?.(event.pointerId);
  document.body.classList.add("dragging-assigned-shift");
  lockGridScrollForDrag();
  mouseTimeOffDrag.sourceBadge.dataset.mouseDragging = "true";
  mouseTimeOffDrag.ghost = createDragGhost(mouseTimeOffDrag.sourceBadge, event, mouseTimeOffDrag);
  document.body.append(mouseTimeOffDrag.ghost);
  updateMouseTimeOffGhost(event);
  restoreGridScrollDuringDrag();
}

function moveMouseTimeOffPaintDrag(event) {
  if (!mouseTimeOffDrag) return;
  const distance = Math.hypot(event.clientX - mouseTimeOffDrag.startX, event.clientY - mouseTimeOffDrag.startY);
  if (!mouseTimeOffDrag.active && distance > 1) activateMouseTimeOffPaintDrag(event);
  if (!mouseTimeOffDrag.active) return;
  event.preventDefault();
  updateMouseTimeOffGhost(event);
  previewMouseTimeOffPaintTarget(event);
  restoreGridScrollDuringDrag();
}

function updateMouseTimeOffGhost(event) {
  const ghost = mouseTimeOffDrag?.ghost;
  if (!ghost) return;
  ghost.style.left = `${event.clientX - (mouseTimeOffDrag.offsetX || 0)}px`;
  ghost.style.top = `${event.clientY - (mouseTimeOffDrag.offsetY || 0)}px`;
}

function previewMouseTimeOffPaintTarget(event) {
  const source = (state.timeOffRequests || []).find((request) => request.id === mouseTimeOffDrag?.requestId);
  const target = assignedShiftDropTargetFromPoint(event.clientX, event.clientY);
  if (!source || !target?.dataset.employeeId || !target.dataset.date) return;
  if (target.dataset.employeeId !== mouseTimeOffDrag.sourceEmployeeId) return;
  if (source.employeeId === target.dataset.employeeId && source.date === target.dataset.date) return;
  const key = `${target.dataset.employeeId}|${target.dataset.date}`;
  if (mouseTimeOffDrag.paintedTargets.has(key)) return;
  const copy = cloneCopiedTimeOffForCell(source, { employeeId: target.dataset.employeeId, date: target.dataset.date });
  const duplicate = (state.timeOffRequests || []).some((item) => timeOffRequestMatches(item, copy));
  target.classList.remove("drag-valid", "drag-warning", "drag-invalid");
  target.classList.add(duplicate ? "drag-invalid" : "drag-valid");
  mouseTimeOffDrag.paintedTargets.set(key, {
    employeeId: target.dataset.employeeId,
    date: target.dataset.date,
    duplicate
  });
}

function finishMouseTimeOffPaintDrag(event) {
  document.removeEventListener("pointermove", moveMouseTimeOffPaintDrag);
  document.removeEventListener("pointercancel", cancelMouseTimeOffPaintDrag);
  const drag = mouseTimeOffDrag;
  if (!drag) return;
  if (!drag.active) {
    mouseTimeOffDrag = null;
    return;
  }
  event.preventDefault();
  const source = (state.timeOffRequests || []).find((request) => request.id === drag.requestId);
  const targets = Array.from(drag.paintedTargets?.values?.() || []);
  const copyable = targets.filter((target) => !target.duplicate);
  const skipped = targets.length - copyable.length;
  endAnyDrag();
  if (!source || !copyable.length) {
    showConflict(skipped ? "No copies were added. Every painted cell already had that RO/Block." : "Drag across same-row schedule cells to copy the RO/Block.");
    return;
  }
  pushUndo();
  const copies = copyable.map((target) => cloneCopiedTimeOffForCell(source, target));
  state.timeOffRequests = [...(state.timeOffRequests || []), ...copies];
  selectedTimeOffRequestId = copies[copies.length - 1]?.id || null;
  selectedShiftId = null;
  selectedUnassignedShiftId = null;
  selectedCell = copies.length ? { employeeId: copies[copies.length - 1].employeeId, date: copies[copies.length - 1].date } : selectedCell;
  saveState();
  renderAllPreservingScheduleScroll();
  const label = isScheduleBlock(source) ? "Block" : "RO";
  const skippedText = skipped ? ` Skipped ${skipped} duplicate cell${skipped === 1 ? "" : "s"}.` : "";
  showConflict(`Copied ${label} into ${copies.length} cell${copies.length === 1 ? "" : "s"}.${skippedText}`);
}

function cancelMouseTimeOffPaintDrag() {
  document.removeEventListener("pointermove", moveMouseTimeOffPaintDrag);
  document.removeEventListener("pointerup", finishMouseTimeOffPaintDrag);
  endAnyDrag();
}

function beginMouseAssignedShiftDrag(event, card, shift) {
  if (mouseAssignedShiftDrag) return;
  if (event.button !== 0 || event.target.closest(".delete-confirm-button")) return;
  card.setPointerCapture?.(event.pointerId);
  mouseAssignedShiftDrag = {
    shiftId: shift.id,
    sourceEmployeeId: shift.employeeId,
    copyPaint: Boolean(event.shiftKey),
    paintedTargets: new Map(),
    sourceCard: card,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - card.getBoundingClientRect().left,
    offsetY: event.clientY - card.getBoundingClientRect().top,
    active: false,
    target: null
  };
  document.addEventListener("pointermove", moveMouseAssignedShiftDrag);
  document.addEventListener("pointerup", finishMouseAssignedShiftDrag, { once: true });
  document.addEventListener("pointercancel", cancelMouseAssignedShiftDrag, { once: true });
}

function activateMouseAssignedShiftDrag(event) {
  if (!mouseAssignedShiftDrag || mouseAssignedShiftDrag.active) return;
  mouseAssignedShiftDrag.active = true;
  mouseAssignedShiftDrag.sourceCard.releasePointerCapture?.(event.pointerId);
  document.body.classList.add("dragging-assigned-shift");
  dragShiftId = mouseAssignedShiftDrag.shiftId;
  dragUnassignedShiftId = null;
  lockGridScrollForDrag();
  mouseAssignedShiftDrag.sourceCard.dataset.mouseDragging = "true";
  if (mouseAssignedShiftDrag.copyPaint) {
    mouseAssignedShiftDrag.ghost = createDragGhost(mouseAssignedShiftDrag.sourceCard, event, mouseAssignedShiftDrag);
    document.body.append(mouseAssignedShiftDrag.ghost);
  } else {
    startLiveAssignedShiftDragCard(mouseAssignedShiftDrag, event);
  }
  updateMouseAssignedShiftGhost(event);
  restoreGridScrollDuringDrag();
}

function moveMouseAssignedShiftDrag(event) {
  if (!mouseAssignedShiftDrag) return;
  const distance = Math.hypot(event.clientX - mouseAssignedShiftDrag.startX, event.clientY - mouseAssignedShiftDrag.startY);
  if (!mouseAssignedShiftDrag.active && distance > 1) activateMouseAssignedShiftDrag(event);
  if (!mouseAssignedShiftDrag.active) return;
  event.preventDefault();
  updateMouseAssignedShiftGhost(event);
  updateDragAutoScroll(event);
  previewMouseAssignedShiftTarget(event);
  restoreGridScrollDuringDrag();
}

function updateMouseAssignedShiftGhost(event) {
  const ghost = mouseAssignedShiftDrag?.ghost;
  if (ghost) {
    ghost.style.left = `${event.clientX - (mouseAssignedShiftDrag.offsetX || 0)}px`;
    ghost.style.top = `${event.clientY - (mouseAssignedShiftDrag.offsetY || 0)}px`;
    return;
  }
  updateLiveAssignedShiftDragCard(event);
}

function previewMouseAssignedShiftTarget(event) {
  const source = state.shifts.find((shift) => shift.id === mouseAssignedShiftDrag?.shiftId);
  const target = assignedShiftDropTargetFromPoint(event.clientX, event.clientY) || assignedShiftEmployeeTargetFromPoint(event.clientX, event.clientY);
  if (mouseAssignedShiftDrag?.copyPaint) {
    previewAssignedShiftCopyPaintTarget(source, target);
    return;
  }
  if (mouseAssignedShiftDrag?.target === target) return;
  document.querySelectorAll(".day-cell, .employee-name").forEach((el) => el.classList.remove("drag-valid", "drag-warning", "drag-invalid"));
  mouseAssignedShiftDrag.target = target;
  if (!target) return;
  if (!source) return;
  const nextShift = {
    ...source,
    id: event.ctrlKey ? uid("shift") : source.id,
    employeeId: target.dataset.employeeId,
    date: target.dataset.date || source.date
  };
  const result = validateShift(nextShift);
  if (result.errors.length) target.classList.add("drag-invalid");
  else if (result.warnings.length) target.classList.add("drag-warning");
  else target.classList.add("drag-valid");
}

function previewAssignedShiftCopyPaintTarget(source, target) {
  if (!mouseAssignedShiftDrag || !source || !target?.dataset.date || !target.dataset.employeeId) return;
  if (target.dataset.employeeId !== mouseAssignedShiftDrag.sourceEmployeeId) return;
  const key = `${target.dataset.employeeId}|${target.dataset.date}`;
  if (source.employeeId === target.dataset.employeeId && source.date === target.dataset.date) return;
  if (mouseAssignedShiftDrag.paintedTargets.has(key)) return;
  const nextShift = cloneCopiedShiftForCell(source, {
    employeeId: target.dataset.employeeId,
    date: target.dataset.date
  });
  const result = validateShift(nextShift);
  target.classList.remove("drag-valid", "drag-warning", "drag-invalid");
  if (result.errors.length) target.classList.add("drag-invalid");
  else if (result.warnings.length) target.classList.add("drag-warning");
  else target.classList.add("drag-valid");
  if (!result.errors.length) addCopyPaintPreviewCard(target, nextShift);
  mouseAssignedShiftDrag.paintedTargets.set(key, {
    employeeId: target.dataset.employeeId,
    date: target.dataset.date,
    errors: result.errors,
    warnings: result.warnings
  });
}

function addCopyPaintPreviewCard(target, shift) {
  const preview = renderShiftCard(shift, { preview: true });
  preview.dataset.copyPaintKey = `${shift.employeeId}|${shift.date}`;
  target.append(preview);
  target.classList.add("copy-paint-preview-cell");
  restoreGridScrollDuringDrag();
}

function clearCopyPaintPreviewCards() {
  document.querySelectorAll(".copy-paint-preview-card").forEach((card) => card.remove());
  document.querySelectorAll(".copy-paint-preview-cell").forEach((cell) => cell.classList.remove("copy-paint-preview-cell"));
}

async function finishMouseAssignedShiftDrag(event) {
  document.removeEventListener("pointermove", moveMouseAssignedShiftDrag);
  document.removeEventListener("pointercancel", cancelMouseAssignedShiftDrag);
  const drag = mouseAssignedShiftDrag;
  if (!drag) return;
  if (!drag.active) {
    mouseAssignedShiftDrag = null;
    return;
  }
  event.preventDefault();
  const source = state.shifts.find((shift) => shift.id === drag.shiftId);
  if (drag.copyPaint) {
    await finishAssignedShiftCopyPaint(source, drag);
    return;
  }
  const target = assignedShiftDropTargetFromPoint(event.clientX, event.clientY);
  const employeeTarget = target ? null : assignedShiftEmployeeTargetFromPoint(event.clientX, event.clientY);
  const trayTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("#unassignedShiftTray");
  if (source && trayTarget) {
    endAnyDrag();
    unassignShift(source.id);
    return;
  }
  if (!source || (!target && !employeeTarget)) {
    endAnyDrag();
    renderSchedulePreservingGridScroll();
    return;
  }
  await moveAssignedShiftToEmployee(
    source.id,
    target?.dataset.employeeId || employeeTarget?.dataset.employeeId,
    target?.dataset.date || source.date,
    event.ctrlKey
  );
}

async function finishAssignedShiftCopyPaint(source, drag) {
  if (!source) {
    endAnyDrag();
    return;
  }
  const targets = Array.from(drag.paintedTargets?.values?.() || []);
  const copyable = targets.filter((target) => !target.errors.length);
  const blocked = targets.length - copyable.length;
  if (!copyable.length) {
    if (blocked) showConflict("No copies were added. Every painted cell was blocked.");
    else showConflict("Drag across schedule cells to copy the shift.");
    endAnyDrag();
    return;
  }
  const warnings = copyable.flatMap((target) => target.warnings);
  endAnyDrag();
  if (!(await confirmWarnings([...new Set(warnings)], { confirmText: "Continue Anyway" }))) {
    return;
  }
  pushUndo();
  const copies = copyable.map((target) => cloneCopiedShiftForCell(source, target));
  state.shifts.push(...copies);
  selectedShiftId = copies[copies.length - 1]?.id || null;
  selectedCell = copies.length ? { employeeId: copies[copies.length - 1].employeeId, date: copies[copies.length - 1].date } : selectedCell;
  selectedTimeOffRequestId = null;
  selectedUnassignedShiftId = null;
  renderAllPreservingScheduleScroll();
  const skippedText = blocked ? ` Skipped ${blocked} blocked cell${blocked === 1 ? "" : "s"}.` : "";
  showConflict(`Copied shift into ${copies.length} cell${copies.length === 1 ? "" : "s"}.${skippedText}`);
}

function cancelMouseAssignedShiftDrag() {
  document.removeEventListener("pointermove", moveMouseAssignedShiftDrag);
  document.removeEventListener("pointerup", finishMouseAssignedShiftDrag);
  endAnyDrag();
}

function highlightBestOpenShiftDragTargets() {
  document.querySelectorAll(".drag-best-target").forEach((el) => el.classList.remove("drag-best-target"));
  const source = state.unassignedShifts?.find((shift) => shift.id === dragUnassignedShiftId);
  if (!source) return;
  const bestIds = new Set(stagedShiftCandidates(source).best.map((item) => item.employee.id));
  bestIds.forEach((employeeId) => {
    document.querySelectorAll(`[data-employee-id="${employeeId}"]`).forEach((el) => {
      if (el.classList.contains("employee-name") || el.classList.contains("day-cell")) {
        el.classList.add("drag-best-target");
      }
    });
  });
}

function updateDragAutoScroll(event) {
  dragScrollVelocity = 0;
  if (dragScrollFrame) cancelAnimationFrame(dragScrollFrame);
  dragScrollFrame = null;
}

function runDragAutoScroll() {
  if (!dragScrollVelocity || (!dragShiftId && !dragUnassignedShiftId && !mouseTimeOffDrag)) {
    dragScrollFrame = null;
    return;
  }
  const grid = $("scheduleGrid");
  if (grid) {
    grid.scrollTop += dragScrollVelocity;
  } else {
    window.scrollBy({ top: dragScrollVelocity, left: 0, behavior: "auto" });
  }
  dragScrollFrame = requestAnimationFrame(runDragAutoScroll);
}

function handleDragWheel(event) {
  if (!dragShiftId && !dragUnassignedShiftId) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  const tray = $("unassignedShiftTray");
  if (tray) {
    const rect = tray.getBoundingClientRect();
    const overTray = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (overTray && tray.scrollWidth > tray.clientWidth) {
      tray.scrollLeft += event.deltaX || event.deltaY || 0;
      return;
    }
  }
  const grid = $("scheduleGrid");
  const deltaY = event.deltaY || 0;
  const deltaX = event.deltaX || 0;
  if (grid) {
    grid.scrollTop += deltaY;
    grid.scrollLeft += deltaX || (event.shiftKey ? deltaY : 0);
    updateGridScrollLockFromCurrentPosition();
    updateMouseOpenShiftGhost(event);
    updateMouseAssignedShiftGhost(event);
    return;
  }
  window.scrollBy({ top: deltaY, left: deltaX, behavior: "auto" });
}

function handleScheduleGridWheel(event) {
  if (dragShiftId || dragUnassignedShiftId) {
    handleDragWheel(event);
    return;
  }
  if (event.ctrlKey) {
    event.preventDefault();
    adjustScheduleZoom(event.deltaY < 0 ? 0.05 : -0.05);
    return;
  }
  const grid = $("scheduleGrid");
  if (!grid) return;
  event.preventDefault();
  grid.scrollTop += event.deltaY || 0;
  grid.scrollLeft += event.deltaX || (event.shiftKey ? event.deltaY || 0 : 0);
}

function renderPendingTrayWarning() {
  const source = state.unassignedShifts.find((shift) => shift.id === pendingTrayWarning.unassignedId);
  const role = roleById(source?.roleId);
  const card = document.createElement("div");
  card.className = "pending-tray-warning";
  card.style.setProperty("--shift-color", shiftColor(source));
  card.innerHTML = `
    <div><strong>${role?.name || "Shift"}</strong><span>${source?.start || ""} - ${source?.untilVolume ? "Vol" : source?.end || ""}</span></div>
    <button type="button" title="Assign anyway">!</button>
  `;
  card.title = pendingTrayWarning.warnings.join(" ");
  card.querySelector("button").onclick = (event) => {
    event.stopPropagation();
    const pending = pendingTrayWarning;
    pendingTrayWarning = null;
    assignUnassignedShift(pending.unassignedId, pending.employeeId, true);
  };
  return card;
}

function focusDayOnOpenShiftDate(shift) {
  if (!focusedDateKey || !shift?.date || shift.date === focusedDateKey) return false;
  const shiftDate = parseDateKey(shift.date);
  if (Number.isNaN(shiftDate.getTime())) return false;
  if (!weekDates().some((date) => formatDateKey(date) === shift.date)) {
    setCurrentWeek(shiftDate, { shared: false });
  }
  focusedDateKey = shift.date;
  return true;
}

function selectOpenShiftWithoutFullRender(unassignedId) {
  const shift = state.unassignedShifts?.find((item) => item.id === unassignedId);
  pendingDeleteUnassignedShiftId = null;
  selectedUnassignedShiftId = unassignedId;
  selectedShiftId = null;
  selectedCell = null;
  pendingDeleteShiftId = null;
  pendingTrayWarning = null;
  if (focusDayOnOpenShiftDate(shift)) {
    renderSchedule();
    showConflict(`Showing ${displayDate(parseDateKey(shift.date))} for selected bay shift.`);
    return;
  }
  if (focusedDateKey) {
    renderSchedulePreservingGridScroll();
    return;
  }
  document.querySelectorAll(".unassigned-shift-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.unassignedShiftId === unassignedId);
    card.classList.remove("pending-delete");
  });
  renderSelectedStagedShiftInfo();
}

function clearOpenShiftSelectionAfterClick() {
  selectedUnassignedShiftId = null;
  pendingTrayWarning = null;
  pendingDeleteUnassignedShiftId = null;
  pendingDeleteShiftId = null;
  document.querySelectorAll(".unassigned-shift-card").forEach((card) => {
    card.classList.remove("selected", "pending-delete");
    card.querySelector(":scope > .delete-confirm-button")?.remove();
  });
  if (focusedDateKey) {
    renderSchedulePreservingGridScroll();
    return;
  }
  renderSelectedStagedShiftInfo();
}
function clearOpenShiftSelectionWithoutFullRender() {
  selectedUnassignedShiftId = null;
  pendingTrayWarning = null;
  pendingDeleteUnassignedShiftId = null;
  document.querySelectorAll(".unassigned-shift-card").forEach((card) => {
    card.classList.remove("selected", "pending-delete");
  });
  // The selected bay role is rendered into the schedule headers too. Refresh
  // those headers when focus is cleared, while preserving the user's position.
  renderSchedulePreservingGridScroll();
}
function renderSelectedStagedShiftInfo() {
  const panel = $("stagedShiftInfo");
  if (!panel) return;
  const shift = state.unassignedShifts?.find((item) => item.id === selectedUnassignedShiftId);
  const showPanel = Boolean(shift) && !focusedDateKey;
  document.body.classList.toggle("shift-bay-expanded", showPanel);
  if (!shift || focusedDateKey) {
    if (!shift) selectedUnassignedShiftId = null;
    panel.hidden = true;
    panel.classList.add("empty");
    panel.innerHTML = "";
    return;
  }
  const role = roleById(shift.roleId);
  const candidates = stagedShiftCandidates(shift);
  const historicalRecommendation = historicalRecommendationForOpenShift(shift, candidates);
  panel.hidden = false;
  panel.classList.remove("empty");
  panel.innerHTML = `
    <div class="staged-info-title">
      <div>
        <strong>${role?.name || "Shift"} ${shift.start} - ${shift.untilVolume ? "Vol" : shift.end}</strong>
        <span>${displayDate(parseDateKey(shift.date))} | ${role?.name || "Role"} shown first</span>
      </div>
      <button class="skip-open-shift-button" type="button" data-skip-open-shift title="Move this shift to the end of the Shift Bay without deleting it. Hotkey: S">Skip</button>
    </div>
    ${renderStagedCandidateSection("Best Fits", candidates.best, "best")}
    ${historicalRecommendation ? renderHistoricalRecommendationSection(historicalRecommendation) : ""}
  `;
  panel.querySelectorAll("[data-stage-assign]").forEach((button) => {
    button.onclick = () => assignUnassignedShift(shift.id, button.dataset.stageAssign);
  });
  panel.querySelector("[data-skip-open-shift]")?.addEventListener("click", skipSelectedOpenShift);
}

// Keep recommendation inputs independent so future weights can be configured without rewriting candidate rules.
const RECOMMENDATION_FACTORS = Object.freeze({
  historicalRepeat: Object.freeze({ weight: 1, minimumWeeks: 2 })
});

function recommendationFactorWeight(key) {
  const configured = Number(state.settings?.recommendationWeights?.[key]);
  return Number.isFinite(configured) ? configured : RECOMMENDATION_FACTORS[key]?.weight || 0;
}

function historicalShiftMatchCount(stagedShift, employeeId) {
  const targetDate = parseDateKey(stagedShift?.date);
  if (!targetDate || !stagedShift?.roleId || !stagedShift?.start) return 0;
  const targetDay = targetDate.getDay();
  const targetStart = minutesFromTime(stagedShift.start);
  const targetEnd = stagedShift.untilVolume ? "Until Volume" : normalizeTime(stagedShift.end);
  const weeks = new Set();
  historyShifts().forEach((shift) => {
    if (String(shift.employeeId || "") !== String(employeeId || "")) return;
    if (parseDateKey(shift.date)?.getDay() !== targetDay || shift.roleId !== stagedShift.roleId) return;
    if (minutesFromTime(shift.start) !== targetStart) return;
    const end = shift.untilVolume ? "Until Volume" : normalizeTime(shift.end);
    if (end !== targetEnd) return;
    if (Boolean(shift.isCloser) !== Boolean(stagedShift.isCloser)) return;
    if (Boolean(shift.isFlexDouble) !== Boolean(stagedShift.isFlexDouble)) return;
    if (shift.sourceWeekId || shift.sourceWeekStart) weeks.add(shift.sourceWeekId || shift.sourceWeekStart);
  });
  return weeks.size;
}

function historicalMostRecentMatchDate(stagedShift, employeeId) {
  const targetDate = parseDateKey(stagedShift?.date);
  if (!targetDate || !stagedShift?.roleId || !stagedShift?.start) return "";
  const targetDay = targetDate.getDay();
  const targetStart = minutesFromTime(stagedShift.start);
  const targetEnd = stagedShift.untilVolume ? "Until Volume" : normalizeTime(stagedShift.end);
  return historyShifts().reduce((latest, shift) => {
    if (String(shift.employeeId || "") !== String(employeeId || "")) return latest;
    if (parseDateKey(shift.date)?.getDay() !== targetDay || shift.roleId !== stagedShift.roleId) return latest;
    if (minutesFromTime(shift.start) !== targetStart) return latest;
    const end = shift.untilVolume ? "Until Volume" : normalizeTime(shift.end);
    if (end !== targetEnd) return latest;
    if (Boolean(shift.isCloser) !== Boolean(stagedShift.isCloser)) return latest;
    if (Boolean(shift.isFlexDouble) !== Boolean(stagedShift.isFlexDouble)) return latest;
    const candidate = String(shift.date || shift.sourceWeekStart || "");
    return candidate > latest ? candidate : latest;
  }, "");
}

function recommendationFactorsForOpenShift(stagedShift, employee) {
  const historicalWeeks = historicalShiftMatchCount(stagedShift, employee.id);
  const weight = recommendationFactorWeight("historicalRepeat");
  return [{
    key: "historicalRepeat",
    label: "Repeated historical assignment",
    value: historicalWeeks,
    weight,
    score: historicalWeeks * weight
  }];
}

function historicalRecommendationForOpenShift(stagedShift, candidates = stagedShiftCandidates(stagedShift)) {
  const minimumWeeks = RECOMMENDATION_FACTORS.historicalRepeat.minimumWeeks;
  return candidates.best
    .map((item) => ({
      ...item,
      factors: recommendationFactorsForOpenShift(stagedShift, item.employee),
      historicalWeeks: historicalShiftMatchCount(stagedShift, item.employee.id),
      historicalMostRecentDate: historicalMostRecentMatchDate(stagedShift, item.employee.id)
    }))
    .filter((item) => item.historicalWeeks >= minimumWeeks)
    .sort((a, b) => b.factors.reduce((sum, factor) => sum + factor.score, 0) - a.factors.reduce((sum, factor) => sum + factor.score, 0)
      || b.historicalWeeks - a.historicalWeeks
      || b.historicalMostRecentDate.localeCompare(a.historicalMostRecentDate)
      || displayName(a.employee).localeCompare(displayName(b.employee)))[0] || null;
}

function renderHistoricalRecommendationSection(recommendation) {
  return `
    <div class="staged-info-section staged-info-history-recommendation">
      <span>Schedule pattern</span>
      <div>
        <button type="button" data-stage-assign="${escapeHtml(recommendation.employee.id)}" title="Repeated schedule pattern">
          ${escapeHtml(displayName(recommendation.employee))} <small>${recommendation.historicalWeeks} repeated weeks</small>
        </button>
      </div>
    </div>
  `;
}

function stagedShiftCandidates(stagedShift) {
  const groups = { best: [], emergency: [], warning: [], blocked: [] };
  schedulableEmployees()
    .filter(visibleEmployee)
    .forEach((employee) => {
      const proposed = stagedShiftToShift(stagedShift, employee.id);
      const result = validateShift(proposed);
      const item = { employee, warnings: result.warnings, errors: result.errors };
      if (result.errors.length) groups.blocked.push(item);
      else if (employeeIsEmergencyOnlyForRole(employee, stagedShift.roleId)) groups.emergency.push(item);
      else if (result.warnings.length) groups.warning.push(item);
      else groups.best.push(item);
    });
  Object.values(groups).forEach((group) => {
    group.sort((a, b) => displayName(a.employee).localeCompare(displayName(b.employee)));
  });
  return groups;
}

function candidateReasonText(item) {
  return [...(item.errors || []), ...(item.warnings || [])].join(" ");
}

function hasClopenWarning(item) {
  return (item.warnings || []).some((warning) => /clopen/i.test(warning));
}

function renderClopenAlternatives(candidates) {
  const clopenWarnings = candidates.warning.filter(hasClopenWarning);
  if (!clopenWarnings.length || !candidates.best.length) return "";
  const cleanNames = candidates.best.slice(0, 4).map((item) => displayName(item.employee)).join(", ");
  return `
    <div class="staged-info-section staged-info-clopen">
      <span>Clopen-safe options</span>
      <div>
        <em>${clopenWarnings.length} option${clopenWarnings.length === 1 ? "" : "s"} would create a clopen. Try ${cleanNames} first.</em>
      </div>
    </div>
  `;
}

function renderStagedCandidateSection(label, candidates, kind, options = {}) {
  const isBlocked = kind === "blocked";
  const body = `
    <span>${label}${options.collapsible ? ` (${candidates.length})` : ""}</span>
    <div>
      ${candidates.length
        ? candidates.slice(0, 18).map((item) => `
            <button type="button" ${isBlocked ? "disabled" : `data-stage-assign="${item.employee.id}"`} title="${candidateReasonText(item)}">
              ${displayName(item.employee)}
              ${candidateReasonText(item) ? `<small>${candidateReasonText(item)}</small>` : ""}
            </button>
          `).join("")
        : `<em>${kind === "best" ? "No clean fits yet." : kind === "emergency" ? "No emergency-only options." : kind === "warning" ? "No warning-level options." : "No blocked employees."}</em>`}
    </div>
  `;
  if (options.collapsible) {
    return `
      <details class="staged-info-section staged-info-${kind} staged-info-collapsible">
        <summary>${label} <strong>${candidates.length}</strong></summary>
        <div class="staged-info-collapsible-body">
          ${body}
        </div>
      </details>
    `;
  }
  return `
    <div class="staged-info-section staged-info-${kind}">
      ${body}
    </div>
  `;
}

function renderRecentStagedSection(recent) {
  return `
    <div class="staged-info-section staged-info-recent">
      <span>Recent</span>
      <div>${recent.length ? recent.map((item) => `<button type="button" data-stage-assign="${item.employee.id}">${displayName(item.employee)} <small>${item.label}</small></button>`).join("") : `<em>No matching shifts in the last two weeks.</em>`}</div>
    </div>
  `;
}

function recentEmployeesForStagedShift(stagedShift) {
  const dates = [7, 14].map((daysBack) => formatDateKey(addDays(parseDateKey(stagedShift.date), -daysBack)));
  return state.shifts
    .filter((shift) => (
      dates.includes(shift.date) &&
      shift.roleId === stagedShift.roleId &&
      minutesFromTime(shift.start) === minutesFromTime(stagedShift.start)
    ))
    .map((shift) => ({
      employee: employeeById(shift.employeeId),
      label: shift.date === dates[0] ? "last week" : "2 weeks"
    }))
    .filter((item) => item.employee)
    .filter((item, index, array) => array.findIndex((other) => other.employee.id === item.employee.id && other.label === item.label) === index)
    .slice(0, 10);
}

function setScheduleZoom(nextZoom) {
  state.settings.scheduleZoom = Math.min(1.5, Math.max(0.65, Math.round(nextZoom * 20) / 20));
  updateScheduleViewToggle();
  applyScheduleZoom();
  saveState();
}

function adjustScheduleZoom(delta) {
  setScheduleZoom((Number(state.settings.scheduleZoom) || 1) + delta);
}

function applyScheduleZoom() {
  const zoom = Number(state.settings.scheduleZoom) || 1;
  document.documentElement.style.setProperty("--schedule-zoom", String(zoom));
  document.documentElement.style.setProperty("--employee-col-width", `${Math.round(220 * zoom)}px`);
  document.documentElement.style.setProperty("--day-col-min", `${Math.round(150 * zoom)}px`);
  if ($("zoomLabel")) $("zoomLabel").textContent = `${Math.round(zoom * 100)}%`;
}

function visibleShift(shift) {
  return state.settings.visibleDepartments.includes(shift.department) && visibleRoleIds().includes(shift.roleId);
}

function visibleRoleIds() {
  const saved = state.settings.visibleRoleIds || [];
  const currentRoleIds = state.roles.map((role) => role.id);
  const validSaved = saved.filter((roleId) => currentRoleIds.includes(roleId));
  return validSaved.length ? validSaved : currentRoleIds;
}

function visibleEmployee(employee) {
  const visibleDepartments = state.settings.visibleDepartments || [];
  const employeeDepartments = normalizeEmployeeDepartments(employee);
  const departmentMatch = employeeDepartments.some((department) => visibleDepartments.includes(department));
  if (state.settings.groupEmployeesByRole) return departmentMatch;
  const roleMatch = (employee.roleTraining || []).some((roleId) => visibleRoleIds().includes(roleId));
  return departmentMatch && (roleMatch || !(employee.roleTraining || []).length);
}

function renderFilters() {
  const visibleRoles = visibleRoleIds();
  const visibleDepartmentText = (state.settings.visibleDepartments || []).join(", ") || "No departments";
  const visibleRoleText = visibleRoles.length === state.roles.length
    ? "All roles"
    : state.roles.filter((role) => visibleRoles.includes(role.id)).map((role) => role.name).join(", ") || "No roles";
  $("printFilters").innerHTML = `
    <details id="scheduleFiltersDetails" class="filter-drawer" ${gridFiltersStayOpen ? "open" : ""}>
      <summary>
        <strong><span class="rail-label-short">Filters</span><span class="rail-label-full">Grid Filters</span></strong>
        <span>${visibleDepartmentText} | ${visibleRoleText}</span>
      </summary>
      <div class="filter-drawer-content">
        <div class="filter-block">
          <strong class="filter-label">Departments</strong>
          ${DEPARTMENTS.map((department) => `
            <label class="checkbox">
              <input type="checkbox" data-filter-department="${department}" ${state.settings.visibleDepartments.includes(department) ? "checked" : ""}>
              ${department}
            </label>
          `).join("")}
        </div>
        <div class="filter-block">
          <strong class="filter-label">Roles</strong>
          ${state.roles.map((role) => `
            <label class="checkbox">
              <input type="checkbox" data-filter-role="${role.id}" ${visibleRoles.includes(role.id) ? "checked" : ""}>
              ${role.name}
            </label>
          `).join("")}
        </div>
        <label class="checkbox">
          <input type="checkbox" id="groupEmployeesByRole" ${state.settings.groupEmployeesByRole ? "checked" : ""}>
          Separate employees by role
        </label>
        <label class="checkbox">
          <input type="checkbox" id="hideUnavailableEmployees" ${state.settings.hideUnavailableEmployees ? "checked" : ""}>
          Move employees with no weekly availability below
        </label>
        <label class="checkbox">
          <input type="checkbox" id="hideDefaultAvailabilityBlocks" ${state.settings.hideDefaultAvailabilityBlocks ? "checked" : ""}>
          Hide default unavailable blocks
        </label>
      </div>
    </details>
  `;
  const filterDetails = $("scheduleFiltersDetails");
  if (filterDetails) {
    updateGridFilterRailState();
    filterDetails.addEventListener("toggle", () => {
      gridFiltersStayOpen = filterDetails.open;
      if (!filterDetails.open) gridFiltersChangedWhileOpen = false;
      updateGridFilterRailState();
    });
  }
  document.querySelectorAll("[data-filter-department]").forEach((input) => {
    input.onchange = () => {
      markGridFiltersChanged();
      const department = input.dataset.filterDepartment;
      if (input.checked && !state.settings.visibleDepartments.includes(department)) state.settings.visibleDepartments.push(department);
      if (!input.checked) state.settings.visibleDepartments = state.settings.visibleDepartments.filter((item) => item !== department);
      saveState();
      renderSchedule();
      renderMonthly();
    };
  });
  document.querySelectorAll("[data-filter-role]").forEach((input) => {
    input.onchange = () => {
      markGridFiltersChanged();
      const selected = Array.from(document.querySelectorAll("[data-filter-role]:checked")).map((item) => item.dataset.filterRole);
      state.settings.visibleRoleIds = selected.length === state.roles.length ? [] : selected;
      saveState();
      renderSchedule();
      renderMonthly();
    };
  });
  $("groupEmployeesByRole").onchange = () => {
    markGridFiltersChanged();
    state.settings.groupEmployeesByRole = $("groupEmployeesByRole").checked;
    saveState();
    renderSchedule();
  };
  $("hideUnavailableEmployees").onchange = () => {
    markGridFiltersChanged();
    state.settings.hideUnavailableEmployees = $("hideUnavailableEmployees").checked;
    saveState();
    renderSchedule();
  };
  $("hideDefaultAvailabilityBlocks").onchange = () => {
    markGridFiltersChanged();
    state.settings.hideDefaultAvailabilityBlocks = $("hideDefaultAvailabilityBlocks").checked;
    saveState();
    renderSchedule();
  };
}

function updateGridFilterRailState() {
  const filterDetails = $("scheduleFiltersDetails");
  const isOpen = Boolean(filterDetails?.open);
  document.body.classList.toggle("grid-filters-open", isOpen);
  layoutScheduleRail();
}

function markGridFiltersChanged() {
  gridFiltersStayOpen = true;
  gridFiltersChangedWhileOpen = true;
}

function eventInsideGridFilters(event) {
  if (event.target.closest?.(".filter-drawer")) return true;
  return Boolean(event.composedPath?.().some((node) => node?.classList?.contains("filter-drawer")));
}

function renderSchedule() {
  renderScheduleControls();
  renderFilters();
  document.body.classList.toggle("problem-focus", Boolean(state.settings.problemFocusMode));
  const grid = $("scheduleGrid");
  const dates = weekDates();
  const weekKeys = new Set(dates.map(formatDateKey));
  // An assigned shift must keep its employee visible even if availability
  // was changed afterward. Availability controls suggestions, not visibility
  // of work that is already on the schedule.
  const scheduledEmployeeIds = new Set((state.shifts || [])
    .filter((shift) => weekKeys.has(shift.date) && shift.employeeId && visibleShift(shift))
    .map((shift) => shift.employeeId));
  const employeeHasAvailabilityOrScheduledShift = (employee) => (
    scheduledEmployeeIds.has(employee.id) || employeeHasAvailabilityForWeek(employee)
  );
  if (focusedDateKey && !dates.some((date) => formatDateKey(date) === focusedDateKey)) focusedDateKey = "";
  const allActiveEmployees = schedulableEmployees().filter(visibleEmployee);
  const unavailableEmployees = allActiveEmployees.filter((employee) => !employeeHasAvailabilityOrScheduledShift(employee));
  const activeEmployees = state.settings.hideUnavailableEmployees
    ? allActiveEmployees.filter(employeeHasAvailabilityOrScheduledShift)
    : allActiveEmployees;
  const selectedRoleId = selectedOpenShiftRoleId();
  const selectedOpenShift = selectedOpenShiftForSchedule();
  const orderedEmployees = prioritizeEmployeesForOpenShift(activeEmployees, selectedOpenShift);
  renderDayFocusToolRail();
  renderRoleJumpStrip(selectedRoleId);
  if (focusedDateKey) {
    if ($("printFilters")) $("printFilters").hidden = true;
    renderDayFocusSchedule(grid, orderedEmployees, focusedDateKey, selectedRoleId);
    renderUnavailableEmployeesList([]);
    renderWeeklyRoleSummary();
    renderIssueIndicator();
    layoutScheduleRail();
    return;
  }
  if ($("printFilters")) $("printFilters").hidden = false;
  grid.innerHTML = "";
  grid.classList.remove("day-focus-grid");
  grid.append(renderEmployeeHeadCell(orderedEmployees, selectedRoleId));
  dates.forEach((date) => grid.append(renderDayHeader(date)));
  if (state.settings.groupEmployeesByRole) renderGroupedEmployeeRows(grid, orderedEmployees, dates, selectedRoleId);
  else orderedEmployees.forEach((employee) => renderEmployeeScheduleRow(grid, employee, dates));
  if (!activeEmployees.length) {
    grid.innerHTML += `<div class="day-cell" style="grid-column: 1 / -1;">Add employees to start building the schedule.</div>`;
  }
  renderUnavailableEmployeesList(unavailableEmployees);
  renderWeeklyRoleSummary();
  renderIssueIndicator();
  layoutScheduleRail();
}

function renderDayFocusSchedule(grid, employees, dateKey, selectedRoleId = "") {
  const date = parseDateKey(dateKey);
  grid.innerHTML = "";
  grid.classList.add("day-focus-grid");
  grid.append(renderDayFocusHeader(date, employees));
  grid.append(renderDayFocusTimelineHeader(dateKey));
  const focusedEmployees = dayFocusOrderedEmployees(employees, dateKey, selectedRoleId);
  if (!focusedEmployees.length) {
    grid.insertAdjacentHTML("beforeend", `<div class="day-focus-empty">No scheduled shifts or availability blocks for ${displayDate(date)}.</div>`);
    return;
  }
  renderDayFocusRoleSections(grid, focusedEmployees, dateKey, selectedRoleId);
}

function employeeHasFocusDayContent(employee, dateKey, selectedRoleId = "") {
  return state.shifts.some((shift) => shift.employeeId === employee.id && shift.date === dateKey && visibleShift(shift)) ||
    employeeHasUsableAvailabilityForDate(employee, dateKey) ||
    dayFocusCleanFitForDay(employee, dateKey, selectedRoleId) ||
    timeOffForEmployeeDate(employee.id, dateKey).length;
}

function dayFocusNeededRoleIds(dateKey, selectedRoleId = "") {
  const ids = new Set();
  if (selectedRoleId) ids.add(selectedRoleId);
  state.shifts
    .filter((shift) => shift.date === dateKey && visibleShift(shift))
    .forEach((shift) => ids.add(shift.roleId));
  (state.unassignedShifts || [])
    .filter((shift) => shift.date === dateKey && visibleShift(shift))
    .forEach((shift) => ids.add(shift.roleId));
  return ids;
}

function dayFocusEmployeeRank(employee, dateKey, selectedRoleId = "") {
  const roleIds = dayFocusNeededRoleIds(dateKey, selectedRoleId);
  const hasScheduledShift = state.shifts.some((shift) => shift.employeeId === employee.id && shift.date === dateKey && visibleShift(shift));
  const hasCleanFit = dayFocusCleanFitForDay(employee, dateKey, selectedRoleId);
  const hasAvailableDay = employeeHasUsableAvailabilityForDate(employee, dateKey);
  const trainedNeededRole = [...roleIds].some((roleId) => employee.roleTraining?.includes(roleId));
  if (hasScheduledShift || hasCleanFit) return 0;
  if (hasAvailableDay && trainedNeededRole) return 1;
  if (hasAvailableDay) return 2;
  return 3;
}

function dayFocusOrderedEmployees(employees, dateKey, selectedRoleId = "") {
  return employees
    .filter((employee) => employeeHasFocusDayContent(employee, dateKey, selectedRoleId))
    .sort((a, b) => (
      dayFocusEmployeeRank(a, dateKey, selectedRoleId) - dayFocusEmployeeRank(b, dateKey, selectedRoleId) ||
      dayFocusPrimaryRoleName(a, dateKey, selectedRoleId).localeCompare(dayFocusPrimaryRoleName(b, dateKey, selectedRoleId)) ||
      displayName(a).localeCompare(displayName(b))
    ));
}

function dayFocusRolesForEmployee(employee, dateKey) {
  const roleIds = new Set(employee.roleTraining || []);
  state.shifts
    .filter((shift) => shift.employeeId === employee.id && shift.date === dateKey && visibleShift(shift))
    .forEach((shift) => roleIds.add(shift.roleId));
  return roleIds;
}

function renderDayFocusRoleSections(grid, employees, dateKey, selectedRoleId = "") {
  const rendered = new Set();
  // Keep the user's current vertical position stable in day view. A selected
  // bay shift may highlight its role, but expanding eligible names must not
  // reorder that entire role section to the top and make the shift appear to vanish.
  orderedRolesForSchedule("").forEach((role) => {
    const groupEmployees = employees.filter((employee) => dayFocusRolesForEmployee(employee, dateKey).has(role.id));
    const openRoleShifts = dayFocusOpenShiftsForRole(dateKey, role.id);
    if (!groupEmployees.length && (!dayFocusShowOpenShifts || !openRoleShifts.length)) return;
    const isCollapsed = collapsedScheduleRoleGroups.has(role.id);
    renderDayFocusRoleHeader(grid, role, groupEmployees, dateKey, openRoleShifts.length, isCollapsed, selectedRoleId === role.id);
    groupEmployees.forEach((employee) => rendered.add(employee.id));
    if (isCollapsed) return;
    const sortedEmployees = sortDayFocusGroupEmployees(groupEmployees, dateKey);
    if (dayFocusShowOpenShifts && dayFocusSortMode === "start" && openRoleShifts.length) {
      renderDayFocusRoleStartSortedRows(grid, role, sortedEmployees, openRoleShifts, dateKey, selectedRoleId, rendered);
      return;
    }
    if (dayFocusShowOpenShifts) renderDayFocusOpenShiftRows(grid, role, openRoleShifts, dateKey);
    sortedEmployees.forEach((employee) => {
      renderDayFocusEmployeeRow(grid, employee, dateKey, selectedRoleId, role);
    });
  });
  const otherEmployees = employees.filter((employee) => !rendered.has(employee.id));
  if (otherEmployees.length) {
    const otherRole = { id: "__other__", name: "Other Available Staff", color: "#64748b" };
    const isCollapsed = collapsedScheduleRoleGroups.has(otherRole.id);
    renderDayFocusRoleHeader(grid, otherRole, otherEmployees, dateKey, 0, isCollapsed, false);
    if (isCollapsed) return;
    sortDayFocusGroupEmployees(otherEmployees, dateKey).forEach((employee) => renderDayFocusEmployeeRow(grid, employee, dateKey, selectedRoleId));
  }
}

function renderDayFocusRoleStartSortedRows(grid, role, employees, openShifts, dateKey, selectedRoleId, rendered) {
  const rows = [
    ...openShifts.map((openShift) => ({
      type: "open",
      key: `open-${openShift.id}`,
      start: minutesFromTime(openShift.start) ?? 99999,
      label: `${role.name} ${openShift.start || ""}`,
      openShift
    })),
    ...employees.map((employee) => ({
      type: "employee",
      key: `employee-${employee.id}`,
      start: earliestEmployeeShiftStartForDate(employee.id, dateKey),
      label: displayName(employee),
      employee
    }))
  ].sort((a, b) => {
    const startCompare = a.start - b.start;
    if (startCompare) return startCompare;
    if (a.type !== b.type) return a.type === "open" ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  rows.forEach((row) => {
    if (row.type === "open") {
      renderDayFocusOpenShiftRows(grid, role, [row.openShift], dateKey);
      return;
    }
    rendered.add(row.employee.id);
    renderDayFocusEmployeeRow(grid, row.employee, dateKey, selectedRoleId, role);
  });
}

function renderDayFocusRoleHeader(grid, role, employees, dateKey, openShiftCount = 0, isCollapsed = false, isSelected = false) {
  const roleShifts = state.shifts.filter((shift) => shift.date === dateKey && shift.roleId === role.id && visibleShift(shift));
  const openText = openShiftCount ? ` / ${openShiftCount} open` : "";
  const header = cell("schedule-role-group day-focus-role-group", `
    <span class="role-group-toggle" aria-hidden="true">${isCollapsed ? "+" : "-"}</span>
    <span><strong>${escapeHtml(role.name)}</strong><small>${employees.length} staff / ${roleShifts.length} shift${roleShifts.length === 1 ? "" : "s"}${openText}</small></span>
  `);
  header.dataset.roleGroup = role.id;
  header.title = `${isCollapsed ? "Expand" : "Collapse"} ${role.name}`;
  header.classList.toggle("collapsed-role-group", isCollapsed);
  if (isSelected) header.classList.add("selected-role-group");
  header.style.setProperty("--role-color", role.color || "#64748b");
  header.onclick = () => {
    if (suppressRoleGroupClickId === role.id) {
      suppressRoleGroupClickId = null;
      return;
    }
    if (collapsedScheduleRoleGroups.has(role.id)) collapsedScheduleRoleGroups.delete(role.id);
    else collapsedScheduleRoleGroups.add(role.id);
    saveCollapsedScheduleRoleGroups();
    renderSchedule();
  };
  if (role.id !== "__other__") wireScheduleRoleGroupDrag(header, role.id);
  grid.append(header);
}

function sortDayFocusGroupEmployees(employees, dateKey) {
  const list = [...employees];
  if (dayFocusSortMode !== "start") {
    return list.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }
  return list.sort((a, b) => {
    const aStart = earliestEmployeeShiftStartForDate(a.id, dateKey);
    const bStart = earliestEmployeeShiftStartForDate(b.id, dateKey);
    return aStart - bStart || displayName(a).localeCompare(displayName(b));
  });
}

function earliestEmployeeShiftStartForDate(employeeId, dateKey) {
  const starts = state.shifts
    .filter((shift) => shift.employeeId === employeeId && shift.date === dateKey && visibleShift(shift))
    .map((shift) => minutesFromTime(shift.start))
    .filter((value) => value != null);
  return starts.length ? Math.min(...starts) : 99999;
}

function dayFocusOpenShiftsForRole(dateKey, roleId) {
  return (state.unassignedShifts || [])
    .filter((shift) => shift.date === dateKey && shift.roleId === roleId && visibleShift(shift))
    .sort((a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0) || (minutesFromTime(a.end) ?? 0) - (minutesFromTime(b.end) ?? 0));
}

function dayFocusEligibleEmployeesForOpenShift(openShift) {
  return schedulableEmployees()
    .filter(visibleEmployee)
    .map((employee) => {
      const proposed = stagedShiftToShift(openShift, employee.id);
      const result = validateShift(proposed);
      return { employee, result };
    })
    .filter((item) => !item.result.errors.length && !item.result.warnings.length)
    .sort((a, b) => displayName(a.employee).localeCompare(displayName(b.employee)));
}

function dayFocusEmployeeWeekSummary(employee, dateKey) {
  const weekStart = startOfWeek(parseDateKey(dateKey), state.settings.weekStart);
  const weekStartKey = formatDateKey(weekStart);
  const weekEndKey = formatDateKey(addDays(weekStart, 6));
  const shifts = state.shifts.filter((shift) =>
    shift.employeeId === employee.id &&
    shift.date >= weekStartKey &&
    shift.date <= weekEndKey &&
    visibleShift(shift)
  );
  const roleCounts = new Map();
  shifts.forEach((shift) => {
    const roleName = roleById(shift.roleId)?.name || "Other";
    roleCounts.set(roleName, (roleCounts.get(roleName) || 0) + 1);
  });
  const roleText = [...roleCounts.entries()].map(([roleName, count]) => `${roleName} ${count}`).join(", ") || "No shifts yet";
  const closeCount = shifts.filter((shift) => shift.isCloser).length;
  return `${shifts.length} shift${shifts.length === 1 ? "" : "s"} this week | ${roleText} | ${closeCount} close${closeCount === 1 ? "" : "s"}`;
}

function showDayFocusChipTooltip(chip) {
  const text = chip?.dataset.chipTip;
  if (!text) return;
  let tooltip = $("dayFocusChipTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "dayFocusChipTooltip";
    tooltip.className = "day-focus-chip-tooltip";
    document.body.append(tooltip);
  }
  tooltip.textContent = text;
  tooltip.hidden = false;
  const chipRect = chip.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const gap = 8;
  const left = Math.max(8, Math.min(
    chipRect.left + (chipRect.width - tooltipRect.width) / 2,
    window.innerWidth - tooltipRect.width - 8
  ));
  const above = chipRect.top - tooltipRect.height - gap;
  const top = above >= 8 ? above : Math.min(chipRect.bottom + gap, window.innerHeight - tooltipRect.height - 8);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
  tooltip.classList.add("visible");
}

function hideDayFocusChipTooltip() {
  const tooltip = $("dayFocusChipTooltip");
  if (!tooltip) return;
  tooltip.classList.remove("visible");
  tooltip.hidden = true;
}

function renderDayFocusOpenShiftRows(grid, role, openShifts, dateKey) {
  openShifts.forEach((openShift) => {
    const roleColor = role.color || shiftColor(openShift);
    const expanded = dayFocusExpandedEligibleShiftIds.has(openShift.id);
    const eligibleCount = expanded ? dayFocusEligibleEmployeesForOpenShift(openShift).length : 0;
    const eligibleRows = expanded ? Math.min(4, Math.max(1, Math.ceil(Math.max(eligibleCount, 1) / 7))) : 1;
    const labelCell = cell(`day-focus-open-name ${expanded ? "expanded" : ""}`, `
      <div class="day-focus-open-label" style="--role-color:${roleColor}">
        <div>
          <strong>Open</strong>
          <span>${escapeHtml(openShift.start)} - ${escapeHtml(openShift.untilVolume ? "Vol" : openShift.end)}</span>
        </div>
        <button type="button" class="day-focus-open-toggle" data-day-open-toggle-eligible aria-label="${expanded ? "Hide" : "Show"} eligible staff for this open shift">${expanded ? "-" : "+"}</button>
      </div>
    `);
    const timelineCell = cell(`day-cell day-focus-open-cell ${expanded ? "expanded" : ""}`, renderDayFocusOpenShiftTimeline(openShift, role));
    if (expanded) {
      labelCell.style.setProperty("--eligible-rows", eligibleRows);
      timelineCell.style.setProperty("--eligible-rows", eligibleRows);
    }
    timelineCell.dataset.date = dateKey;
    timelineCell.dataset.openShiftId = openShift.id;
    grid.append(labelCell);
    grid.append(timelineCell);
    timelineCell.querySelector("[data-day-open-edit]")?.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      selectedUnassignedShiftId = openShift.id;
      openShiftDialog(openShift);
    });
    labelCell.querySelector("[data-day-open-toggle-eligible]")?.addEventListener("click", () => {
      if (dayFocusExpandedEligibleShiftIds.has(openShift.id)) dayFocusExpandedEligibleShiftIds.delete(openShift.id);
      else dayFocusExpandedEligibleShiftIds.add(openShift.id);
      renderSchedulePreservingGridScroll();
    });
    timelineCell.querySelectorAll("[data-day-open-assign]").forEach((button) => {
      button.addEventListener("click", () => assignUnassignedShift(openShift.id, button.dataset.dayOpenAssign));
      if (button.dataset.chipTip) {
        button.addEventListener("pointerenter", () => showDayFocusChipTooltip(button));
        button.addEventListener("pointerleave", hideDayFocusChipTooltip);
        button.addEventListener("focus", () => showDayFocusChipTooltip(button));
        button.addEventListener("blur", hideDayFocusChipTooltip);
      }
    });
  });
}

function renderDayFocusOpenShiftTimeline(openShift, role) {
  const window = dayFocusFullTimelineWindow(openShift.date);
  const range = Math.max(1, window.end - window.start);
  const shiftRange = getTimelineRange(openShift);
  const start = shiftRange.start ?? window.start;
  const end = shiftRange.end ?? start + 60;
  const visibleStart = Math.max(window.start, start);
  const visibleEnd = Math.min(window.end, end);
  const left = ((visibleStart - window.start) / range) * 100;
  const width = Math.max(5, ((Math.max(visibleEnd, visibleStart + 30) - visibleStart) / range) * 100);
  const eligible = dayFocusEligibleEmployeesForOpenShift(openShift);
  const patternRecommendation = historicalRecommendationForOpenShift(openShift);
  const expanded = dayFocusExpandedEligibleShiftIds.has(openShift.id);
  const endLabel = openShift.untilVolume ? "Vol" : (openShift.end || timeFromMinutes(end));
  const timeLabel = `${openShift.start.replace(":00 ", "")} - ${endLabel.replace(":00 ", "")}`;
  const chips = eligible.length
    ? eligible.map((item) => `<button type="button" class="day-focus-eligible-chip${patternRecommendation?.employee.id === item.employee.id ? " day-focus-pattern-chip" : ""}" data-day-open-assign="${item.employee.id}" data-chip-tip="${escapeHtml(dayFocusEmployeeWeekSummary(item.employee, openShift.date))}">${escapeHtml(displayName(item.employee))}</button>`).join("")
    : `<em>No clean fits</em>`;
  return `
    <div class="day-focus-row-timebar day-focus-open-timebar-wrap">
      <div class="day-focus-timebar day-focus-row-timeline day-focus-open-timeline" data-timeline-date="${openShift.date}" data-timeline-start="${window.start}" data-timeline-end="${window.end}">
        <div class="day-focus-timebar-track" style="--timeline-lanes:1;">
          ${renderDayFocusTimelineBackdrop(openShift.date, window, true)}
          <div class="day-focus-timebar-shift day-focus-open-shift ${selectedUnassignedShiftId === openShift.id ? "selected" : ""}" data-day-open-edit data-unassigned-shift-id="${openShift.id}" style="--shift-color:${role.color || shiftColor(openShift)}; left:${left}%; width:${Math.min(width, 100 - left)}%;" title="Open ${escapeHtml(role?.name || "shift")}: ${escapeHtml(openShift.start)} - ${escapeHtml(openShift.untilVolume ? "Until Volume" : openShift.end)}">
            <span class="timebar-shift-label"><strong>Open ${escapeHtml(role?.name || "Shift")}</strong><em>${escapeHtml(timeLabel)}</em></span>
          </div>
        </div>
      </div>
      ${expanded ? `<div class="day-focus-open-eligible"><span>Eligible</span><div>${chips}</div></div>` : ""}
    </div>
  `;
}

function renderDayFocusTimelineBackdrop(dateKey, window, showTicks = false) {
  const range = Math.max(1, window.end - window.start);
  const periods = getMealPeriodsForDate(dateKey).filter((period) => ["Breakfast", "Lunch", "Dinner"].includes(period.name));
  const segments = periods.map((period) => {
    const left = ((Math.max(window.start, period.startMinutes) - window.start) / range) * 100;
    const width = ((Math.min(window.end, period.endMinutes) - Math.max(window.start, period.startMinutes)) / range) * 100;
    return `<span class="timebar-meal-segment timebar-meal-${period.name.toLowerCase()}" style="left:${left}%; width:${Math.max(0, width)}%;"><em>${period.name}</em></span>`;
  }).join("");
  if (!showTicks) return segments;
  const ticks = [];
  for (let minutes = Math.ceil(window.start / 180) * 180; minutes <= window.end; minutes += 180) {
    ticks.push({
      label: timeFromMinutes(minutes).replace(":00", "").replace(" ", ""),
      left: ((minutes - window.start) / range) * 100
    });
  }
  return `${segments}${ticks.map((tick) => `<span class="timebar-tick day-focus-row-tick" style="left:${tick.left}%"><em>${tick.label}</em></span>`).join("")}`;
}
function dayFocusPrimaryRoleName(employee, dateKey, selectedRoleId = "") {
  if (selectedRoleId && employee.roleTraining?.includes(selectedRoleId)) return roleById(selectedRoleId)?.name || "";
  const scheduledRole = state.shifts.find((shift) => shift.employeeId === employee.id && shift.date === dateKey && visibleShift(shift))?.roleId;
  if (scheduledRole) return roleById(scheduledRole)?.name || "";
  const roleIds = dayFocusNeededRoleIds(dateKey, selectedRoleId);
  const trainedRoleId = [...roleIds].find((roleId) => employee.roleTraining?.includes(roleId));
  return roleById(trainedRoleId)?.name || "zz";
}

function moveFocusedDay(delta) {
  if (!focusedDateKey) return;
  const date = addDays(parseDateKey(focusedDateKey), delta);
  focusedDateKey = formatDateKey(date);
  setCurrentWeek(date);
  renderSchedule();
}

function renderDayFocusHeader(date, employees) {
  const dateKey = formatDateKey(date);
  const hasDayNote = Boolean(dayNoteForDate(dateKey));
  const head = cell("employee-head day-focus-title-cell", `
    <div class="day-focus-title">
      <div>
        <strong>${displayDate(date)}</strong>
      </div>
      <div class="day-focus-actions">
        <button type="button" class="icon-button week-nav day-focus-step-button" data-day-focus-prev title="Previous day" aria-label="Previous day">&#8249;</button>
        <button type="button" class="icon-button week-nav day-focus-step-button" data-day-focus-next title="Next day" aria-label="Next day">&#8250;</button>
        <button type="button" class="small-button day-focus-notes-button${hasDayNote ? " has-notes" : ""}" data-day-notes title="Add or edit floor chart notes for this day">Day Notes</button>
        <button type="button" class="small-button" data-exit-day-focus>Back to Week</button>
      </div>
    </div>
  `);
  head.querySelector("[data-day-focus-prev]").onclick = () => moveFocusedDay(-1);
  head.querySelector("[data-day-focus-next]").onclick = () => moveFocusedDay(1);
  head.querySelector("[data-day-notes]").onclick = () => openDayNotesDialog(dateKey);
  head.querySelector("[data-exit-day-focus]").onclick = () => {
    exitDayFocus();
  };
  return head;
}

function renderDayFocusMealHeader(dateKey, meal) {
  const roleCounts = new Map();
  state.shifts
    .filter((shift) => shift.date === dateKey && visibleShift(shift) && getMealsForShift(shift).includes(meal))
    .forEach((shift) => {
      const role = roleById(shift.roleId);
      const name = role?.name || "Role";
      roleCounts.set(name, (roleCounts.get(name) || 0) + 1);
    });
  const counts = [...roleCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([role, count]) => `${role} ${count}`)
    .join(" / ");
  const head = cell("grid-head day-focus-meal-head", `
    <div class="day-focus-meal-title">
      <strong>${meal}</strong>
      <span>${counts || "No shifts yet"}</span>
    </div>
    ${renderDayFocusMealTimeline(dateKey, meal)}
  `);
  wireDayFocusTimeline(head);
  return head;
}

function renderDayFocusTimelineHeader(dateKey) {
  const shifts = state.shifts.filter((shift) => shift.date === dateKey && visibleShift(shift));
  const roleCounts = new Map();
  shifts.forEach((shift) => {
    const role = roleById(shift.roleId);
    const name = role?.name || "Role";
    roleCounts.set(name, (roleCounts.get(name) || 0) + 1);
  });
  const counts = [...roleCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([role, count]) => `<span>${escapeHtml(role)} <strong>${count}</strong></span>`)
    .join("");
  const head = cell("grid-head day-focus-timeline-head", `
    ${renderDayFocusFullTimeline(dateKey, counts || `<span>No shifts yet</span>`)}
  `);
  return head;
}

function dayFocusFullTimelineWindow(dateKey) {
  const periods = getMealPeriodsForDate(dateKey).filter((period) => ["Breakfast", "Lunch", "Dinner"].includes(period.name));
  const shifts = state.shifts.filter((shift) => shift.date === dateKey && visibleShift(shift));
  const openShifts = dayFocusShowOpenShifts ? (state.unassignedShifts || []).filter((shift) => shift.date === dateKey && visibleShift(shift)) : [];
  const shiftRanges = [...shifts, ...openShifts].map(getTimelineRange).filter((range) => range.start != null);
  const periodStarts = periods.map((period) => period.startMinutes).filter((value) => value != null);
  const periodEnds = periods.map((period) => period.endMinutes).filter((value) => value != null);
  const shiftStarts = shiftRanges.map((range) => range.start).filter((value) => value != null);
  const shiftEnds = shiftRanges.map((range) => range.end ?? range.start + 60).filter((value) => value != null);
  let start = periodStarts.length || shiftStarts.length ? Math.min(...periodStarts, ...shiftStarts) : null;
  let end = periodEnds.length || shiftEnds.length ? Math.max(...periodEnds, ...shiftEnds) : null;
  if (start == null) start = 6 * 60;
  if (end == null) end = 22 * 60;
  if (end <= start) end += 1440;
  start = Math.max(0, Math.floor((start - 30) / 30) * 30);
  end = Math.min(1440, Math.ceil((end + 30) / 30) * 30);
  if (end - start < 360) end = Math.min(1440, start + 360);
  return { start, end };
}

function layoutDayFocusTimelineItems(items) {
  const lanes = [];
  return items
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((item) => {
      let lane = lanes.findIndex((laneEnd) => item.start >= laneEnd);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(item.end);
      } else {
        lanes[lane] = item.end;
      }
      return { ...item, lane };
    });
}

function renderDayFocusFullTimeline(dateKey, countHtml = "") {
  const window = dayFocusFullTimelineWindow(dateKey);
  const range = Math.max(1, window.end - window.start);
  const periods = getMealPeriodsForDate(dateKey).filter((period) => ["Breakfast", "Lunch", "Dinner"].includes(period.name));
  const ticks = [];
  for (let minutes = Math.ceil(window.start / 60) * 60; minutes <= window.end; minutes += 60) {
    ticks.push({
      label: timeFromMinutes(minutes).replace(":00", "").replace(" ", ""),
      left: ((minutes - window.start) / range) * 100
    });
  }
  const segments = renderDayFocusTimelineBackdrop(dateKey, window, false);
  return `
    <div class="day-focus-timebar day-focus-full-timebar" data-timeline-date="${dateKey}" data-timeline-start="${window.start}" data-timeline-end="${window.end}">
      <div class="day-focus-timebar-track day-focus-ruler-track" style="--timeline-lanes:1;">
        ${segments}
        ${ticks.map((tick) => `<span class="timebar-tick" style="left:${tick.left}%"><em>${tick.label}</em></span>`).join("")}
        ${countHtml ? `<div class="day-focus-count-tableau">${countHtml}</div>` : ""}
      </div>
    </div>
  `;
}

function dayFocusMealTimelineWindow(dateKey, meal) {
  const period = getMealPeriodsForDate(dateKey).find((item) => item.name === meal);
  let start = period?.startMinutes;
  let end = period?.endMinutes;
  const shifts = state.shifts.filter((shift) => shift.date === dateKey && visibleShift(shift) && getMealsForShift(shift).includes(meal));
  const shiftRanges = shifts.map(getTimelineRange).filter((range) => range.start != null);
  if (shiftRanges.length) {
    const shiftStart = Math.min(...shiftRanges.map((range) => range.start));
    const shiftEnd = Math.max(...shiftRanges.map((range) => range.end ?? range.start + 60));
    start = start == null ? shiftStart : Math.min(start, shiftStart);
    end = end == null ? shiftEnd : Math.max(end, shiftEnd);
  }
  if (start == null) start = meal === "Breakfast" ? 6 * 60 : meal === "Lunch" ? 10 * 60 : 16 * 60;
  if (end == null) end = meal === "Breakfast" ? 11 * 60 : meal === "Lunch" ? 16 * 60 : 22 * 60;
  if (end <= start) end += 1440;
  start = Math.max(0, Math.floor((start - 30) / 30) * 30);
  end = Math.min(1440, Math.ceil((end + 30) / 30) * 30);
  if (end - start < 180) end = Math.min(1440, start + 180);
  return { start, end };
}

function renderDayFocusMealTimeline(dateKey, meal) {
  const shifts = state.shifts
    .filter((shift) => shift.date === dateKey && visibleShift(shift) && getMealsForShift(shift).includes(meal))
    .sort((a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0));
  const window = dayFocusMealTimelineWindow(dateKey, meal);
  const range = Math.max(1, window.end - window.start);
  const ticks = [];
  for (let minutes = Math.ceil(window.start / 180) * 180; minutes <= window.end; minutes += 180) {
    ticks.push({
      label: timeFromMinutes(minutes).replace(":00", "").replace(" ", ""),
      left: ((minutes - window.start) / range) * 100
    });
  }
  const bars = shifts.map((shift) => {
    const role = roleById(shift.roleId);
    const employee = employeeById(shift.employeeId);
    const shiftRange = getTimelineRange(shift);
    const start = Math.max(window.start, shiftRange.start ?? window.start);
    const end = Math.min(window.end, shiftRange.end ?? window.end);
    const left = ((start - window.start) / range) * 100;
    const width = Math.max(7, ((Math.max(end, start + 30) - start) / range) * 100);
    return `
      <div class="day-focus-timebar-shift" data-timeline-shift="${shift.id}" style="--shift-color:${shiftColor(shift)}; left:${left}%; width:${Math.min(width, 100 - left)}%;" title="${escapeHtml(displayName(employee))}: ${escapeHtml(role?.name || "Shift")} ${shift.start} - ${shift.untilVolume ? "Until Volume" : shift.end}">
        <span class="timebar-resize-handle timebar-start" data-timeline-resize="start" aria-hidden="true"></span>
        <span class="timebar-shift-label">${escapeHtml(displayName(employee).split(" ")[0])} ${escapeHtml(shift.start.replace(":00 ", ""))}</span>
        <span class="timebar-resize-handle timebar-end" data-timeline-resize="end" aria-hidden="true"></span>
      </div>
    `;
  }).join("");
  return `
    <div class="day-focus-timebar" data-timeline-date="${dateKey}" data-timeline-meal="${meal}" data-timeline-start="${window.start}" data-timeline-end="${window.end}">
      <div class="day-focus-timebar-track">
        ${ticks.map((tick) => `<span class="timebar-tick" style="left:${tick.left}%"><em>${tick.label}</em></span>`).join("")}
        ${bars || `<span class="timebar-empty">No scheduled ${meal.toLowerCase()} shifts</span>`}
      </div>
    </div>
  `;
}

function wireDayFocusTimeline(root) {
  root.querySelectorAll("[data-timeline-shift]").forEach((bar) => {
    bar.querySelector(".unassign-confirm-button")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shiftId = bar.dataset.timelineShift;
      pendingDeleteShiftId = null;
      unassignShift(shiftId);
    });
    bar.querySelector(".delete-confirm-button")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shiftId = bar.dataset.timelineShift;
      pushUndo();
      state.shifts = state.shifts.filter((item) => item.id !== shiftId);
      selectedShiftId = null;
      selectedCell = null;
      pendingDeleteShiftId = null;
      saveState();
      renderAllPreservingScheduleScroll();
    });
    bar.ondblclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shift = state.shifts.find((item) => item.id === bar.dataset.timelineShift);
      if (!shift) return;
      selectedShiftId = shift.id;
      selectedCell = { employeeId: shift.employeeId, date: shift.date, roleId: shift.roleId };
      selectedTimeOffRequestId = null;
      openShiftDialog(shift);
    };
    bar.onpointerdown = (event) => beginDayFocusTimelineDrag(event, bar);
  });
}

function beginDayFocusTimelineDrag(event, bar) {
  if (event.button !== 0 || event.target.closest(".delete-confirm-button, .unassign-confirm-button")) return;
  const shift = state.shifts.find((item) => item.id === bar.dataset.timelineShift);
  const track = bar.closest(".day-focus-timebar-track");
  const timebar = bar.closest(".day-focus-timebar");
  if (!shift || !track || !timebar) return;
  event.preventDefault();
  event.stopPropagation();
  const mode = event.target.closest("[data-timeline-resize]")?.dataset.timelineResize || "move";
  const start = minutesFromTime(shift.start);
  const end = shift.untilVolume ? estimatedUntilVolumeEnd(shift) : minutesFromTime(shift.end);
  if (start == null || end == null) return;
  pushUndo();
  dayFocusTimelineDrag = {
    shiftId: shift.id,
    mode,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - bar.getBoundingClientRect().left,
    offsetY: event.clientY - bar.getBoundingClientRect().top,
    originalStart: start,
    originalEnd: end <= start ? end + 1440 : end,
    timelineStart: Number(timebar.dataset.timelineStart) || 0,
    timelineEnd: Number(timebar.dataset.timelineEnd) || 1440,
    track,
    bar,
    labelTime: bar.querySelector(".timebar-shift-label em"),
    ghostLabelTime: null,
    originalLabelText: bar.querySelector(".timebar-shift-label em")?.textContent || "",
    moved: false,
    wasUntilVolume: Boolean(shift.untilVolume)
  };
  bar.setPointerCapture?.(event.pointerId);
  bar.classList.add("timebar-dragging");
  window.addEventListener("pointermove", moveDayFocusTimelineDrag);
  window.addEventListener("pointerup", finishDayFocusTimelineDrag, { once: true });
}

function ensureDayFocusTimelineDragGhost(event) {
  const drag = dayFocusTimelineDrag;
  if (!drag || drag.mode !== "move" || drag.ghost) return;
  const ghost = createDragGhost(drag.bar, event, drag);
  ghost.classList.add("day-focus-drag-ghost");
  document.body.append(ghost);
  drag.ghost = ghost;
  drag.ghostLabelTime = ghost.querySelector(".timebar-shift-label em");
  drag.bar.dataset.mouseDragging = "true";
  drag.bar.classList.add("drag-source-hidden");
  document.body.classList.add("dragging-assigned-shift");
}

function updateDayFocusTimelineDragGhost(event) {
  const drag = dayFocusTimelineDrag;
  const ghost = drag?.ghost;
  if (!ghost) return;
  ghost.style.left = `${event.clientX - (drag.offsetX || 0)}px`;
  ghost.style.top = `${event.clientY - (drag.offsetY || 0)}px`;
}

function cleanupDayFocusTimelineDragVisual(drag = dayFocusTimelineDrag) {
  drag?.ghost?.remove();
  removeDayFocusTimelineSnapPreview(drag);
  if (drag?.bar) {
    drag.bar.dataset.mouseDragging = "false";
    drag.bar.classList.remove("drag-source-hidden", "timebar-dragging");
  }
  if (drag?.labelTime) {
    drag.labelTime.classList.remove("timebar-draft-time");
    if (!drag.moved && drag.originalLabelText) drag.labelTime.textContent = drag.originalLabelText;
  }
  document.body.classList.remove("dragging-assigned-shift");
}

function timelineSnapDelta(drag, clientX) {
  const rect = drag.track.getBoundingClientRect();
  const range = Math.max(1, drag.timelineEnd - drag.timelineStart);
  const rawDelta = ((clientX - drag.startX) / Math.max(rect.width, 1)) * range;
  return Math.round(rawDelta / 15) * 15;
}

function dayFocusTimelineDragTimes(clientX) {
  const drag = dayFocusTimelineDrag;
  if (!drag) return null;
  const delta = timelineSnapDelta(drag, clientX);
  const duration = Math.max(30, drag.originalEnd - drag.originalStart);
  let start = drag.originalStart;
  let end = drag.originalEnd;
  if (drag.mode === "move") {
    if (drag.wasUntilVolume) start = drag.originalStart + delta;
    else {
      start = drag.originalStart + delta;
      end = drag.originalEnd + delta;
    }
  } else if (drag.mode === "start") {
    start = Math.min(drag.originalStart + delta, drag.originalEnd - 30);
  } else {
    end = Math.max(drag.originalEnd + delta, drag.originalStart + 30);
  }
  if (start < 0) {
    if (drag.mode === "move" && !drag.wasUntilVolume) end -= start;
    start = 0;
  }
  if (end > 1440) {
    if (drag.mode === "move" && !drag.wasUntilVolume) start -= end - 1440;
    end = 1440;
  }
  start = Math.max(0, Math.min(1410, start));
  end = Math.max(start + 30, Math.min(1440, end));
  if (drag.mode === "move" && !drag.wasUntilVolume && end - start !== duration) end = Math.min(1440, start + duration);
  return { start, end };
}

function dayFocusDraftTimeText(drag, times) {
  if (!drag || !times) return "";
  const start = timeFromMinutes(times.start).replace(":00 ", "");
  const end = drag.wasUntilVolume && drag.mode === "move" ? "Vol" : timeFromMinutes(times.end).replace(":00 ", "");
  if (drag.mode === "start") return `Start ${start}`;
  if (drag.mode === "end") return `End ${end}`;
  return `${start} - ${end}`;
}

function removeDayFocusTimelineSnapPreview(drag = dayFocusTimelineDrag) {
  drag?.snapPreview?.remove();
  if (drag) drag.snapPreview = null;
}

function updateDayFocusTimelineSnapPreview(drag, times) {
  if (!drag || !times || !drag.track) return;
  const range = Math.max(1, drag.timelineEnd - drag.timelineStart);
  if (!drag.snapPreview) {
    const preview = document.createElement("div");
    preview.className = "day-focus-snap-preview";
    preview.innerHTML = '<span class="day-focus-snap-line day-focus-snap-line-start"></span><span class="day-focus-snap-line day-focus-snap-line-end"></span><strong class="day-focus-snap-label"></strong>';
    drag.track.append(preview);
    drag.snapPreview = preview;
  }
  const startPct = ((Math.max(drag.timelineStart, Math.min(drag.timelineEnd, times.start)) - drag.timelineStart) / range) * 100;
  const endPct = ((Math.max(drag.timelineStart, Math.min(drag.timelineEnd, times.end)) - drag.timelineStart) / range) * 100;
  const activePct = drag.mode === "end" ? endPct : startPct;
  const preview = drag.snapPreview;
  const startLine = preview.querySelector(".day-focus-snap-line-start");
  const endLine = preview.querySelector(".day-focus-snap-line-end");
  const label = preview.querySelector(".day-focus-snap-label");
  if (startLine) {
    startLine.style.left = `${startPct}%`;
    startLine.hidden = drag.mode === "end";
  }
  if (endLine) {
    endLine.style.left = `${endPct}%`;
    endLine.hidden = drag.mode === "start" || (drag.wasUntilVolume && drag.mode === "move");
  }
  if (label) {
    label.textContent = dayFocusDraftTimeText(drag, times);
    label.style.left = `${Math.max(3, Math.min(97, activePct))}%`;
  }
}

function updateDayFocusTimelineDraftLabels(drag, times) {
  const text = dayFocusDraftTimeText(drag, times);
  [drag?.labelTime, drag?.ghostLabelTime].forEach((label) => {
    if (!label || !text) return;
    label.textContent = text;
    label.classList.add("timebar-draft-time");
  });
}

function moveDayFocusTimelineDrag(event) {
  const drag = dayFocusTimelineDrag;
  if (!drag) return;
  event.preventDefault();
  const times = dayFocusTimelineDragTimes(event.clientX);
  if (!times) return;
  drag.moved = true;
  ensureDayFocusTimelineDragGhost(event);
  updateDayFocusTimelineDragGhost(event);
  const range = Math.max(1, drag.timelineEnd - drag.timelineStart);
  const visibleStart = Math.max(drag.timelineStart, times.start);
  const visibleEnd = Math.min(drag.timelineEnd, drag.wasUntilVolume && drag.mode === "move" ? drag.originalEnd : times.end);
  const left = ((visibleStart - drag.timelineStart) / range) * 100;
  const width = Math.max(7, ((visibleEnd - visibleStart) / range) * 100);
  drag.bar.style.left = `${left}%`;
  drag.bar.style.width = `${Math.min(width, 100 - left)}%`;
  updateDayFocusTimelineSnapPreview(drag, times);
  updateDayFocusTimelineDraftLabels(drag, times);
}

async function finishDayFocusTimelineDrag(event) {
  const drag = dayFocusTimelineDrag;
  window.removeEventListener("pointermove", moveDayFocusTimelineDrag);
  if (!drag) return;
  cleanupDayFocusTimelineDragVisual(drag);
  if (!drag.moved) {
    undoStack.pop();
    const shift = state.shifts.find((item) => item.id === drag.shiftId);
    const hadPendingDelete = Boolean(pendingDeleteShiftId);
    if (shift) {
      selectedShiftId = shift.id;
      selectedCell = { employeeId: shift.employeeId, date: shift.date, roleId: shift.roleId };
      selectedTimeOffRequestId = null;
      selectedUnassignedShiftId = null;
      pendingDeleteShiftId = null;
      document.querySelectorAll(".day-focus-timebar-shift.selected").forEach((item) => item.classList.remove("selected"));
      drag.bar.classList.add("selected");
    }
    dayFocusTimelineDrag = null;
    if (hadPendingDelete) renderSchedulePreservingGridScroll();
    return;
  }
  const times = dayFocusTimelineDragTimes(event.clientX);
  dayFocusTimelineDrag = null;
  const shift = state.shifts.find((item) => item.id === drag.shiftId);
  if (!times || !shift) return;
  const targetCell = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".day-focus-employee-timeline-cell[data-employee-id]");
  if (!targetCell) {
    undoStack.pop();
    renderSchedulePreservingGridScroll();
    return;
  }
  const targetEmployeeId = drag.mode === "move" && targetCell?.dataset.employeeId ? targetCell.dataset.employeeId : shift.employeeId;
  const nextShift = {
    ...shift,
    employeeId: targetEmployeeId,
    start: timeFromMinutes(times.start),
    end: (drag.mode !== "move" || !drag.wasUntilVolume) ? timeFromMinutes(times.end) : shift.end,
    untilVolume: (drag.mode !== "move" || !drag.wasUntilVolume) ? false : shift.untilVolume
  };
  const result = validateShift(nextShift);
  if (result.errors.length) {
    undoStack.pop();
    showConflict(result.errors.join(" "));
    renderSchedule();
    return;
  }
  if (!(await confirmWarnings(result.warnings, { confirmText: "Save Anyway" }))) {
    undoStack.pop();
    renderSchedule();
    return;
  }
  state.shifts = state.shifts.map((item) => item.id === shift.id ? nextShift : item);
  selectedShiftId = nextShift.id;
  selectedCell = { employeeId: nextShift.employeeId, date: nextShift.date };
  saveState();
  renderSchedulePreservingGridScroll();
}

function renderDayFocusEmployeeRow(grid, employee, dateKey, selectedRoleId = "", groupRole = null) {
  const nameCell = renderEmployeeNameCell(employee, groupRole, { compact: true });
  nameCell.classList.add("day-focus-employee-name");
  grid.append(nameCell);
  grid.append(renderDayFocusEmployeeTimelineCell(employee, dateKey, selectedRoleId, groupRole));
}

function renderDayFocusEmployeeTimelineCell(employee, dateKey, selectedRoleId = "", groupRole = null) {
  const dayCell = cell("day-cell day-focus-employee-timeline-cell", "");
  dayCell.dataset.employeeId = employee.id;
  dayCell.dataset.date = dateKey;
  const shifts = state.shifts
    .filter((shift) => shift.employeeId === employee.id && shift.date === dateKey && visibleShift(shift))
    .sort((a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0));
  const unavailableRanges = unavailableRangesForEmployeeDate(employee, dateKey);
  const dayTimeOffRequests = timeOffForEmployeeDate(employee.id, dateKey);
  const cleanFit = dayFocusCleanFitForDay(employee, dateKey, selectedRoleId);
  if (cleanFit) {
    dayCell.classList.add("day-focus-clean-fit");
    dayCell.title = `Clean fit for ${cleanFit.roleName} ${cleanFit.start} - ${cleanFit.end}`;
  }
  if (selectedCell?.employeeId === employee.id && selectedCell?.date === dateKey) dayCell.classList.add("selected");
  applySelectedOpenShiftRowState(dayCell, employee);
  dayCell.onclick = (event) => {
    if (event.target.closest(".day-focus-timebar-shift")) return;
    if (selectedUnassignedShiftId) {
      event.stopPropagation();
      assignUnassignedShift(selectedUnassignedShiftId, employee.id);
      return;
    }
    selectedCell = { employeeId: employee.id, date: dateKey, roleId: selectedRoleId || "" };
    selectedShiftId = null;
    selectedTimeOffRequestId = null;
    renderSchedule();
  };
  dayCell.ondblclick = (event) => {
    if (event.target.closest(".day-focus-timebar-shift")) return;
    event.stopPropagation();
    selectedCell = { employeeId: employee.id, date: dateKey, roleId: selectedRoleId || "" };
    selectedShiftId = null;
    selectedTimeOffRequestId = null;
    openShiftDialog();
  };
  dayCell.ondragover = (event) => handleDragOver(event, dayCell);
  dayCell.ondragenter = (event) => handleDragEnter(event, dayCell);
  dayCell.ondragleave = () => dayCell.classList.remove("drag-valid", "drag-warning", "drag-invalid");
  dayCell.ondrop = (event) => handleDrop(event, dayCell);
  dayCell.innerHTML = `
    <div class="day-focus-row-timebar">
      ${renderDayFocusEmployeeTimeline(dateKey, employee, shifts, unavailableRanges, dayTimeOffRequests, groupRole)}
    </div>
  `;
  wireDayFocusTimeline(dayCell);
  return dayCell;
}

function renderDayFocusEmployeeTimeline(dateKey, employee, shifts, unavailableRanges = [], timeOffRequests = [], groupRole = null) {
  const window = dayFocusFullTimelineWindow(dateKey);
  const range = Math.max(1, window.end - window.start);
  const periods = getMealPeriodsForDate(dateKey).filter((period) => ["Breakfast", "Lunch", "Dinner"].includes(period.name));
  const ticks = [];
  for (let minutes = Math.ceil(window.start / 180) * 180; minutes <= window.end; minutes += 180) {
    ticks.push({
      label: timeFromMinutes(minutes).replace(":00", "").replace(" ", ""),
      left: ((minutes - window.start) / range) * 100
    });
  }
  const segments = periods.map((period) => {
    const left = ((Math.max(window.start, period.startMinutes) - window.start) / range) * 100;
    const width = ((Math.min(window.end, period.endMinutes) - Math.max(window.start, period.startMinutes)) / range) * 100;
    return `<span class="timebar-meal-segment timebar-meal-${period.name.toLowerCase()}" style="left:${left}%; width:${Math.max(0, width)}%;"></span>`;
  }).join("");
  const blockedRanges = [
    ...unavailableRanges.map((blocked) => ({ ...blocked, kind: "unavailable", label: unavailableRangeLabel(blocked) })),
    ...timeOffRequests.map((request) => ({ ...requestOffTimelineRange(request, dateKey), kind: isScheduleBlock(request) ? "block" : "ro" }))
  ].filter((blocked) => blocked.start != null && blocked.end != null && blocked.end > window.start && blocked.start < window.end);
  const timelineItems = layoutDayFocusTimelineItems([
    ...shifts.map((shift) => {
      const range = getTimelineRange(shift);
      return { type: "shift", shift, start: range.start ?? 0, end: range.end ?? (range.start ?? 0) + 30 };
    }),
    ...blockedRanges.map((blocked) => ({ type: "blocked", blocked, start: blocked.start, end: blocked.end }))
  ]);
  const laneCount = Math.max(1, Math.min(5, timelineItems.reduce((max, item) => Math.max(max, item.lane + 1), 1)));
  const bars = timelineItems.filter((item) => item.type === "shift").map(({ shift, lane, start, end }) => {
    const role = roleById(shift.roleId);
    const isGhost = Boolean(groupRole?.id && shift.roleId !== groupRole.id);
    const visibleStart = Math.max(window.start, start);
    const visibleEnd = Math.min(window.end, end);
    const left = ((visibleStart - window.start) / range) * 100;
    const width = Math.max(4, ((Math.max(visibleEnd, visibleStart + 30) - visibleStart) / range) * 100);
    const endLabel = shift.untilVolume ? "Vol" : (shift.end || timeFromMinutes(end));
    const timeLabel = `${shift.start.replace(":00 ", "")} - ${endLabel.replace(":00 ", "")}`;
    return `
      <div class="day-focus-timebar-shift day-focus-row-shift ${isGhost ? "day-focus-ghost-shift" : ""} ${selectedShiftId === shift.id ? "selected" : ""} ${pendingDeleteShiftId === shift.id ? "pending-delete" : ""}" data-timeline-shift="${shift.id}" style="--shift-color:${shiftColor(shift)}; --timebar-top:${4 + lane * 20}px; left:${left}%; width:${Math.min(width, 100 - left)}%;" title="${escapeHtml(isGhost ? "Also scheduled here: " : "")}${escapeHtml(displayName(employee))}: ${escapeHtml(role?.name || "Shift")} ${shift.start} - ${shift.untilVolume ? "Until Volume" : shift.end}">
        <span class="timebar-resize-handle timebar-start" data-timeline-resize="start" aria-hidden="true"></span>
        <span class="timebar-shift-label">
          <strong>${escapeHtml(role?.name || "Shift")}</strong>
          <em>${escapeHtml(timeLabel)}</em>
        </span>
        ${shift.training?.isTraining ? `<span class="timebar-training-badge" title="Training shift">TR</span>` : ""}
        ${shift.isCloser ? `<span class="timebar-close-badge">CL</span>` : ""}
        ${pendingDeleteShiftId === shift.id ? `<span class="day-focus-delete-options"><button class="unassign-confirm-button" type="button" title="Move back to Shift Bay" aria-label="Move back to Shift Bay"><span class="open-bay-icon" aria-hidden="true"></span></button><button class="delete-confirm-button" type="button" title="Delete shift permanently" aria-label="Delete shift permanently">X</button></span>` : ""}
        <span class="timebar-resize-handle timebar-end" data-timeline-resize="end" aria-hidden="true"></span>
      </div>
    `;
  }).join("");
  const blockedBars = timelineItems.filter((item) => item.type === "blocked").map(({ blocked, lane }) => {
    const visibleStart = Math.max(window.start, blocked.start);
    const visibleEnd = Math.min(window.end, blocked.end);
    const left = ((visibleStart - window.start) / range) * 100;
    const width = Math.max(4, ((Math.max(visibleEnd, visibleStart + 30) - visibleStart) / range) * 100);
    const label = blocked.kind === "ro" ? "RO" : "Unavailable";
    return `
      <div class="day-focus-timebar-block day-focus-timebar-block-${blocked.kind}" style="--timebar-top:${4 + lane * 20}px; left:${left}%; width:${Math.min(width, 100 - left)}%;" title="${escapeHtml(label)}: ${escapeHtml(blocked.label || "")}">
        <span>${escapeHtml(label)}</span>
        <em>${escapeHtml(blocked.label || "")}</em>
      </div>
    `;
  }).join("");
  return `
    <div class="day-focus-timebar day-focus-row-timeline" data-timeline-date="${dateKey}" data-timeline-start="${window.start}" data-timeline-end="${window.end}">
      <div class="day-focus-timebar-track" style="--timeline-lanes:${laneCount}; min-height:${Math.max(42, 31 + ((laneCount - 1) * 20))}px;">
        ${segments}
        ${ticks.map((tick) => `<span class="timebar-row-tick" style="left:${tick.left}%"><em>${tick.label}</em></span>`).join("")}
        ${bars}
        ${blockedBars}
        ${!bars && !blockedBars ? `<span class="timebar-empty">Available</span>` : ""}
      </div>
    </div>
  `;
}

function renderDayFocusMealCell(employee, dateKey, meal, selectedRoleId = "") {
  const dayCell = cell("day-cell day-focus-meal-cell", "");
  dayCell.dataset.employeeId = employee.id;
  dayCell.dataset.date = dateKey;
  dayCell.dataset.meal = meal;
  const allDayShifts = state.shifts
    .filter((shift) => shift.employeeId === employee.id && shift.date === dateKey && visibleShift(shift))
    .sort((a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0));
  const mealShifts = allDayShifts.filter((shift) => getMealsForShift(shift).includes(meal));
  const unavailableRanges = unavailableRangesForEmployeeDate(employee, dateKey);
  const dayTimeOffRequests = timeOffForEmployeeDate(employee.id, dateKey);
  if ((unavailableRanges.length || dayTimeOffRequests.length) && mealShifts.length) dayCell.classList.add("has-availability-block-with-shift");
  if (mealShifts.length > 1) dayCell.classList.add("has-stacked-shifts");
  if (mealShifts.some((shift) => getMealsForShift(shift).length > 1)) dayCell.classList.add("has-meal-overlap-shift");
  const cleanFit = dayFocusCleanFitForMeal(employee, dateKey, meal);
  if (cleanFit) {
    dayCell.classList.add("day-focus-clean-fit");
    dayCell.title = `Clean fit for ${cleanFit.roleName} ${cleanFit.start} - ${cleanFit.end}`;
  }
  if (selectedCell?.employeeId === employee.id && selectedCell?.date === dateKey) dayCell.classList.add("selected");
  applySelectedOpenShiftRowState(dayCell, employee);
  dayCell.onclick = (event) => {
    if (event.target.closest(".shift-card")) return;
    if (selectedUnassignedShiftId) {
      event.stopPropagation();
      assignUnassignedShift(selectedUnassignedShiftId, employee.id);
      return;
    }
    selectedCell = { employeeId: employee.id, date: dateKey, roleId: selectedRoleId || "" };
    selectedShiftId = null;
    selectedTimeOffRequestId = null;
    renderSchedule();
  };
  dayCell.ondblclick = (event) => {
    if (event.target.closest(".shift-card")) return;
    event.stopPropagation();
    selectedCell = { employeeId: employee.id, date: dateKey, roleId: selectedRoleId || "" };
    selectedShiftId = null;
    selectedTimeOffRequestId = null;
    openShiftDialog();
  };
  dayCell.ondragover = (event) => handleDragOver(event, dayCell);
  dayCell.ondragenter = (event) => handleDragEnter(event, dayCell);
  dayCell.ondragleave = () => dayCell.classList.remove("drag-valid", "drag-warning", "drag-invalid");
  dayCell.ondrop = (event) => handleDrop(event, dayCell);
  dayCell.insertAdjacentHTML("beforeend", renderUnavailableBadge(employee, dateKey));
  dayTimeOffRequests.forEach((request) => dayCell.append(renderTimeOffBadge(request)));
  mealShifts.forEach((shift) => {
    const card = renderShiftCard(shift);
    if (getMealsForShift(shift).length > 1) {
      card.classList.add("meal-overlap-card");
      card.insertAdjacentHTML("beforeend", `<span class="meal-overlap-marker" title="This shift appears in every meal it covers">Overlap</span>`);
    }
    dayCell.append(card);
  });
  return dayCell;
}

function dayFocusOpenShiftsForMeal(dateKey, meal) {
  return (state.unassignedShifts || [])
    .filter((shift) => (
      shift.date === dateKey &&
      visibleShift(shift) &&
      getMealsForShift(shift).includes(meal)
    ))
    .sort((a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0));
}

function dayFocusCleanFitForMeal(employee, dateKey, meal) {
  const candidates = dayFocusOpenShiftsForMeal(dateKey, meal);
  for (const candidate of candidates) {
    const testShift = {
      ...candidate,
      id: `day_focus_test_${candidate.id}`,
      employeeId: employee.id,
      date: dateKey
    };
    const result = validateShift(testShift);
    if (!result.errors.length && !result.warnings.length) {
      return {
        roleName: roleById(candidate.roleId)?.name || "shift",
        start: candidate.start,
        end: candidate.untilVolume ? "Until Volume" : candidate.end
      };
    }
  }
  return null;
}

function dayFocusCleanFitForDay(employee, dateKey, selectedRoleId = "") {
  const candidates = (state.unassignedShifts || [])
    .filter((shift) => shift.date === dateKey && visibleShift(shift))
    .filter((shift) => !selectedRoleId || shift.roleId === selectedRoleId)
    .sort((a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0));
  for (const candidate of candidates) {
    const testShift = {
      ...candidate,
      id: `day_focus_test_${candidate.id}`,
      employeeId: employee.id,
      date: dateKey
    };
    const result = validateShift(testShift);
    if (!result.errors.length && !result.warnings.length) {
      return {
        roleName: roleById(candidate.roleId)?.name || "shift",
        start: candidate.start,
        end: candidate.untilVolume ? "Until Volume" : candidate.end
      };
    }
  }
  return null;
}

function renderDayFocusToolRail() {
  const rail = $("dayFocusToolRail");
  if (!rail) return;
  if (!focusedDateKey) {
    rail.hidden = true;
    rail.innerHTML = "";
    return;
  }
  document.body.classList.remove("grid-filters-open");
  rail.hidden = false;
  rail.innerHTML = `
    <span><span class="rail-label-short">Day</span><span class="rail-label-full">Day view</span></span>
    <button type="button" class="day-focus-tool-button ${dayFocusShowOpenShifts ? "selected" : ""}" data-day-focus-open-toggle title="Show or hide unassigned Shift Bay shifts inside this day view">Bay</button>
    <button type="button" class="day-focus-tool-button ${dayFocusSortMode === "alpha" ? "selected" : ""}" data-day-focus-sort="alpha" title="Sort staff alphabetically inside each role">A-Z</button>
    <button type="button" class="day-focus-tool-button ${dayFocusSortMode === "start" ? "selected" : ""}" data-day-focus-sort="start" title="Sort staff inside each role by earliest scheduled start time">Start</button>
  `;
  rail.querySelector("[data-day-focus-open-toggle]")?.addEventListener("click", () => {
    dayFocusShowOpenShifts = !dayFocusShowOpenShifts;
    saveDayFocusShowOpenShifts();
    renderSchedulePreservingGridScroll();
  });
  rail.querySelectorAll("[data-day-focus-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      dayFocusSortMode = button.dataset.dayFocusSort === "start" ? "start" : "alpha";
      saveDayFocusSortMode();
      renderSchedulePreservingGridScroll();
    });
  });
  positionDayFocusRails();
}

function positionDayFocusRails() {
  layoutScheduleRail();
}
function renderRoleJumpStrip(selectedRoleId = "") {
  const strip = $("roleJumpStrip");
  if (!strip) return;
  const roles = orderedRolesForSchedule(selectedRoleId);
  const shouldShow = state.settings.groupEmployeesByRole && roles.length > 1;
  strip.hidden = !shouldShow;
  if (!shouldShow) {
    strip.innerHTML = "";
    return;
  }
  strip.innerHTML = `
    <span><span class="rail-label-short">Roles</span><span class="rail-label-full">Jump to role</span></span>
    ${roles.map((role) => `<button type="button" class="${role.id === selectedRoleId ? "selected" : ""}" data-role-jump="${role.id}" style="--role-color:${role.color || "#64748b"}">${role.name}</button>`).join("")}
  `;
  strip.onmouseenter = () => {
    window.clearTimeout(renderRoleJumpStrip.closeTimer);
    strip.classList.add("rail-expanded");
  };
  strip.onmouseleave = () => {
    window.clearTimeout(renderRoleJumpStrip.closeTimer);
    renderRoleJumpStrip.closeTimer = window.setTimeout(() => strip.classList.remove("rail-expanded"), 180);
  };
  strip.querySelectorAll("[data-role-jump]").forEach((button) => {
    button.onclick = () => {
      const roleId = button.dataset.roleJump;
      window.clearTimeout(renderRoleJumpStrip.closeTimer);
      strip.classList.remove("rail-expanded");
      button.blur();
      if (collapsedScheduleRoleGroups.has(roleId)) {
        collapsedScheduleRoleGroups.delete(roleId);
        saveCollapsedScheduleRoleGroups();
        renderSchedule();
        window.requestAnimationFrame(() => {
          document.querySelector(`[data-role-group="${roleId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }
      const target = document.querySelector(`[data-role-group="${roleId}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
  });
}

function scheduleRoleGroupKeysForEmployees(employees, selectedRoleId = "") {
  if (!state.settings.groupEmployeesByRole) return [];
  const rendered = new Set();
  const keys = [];
  orderedRolesForSchedule(selectedRoleId).forEach((role) => {
    const groupEmployees = employees.filter((employee) => employee.roleTraining?.includes(role.id));
    if (!groupEmployees.length) return;
    keys.push(role.id);
    groupEmployees.forEach((employee) => rendered.add(employee.id));
  });
  if (employees.some((employee) => !rendered.has(employee.id))) keys.push("__other__");
  return keys;
}

function renderEmployeeHeadCell(employees, selectedRoleId = "") {
  const groupKeys = scheduleRoleGroupKeysForEmployees(employees, selectedRoleId);
  const canCollapse = state.settings.groupEmployeesByRole && groupKeys.length > 0;
  const allCollapsed = canCollapse && groupKeys.every((key) => collapsedScheduleRoleGroups.has(key));
  const head = cell("employee-head", `
    <div class="employee-head-content">
      <span>Employee</span>
      ${canCollapse ? `<button type="button" class="small-button collapse-all-role-groups" title="${allCollapsed ? "Expand all role sections" : "Collapse all role sections"}">${allCollapsed ? "Expand All" : "Collapse All"}</button>` : ""}
    </div>
  `);
  const button = head.querySelector(".collapse-all-role-groups");
  if (button) {
    button.onclick = (event) => {
      event.stopPropagation();
      if (allCollapsed) groupKeys.forEach((key) => collapsedScheduleRoleGroups.delete(key));
      else groupKeys.forEach((key) => collapsedScheduleRoleGroups.add(key));
      saveCollapsedScheduleRoleGroups();
      renderSchedule();
    };
  }
  return head;
}

function selectedOpenShiftRoleId() {
  return selectedOpenShiftForSchedule()?.roleId || "";
}

function jumpToEmployeeByLetter(letter) {
  const grid = $("scheduleGrid");
  if (!grid || focusedDateKey) return false;
  const normalized = String(letter || "").toLowerCase();
  if (!/^[a-z]$/.test(normalized)) return false;
  const selectedRoleId = selectedOpenShiftRoleId();
  const visibleCells = Array.from(grid.querySelectorAll(".employee-name[data-employee-id]"))
    .filter((cell) => cell.offsetParent !== null);
  let candidates = visibleCells;
  if (selectedRoleId) {
    const roleMatches = visibleCells.filter((cell) => cell.dataset.roleGroup === selectedRoleId);
    if (roleMatches.length) candidates = roleMatches;
  } else if (state.settings.groupEmployeesByRole) {
    const gridRect = grid.getBoundingClientRect();
    const firstVisibleRole = visibleCells.find((cell) => {
      const rect = cell.getBoundingClientRect();
      return rect.bottom >= gridRect.top + 24 && rect.top <= gridRect.bottom;
    })?.dataset.roleGroup;
    const roleMatches = firstVisibleRole ? visibleCells.filter((cell) => cell.dataset.roleGroup === firstVisibleRole) : [];
    if (roleMatches.length) candidates = roleMatches;
  }
  const target = candidates.find((cell) => cell.dataset.employeeFirstLetter === normalized) ||
    visibleCells.find((cell) => cell.dataset.employeeFirstLetter === normalized);
  if (!target) return false;
  const targetTop = target.offsetTop - grid.offsetTop;
  grid.scrollTo({ top: Math.max(0, targetTop - 12), left: grid.scrollLeft, behavior: "smooth" });
  target.classList.remove("keyboard-jump-target");
  window.requestAnimationFrame(() => target.classList.add("keyboard-jump-target"));
  window.clearTimeout(jumpToEmployeeByLetter.timer);
  jumpToEmployeeByLetter.timer = window.setTimeout(() => target.classList.remove("keyboard-jump-target"), 900);
  return true;
}

function selectedOpenShiftForSchedule() {
  if (mouseOpenShiftDrag?.active || dragUnassignedShiftId) return null;
  const shift = state.unassignedShifts?.find((item) => item.id === selectedUnassignedShiftId) || null;
  if (focusedDateKey && shift?.date !== focusedDateKey) return null;
  return shift;
}

function scrollToOpenShiftRoleForDrag(unassignedId) {
  const shift = state.unassignedShifts?.find((item) => item.id === unassignedId);
  if (!shift?.roleId || !state.settings.groupEmployeesByRole) return;
  window.requestAnimationFrame(() => {
    const target = document.querySelector(`[data-role-group="${shift.roleId}"]`);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const topSafeArea = 116;
    const bottomSafeArea = window.innerHeight - 90;
    if (rect.top >= topSafeArea && rect.bottom <= bottomSafeArea) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function prioritizeEmployeesForOpenShift(employees, openShift) {
  const roleId = openShift?.roleId || "";
  const candidateRanks = openShift ? openShiftCandidateRankMap(openShift) : new Map();
  return employees.slice().sort((a, b) => {
    const aCandidate = candidateRanks.get(a.id) ?? 3;
    const bCandidate = candidateRanks.get(b.id) ?? 3;
    const aMatch = roleId && a.roleTraining?.includes(roleId) ? 0 : 1;
    const bMatch = roleId && b.roleTraining?.includes(roleId) ? 0 : 1;
    return aCandidate - bCandidate || aMatch - bMatch || displayName(a).localeCompare(displayName(b));
  });
}

function openShiftCandidateRankMap(openShift) {
  const ranks = new Map();
  const candidates = stagedShiftCandidates(openShift);
  candidates.best.forEach((item, index) => ranks.set(item.employee.id, index === 0 ? 0 : 1));
  candidates.emergency.forEach((item) => {
    if (!ranks.has(item.employee.id)) ranks.set(item.employee.id, 2);
  });
  candidates.warning.forEach((item) => {
    if (!ranks.has(item.employee.id)) ranks.set(item.employee.id, 3);
  });
  return ranks;
}

function selectedOpenShiftRecommendation() {
  const shift = selectedOpenShiftForSchedule();
  if (!shift) return null;
  const candidates = stagedShiftCandidates(shift);
  return candidates.best[0]?.employee || candidates.emergency[0]?.employee || candidates.warning[0]?.employee || null;
}

function defaultScheduleRoleOrder(roles = state.roles, visibleDepartments = state.settings?.visibleDepartments || ["FOH"]) {
  return roles
    .filter((role) => visibleDepartments.includes(role.department))
    .slice()
    .sort((a, b) => {
      const aServer = a.name.toLowerCase() === "server" ? 0 : 1;
      const bServer = b.name.toLowerCase() === "server" ? 0 : 1;
      return aServer - bServer || a.name.localeCompare(b.name);
    })
    .map((role) => role.id);
}

function normalizeScheduleRoleOrder(order = [], roles = state.roles, visibleDepartments = state.settings?.visibleDepartments || ["FOH"]) {
  const roleIds = new Set(roles.map((role) => role.id));
  const saved = Array.isArray(order) ? order.filter((roleId) => roleIds.has(roleId)) : [];
  const missing = defaultScheduleRoleOrder(roles, visibleDepartments).filter((roleId) => !saved.includes(roleId));
  return [...saved, ...missing];
}

function scheduleRoleOrderMap() {
  state.settings.scheduleRoleOrder = normalizeScheduleRoleOrder(state.settings.scheduleRoleOrder || []);
  return new Map(state.settings.scheduleRoleOrder.map((roleId, index) => [roleId, index]));
}

function compareRolesByScheduleOrder(a, b) {
  const order = scheduleRoleOrderMap();
  const aOrder = order.has(a?.id) ? order.get(a.id) : 9999;
  const bOrder = order.has(b?.id) ? order.get(b.id) : 9999;
  return aOrder - bOrder || (a?.name || "").localeCompare(b?.name || "");
}

function compareRoleIdsByScheduleOrder(aRoleId, bRoleId) {
  return compareRolesByScheduleOrder(roleById(aRoleId), roleById(bRoleId));
}

function renderScheduleRoleOrderEditor() {
  const target = $("scheduleRoleOrderEditor");
  if (!target) return;
  state.settings.scheduleRoleOrder = normalizeScheduleRoleOrder(state.settings.scheduleRoleOrder || []);
  const roles = orderedRolesForSchedule();
  if (!roles.length) {
    target.innerHTML = `<p class="hint">No visible roles to order.</p>`;
    return;
  }
  target.innerHTML = `
    <div class="compact-print-role-list">
      ${roles.map((role, index) => `
        <div class="compact-print-role-row" style="--role-color:${role.color || "#2563eb"}">
          <span>${escapeHtml(role.name)} <small>${escapeHtml(role.department || "")}</small></span>
          <button type="button" data-schedule-role-move="${role.id}" data-direction="-1" ${index === 0 ? "disabled" : ""} title="Move ${escapeHtml(role.name)} up">Up</button>
          <button type="button" data-schedule-role-move="${role.id}" data-direction="1" ${index === roles.length - 1 ? "disabled" : ""} title="Move ${escapeHtml(role.name)} down">Down</button>
        </div>
      `).join("")}
    </div>
  `;
  target.querySelectorAll("[data-schedule-role-move]").forEach((button) => {
    button.addEventListener("click", () => moveScheduleRole(button.dataset.scheduleRoleMove, Number(button.dataset.direction)));
  });
}

function moveScheduleRole(roleId, direction) {
  state.settings.scheduleRoleOrder = normalizeScheduleRoleOrder(state.settings.scheduleRoleOrder || []);
  const visibleRoleIds = orderedRolesForSchedule().map((role) => role.id);
  const from = visibleRoleIds.indexOf(roleId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= visibleRoleIds.length) return;
  const nextVisible = visibleRoleIds.slice();
  [nextVisible[from], nextVisible[to]] = [nextVisible[to], nextVisible[from]];
  const visibleSet = new Set(visibleRoleIds);
  const hiddenSaved = (state.settings.scheduleRoleOrder || []).filter((id) => !visibleSet.has(id));
  state.settings.scheduleRoleOrder = [...nextVisible, ...hiddenSaved];
  renderScheduleRoleOrderEditor();
}
function orderedRolesForSchedule(selectedRoleId = "") {
  const roleOrder = scheduleRoleOrderMap();
  return state.roles
    .filter((role) => state.settings.visibleDepartments.includes(role.department))
    .sort((a, b) => {
      const aSelected = selectedRoleId && a.id === selectedRoleId ? 0 : 1;
      const bSelected = selectedRoleId && b.id === selectedRoleId ? 0 : 1;
      const aOrder = roleOrder.has(a.id) ? roleOrder.get(a.id) : 9999;
      const bOrder = roleOrder.has(b.id) ? roleOrder.get(b.id) : 9999;
      return aSelected - bSelected || aOrder - bOrder || a.name.localeCompare(b.name);
    });
}

function defaultPrintRoleOrder(roles = state.roles, visibleDepartments = state.settings?.visibleDepartments || ["FOH"]) {
  return roles
    .filter((role) => visibleDepartments.includes(role.department))
    .slice()
    .sort((a, b) => {
      const aServer = a.name.toLowerCase() === "server" ? 0 : 1;
      const bServer = b.name.toLowerCase() === "server" ? 0 : 1;
      return aServer - bServer || a.name.localeCompare(b.name);
    })
    .map((role) => role.id);
}

function normalizePrintRoleOrder(order = [], roles = state.roles, visibleDepartments = state.settings?.visibleDepartments || ["FOH"]) {
  const roleIds = new Set(roles.map((role) => role.id));
  const saved = Array.isArray(order) ? order.filter((roleId) => roleIds.has(roleId)) : [];
  const missing = defaultPrintRoleOrder(roles, visibleDepartments).filter((roleId) => !saved.includes(roleId));
  return [...saved, ...missing];
}

function orderedRolesForPrint() {
  state.settings.printRoleOrder = normalizePrintRoleOrder(state.settings.printRoleOrder || []);
  const order = new Map(state.settings.printRoleOrder.map((roleId, index) => [roleId, index]));
  return state.roles
    .filter((role) => state.settings.visibleDepartments.includes(role.department))
    .slice()
    .sort((a, b) => {
      const aOrder = order.has(a.id) ? order.get(a.id) : 9999;
      const bOrder = order.has(b.id) ? order.get(b.id) : 9999;
      return aOrder - bOrder || a.name.localeCompare(b.name);
    });
}

function comparePrintRoleGroups(a, b, sortMode = "role") {
  const order = new Map(orderedRolesForPrint().map((role, index) => [role.id, index]));
  const aOrder = a.roleId && order.has(a.roleId) ? order.get(a.roleId) : 9999;
  const bOrder = b.roleId && order.has(b.roleId) ? order.get(b.roleId) : 9999;
  if (aOrder !== bOrder) return aOrder - bOrder;
  if (sortMode === "role") return a.roleName.localeCompare(b.roleName);
  return a.roleName.localeCompare(b.roleName);
}

function moveScheduleRoleBefore(dragRoleId, targetRoleId) {
  if (!dragRoleId || !targetRoleId || dragRoleId === targetRoleId || targetRoleId === "__other__") return false;
  const baseOrder = orderedRolesForSchedule("")
    .map((role) => role.id)
    .filter((roleId) => roleId !== dragRoleId);
  const targetIndex = baseOrder.indexOf(targetRoleId);
  if (targetIndex === -1) return false;
  baseOrder.splice(targetIndex, 0, dragRoleId);
  state.settings.scheduleRoleOrder = baseOrder;
  saveState();
  return true;
}

function wireScheduleRoleGroupDrag(header, roleId) {
  if (!roleId || roleId === "__other__") return;
  header.draggable = true;
  header.addEventListener("dragstart", (event) => {
    draggingScheduleRoleGroupId = roleId;
    event.dataTransfer.setData("text/schedule-role-group", roleId);
    event.dataTransfer.effectAllowed = "move";
    header.classList.add("dragging-role-group");
  });
  header.addEventListener("dragend", () => {
    suppressRoleGroupClickId = draggingScheduleRoleGroupId;
    draggingScheduleRoleGroupId = null;
    header.classList.remove("dragging-role-group");
    document.querySelectorAll(".role-group-drop-target").forEach((item) => item.classList.remove("role-group-drop-target"));
  });
  header.addEventListener("dragover", (event) => {
    const dragRoleId = draggingScheduleRoleGroupId || event.dataTransfer.getData("text/schedule-role-group");
    if (!dragRoleId || dragRoleId === roleId) return;
    event.preventDefault();
    header.classList.add("role-group-drop-target");
  });
  header.addEventListener("dragleave", () => {
    header.classList.remove("role-group-drop-target");
  });
  header.addEventListener("drop", (event) => {
    const dragRoleId = draggingScheduleRoleGroupId || event.dataTransfer.getData("text/schedule-role-group");
    if (!dragRoleId || dragRoleId === roleId) return;
    event.preventDefault();
    if (moveScheduleRoleBefore(dragRoleId, roleId)) renderSchedule();
  });
}

function renderGroupedEmployeeRows(grid, employees, dates, selectedRoleId = "") {
  const rendered = new Set();
  const weekDateKeys = new Set(dates.map(formatDateKey));
  const employeeHasWeekShiftForRole = (employee, roleId) => state.shifts.some((shift) => (
    shift.employeeId === employee.id &&
    shift.roleId === roleId &&
    weekDateKeys.has(shift.date) &&
    visibleShift(shift)
  ));
  orderedRolesForSchedule(selectedRoleId)
    .forEach((role) => {
      const groupEmployees = employees.filter((employee) => (
        employee.roleTraining?.includes(role.id) ||
        employeeHasWeekShiftForRole(employee, role.id)
      ));
      if (!groupEmployees.length) return;
      const selectedLabel = selectedRoleId === role.id ? " - selected shift role" : "";
      const isCollapsed = collapsedScheduleRoleGroups.has(role.id);
      const header = cell("schedule-role-group", `
        <span class="role-group-toggle" aria-hidden="true">${isCollapsed ? "+" : "-"}</span>
        <span>${role.name} Staff (${groupEmployees.length})${selectedLabel}</span>
      `);
      header.dataset.roleGroup = role.id;
      header.title = `${isCollapsed ? "Expand" : "Collapse"} ${role.name} staff`;
      header.classList.toggle("collapsed-role-group", isCollapsed);
      if (selectedRoleId === role.id) header.classList.add("selected-role-group");
      header.onclick = () => {
        if (suppressRoleGroupClickId === role.id) {
          suppressRoleGroupClickId = null;
          return;
        }
        if (collapsedScheduleRoleGroups.has(role.id)) collapsedScheduleRoleGroups.delete(role.id);
        else collapsedScheduleRoleGroups.add(role.id);
        saveCollapsedScheduleRoleGroups();
        renderSchedule();
      };
      wireScheduleRoleGroupDrag(header, role.id);
      grid.append(header);
      dates.forEach(() => {
        const fill = cell("schedule-role-group-fill", "");
        fill.classList.toggle("collapsed-role-group", isCollapsed);
        grid.append(fill);
      });
      groupEmployees.forEach((employee) => rendered.add(employee.id));
      if (isCollapsed) return;
      groupEmployees.forEach((employee) => {
        renderEmployeeScheduleRow(grid, employee, dates, role);
      });
    });
  const ungrouped = employees.filter((employee) => !rendered.has(employee.id));
  if (ungrouped.length) {
    const groupKey = "__other__";
    const isCollapsed = collapsedScheduleRoleGroups.has(groupKey);
    const header = cell("schedule-role-group", `
      <span class="role-group-toggle" aria-hidden="true">${isCollapsed ? "+" : "-"}</span>
      <span>Other Staff (${ungrouped.length})</span>
    `);
    header.dataset.roleGroup = groupKey;
    header.title = `${isCollapsed ? "Expand" : "Collapse"} other staff`;
    header.classList.toggle("collapsed-role-group", isCollapsed);
    header.onclick = () => {
      if (collapsedScheduleRoleGroups.has(groupKey)) collapsedScheduleRoleGroups.delete(groupKey);
      else collapsedScheduleRoleGroups.add(groupKey);
      saveCollapsedScheduleRoleGroups();
      renderSchedule();
    };
    grid.append(header);
    dates.forEach(() => {
      const fill = cell("schedule-role-group-fill", "");
      fill.classList.toggle("collapsed-role-group", isCollapsed);
      grid.append(fill);
    });
    if (isCollapsed) return;
    ungrouped.forEach((employee) => renderEmployeeScheduleRow(grid, employee, dates));
  }
}

function renderEmployeeScheduleRow(grid, employee, dates, groupRole = null) {
  const nameCell = renderEmployeeNameCell(employee, groupRole, { hideScheduleLabels: true });
  const dayCells = dates.map((date) => renderEmployeeDayCell(employee, date, groupRole));
  const rowHeight = Math.max(
    118,
    ...dayCells.map((dayCell) => Number(dayCell.dataset.estimatedHeight) || 118)
  );
  const rowMinHeight = `calc(${rowHeight}px * var(--schedule-zoom, 1))`;
  nameCell.style.minHeight = rowMinHeight;
  dayCells.forEach((dayCell) => {
    dayCell.style.minHeight = rowMinHeight;
  });
  grid.append(nameCell);
  dayCells.forEach((dayCell) => grid.append(dayCell));
}

function renderEmployeeNameCell(employee, groupRole = null, options = {}) {
  const meta = options.hideScheduleLabels ? "" : (employee.mealTraining?.join(", ") || "");
  const labor = employeeWeekLabor(employee.id);
  const payrollLine = `<div class="employee-labor-summary">${formatHours(labor.hours)} hrs | ${formatRate(labor.payroll)} projected</div>`;
  const groupLine = groupRole ? `<div class="employee-meta">${groupRole.name} group</div>` : "";
  const content = options.compact
    ? `<div>${displayName(employee)}</div>${renderRoleCapabilityStrip(employee)}${renderEmployeeHoverCard(employee)}`
    : `<div>${displayName(employee)}</div>${renderRoleCapabilityStrip(employee)}${groupLine}${meta ? `<div class="employee-meta">${meta}</div>` : ""}${payrollLine}${renderEmployeeHoverCard(employee)}`;
  const nameCell = cell("employee-name", content);
  nameCell.dataset.employeeId = employee.id;
  nameCell.dataset.employeeName = displayName(employee).toLowerCase();
  nameCell.dataset.employeeFirstLetter = firstEmployeeSearchLetter(employee);
  if (groupRole?.id) nameCell.dataset.roleGroup = groupRole.id;
  if (labor.hours >= 40) nameCell.classList.add("overtime-row");
  // Use the app-styled hover card as the single employee rollover. A native
  // title tooltip here creates a second tooltip that can overlap the card.
  nameCell.setAttribute("aria-label", options.compact ? displayName(employee) : employeeHoverText(employee));
  applySelectedOpenShiftRowState(nameCell, employee);
  nameCell.onclick = (event) => {
    if (!selectedUnassignedShiftId) return;
    event.stopPropagation();
    assignUnassignedShift(selectedUnassignedShiftId, employee.id);
  };
  nameCell.ondblclick = () => {
    loadEmployee(employee.id);
    activateTab("employees");
  };
  nameCell.ondragover = (event) => handleEmployeeRowDragOver(event, nameCell, employee.id);
  nameCell.ondragleave = () => nameCell.classList.remove("drag-valid", "drag-warning", "drag-invalid");
  nameCell.ondrop = async (event) => {
    event.preventDefault();
    const unassignedId = event.dataTransfer.getData("text/unassigned-shift") || dragUnassignedShiftId;
    if (unassignedId) {
      assignUnassignedShift(unassignedId, employee.id);
      endAnyDrag();
    } else {
      const droppedShiftId = event.dataTransfer.getData("text/shift") || dragShiftId;
      if (droppedShiftId) await moveAssignedShiftToEmployee(droppedShiftId, employee.id, null, event.ctrlKey);
      else showConflict("Drop the shift onto an employee or schedule cell to move it.");
    }
    nameCell.classList.remove("drag-valid", "drag-warning", "drag-invalid");
  };
  return nameCell;
}

function applySelectedOpenShiftRowState(element, employee) {
  const selectedShift = selectedOpenShiftForSchedule();
  if (!selectedShift) return;
  if (employee.roleTraining?.includes(selectedShift.roleId)) element.classList.add("selected-role-match");
  const recommendation = selectedOpenShiftRecommendation();
  if (recommendation?.id === employee.id) element.classList.add("selected-best-target");
}

function renderEmployeeHoverCard(employee) {
  const roles = (employee.roleTraining || []).map((roleId) => roleById(roleId)?.name).filter(Boolean).join(", ") || "No roles set";
  const meals = (employee.mealTraining || []).join(", ") || "No meals set";
  const notes = employee.managerNotes ? `<small>${employee.managerNotes}</small>` : "";
  return `
    <div class="employee-hover-card">
      <strong>${fullEmployeeName(employee)}</strong>
      <span>${formatPhoneNumber(employee.phone || "No phone")}</span>
      <span>${roles}</span>
      <span>${meals}</span>
      ${employee.callWeekly ? `<span>Call weekly</span>` : ""}
      ${notes}
    </div>
  `;
}

function employeeHoverText(employee) {
  const roles = (employee.roleTraining || []).map((roleId) => roleById(roleId)?.name).filter(Boolean).join(", ") || "No roles set";
  return `${fullEmployeeName(employee)}\n${formatPhoneNumber(employee.phone || "No phone")}\n${roles}${employee.callWeekly ? "\nCall weekly for availability" : ""}${employee.managerNotes ? `\n${employee.managerNotes}` : ""}`;
}

function estimatedGridShiftCardHeight(shift, { ghost = false } = {}) {
  let height = ghost ? 88 : 92;
  const noteText = cleanCell(shift.notes);
  const detailText = ghost ? "Also scheduled" : (noteText || getMealsForShift(shift).join(", "));
  if (shift.untilVolume || detailText.length > 20) height += ghost ? 8 : 12;
  if (!ghost && noteText && !/^training$/i.test(noteText)) height += 52;
  if (shift.isFlexDouble) height += 14;
  const trainingBadgeCount = trainingBadgesForShift(shift).length;
  if (trainingBadgeCount) height = Math.max(height, ghost ? 150 + (trainingBadgeCount - 1) * 26 : 178 + (trainingBadgeCount - 1) * 28);
  return height;
}

function estimatedDayCellHeight(visibleDayShifts, unavailableRanges, dayTimeOffRequests, groupRole = null) {
  const base = visibleDayShifts.some((shift) => trainingBadgesForShift(shift).length) ? 225 : 118;
  const hasUnavailable = unavailableRanges.length > 0;
  const hasAllDayUnavailable = unavailableRanges.some((range) => range.start <= 0 && range.end >= 1440);
  const availabilityHeight = hasUnavailable ? (hasAllDayUnavailable ? 40 : 52) : 0;
  const timeOffHeight = dayTimeOffRequests.length * 42;
  const shiftHeight = visibleDayShifts.reduce((sum, shift) => {
    const ghost = Boolean(groupRole && shift.roleId !== groupRole.id);
    return sum + estimatedGridShiftCardHeight(shift, { ghost });
  }, 0);
  const itemCount = (hasUnavailable ? 1 : 0) + dayTimeOffRequests.length + visibleDayShifts.length;
  const gaps = Math.max(0, itemCount - 1) * 5;
  const contentHeight = 14 + availabilityHeight + timeOffHeight + shiftHeight + gaps;
  return Math.max(base, contentHeight);
}

function renderEmployeeDayCell(employee, date, groupRole = null) {
  const dateKey = formatDateKey(date);
  const labor = employeeWeekLabor(employee.id);
  const dayCell = cell("day-cell", "");
  dayCell.dataset.employeeId = employee.id;
  dayCell.dataset.date = dateKey;
  const visibleDayShifts = state.shifts
    .filter((shift) => shift.employeeId === employee.id && shift.date === dateKey && visibleShift(shift))
    .sort((a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0));
  const unavailableRanges = unavailableRangesForEmployeeDate(employee, dateKey);
  const dayTimeOffRequests = timeOffForEmployeeDate(employee.id, dateKey);
  dayCell.dataset.estimatedHeight = String(estimatedDayCellHeight(visibleDayShifts, unavailableRanges, dayTimeOffRequests, groupRole));
  const hasPartialUnavailable = unavailableRanges.some((range) => !(range.start <= 0 && range.end >= 1440));
  if ((unavailableRanges.length || dayTimeOffRequests.length) && visibleDayShifts.length) dayCell.classList.add("has-availability-block-with-shift");
  if (hasPartialUnavailable && visibleDayShifts.length) dayCell.classList.add("has-partial-unavailable-with-shift");
  if (visibleDayShifts.length > 1) dayCell.classList.add("has-stacked-shifts");
  if (visibleDayShifts.some((shift) => trainingBadgesForShift(shift).length)) dayCell.classList.add("has-training-shift");
  if (labor.hours >= 40) dayCell.classList.add("overtime-row");
  applySelectedOpenShiftRowState(dayCell, employee);
  if (selectedCell?.employeeId === employee.id && selectedCell?.date === dateKey) dayCell.classList.add("selected");
  dayCell.onclick = (event) => {
    if (event.target.closest(".shift-card")) return;
    if (selectedUnassignedShiftId) {
      event.stopPropagation();
      assignUnassignedShift(selectedUnassignedShiftId, employee.id);
      return;
    }
    selectedCell = { employeeId: employee.id, date: dateKey, roleId: groupRole?.id || "" };
    selectedShiftId = null;
    selectedTimeOffRequestId = null;
    renderSchedule();
  };
  dayCell.ondblclick = (event) => {
    if (event.target.closest(".shift-card")) return;
    event.stopPropagation();
    selectedCell = { employeeId: employee.id, date: dateKey, roleId: groupRole?.id || "" };
    selectedShiftId = null;
    selectedTimeOffRequestId = null;
    openShiftDialog();
  };
  dayCell.ondragover = (event) => handleDragOver(event, dayCell);
  dayCell.ondragenter = (event) => handleDragEnter(event, dayCell);
  dayCell.ondragleave = () => dayCell.classList.remove("drag-valid", "drag-warning", "drag-invalid");
  dayCell.ondrop = (event) => handleDrop(event, dayCell);
  dayCell.insertAdjacentHTML("beforeend", renderUnavailableBadge(employee, dateKey));
  visibleDayShifts.forEach((shift) => {
      const isGhost = groupRole && shift.roleId !== groupRole.id;
      dayCell.append(renderShiftCard(shift, { ghost: isGhost, hideScheduleLabels: true }));
    });
  if (pendingTrayWarning?.employeeId === employee.id && pendingTrayWarning.date === dateKey) {
    dayCell.append(renderPendingTrayWarning());
  }
  dayTimeOffRequests.forEach((request) => dayCell.append(renderTimeOffBadge(request)));
  return dayCell;
}

function updateRoleSummaryToggle() {
  const button = $("toggleRoleSummaryBtn");
  if (!button) return;
  const shown = state.settings.showWeeklyRoleSummary !== false;
  button.classList.toggle("active", shown);
  button.textContent = shown ? "Hide Roles" : "Show Roles";
  button.title = shown ? "Hide role summary bubbles" : "Show role summary bubbles";
}

function renderWeeklyRoleSummary() {
  const target = $("weeklyRoleSummary");
  if (!target) return;
  const shown = state.settings.showWeeklyRoleSummary !== false;
  target.hidden = !shown;
  updateRoleSummaryToggle();
  if (!shown) {
    target.innerHTML = "";
    return;
  }
  const dates = new Set(weekDates().map(formatDateKey));
  const groups = new Map();
  state.shifts
    .filter((shift) => dates.has(shift.date) && visibleShift(shift))
    .forEach((shift) => {
      const role = roleById(shift.roleId);
      const key = role?.id || "unknown";
      const item = groups.get(key) || { roleName: role?.name || "Unknown", count: 0, hours: 0 };
      item.count += 1;
      item.hours += shiftHours(shift);
      groups.set(key, item);
    });
  const summaries = Array.from(groups.values()).sort((a, b) => a.roleName.localeCompare(b.roleName));
  target.innerHTML = summaries.length
    ? summaries.map((item) => `<span><strong>${item.roleName}</strong> ${item.count} shifts / ${formatHours(item.hours)} hrs</span>`).join("")
    : `<span>No visible shifts scheduled this week.</span>`;
}

function skipSelectedOpenShift() {
  if (!selectedUnassignedShiftId) return false;
  const shift = state.unassignedShifts?.find((item) => item.id === selectedUnassignedShiftId);
  if (!shift) return false;
  pushUndo();
  shift.skippedAt = nowIso();
  saveState();
  selectedUnassignedShiftId = null;
  pendingDeleteUnassignedShiftId = null;
  pendingTrayWarning = null;
  renderSchedule();
  window.setTimeout(() => {
    const tray = $("unassignedShiftTray");
    if (tray) tray.scrollTo({ left: 0, behavior: "smooth" });
  }, 30);
  showConflict("Skipped shift and moved it to the end of the Shift Bay.");
  return true;
}

function selectAdjacentOpenShift(direction) {
  const shifts = currentWeekOpenShifts();
  if (!shifts.length) return;
  const currentIndex = shifts.findIndex((shift) => shift.id === selectedUnassignedShiftId);
  const nextIndex = currentIndex === -1
    ? (direction > 0 ? 0 : shifts.length - 1)
    : (currentIndex + direction + shifts.length) % shifts.length;
  selectedUnassignedShiftId = shifts[nextIndex].id;
  pendingDeleteUnassignedShiftId = null;
  pendingTrayWarning = null;
  renderSchedule();
  window.setTimeout(() => {
    document.querySelector(`[data-unassigned-shift-id="${selectedUnassignedShiftId}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, 30);
}

function assignSelectedOpenShiftCandidate(index) {
  const shift = state.unassignedShifts?.find((item) => item.id === selectedUnassignedShiftId);
  if (!shift) return false;
  const candidate = stagedShiftCandidates(shift).best[index];
  if (!candidate) return false;
  assignUnassignedShift(shift.id, candidate.employee.id);
  return true;
}

function renderUnavailableEmployeesList(employees) {
  const panel = $("unavailableEmployeesList");
  if (!panel) return;
  panel.hidden = !state.settings.hideUnavailableEmployees || !employees.length;
  if (panel.hidden) {
    panel.innerHTML = "";
    updateUnavailablePanelToggle(employees.length);
    return;
  }
  const expanded = Boolean(state.settings.showUnavailablePanel);
  panel.innerHTML = `
    <div class="unavailable-list-head">
      <div>
        <h3>Unavailable This Week</h3>
        <span>${employees.length} employee${employees.length === 1 ? "" : "s"} moved out of the working grid</span>
      </div>
      <button type="button" class="small-button" data-toggle-unavailable-inline>${expanded ? "Collapse" : "Review"}</button>
    </div>
    ${expanded ? `
      <div class="unavailable-employee-grid">
        ${employees.map((employee) => `
          <button type="button" class="unavailable-employee-card" data-unavailable-employee="${employee.id}">
            <strong>${displayName(employee)}</strong>
            ${renderRoleCapabilityStrip(employee)}
            <span>${formatPhoneNumber(employee.phone || "No phone listed")}</span>
            <small>Double-click to edit this week</small>
          </button>
        `).join("")}
      </div>
    ` : ""}
  `;
  panel.classList.toggle("collapsed", !expanded);
  panel.querySelector("[data-toggle-unavailable-inline]")?.addEventListener("click", () => {
    state.settings.showUnavailablePanel = !state.settings.showUnavailablePanel;
    saveState();
    renderSchedule();
  });
  panel.querySelectorAll("[data-unavailable-employee]").forEach((button) => {
    button.onclick = () => {
      loadEmployee(button.dataset.unavailableEmployee);
      activateTab("employees");
    };
    button.ondblclick = (event) => {
      event.preventDefault();
      openEmployeeWeeklyAvailability(button.dataset.unavailableEmployee);
    };
  });
  updateUnavailablePanelToggle(employees.length);
}

function updateUnavailablePanelToggle(count = 0) {
  const button = $("toggleUnavailablePanelBtn");
  if (!button) return;
  const canShow = Boolean(state.settings.hideUnavailableEmployees && count);
  button.hidden = !canShow;
  button.classList.toggle("active", Boolean(state.settings.showUnavailablePanel && canShow));
  button.textContent = state.settings.showUnavailablePanel && canShow ? "Hide Unavail" : `Unavail ${count || ""}`.trim();
  button.title = state.settings.showUnavailablePanel ? "Hide unavailable this week" : "Show unavailable this week";
}

function syncEmployeeAvailabilityMode() {
  const callWeekly = Boolean($("employeeCallWeekly")?.checked);
  if ($("regularAvailabilityFieldset")) $("regularAvailabilityFieldset").hidden = callWeekly;
  if ($("weeklyAvailabilityFieldset")) $("weeklyAvailabilityFieldset").hidden = !callWeekly;
  if ($("toggleWeeklyAvailabilityBtn")) $("toggleWeeklyAvailabilityBtn").hidden = !callWeekly;
}

function openEmployeeWeeklyAvailability(employeeId) {
  loadEmployee(employeeId);
  activateTab("employees");
  setWeeklyAvailabilityWeek(employeeWeeklyAvailabilityWeekKey || currentWeekKey(), { render: false });
  $("employeeCallWeekly").checked = true;
  syncEmployeeAvailabilityMode();
  renderWeeklyAvailabilityEditor(employeeById(employeeId));
  window.setTimeout(() => {
    $("weeklyAvailabilityFieldset")?.scrollIntoView({ behavior: "smooth", block: "center" });
    $("weeklyAvailabilityFieldset")?.querySelector("input[data-weekly-availability-day]")?.focus();
  }, 50);
}

function renderDayHeader(date) {
  const dateKey = formatDateKey(date);
  const status = getCoverageStatus(dateKey);
  const closerStatus = getCloserStatus(dateKey);
  const totalProjection = totalSalesProjectionForDate(dateKey);
  const projectionTotal = totalProjection ? `$${formatMoneyCompact(totalProjection)}` : "";
  const div = cell("grid-head", `
    <div class="day-head-content">
      <div class="day-title-stack">
        <span>${displayDate(date)}</span>
        <div class="projection-menu">
          <button type="button" class="projection-button" data-projection-toggle="${dateKey}" title="Meal sales projections">
            Proj
          </button>
          <span class="projection-total-badge" data-projection-total="${dateKey}">${projectionTotal}</span>
          <div class="projection-popover" data-projection-popover="${dateKey}">
            ${renderProjectionPopover(dateKey)}
          </div>
        </div>
      </div>
      <button type="button" class="coverage-button ${status.className}" data-coverage-date="${dateKey}" title="${status.title}">
        ${status.label}
      </button>
      <span class="closer-day-indicator ${closerStatus.className}" title="${closerStatus.title}">
        CL ${closerStatus.scheduled}/${closerStatus.required}
      </span>
    </div>
  `);
  div.dataset.tooltip = "Double-click the date header to open Day View.";
  wireProjectionPopover(div, dateKey);
  div.ondblclick = (event) => {
    if (event.target.closest("button, input, select, .projection-popover")) return;
    event.stopPropagation();
    enterDayFocus(dateKey);
  };
  div.querySelector("[data-coverage-date]").onclick = (event) => {
    event.stopPropagation();
    openCoverageDialog(dateKey);
  };
  return div;
}

function closerRequirementForDate(dateKey) {
  const dayIndex = parseDateKey(dateKey).getDay();
  const requirements = { ...defaultCloserRequirements(), ...(state.settings.closerRequirements || {}) };
  return Number(requirements[dayIndex]) || 0;
}

function getCloserStatus(dateKey) {
  const required = closerRequirementForDate(dateKey);
  const scheduled = state.shifts.filter((shift) => (
    shift.date === dateKey &&
    shift.department === "FOH" &&
    shift.isCloser &&
    visibleShift(shift)
  )).length;
  if (!required) {
    return { required, scheduled, className: "closer-none-required", title: "No closers required for this day" };
  }
  if (scheduled >= required) {
    return { required, scheduled, className: "closer-complete", title: `${scheduled} of ${required} required closer shifts scheduled` };
  }
  return { required, scheduled, className: "closer-missing", title: `${required - scheduled} closer shift${required - scheduled === 1 ? "" : "s"} still needed` };
}

function timeOffForEmployeeDate(employeeId, dateKey) {
  return (state.timeOffRequests || []).filter((request) => request.employeeId === employeeId && request.date === dateKey);
}

function toggleManualRequestOff(employeeId, dateKey) {
  state.timeOffRequests = state.timeOffRequests || [];
  const manual = state.timeOffRequests.find((request) => (
    request.employeeId === employeeId &&
    request.date === dateKey &&
    request.source === "Manual"
  ));
  if (manual) {
    pushUndo();
    state.timeOffRequests = state.timeOffRequests.filter((request) => request.id !== manual.id);
    saveState();
    renderAll();
    showConflict(`Removed manual RO for ${displayName(employeeById(employeeId))} on ${displayDate(parseDateKey(dateKey))}.`);
    return;
  }
  const existing = timeOffForEmployeeDate(employeeId, dateKey);
  if (existing.length) {
    showConflict(`${displayName(employeeById(employeeId))} already has an RO on ${displayDate(parseDateKey(dateKey))}.`);
    return;
  }
  pushUndo();
  state.timeOffRequests.push({
    id: uid("timeoff"),
    employeeId,
    date: dateKey,
    daypart: "All day",
    note: "Manual grid entry",
    source: "Manual"
  });
  saveState();
  renderAll();
}

function openDayBlockDialog(employeeId = selectedCell?.employeeId, dateKey = selectedCell?.date) {
  if (!employeeId || !dateKey) return showConflict("Choose an employee and date before adding a day block.");
  const dialog = $("dayBlockDialog");
  if (!dialog) return;
  $("dayBlockEmployeeId").value = employeeId;
  $("dayBlockDate").value = dateKey;
  $("dayBlockTitle").textContent = `Add Day Block for ${displayName(employeeById(employeeId))}`;
  $("dayBlockType").value = "Off-site Event";
  $("dayBlockAllDay").checked = true;
  $("dayBlockStart").value = "";
  $("dayBlockEnd").value = "";
  $("dayBlockNote").value = "";
  updateDayBlockTimeControls();
  dialog.showModal();
}

function updateDayBlockTimeControls() {
  const allDay = $("dayBlockAllDay")?.checked;
  ["dayBlockStart", "dayBlockEnd"].forEach((id) => {
    const input = $(id);
    if (!input) return;
    input.disabled = Boolean(allDay);
    input.closest("label")?.classList.toggle("muted", Boolean(allDay));
  });
}

function saveDayBlock(event) {
  event.preventDefault();
  const employeeId = $("dayBlockEmployeeId").value;
  const dateKey = $("dayBlockDate").value;
  const allDay = $("dayBlockAllDay").checked;
  const start = normalizeTime($("dayBlockStart").value);
  const end = normalizeTime($("dayBlockEnd").value);
  if (!employeeId || !dateKey) return showConflict("Choose an employee and date before adding a day block.");
  if (!allDay && (!start || !end)) return showConflict("Use a start and end time, or leave the block set to All day.");
  state.timeOffRequests = state.timeOffRequests || [];
  const blockType = cleanCell($("dayBlockType").value) || "Day Block";
  const note = cleanCell($("dayBlockNote").value);
  const duplicate = state.timeOffRequests.some((request) => (
    request.employeeId === employeeId &&
    request.date === dateKey &&
    isScheduleBlock(request) &&
    scheduleBlockType(request) === blockType &&
    requestOffIsFullDay(request) === allDay &&
    (allDay || (request.start === start && request.end === end))
  ));
  if (duplicate) return showConflict("That day block is already entered.");
  pushUndo();
  state.timeOffRequests.push({
    id: uid("block"),
    employeeId,
    date: dateKey,
    kind: "block",
    source: "Day Block",
    blockType,
    daypart: allDay ? "All day" : "Partial day",
    allDay,
    start: allDay ? "" : start,
    end: allDay ? "" : end,
    note
  });
  $("dayBlockDialog").close();
  $("shiftDialog")?.close();
  saveState();
  renderAllPreservingScheduleScroll();
  showConflict(`Added ${blockType} block for ${displayName(employeeById(employeeId))} on ${displayDate(parseDateKey(dateKey))}.`);
}
function addManualRequestOffRange(employeeId, startKey, endKey) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    showConflict("Use a valid RO start date and end date.");
    return;
  }
  state.timeOffRequests = state.timeOffRequests || [];
  pushUndo();
  let added = 0;
  for (let date = new Date(start); date <= end; date = addDays(date, 1)) {
    const dateKey = formatDateKey(date);
    const duplicate = state.timeOffRequests.some((request) => (
      request.employeeId === employeeId &&
      request.date === dateKey
    ));
    if (duplicate) continue;
    state.timeOffRequests.push({
      id: uid("timeoff"),
      employeeId,
      date: dateKey,
      daypart: "All day",
      note: "Manual grid entry",
      source: "Manual"
    });
    added++;
  }
  if (!added) {
    undoStack.pop();
    showConflict("That manual RO range is already entered.");
    return;
  }
  renderAll();
  showConflict(`Added ${added} RO day${added === 1 ? "" : "s"} for ${displayName(employeeById(employeeId))}.`);
}

function updateTimeOffEditTimeControls() {
  const coverage = $("timeOffEditDaypart")?.value || "allDay";
  const disabled = coverage !== "custom";
  ["timeOffEditStart", "timeOffEditEnd"].forEach((id) => {
    const input = $(id);
    if (!input) return;
    input.disabled = disabled;
    input.closest("label")?.classList.toggle("muted", disabled);
  });
}

function openTimeOffEditDialog(requestId = selectedTimeOffRequestId) {
  const request = (state.timeOffRequests || []).find((item) => item.id === requestId);
  const dialog = $("timeOffEditDialog");
  if (!request || !dialog) return;
  const block = isScheduleBlock(request);
  const allDay = requestOffIsFullDay(request);
  const hasExplicitRange = Boolean(request.start || request.end) && !allDay;
  $("timeOffEditId").value = request.id;
  $("timeOffEditEmployee").value = displayName(employeeById(request.employeeId));
  $("timeOffEditDate").value = request.date || "";
  $("timeOffEditDaypart").value = allDay ? "allDay" : (/^(am|pm)$/i.test(request.daypart || "") ? request.daypart.toUpperCase() : "custom");
  $("timeOffEditStart").value = hasExplicitRange ? (request.start || "") : "";
  $("timeOffEditEnd").value = hasExplicitRange ? (request.end || "") : "";
  $("timeOffEditNote").value = request.note || "";
  $("timeOffEditTitle").textContent = block ? "Edit Day Block" : "Edit Request Off";
  $("timeOffEditContext").textContent = block
    ? `${scheduleBlockType(request)} for ${displayName(employeeById(request.employeeId))}`
    : `Request off for ${displayName(employeeById(request.employeeId))}`;
  $("timeOffEditWarnings").innerHTML = "";
  updateTimeOffEditTimeControls();
  attachTimePickerInput($("timeOffEditStart"));
  attachTimePickerInput($("timeOffEditEnd"));
  dialog.showModal();
}

function saveTimeOffEdit(event) {
  event.preventDefault();
  const requestId = $("timeOffEditId")?.value;
  const current = (state.timeOffRequests || []).find((item) => item.id === requestId);
  if (!current) return;
  const dateKey = $("timeOffEditDate")?.value || "";
  const coverage = $("timeOffEditDaypart")?.value || "allDay";
  const allDay = coverage === "allDay";
  const customTimes = coverage === "custom";
  const start = customTimes ? normalizeTime($("timeOffEditStart")?.value || "") : "";
  const end = customTimes ? normalizeTime($("timeOffEditEnd")?.value || "") : "";
  const warnings = $("timeOffEditWarnings");
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(parseDateKey(dateKey).getTime())) {
    errors.push("Choose a valid date.");
  }
  if (customTimes && (!start || !end)) errors.push("Use both a start and end time, or choose All day, AM, or PM.");
  if (customTimes && start && end) {
    const startMinutes = minutesFromTime(start);
    let endMinutes = minutesFromTime(end);
    if (startMinutes == null || endMinutes == null) errors.push("Use valid times such as 9a or 5p.");
    else {
      if (endMinutes <= startMinutes) endMinutes += 1440;
      if (endMinutes <= startMinutes || endMinutes - startMinutes > 1440) errors.push("The end time must be after the start time.");
    }
  }
  if (errors.length) {
    if (warnings) warnings.innerHTML = errors.map((error) => `<div>${escapeHtml(error)}</div>`).join("");
    return;
  }
  const editedRequest = {
    ...current,
    date: dateKey,
    allDay: isScheduleBlock(current) ? allDay : current.allDay,
    daypart: allDay ? "All day" : (coverage === "AM" || coverage === "PM" ? coverage : "Partial day"),
    start,
    end,
    note: cleanCell($("timeOffEditNote")?.value || ""),
    updatedAt: nowIso(),
    updatedBy: currentSaveActor()
  };
  const duplicate = (state.timeOffRequests || []).some((item) => item.id !== current.id && timeOffRequestMatches(item, editedRequest));
  if (duplicate) {
    if (warnings) warnings.innerHTML = "<div>That RO or block already exists for this employee on that date.</div>";
    return;
  }
  pushUndo();
  state.timeOffRequests = state.timeOffRequests.map((item) => item.id === current.id ? editedRequest : item);
  selectedTimeOffRequestId = editedRequest.id;
  selectedCell = { employeeId: editedRequest.employeeId, date: editedRequest.date };
  pendingDeleteTimeOffRequestId = null;
  $("timeOffEditDialog")?.close();
  saveState();
  renderAllPreservingScheduleScroll();
  showConflict(`Updated ${isScheduleBlock(editedRequest) ? "day block" : "RO"} for ${displayName(employeeById(editedRequest.employeeId))} on ${displayDate(parseDateKey(editedRequest.date))}.`);
}

function renderTimeOffBadge(request) {
  const badge = document.createElement("div");
  badge.className = "time-off-badge";
  if (isScheduleBlock(request)) badge.classList.add("schedule-block-badge");
  if (selectedTimeOffRequestId === request.id) badge.classList.add("selected");
  if (pendingDeleteTimeOffRequestId === request.id) badge.classList.add("pending-delete");
  badge.tabIndex = 0;
  badge.dataset.timeOffRequestId = request.id;
  const timeText = isScheduleBlock(request) && !requestOffIsFullDay(request) ? `${request.start || ""} - ${request.end || ""}` : (request.daypart || "All day");
  const details = [timeOffLongLabel(request), timeText, request.note].filter(Boolean).join(" - ");
  const source = request.source ? `Source: ${request.source}` : "";
  const tooltip = [details || timeOffLongLabel(request), source].filter(Boolean).join("\n");
  const shortLabel = timeOffShortLabel(request);
  const deleteLabel = isScheduleBlock(request) ? "Day Block" : "RO";
  badge.title = tooltip;
  badge.dataset.tooltip = tooltip;
  badge.innerHTML = `
    <button class="delete-start-button" type="button" title="Delete this ${deleteLabel}" aria-label="Start delete ${deleteLabel}">×</button>
    <strong>${shortLabel}</strong>
    ${isScheduleBlock(request) ? `<span>${escapeHtml(scheduleBlockType(request))}</span>` : ""}
    ${pendingDeleteTimeOffRequestId === request.id ? `
      <div class="shift-delete-options" aria-label="Confirm deleting this ${deleteLabel}">
        <button class="delete-confirm-button" type="button" title="Delete ${deleteLabel}" aria-label="Delete ${deleteLabel}">X</button>
      </div>
    ` : ""}
  `;
  const selectRequest = () => {
    selectedTimeOffRequestId = request.id;
    selectedShiftId = null;
    selectedUnassignedShiftId = null;
    pendingDeleteShiftId = null;
    pendingDeleteUnassignedShiftId = null;
    selectedCell = { employeeId: request.employeeId, date: request.date };
  };
  badge.onclick = (event) => {
    event.stopPropagation();
    if (pendingDeleteTimeOffRequestId === request.id && !event.target.closest(".delete-confirm-button")) {
      pendingDeleteTimeOffRequestId = null;
      renderSchedulePreservingGridScroll();
      return;
    }
    pendingDeleteTimeOffRequestId = null;
    selectRequest();
    renderSchedulePreservingGridScroll();
  };
  badge.ondblclick = (event) => {
    event.stopPropagation();
    selectRequest();
    openTimeOffEditDialog(request.id);
  };
  badge.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    selectRequest();
    openTimeOffEditDialog(request.id);
  };
  badge.querySelector(".delete-start-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    selectRequest();
    pendingDeleteTimeOffRequestId = request.id;
    renderSchedulePreservingGridScroll();
  });
  badge.querySelector(".delete-confirm-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteTimeOffRequest(request.id);
  });
  badge.onpointerdown = (event) => {
    if (!event.shiftKey || event.target.closest("button")) return;
    event.stopPropagation();
    event.preventDefault();
    selectRequest();
    beginMouseTimeOffPaintDrag(event, badge, request);
  };
  return badge;
}

function deleteTimeOffRequest(requestId) {
  const request = (state.timeOffRequests || []).find((item) => item.id === requestId);
  if (!request) return;
  pushUndo();
  state.timeOffRequests = (state.timeOffRequests || []).filter((item) => item.id !== requestId);
  selectedTimeOffRequestId = null;
  pendingDeleteTimeOffRequestId = null;
  saveState();
  renderAllPreservingScheduleScroll();
  const employee = employeeById(request.employeeId);
  showConflict(`Removed ${isScheduleBlock(request) ? "day block" : "RO"} for ${displayName(employee)} on ${displayDate(parseDateKey(request.date))}.`);
}

function renderProjectionPopover(dateKey) {
  const rows = getMealPeriodsForDate(dateKey).map((period) => {
    const value = salesProjectionForMeal(dateKey, period.name) || "";
    return `
      <label>${period.name}
        <input type="number" min="0" step="50" data-sales-projection="${dateKey}:${period.name}" value="${value}" placeholder="0">
      </label>
    `;
  }).join("");
  return `${rows}<div class="projection-total-row">Total <strong data-projection-popover-total="${dateKey}">$${formatMoney(totalSalesProjectionForDate(dateKey))}</strong></div>`;
}

function wireProjectionPopover(container, dateKey) {
  const button = container.querySelector(`[data-projection-toggle="${dateKey}"]`);
  const popover = container.querySelector(`[data-projection-popover="${dateKey}"]`);
  button.onclick = (event) => {
    event.stopPropagation();
    closeProjectionPopovers(popover);
    popover.classList.toggle("open");
  };
  popover.onclick = (event) => event.stopPropagation();
  popover.querySelectorAll("[data-sales-projection]").forEach((input) => {
    input.onkeydown = (event) => {
      if (event.key === "Enter") input.blur();
    };
    input.onchange = () => {
      const [, meal] = input.dataset.salesProjection.split(":");
      setSalesProjectionForMeal(dateKey, meal, Number(input.value) || 0);
      const total = totalSalesProjectionForDate(dateKey);
      const badge = container.querySelector(`[data-projection-total="${dateKey}"]`);
      const popoverTotal = popover.querySelector(`[data-projection-popover-total="${dateKey}"]`);
      if (badge) badge.textContent = total ? `$${formatMoneyCompact(total)}` : "";
      if (popoverTotal) popoverTotal.textContent = `$${formatMoney(total)}`;
      projectionsDirty = true;
      saveState();
    };
  });
}

function closeProjectionPopovers(except = null) {
  let closed = false;
  document.querySelectorAll(".projection-popover.open").forEach((popover) => {
    if (popover !== except) {
      popover.classList.remove("open");
      closed = true;
    }
  });
  if (closed && projectionsDirty && !except) {
    projectionsDirty = false;
    renderSchedule();
  }
}

function cloneCoverage(coverage) {
  return JSON.parse(JSON.stringify(coverage || {}));
}

function blankCoverageForDate(dateKey) {
  const coverage = {};
  getMealPeriodsForDate(dateKey).forEach((period) => {
    coverage[period.name] = {};
    fohRoles().forEach((role) => {
      coverage[period.name][role.id] = 0;
    });
  });
  return coverage;
}

function defaultCoverageForDate(dateKey) {
  const dayIndex = parseDateKey(dateKey).getDay();
  return mergeCoverage(blankCoverageForDate(dateKey), cloneCoverage(state.settings.defaultCoverage?.[dayIndex]));
}

function previousWeekCoverageForDate(dateKey) {
  const previousKey = formatDateKey(addDays(parseDateKey(dateKey), -7));
  return state.coverageRequirements?.[previousKey] ? cloneCoverage(state.coverageRequirements[previousKey]) : null;
}

function coverageForDate(dateKey) {
  if (state.coverageRequirements?.[dateKey]) {
    return mergeCoverage(blankCoverageForDate(dateKey), cloneCoverage(state.coverageRequirements[dateKey]));
  }
  const baseline = previousWeekCoverageForDate(dateKey) || defaultCoverageForDate(dateKey);
  return mergeCoverageMax(baseline, projectedCoverageForDate(dateKey));
}

function mergeCoverage(base, incoming) {
  Object.entries(incoming || {}).forEach(([meal, roles]) => {
    if (!base[meal]) base[meal] = {};
    Object.entries(roles || {}).forEach(([roleId, count]) => {
      base[meal][roleId] = Number(count) || 0;
    });
  });
  return base;
}

function mergeCoverageMax(base, incoming) {
  Object.entries(incoming || {}).forEach(([meal, roles]) => {
    if (!base[meal]) base[meal] = {};
    Object.entries(roles || {}).forEach(([roleId, count]) => {
      base[meal][roleId] = Math.max(Number(base[meal][roleId]) || 0, Number(count) || 0);
    });
  });
  return base;
}

function salesProjectionForMeal(dateKey, meal) {
  const projection = state.salesProjections?.[dateKey];
  if (!projection) return 0;
  if (typeof projection === "number") return Number(projection) || 0;
  return Number(projection[meal]) || 0;
}

function totalSalesProjectionForDate(dateKey) {
  const projection = state.salesProjections?.[dateKey];
  if (!projection) return 0;
  if (typeof projection === "number") return Number(projection) || 0;
  return Object.values(projection).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function setSalesProjectionForMeal(dateKey, meal, value) {
  pushUndo();
  state.salesProjections = { ...(state.salesProjections || {}) };
  const current = typeof state.salesProjections[dateKey] === "object" && state.salesProjections[dateKey]
    ? { ...state.salesProjections[dateKey] }
    : {};
  if (value) current[meal] = value;
  else delete current[meal];
  if (Object.values(current).some((amount) => Number(amount) > 0)) state.salesProjections[dateKey] = current;
  else delete state.salesProjections[dateKey];
}

function formatMoneyCompact(value) {
  const amount = Number(value) || 0;
  if (amount >= 1000) return `${Math.round(amount / 100) / 10}k`;
  return String(amount);
}

function formatMoney(value) {
  return (Number(value) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatRate(value) {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function employeeRateForRole(employee, roleId) {
  const override = employee?.payRates?.[roleId];
  if (override?.override) return Number(override.rate) || 0;
  return Number(roleById(roleId)?.defaultRate) || 0;
}

function shiftHours(shift) {
  const start = minutesFromTime(shift.start);
  if (start == null) return 0;
  let end = shift.untilVolume ? estimatedUntilVolumeEnd(shift) : minutesFromTime(shift.end);
  if (end == null) return 0;
  if (end <= start) end += 1440;
  return Math.max(0, (end - start) / 60);
}

function estimatedUntilVolumeEnd(shift) {
  const start = minutesFromTime(shift.start);
  const periods = getMealPeriodsForDate(shift.date);
  const activePeriod = periods.find((period) => start >= period.startMinutes && start < period.endMinutes);
  if (activePeriod) return activePeriod.endMinutes;
  const nextPeriod = periods.find((period) => start < period.startMinutes);
  return nextPeriod?.endMinutes ?? start;
}

function employeeWeekLabor(employeeId) {
  const employee = employeeById(employeeId);
  const dates = new Set(weekDates().map(formatDateKey));
  return state.shifts
    .filter((shift) => shift.employeeId === employeeId && dates.has(shift.date) && visibleShift(shift))
    .reduce((summary, shift) => {
      const hours = shiftHours(shift);
      summary.hours += hours;
      summary.payroll += hours * employeeRateForRole(employee, shift.roleId);
      return summary;
    }, { hours: 0, payroll: 0 });
}

function formatHours(value) {
  const rounded = Math.round((Number(value) || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function projectedCoverageForDate(dateKey) {
  const coverage = blankCoverageForDate(dateKey);
  getMealPeriodsForDate(dateKey).forEach((period) => {
    const projection = salesProjectionForMeal(dateKey, period.name);
    if (!projection) return;
    fohRoles().forEach((role) => {
      const rule = state.settings.projectionRules?.[period.name]?.[role.id] || {};
      const dollarsPerStaff = Number(rule.dollarsPerStaff) || 0;
      const minimum = Number(rule.minimum) || 0;
      const calculated = dollarsPerStaff > 0 ? Math.ceil(projection / dollarsPerStaff) : 0;
      coverage[period.name][role.id] = Math.max(minimum, calculated);
    });
  });
  return coverage;
}

function countCoverage(dateKey, options = {}) {
  const includeUnassigned = options.includeUnassigned !== false;
  const counts = {};
  getMealPeriodsForDate(dateKey).forEach((period) => {
    counts[period.name] = {};
    fohRoles().forEach((role) => counts[period.name][role.id] = 0);
  });
  const coverageShifts = [
    ...state.shifts.filter((shift) => shift.date === dateKey && shift.department === "FOH"),
    ...(includeUnassigned ? (state.unassignedShifts || []).filter((shift) => shift.date === dateKey && shift.department === "FOH") : [])
  ];
  coverageShifts.forEach((shift) => {
    const role = roleById(shift.roleId);
    if (!role || role.department !== "FOH") return;
    getMealsForShift(shift).forEach((meal) => {
      if (!counts[meal]) counts[meal] = {};
      counts[meal][role.id] = (counts[meal][role.id] || 0) + 1;
    });
  });
  return counts;
}

function coverageShortfalls(dateKey, options = {}) {
  const required = coverageForDate(dateKey);
  const actual = countCoverage(dateKey, options);
  const shortfalls = [];
  Object.entries(required).forEach(([meal, roleCounts]) => {
    Object.entries(roleCounts || {}).forEach(([roleId, requiredCount]) => {
      const need = Number(requiredCount) || 0;
      if (!need) return;
      const have = Number(actual[meal]?.[roleId]) || 0;
      if (have < need) {
        shortfalls.push({ dateKey, meal, roleId, need, have, missing: need - have });
      }
    });
  });
  return shortfalls;
}

function getCoverageStatus(dateKey) {
  const required = coverageForDate(dateKey);
  const totalRequired = Object.values(required).reduce((sum, roles) => (
    sum + Object.values(roles || {}).reduce((roleSum, count) => roleSum + (Number(count) || 0), 0)
  ), 0);
  if (!totalRequired) return { className: "coverage-empty", label: "Set", title: "No coverage requirements set" };
  const missingCreated = coverageShortfalls(dateKey, { includeUnassigned: true }).reduce((sum, item) => sum + item.missing, 0);
  if (missingCreated) return { className: "coverage-missing", label: `${missingCreated} short`, title: `${missingCreated} required shift${missingCreated === 1 ? "" : "s"} not created yet` };
  const missingAssigned = coverageShortfalls(dateKey, { includeUnassigned: false }).reduce((sum, item) => sum + item.missing, 0);
  if (missingAssigned) return { className: "coverage-created", label: "In Bay", title: "Required shifts are created, but some are still in the Shift Bay" };
  return { className: "coverage-complete", label: "Full", title: "Coverage requirements are fully assigned" };
}

function openCoverageDialog(dateKey) {
  $("coverageDate").value = dateKey;
  $("coverageDialogTitle").textContent = `Coverage for ${displayDate(parseDateKey(dateKey))}`;
  renderCoverageEditor(dateKey, coverageForDate(dateKey));
  $("coverageDialog").showModal();
}

function renderCoverageEditor(dateKey, coverage) {
  const roles = fohRoles();
  const counts = countCoverage(dateKey);
  $("coverageEditor").innerHTML = getMealPeriodsForDate(dateKey).map((period) => {
    const roleInputs = roles.map((role) => {
      const required = coverage?.[period.name]?.[role.id] || "";
      const actual = counts?.[period.name]?.[role.id] || 0;
      return `
        <label class="coverage-role-control">
          <span>${role.name}</span>
          <input type="number" min="0" step="1" data-coverage-input="${period.name}:${role.id}" value="${required}">
          <small>${actual} scheduled</small>
        </label>
      `;
    }).join("");
    return `
      <section class="coverage-meal">
        <h3>${period.name} <span>${period.start} - ${period.end}</span></h3>
        <div class="coverage-role-grid">${roleInputs}</div>
      </section>
    `;
  }).join("");
  renderCoverageSummary(dateKey, coverage);
}

function collectCoverageEditor() {
  const coverage = blankCoverageForDate($("coverageDate").value);
  document.querySelectorAll("[data-coverage-input]").forEach((input) => {
    const [meal, roleId] = input.dataset.coverageInput.split(":");
    if (!coverage[meal]) coverage[meal] = {};
    coverage[meal][roleId] = Number(input.value) || 0;
  });
  return coverage;
}

function renderCoverageSummary(dateKey, coverage = collectCoverageEditor()) {
  const previous = state.coverageRequirements?.[dateKey];
  state.coverageRequirements = { ...state.coverageRequirements, [dateKey]: coverage };
  const shortfalls = coverageShortfalls(dateKey);
  if (previous) state.coverageRequirements[dateKey] = previous;
  else delete state.coverageRequirements[dateKey];
  if (!shortfalls.length) {
    $("coverageSummary").textContent = "Coverage requirements are met for the currently scheduled shifts.";
    return;
  }
  $("coverageSummary").innerHTML = shortfalls.map((item) => {
    const role = roleById(item.roleId);
    return `<div>${item.meal}: ${role?.name || "Role"} needs ${item.need}, scheduled ${item.have}</div>`;
  }).join("");
}

function useCoverageDefaults() {
  const dateKey = $("coverageDate").value;
  renderCoverageEditor(dateKey, defaultCoverageForDate(dateKey));
}

function useProjectionCoverage() {
  const dateKey = $("coverageDate").value;
  renderCoverageEditor(dateKey, mergeCoverageMax(defaultCoverageForDate(dateKey), projectedCoverageForDate(dateKey)));
}

function usePreviousWeekCoverage() {
  const dateKey = $("coverageDate").value;
  renderCoverageEditor(dateKey, previousWeekCoverageForDate(dateKey) || defaultCoverageForDate(dateKey));
}

function addMissingCoverageToShiftBay() {
  const dateKey = $("coverageDate").value;
  if (!dateKey) return;
  pushUndo();
  state.coverageRequirements[dateKey] = collectCoverageEditor();
  state.unassignedShifts = state.unassignedShifts || [];
  const added = addCoverageShortfallShifts([dateKey]);
  if (!added) {
    undoStack.pop();
    renderCoverageSummary(dateKey, state.coverageRequirements[dateKey]);
    showConflict("No missing coverage shifts to add for this day.");
    return;
  }
  $("coverageDialog").close();
  selectedUnassignedShiftId = state.unassignedShifts[state.unassignedShifts.length - 1]?.id || null;
  pendingDeleteUnassignedShiftId = null;
  pendingTrayWarning = null;
  activateTab("schedule");
  renderAll();
  showConflict(`Added ${added} missing coverage shift${added === 1 ? "" : "s"} to the Shift Bay.`);
}

function addWeekMissingCoverageToShiftBay() {
  pushUndo();
  state.unassignedShifts = state.unassignedShifts || [];
  const added = addCoverageShortfallShifts(weekDates().map(formatDateKey));
  if (!added) {
    undoStack.pop();
    showConflict("No missing coverage shifts to add for the active week.");
    return;
  }
  selectedUnassignedShiftId = state.unassignedShifts[state.unassignedShifts.length - 1]?.id || null;
  pendingDeleteUnassignedShiftId = null;
  pendingTrayWarning = null;
  activateTab("schedule");
  renderAll();
  showConflict(`Added ${added} missing coverage shift${added === 1 ? "" : "s"} to the Shift Bay for the active week.`);
}

function trainingDayNumber(shift) {
  if (!shift.training?.isTraining) return null;
  if (shift.training.dayOverride) return Number(shift.training.dayOverride);
  const traineeId = shift.training.traineeId || shift.employeeId;
  const roleId = shift.roleId;
  return state.shifts
    .filter((item) => item.training?.isTraining && (item.training.traineeId || item.employeeId) === traineeId && item.roleId === roleId)
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
    .findIndex((item) => item.id === shift.id) + 1;
}

function trainingBadgesForShift(shift) {
  const badges = [];
  const trainerLinks = state.shifts.filter((item) => trainingShiftMatchesTrainerShift(item, shift));
  const segmentText = shift.training?.segmentEnd ? ` until ${shift.training.segmentEnd}` : "";
  if (shift.training?.isTraining) {
    const trainee = employeeById(shift.training.traineeId);
    const trainer = employeeById(shift.training.trainerId);
    if (shift.employeeId === shift.training.trainerId) {
      if (trainee || !trainerLinks.length) badges.push(`Training ${trainee ? displayName(trainee) : "trainee"}${segmentText}`);
    } else if (shift.employeeId === shift.training.traineeId) {
      if (trainer) badges.push(`Training with ${displayName(trainer)}${segmentText}`);
      else if (!trainerLinks.length) badges.push("Training with trainer needed");
    } else {
      badges.push(`Training ${trainee ? displayName(trainee) : "trainee"}${trainer ? ` with ${displayName(trainer)}` : ""}${segmentText}`);
    }
  }
  trainerLinks.forEach((item) => {
    const trainee = employeeById(item.training.traineeId || item.employeeId);
    const linkedSegmentText = item.training?.segmentEnd ? ` until ${item.training.segmentEnd}` : "";
    badges.push(`Training ${trainee ? displayName(trainee) : "trainee"}${linkedSegmentText}`);
  });
  return [...new Set(badges)];
}

function cell(className, html) {
  const div = document.createElement("div");
  div.className = className;
  div.innerHTML = html;
  return div;
}

function shiftColor(shift) {
  const role = roleById(shift?.roleId);
  const color = String(role?.color || shift?.color || "#2563eb").trim();
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) ? color : (role?.color || "#2563eb");
}

function renderShiftCard(shift, options = {}) {
  const role = roleById(shift.roleId);
  const employee = employeeById(shift.employeeId);
  const roleName = role?.name || "";
  const rawShiftLabel = cleanCell(shift.shiftLabel);
  const titleText = roleName || rawShiftLabel || "Role";
  const hideScheduleLabels = Boolean(options.hideScheduleLabels);
  const showShiftLabel = !hideScheduleLabels && Boolean(state.settings.showShiftNameFields) && rawShiftLabel && rawShiftLabel !== titleText && !/regular\s+week/i.test(rawShiftLabel);
  const card = document.createElement("div");
  card.className = "shift-card";
  if (options.ghost) card.classList.add("ghost-shift-card");
  if (options.preview) card.classList.add("copy-paint-preview-card");
  const issueMessages = shiftIssueMessages(shift);
  if (issueMessages.length) card.classList.add("has-issue");
  if (!options.ghost && selectedShiftId === shift.id) card.classList.add("selected");
  if (pendingDeleteShiftId === shift.id) card.classList.add("pending-delete");
  card.draggable = false;
  card.dataset.shiftId = shift.id;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.style.setProperty("--shift-color", shiftColor(shift));
  const end = shift.untilVolume ? "Until Volume" : shift.end;
  const coveredMeals = getMealsForShift(shift).join(", ");
  const rawNoteText = cleanCell(shift.notes);
  const noteText = /^training$/i.test(rawNoteText) ? "" : rawNoteText;
  const detailText = options.ghost ? "Also scheduled" : (noteText || (hideScheduleLabels ? "" : coveredMeals));
  const detailClass = noteText && !options.ghost ? "shift-notes shift-note-badge" : "shift-notes";
  const trainingBadges = trainingBadgesForShift(shift).map((badge) => `<div class="training-badge">${badge}</div>`).join("");
  if (trainingBadges) card.classList.add("has-training-badge");
  const flexBadge = shift.isFlexDouble ? `<span class="shift-trait-badge flex-double-badge" title="Flex Double">Flex</span>` : "";
  const lunchCloserBadge = shift.isLunchCloser ? `<span class="shift-trait-badge lunch-closer-badge" title="Lunch closer">Lunch CL</span>` : "";
  const selectedActions = (!options.ghost && selectedShiftId === shift.id && pendingDeleteShiftId !== shift.id) ? `
    <div class="shift-action-strip" aria-label="Selected shift actions">
      <button type="button" data-shift-action="edit" title="Edit shift">Edit</button>
      <button type="button" data-shift-action="copy" title="Copy shift">Copy</button>
      <button type="button" data-shift-action="delete" title="Delete or move shift">Delete</button>
    </div>
  ` : "";
  card.innerHTML = `
    <div class="shift-title"><span>${escapeHtml(titleText)}</span><span class="shift-dept">${escapeHtml(shift.department || "")}</span></div>
    ${flexBadge}${lunchCloserBadge}
    ${selectedActions}
    ${options.ghost ? "" : `<button class="closer-toggle ${shift.isCloser ? "active" : ""}" type="button" title="${shift.isCloser ? "Marked as closer shift" : "Mark as closer shift"}" aria-label="${shift.isCloser ? "Unmark closer shift" : "Mark closer shift"}">Close</button>`}
    ${showShiftLabel ? `<div class="shift-notes">${escapeHtml(rawShiftLabel)}</div>` : ""}
    <div class="shift-time">${shift.start} - ${end}</div>
    ${detailText ? `<div class="${detailClass}">${noteText && !options.ghost ? `Note: ${escapeHtml(noteText)}` : escapeHtml(detailText)}</div>` : ""}
    ${trainingBadges}
    ${pendingDeleteShiftId === shift.id ? `
      <div class="shift-delete-options" aria-label="Choose what to do with this shift">
        <button class="unassign-confirm-button" type="button" title="Move back to Shift Bay" aria-label="Move back to Shift Bay">
          <span class="open-bay-return-icon" aria-hidden="true"><span class="open-bay-icon"></span></span>
        </button>
        <button class="delete-confirm-button" type="button" title="Delete shift permanently" aria-label="Delete shift permanently">X</button>
      </div>
    ` : ""}
  `;
  if (options.preview) {
    card.querySelector(".delete-start-button")?.remove();
    card.querySelector(".closer-toggle")?.remove();
    card.removeAttribute("draggable");
    return card;
  }
  if (options.ghost) {
    card.title = `${displayName(employee)} already scheduled: ${role?.name || ""} ${shift.start} - ${end}`;
    card.onclick = (event) => {
      event.stopPropagation();
      if (selectedShiftId === shift.id) {
        pendingDeleteShiftId = null;
        selectedShiftId = null;
        selectedTimeOffRequestId = null;
        selectedUnassignedShiftId = null;
        selectedCell = null;
        renderSchedulePreservingGridScroll();
        return;
      }
      pendingDeleteShiftId = null;
      selectedShiftId = shift.id;
      selectedTimeOffRequestId = null;
      selectedUnassignedShiftId = null;
      selectedCell = { employeeId: shift.employeeId, date: shift.date };
      renderSchedulePreservingGridScroll();
    };
    card.ondblclick = (event) => {
      event.stopPropagation();
      selectedShiftId = shift.id;
      selectedTimeOffRequestId = null;
      selectedUnassignedShiftId = null;
      selectedCell = { employeeId: shift.employeeId, date: shift.date };
      openShiftDialog(shift);
    };
    card.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      card.click();
      if (event.key === "Enter") openShiftDialog(shift);
    };
    return card;
  }
  const deleteStartButton = card.querySelector(".delete-start-button");
  if (deleteStartButton) {
    deleteStartButton.onclick = (event) => {
      event.stopPropagation();
      document.querySelectorAll(".shift-card.pending-delete").forEach((openCard) => {
        if (openCard !== card) {
          openCard.classList.remove("pending-delete");
          openCard.querySelector(".shift-delete-options")?.remove();
        }
      });
      document.querySelectorAll(".shift-card.selected").forEach((selectedCard) => {
        if (selectedCard !== card) selectedCard.classList.remove("selected");
      });
      pendingDeleteShiftId = shift.id;
      pendingDeleteUnassignedShiftId = null;
      selectedShiftId = shift.id;
      selectedTimeOffRequestId = null;
      selectedUnassignedShiftId = null;
      selectedCell = { employeeId: shift.employeeId, date: shift.date };
      card.classList.add("selected", "pending-delete");
      if (!card.querySelector(".shift-delete-options")) {
        card.insertAdjacentHTML("beforeend", `
          <div class="shift-delete-options" aria-label="Choose what to do with this shift">
            <button class="unassign-confirm-button" type="button" title="Move back to Shift Bay" aria-label="Move back to Shift Bay">
              <span class="open-bay-return-icon" aria-hidden="true"><span class="open-bay-icon"></span></span>
            </button>
            <button class="delete-confirm-button" type="button" title="Delete shift permanently" aria-label="Delete shift permanently">X</button>
          </div>
        `);
        card.querySelector(".unassign-confirm-button")?.addEventListener("click", (confirmEvent) => {
          confirmEvent.stopPropagation();
          pendingDeleteShiftId = null;
          unassignShift(shift.id);
        });
        card.querySelector(".delete-confirm-button")?.addEventListener("click", (confirmEvent) => {
          confirmEvent.stopPropagation();
          pushUndo();
          state.shifts = state.shifts.filter((item) => item.id !== shift.id);
          selectedShiftId = null;
          pendingDeleteShiftId = null;
          renderAllPreservingScheduleScroll();
        });
      }
    };
  }
  card.querySelectorAll("[data-shift-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedShiftId = shift.id;
      selectedTimeOffRequestId = null;
      selectedUnassignedShiftId = null;
      selectedCell = { employeeId: shift.employeeId, date: shift.date };
      const action = button.dataset.shiftAction;
      if (action === "edit") openShiftDialog(shift);
      if (action === "copy") copySelectedShift();
      if (action === "delete") {
        pendingDeleteShiftId = shift.id;
        pendingDeleteUnassignedShiftId = null;
        renderSchedulePreservingGridScroll();
      }
    });
  });
  const closerToggle = card.querySelector(".closer-toggle");
  if (closerToggle) {
    closerToggle.onclick = (event) => {
      event.stopPropagation();
      toggleShiftCloser(shift.id);
    };
  }
  const confirmUnassignButton = card.querySelector(".unassign-confirm-button");
  if (confirmUnassignButton) {
    confirmUnassignButton.onclick = (event) => {
      event.stopPropagation();
      pendingDeleteShiftId = null;
      unassignShift(shift.id);
    };
  }
  const confirmDeleteButton = card.querySelector(".delete-confirm-button");
  if (confirmDeleteButton) {
    confirmDeleteButton.onclick = (event) => {
      event.stopPropagation();
      pushUndo();
      state.shifts = state.shifts.filter((item) => item.id !== shift.id);
      selectedShiftId = null;
      pendingDeleteShiftId = null;
      renderAllPreservingScheduleScroll();
    };
  }
  card.onclick = (event) => {
    event.stopPropagation();
    if (pendingDeleteShiftId === shift.id) {
      pendingDeleteShiftId = null;
      renderSchedulePreservingGridScroll();
      return;
    }
    if (selectedShiftId === shift.id) {
      pendingDeleteShiftId = null;
      selectedShiftId = null;
      selectedTimeOffRequestId = null;
      selectedUnassignedShiftId = null;
      selectedCell = null;
      renderSchedulePreservingGridScroll();
      return;
    }
    pendingDeleteShiftId = null;
    selectedShiftId = shift.id;
    selectedTimeOffRequestId = null;
    selectedUnassignedShiftId = null;
    selectedCell = { employeeId: shift.employeeId, date: shift.date };
    renderSchedulePreservingGridScroll();
  };
  card.ondblclick = (event) => {
    event.stopPropagation();
    openShiftDialog(shift);
  };
  card.onpointerdown = (event) => {
    if (event.target.closest("button")) return;
    event.preventDefault();
    beginMouseAssignedShiftDrag(event, card, shift);
  };
  card.title = `${displayName(employee)} ${role?.name || ""}${issueMessages.length ? `\n${issueMessages.join("\n")}` : ""}`;
  card.setAttribute("aria-label", `${displayName(employee)} ${role?.name || "Shift"} ${shift.start} to ${end}. Press Enter to edit, or Space to select actions.`);
  card.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (event.key === "Enter") openShiftDialog(shift);
    else card.click();
  };
  return card;
}

function toggleShiftCloser(shiftId) {
  const shift = state.shifts.find((item) => item.id === shiftId);
  if (!shift) return;
  pushUndo();
  state.shifts = state.shifts.map((item) => item.id === shiftId ? { ...item, isCloser: !item.isCloser } : item);
  selectedShiftId = shiftId;
  renderAll();
}

function handleDragOver(event, dayCell) {
  const unassignedId = dragUnassignedShiftId;
  if (!dragShiftId && !unassignedId) return;
  event.preventDefault();
  const staged = unassignedId ? state.unassignedShifts.find((shift) => shift.id === unassignedId) : null;
  const source = staged || state.shifts.find((shift) => shift.id === dragShiftId);
  if (!source) return;
  const targetShift = {
    ...source,
    id: staged || event.ctrlKey ? uid("shift") : source.id,
    employeeId: dayCell.dataset.employeeId,
    date: staged ? source.date : dayCell.dataset.date
  };
  const result = validateShift(targetShift);
  dayCell.classList.remove("drag-valid", "drag-warning", "drag-invalid");
  if (result.errors.length) dayCell.classList.add("drag-invalid");
  else if (result.warnings.length) dayCell.classList.add("drag-warning");
  else dayCell.classList.add("drag-valid");
}

function handleEmployeeRowDragOver(event, element, employeeId) {
  if (!dragUnassignedShiftId && !dragShiftId) return;
  const source = dragUnassignedShiftId
    ? state.unassignedShifts.find((shift) => shift.id === dragUnassignedShiftId)
    : state.shifts.find((shift) => shift.id === dragShiftId);
  if (!source) return;
  event.preventDefault();
  const targetShift = {
    ...source,
    id: dragUnassignedShiftId || event.ctrlKey ? uid("shift") : source.id,
    employeeId,
    date: source.date
  };
  const result = validateShift(targetShift);
  element.classList.remove("drag-valid", "drag-warning", "drag-invalid");
  if (result.errors.length) element.classList.add("drag-invalid");
  else if (result.warnings.length) element.classList.add("drag-warning");
  else element.classList.add("drag-valid");
}

function handleDragEnter(event, dayCell) {
  if (!dragShiftId || !event.ctrlKey || !event.shiftKey) return;
  event.preventDefault();
  const source = state.shifts.find((shift) => shift.id === dragShiftId);
  if (!source) return;
  if (!dragPaint) {
    dragPaint = { applied: new Set(), snapshotTaken: false, sourceEmployeeId: source.employeeId };
  }
  if (dayCell.dataset.employeeId !== dragPaint.sourceEmployeeId) return;
  if (source.employeeId === dayCell.dataset.employeeId && source.date === dayCell.dataset.date) return;
  const key = `${dayCell.dataset.employeeId}:${dayCell.dataset.date}`;
  if (dragPaint.applied.has(key)) return;
  const copy = {
    ...source,
    id: uid("shift"),
    employeeId: dayCell.dataset.employeeId,
    date: dayCell.dataset.date
  };
  const result = validateShift(copy);
  if (result.errors.length || result.warnings.length) return;
  if (!dragPaint.snapshotTaken) {
    pushUndo();
    dragPaint.snapshotTaken = true;
  }
  dragPaint.applied.add(key);
  state.shifts.push(copy);
  selectedShiftId = copy.id;
  selectedCell = { employeeId: copy.employeeId, date: copy.date };
  saveState();
  renderSchedule();
}

async function handleDrop(event, dayCell) {
  event.preventDefault();
  const unassignedId = event.dataTransfer.getData("text/unassigned-shift") || dragUnassignedShiftId;
  if (unassignedId) {
    assignUnassignedShift(unassignedId, dayCell.dataset.employeeId);
    endAnyDrag();
    return;
  }
  const droppedShiftId = event.dataTransfer.getData("text/shift") || dragShiftId;
  if (dragPaint?.snapshotTaken) {
    dragPaint = null;
    renderAll();
    return;
  }
  await moveAssignedShiftToEmployee(droppedShiftId, dayCell.dataset.employeeId, dayCell.dataset.date, event.ctrlKey);
}

async function moveAssignedShiftToEmployee(shiftId, employeeId, dateKey = null, isCopy = false) {
  const source = state.shifts.find((shift) => shift.id === shiftId);
  if (!source || !employeeId) {
    showConflict("Drop the shift onto an employee or schedule cell to move it.");
    endAnyDrag();
    return;
  }
  const nextShift = {
    ...source,
    id: isCopy ? uid("shift") : source.id,
    employeeId,
    date: dateKey || source.date,
    color: shiftColor(source)
  };
  const result = validateShift(nextShift);
  if (result.errors.length) {
    showConflict(result.errors.join(" "));
    endAnyDrag();
    renderSchedule();
    return;
  }
  if (!(await confirmWarnings(result.warnings, { confirmText: "Assign Anyway" }))) {
    endAnyDrag();
    renderSchedule();
    return;
  }
  pushUndo();
  if (isCopy) state.shifts.push(nextShift);
  else state.shifts = state.shifts.map((shift) => shift.id === source.id ? nextShift : shift);
  selectedShiftId = nextShift.id;
  selectedCell = { employeeId: nextShift.employeeId, date: nextShift.date };
  endAnyDrag();
  renderAll();
}

async function assignUnassignedShift(unassignedId, employeeId, force = false) {
  const source = state.unassignedShifts.find((shift) => shift.id === unassignedId);
  if (!source) return;
  const targetShift = stagedShiftToShift(source, employeeId);
  const result = validateShift(targetShift);
  if (result.errors.length) {
    showConflict(result.errors.join(" "));
    renderSchedule();
    return;
  }
  if (result.warnings.length && !force && !state.settings.ignoreWarnings) {
    if (!(await confirmWarnings(result.warnings, { confirmText: "Assign Anyway" }))) return;
  }
  if (result.warnings.length && state.settings.ignoreWarnings) {
    showConflict(`Developer mode allowed warning-level assignment: ${result.warnings.join(" ")}`);
  }
  pushUndo();
  pendingTrayWarning = null;
  state.shifts.push(targetShift);
  state.unassignedShifts = state.unassignedShifts.filter((shift) => shift.id !== unassignedId);
  if (selectedUnassignedShiftId === unassignedId) selectedUnassignedShiftId = null;
  selectedShiftId = targetShift.id;
  selectedCell = { employeeId, date: targetShift.date };
  renderAll();
}

function autoAssignCleanOpenShiftBay() {
  const openShifts = currentWeekOpenShifts();
  if (!openShifts.length) {
    showConflict("There are no shifts in the Shift Bay for this week.");
    return;
  }
  const assigned = [];
  const skipped = [];
  pushUndo();
  openShifts.forEach((openShift) => {
    const stillInBay = state.unassignedShifts.find((shift) => shift.id === openShift.id);
    if (!stillInBay) return;
    const cleanCandidate = stagedShiftCandidates(stillInBay).best.find((item) => !employeeHasShiftOnDate(item.employee.id, stillInBay.date));
    if (!cleanCandidate) {
      skipped.push(stillInBay);
      return;
    }
    const targetShift = stagedShiftToShift(stillInBay, cleanCandidate.employee.id);
    const result = validateShift(targetShift);
    if (result.errors.length || result.warnings.length) {
      skipped.push(stillInBay);
      return;
    }
    state.shifts.push(targetShift);
    state.unassignedShifts = state.unassignedShifts.filter((shift) => shift.id !== stillInBay.id);
    assigned.push({ shift: targetShift, employee: cleanCandidate.employee });
  });
  pendingTrayWarning = null;
  pendingDeleteUnassignedShiftId = null;
  if (selectedUnassignedShiftId && !state.unassignedShifts.some((shift) => shift.id === selectedUnassignedShiftId)) {
    selectedUnassignedShiftId = null;
  }
  const lastAssigned = assigned.at(-1);
  if (lastAssigned) {
    selectedShiftId = lastAssigned.shift.id;
    selectedCell = { employeeId: lastAssigned.shift.employeeId, date: lastAssigned.shift.date };
  }
  renderAll();
  const assignedText = `Auto-assigned ${assigned.length} clean shift${assigned.length === 1 ? "" : "s"}.`;
  const skippedText = skipped.length ? ` Left ${skipped.length} shift${skipped.length === 1 ? "" : "s"} in the Shift Bay because no warning-free, non-double fit was available.` : "";
  showConflict(`${assignedText}${skippedText}`);
}

function employeeHasShiftOnDate(employeeId, dateKey, excludeShiftId = "") {
  return (state.shifts || []).some((shift) => shift.id !== excludeShiftId && shift.employeeId === employeeId && shift.date === dateKey && visibleShift(shift));
}

function employeeHasAnyShiftOnDate(employeeId, dateKey, excludeShiftId = "") {
  return (state.shifts || []).some((shift) => shift.id !== excludeShiftId && shift.employeeId === employeeId && shift.date === dateKey);
}

function stagedShiftToShift(source, employeeId) {
  return {
    id: uid("shift"),
    employeeId,
    date: source.date,
    shiftLabel: source.shiftLabel || "",
    department: source.department,
    roleId: source.roleId,
    start: source.start,
    end: source.end,
    untilVolume: source.untilVolume,
    isCloser: Boolean(source.isCloser),
    isLunchCloser: Boolean(source.isLunchCloser),
    isFlexDouble: Boolean(source.isFlexDouble),
    meals: [],
    notes: source.notes || "",
    training: normalizeShiftTraining(source.training),
    color: shiftColor(source)
  };
}

function unassignShift(shiftId) {
  const shift = state.shifts.find((item) => item.id === shiftId);
  if (!shift) return;
  pushUndo();
  const staged = {
    id: uid("unassigned"),
    templateId: shift.templateId || "",
    templateShiftId: shift.templateShiftId || "",
    date: shift.date,
    shiftLabel: shift.shiftLabel || "",
    department: shift.department,
    roleId: shift.roleId,
    start: shift.start,
    end: shift.end,
    untilVolume: shift.untilVolume,
    isCloser: Boolean(shift.isCloser),
    isLunchCloser: Boolean(shift.isLunchCloser),
    isFlexDouble: Boolean(shift.isFlexDouble),
    notes: shift.notes || "",
    color: shiftColor(shift)
  };
  state.shifts = state.shifts.filter((item) => item.id !== shiftId);
  state.unassignedShifts = [...(state.unassignedShifts || []), staged];
  selectedShiftId = null;
  selectedCell = null;
  selectedUnassignedShiftId = null;
  pendingDeleteShiftId = null;
  pendingDeleteUnassignedShiftId = null;
  pendingTrayWarning = null;
  $("shiftDialog").close();
  renderAllPreservingScheduleScroll();
}

function showConflict(message) {
  const legacyBanner = $("conflictBanner");
  if (legacyBanner) legacyBanner.hidden = true;
  const notice = $("appNotice");
  if (!notice) return;
  notice.innerHTML = `
    <div class="app-notice-icon" aria-hidden="true">i</div>
    <div class="app-notice-message">${escapeHtml(message)}</div>
    <button type="button" class="app-notice-close" aria-label="Close notice">X</button>
  `;
  notice.hidden = false;
  notice.classList.remove("show");
  notice.querySelector(".app-notice-close")?.addEventListener("click", () => hideAppNotice());
  window.clearTimeout(showConflict.timer);
  window.requestAnimationFrame(() => notice.classList.add("show"));
  showConflict.timer = window.setTimeout(hideAppNotice, 7000);
}

function hideAppNotice() {
  const notice = $("appNotice");
  if (!notice) return;
  notice.classList.remove("show");
  window.setTimeout(() => {
    if (!notice.classList.contains("show")) notice.hidden = true;
  }, 180);
}

function showAppAlert({ title = "Notice", message = "", items = [], type = "info" } = {}) {
  const dialog = $("appAlertDialog");
  if (!dialog) {
    showConflict(message || title);
    return;
  }
  const form = dialog.querySelector(".app-alert");
  form?.classList.remove("app-alert-info", "app-alert-warning", "app-alert-error");
  form?.classList.add(`app-alert-${type}`);
  $("appAlertIcon").textContent = type === "error" ? "!" : type === "warning" ? "!" : "i";
  $("appAlertTitle").textContent = title;
  $("appAlertMessage").textContent = message;
  $("appAlertList").innerHTML = items.map((item) => `<div>${escapeHtml(item)}</div>`).join("");
  $("appAlertCloseBtn").onclick = () => dialog.close();
  if (dialog.open) dialog.close();
  dialog.showModal();
}

function stateCollectionChanges(localState = {}, serverState = {}) {
  const employees = new Map((Array.isArray(serverState.employees) ? serverState.employees : []).map((item) => [item.id, item]));
  const employeeName = (id) => {
    const employee = employees.get(id) || (state.employees || []).find((item) => item.id === id);
    return employee ? displayName(employee) : "Unknown employee";
  };
  const roleName = (id) => roleById(id)?.name || "Shift";
  const describe = (key, label, item) => {
    if (key === "shifts" || key === "unassignedShifts") {
      const owner = item.employeeId ? employeeName(item.employeeId) : "Open shift";
      return `${label}: ${owner} / ${roleName(item.roleId)} / ${item.date || "undated"} / ${item.start || "no start"}`;
    }
    if (key === "timeOffRequests") return `${label}: ${employeeName(item.employeeId)} / ${item.date || "undated"} / ${isScheduleBlock(item) ? "Block" : "RO"}`;
    if (key === "employees") return `${label}: ${displayName(item) || item.name || "Employee"}`;
    if (key === "templates") return `${label}: ${item.name || "Template"}`;
    return `${label}: ${item.id || "record"}`;
  };
  const changes = [];
  ["shifts", "unassignedShifts", "timeOffRequests", "employees", "templates"].forEach((key) => {
    const before = new Map((Array.isArray(serverState[key]) ? serverState[key] : []).map((item) => [item.id, item]));
    const after = new Map((Array.isArray(localState[key]) ? localState[key] : []).map((item) => [item.id, item]));
    after.forEach((item, id) => {
      if (!before.has(id)) changes.push(describe(key, "Added", item));
      else if (JSON.stringify(before.get(id)) !== JSON.stringify(item)) changes.push(describe(key, "Edited", item));
    });
    before.forEach((item, id) => {
      if (!after.has(id)) changes.push(describe(key, "Deleted", item));
    });
  });
  return changes.slice(0, 100);
}

function cloneSchedulerState(snapshot = {}) {
  return JSON.parse(JSON.stringify(snapshot || {}));
}

const REBASABLE_STATE_COLLECTIONS = ["roles", "employees", "templates", "shifts", "unassignedShifts", "timeOffRequests", "scheduleHistory"];
const REBASABLE_STATE_OBJECTS = ["settings", "salesProjections", "coverageRequirements"];

function sameSchedulerValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function describeRebasedRecord(collection, record) {
  if (collection === "shifts" || collection === "unassignedShifts") return `${collection === "shifts" ? "Shift" : "Open shift"}: ${record?.date || "undated"} ${record?.start || ""}`.trim();
  if (collection === "employees") return `Employee: ${displayName(record) || "profile"}`;
  if (collection === "timeOffRequests") return `${isScheduleBlock(record) ? "Block" : "RO"}: ${record?.date || "undated"}`;
  if (collection === "templates") return `Template: ${record?.name || "unnamed"}`;
  return `${collection}: ${record?.id || "record"}`;
}

// Reapply only the records that changed in the rejected browser copy. A record
// changed by someone else at the same time is left untouched and preserved for
// review instead of silently overwriting their work.
function rebaseCloudRecovery(baseState = {}, localState = {}, latestState = {}) {
  const rebased = cloneSchedulerState(latestState);
  const applied = [];
  const conflicts = [];
  REBASABLE_STATE_COLLECTIONS.forEach((collection) => {
    const base = new Map((Array.isArray(baseState[collection]) ? baseState[collection] : []).map((item) => [String(item?.id || ""), item]));
    const local = new Map((Array.isArray(localState[collection]) ? localState[collection] : []).map((item) => [String(item?.id || ""), item]));
    const latest = new Map((Array.isArray(latestState[collection]) ? latestState[collection] : []).map((item) => [String(item?.id || ""), item]));
    const result = Array.isArray(rebased[collection]) ? [...rebased[collection]] : [];
    const resultIndex = new Map(result.map((item, index) => [String(item?.id || ""), index]));
    const replace = (id, item) => {
      const index = resultIndex.get(id);
      if (index == null) {
        resultIndex.set(id, result.length);
        result.push(item);
      } else result[index] = item;
    };
    const remove = (id) => {
      const index = resultIndex.get(id);
      if (index != null) {
        result.splice(index, 1);
        resultIndex.clear();
        result.forEach((item, nextIndex) => resultIndex.set(String(item?.id || ""), nextIndex));
      }
    };
    const ids = new Set([...base.keys(), ...local.keys()]);
    ids.forEach((id) => {
      const before = base.get(id);
      const changed = local.get(id);
      const remote = latest.get(id);
      if (sameSchedulerValue(before, changed)) return;
      const label = describeRebasedRecord(collection, changed || before || remote);
      if (!before && changed) {
        if (!remote || sameSchedulerValue(remote, changed)) {
          replace(id, changed);
          applied.push(`Restored ${label}`);
        } else conflicts.push(`Both windows added ${label}`);
        return;
      }
      if (before && !changed) {
        if (!remote || sameSchedulerValue(remote, before)) {
          remove(id);
          applied.push(`Restored deletion of ${label}`);
        } else conflicts.push(`Both windows changed ${label}`);
        return;
      }
      if (!remote || sameSchedulerValue(remote, before)) {
        replace(id, changed);
        applied.push(`Restored ${label}`);
      } else if (!sameSchedulerValue(remote, changed)) conflicts.push(`Both windows changed ${label}`);
    });
    rebased[collection] = result;
  });
  REBASABLE_STATE_OBJECTS.forEach((key) => {
    const before = baseState[key] || {};
    const changed = localState[key] || {};
    const remote = latestState[key] || {};
    if (sameSchedulerValue(before, changed)) return;
    if (sameSchedulerValue(remote, before) || sameSchedulerValue(remote, changed)) {
      rebased[key] = cloneSchedulerState(changed);
      applied.push(`Restored ${key} changes`);
    } else conflicts.push(`Both windows changed ${key}`);
  });
  rebased.meta = { ...(latestState.meta || {}), updatedAt: nowIso(), updatedBy: currentSaveActor() };
  return { state: rebased, applied, conflicts };
}

function createCloudRecovery(localState, baseServerSavedAt = "", existingUpdatedAt = "", baseState = lastKnownServerState) {
  return {
    savedAt: nowIso(),
    baseServerSavedAt,
    existingUpdatedAt,
    data: cloneSchedulerState(localState),
    baseData: baseState ? cloneSchedulerState(baseState) : null,
    changes: [],
    autoReapplyPending: Boolean(baseState)
  };
}

function saveCloudRecovery(recovery) {
  try { localStorage.setItem(CLOUD_RECOVERY_KEY, JSON.stringify(recovery)); } catch { /* local recovery is best effort */ }
}

function readCloudRecovery() {
  try {
    const value = JSON.parse(localStorage.getItem(CLOUD_RECOVERY_KEY) || "null");
    return value && value.data ? value : null;
  } catch {
    return null;
  }
}

function clearCloudRecovery() {
  try { localStorage.removeItem(CLOUD_RECOVERY_KEY); } catch { /* local recovery is best effort */ }
}

function refreshBlockedCloudRecovery(localState) {
  const recovery = readCloudRecovery();
  if (!recovery) return;
  recovery.data = cloneSchedulerState(localState);
  if (recovery.baseData) recovery.changes = stateCollectionChanges(recovery.data, recovery.baseData);
  saveCloudRecovery(recovery);
}

async function reapplyCloudRecoveryAfterRefresh(recovery, latestState, latestSavedAt) {
  const rebased = rebaseCloudRecovery(recovery.baseData, recovery.data, latestState);
  recovery.autoReapplyPending = false;
  recovery.rebasedAt = nowIso();
  recovery.applied = rebased.applied;
  recovery.conflicts = rebased.conflicts;
  if (!rebased.applied.length) {
    saveCloudRecovery(recovery);
    if (rebased.conflicts.length) {
      showAppAlert({
        title: "Some changes need review",
        message: "Another user changed the same records. Their shared changes were kept, and your browser copy remains available for review.",
        items: rebased.conflicts,
        type: "warning"
      });
    }
    return { saved: false, conflicts: rebased.conflicts };
  }
  state = normalizeLoadedState(rebased.state);
  state.meta = { ...(state.meta || {}), serverSavedAt: latestSavedAt, updatedAt: nowIso(), updatedBy: currentSaveActor() };
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  // Preserve this rebased copy until the cloud confirms it. If another write
  // wins the race, the normal stale handler starts a new rebase from this one.
  recovery.data = cloneSchedulerState(state);
  recovery.baseData = cloneSchedulerState(latestState);
  recovery.autoReapplyPending = true;
  saveCloudRecovery(recovery);
  const saved = await persistStateToServer({ immediate: true });
  if (saved) {
    lastKnownServerState = cloneSchedulerState(state);
    if (!rebased.conflicts.length) clearCloudRecovery();
    else {
      recovery.autoReapplyPending = false;
      recovery.presentedAt = nowIso();
      saveCloudRecovery(recovery);
    }
    showAppAlert({
      title: "Changes restored",
      message: rebased.conflicts.length
        ? "Your non-conflicting changes were restored and saved. A few same-record conflicts still need review."
        : "Your saved browser changes were automatically restored after reconnecting to the newest shared schedule.",
      items: [...rebased.applied, ...rebased.conflicts],
      type: rebased.conflicts.length ? "warning" : "info"
    });
  }
  return { saved, conflicts: rebased.conflicts };
}

function showStaleRecoveryAlert(recovery, blocking = false) {
  const changes = Array.isArray(recovery?.changes) ? recovery.changes : [];
  showAppAlert({
    title: blocking ? "CLOUD SAVE REJECTED" : "Unsaved changes preserved",
    message: blocking
      ? "Another user saved the schedule first. Stop editing this window and refresh before making more changes. Your rejected browser copy was preserved, and this list shows what it contained."
      : "This browser had edits that were newer than the shared schedule. The shared version was loaded, and the older browser copy was preserved for review.",
    items: changes.length ? changes : ["The rejected browser copy is preserved locally, but no record-level differences were detected."],
    type: "error"
  });
  if (!blocking && recovery) {
    recovery.presentedAt = nowIso();
    saveCloudRecovery(recovery);
  }
}

function updateShiftNameVisibility() {
  const control = $("shiftLabelControl");
  if (!control) return;
  const show = Boolean(state.settings.showShiftNameFields);
  control.hidden = !show;
  if (show) control.style.removeProperty("display");
  else control.style.setProperty("display", "none", "important");
}
function updateShiftUntilVolumeControl() {
  const show = Boolean(state.settings.showUntilVolumeInShiftEditor);
  const control = $("shiftUntilVolumeControl");
  const checkbox = $("shiftUntilVolume");
  const endInput = $("shiftEnd");
  if (control) {
    control.hidden = !show;
    if (show) control.style.removeProperty("display");
    else control.style.setProperty("display", "none", "important");
  }
  if (checkbox && !show) checkbox.checked = false;
  if (endInput) endInput.placeholder = show ? "until volume or 4p" : "4p";
}

function updateShiftDialogContext() {
  const target = $("shiftDialogContext");
  if (!target) return;
  const dateKey = $("shiftDialogMode")?.value === "staged"
    ? ($("stagedShiftDate")?.value || $("shiftDate")?.value)
    : $("shiftDate")?.value;
  const parsed = parseDateKey(dateKey || "");
  const dateText = Number.isNaN(parsed.getTime())
    ? "No date selected"
    : parsed.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  const employeeId = $("shiftEmployee")?.value || $("shiftEmployeeId")?.value;
  const employee = employeeById(employeeId);
  const employeeText = employee ? ` | ${displayName(employee)}` : "";
  target.textContent = `${dateText}${employeeText}`;
  updateShiftNameVisibility();
}

function auditActorLabel(actor) {
  if (!actor) return "Unknown user";
  return actor.email || actor.name || actor.id || "Unknown user";
}

function renderShiftMetadata(shift) {
  const details = $("shiftMetadataDetails");
  const body = $("shiftMetadataBody");
  if (!details || !body) return;
  details.hidden = !shift;
  if (!shift) {
    body.innerHTML = "";
    return;
  }
  body.innerHTML = `
    <dl>
      <div><dt>Created</dt><dd>${escapeHtml(shift.createdAt ? new Date(shift.createdAt).toLocaleString() : "Unknown")}</dd></div>
      <div><dt>Created by</dt><dd>${escapeHtml(auditActorLabel(shift.createdBy))}</dd></div>
      <div><dt>Last edited</dt><dd>${escapeHtml(shift.updatedAt ? new Date(shift.updatedAt).toLocaleString() : "Unknown")}</dd></div>
      <div><dt>Last edited by</dt><dd>${escapeHtml(auditActorLabel(shift.updatedBy))}</dd></div>
      <div><dt>Created from</dt><dd>${escapeHtml(shift.changeSource || shift.source || "Existing schedule")}</dd></div>
    </dl>
  `;
}

function shiftChangeMetadata(existing, source = "Manual") {
  const now = nowIso();
  const actor = currentSaveActor();
  return {
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || actor,
    updatedAt: now,
    updatedBy: actor,
    changeSource: existing?.changeSource || existing?.source || source
  };
}

function openShiftDialog(shift = null) {
  const dialog = $("shiftDialog");
  const roleOptions = state.roles.map((role) => `<option value="${role.id}">${role.name}</option>`).join("");
  $("shiftDialogMode").value = "assigned";
  $("shiftDialogTitle").textContent = shift ? "Edit Shift" : "Create Shift";
  updateShiftUntilVolumeControl();
  $("shiftEmployeeLabel").hidden = false;
  $("stagedShiftDateLabel").hidden = true;
  $("shiftIsTraining").closest("fieldset").hidden = false;
  $("requestOffShiftBtn").hidden = false;
  $("dayBlockShiftBtn").hidden = false;
  $("unassignShiftBtn").hidden = !shift;
  $("deleteShiftBtn").hidden = !shift;
  $("shiftRole").innerHTML = roleOptions;
  const employeesForSelect = sortedEmployeesForSelect();
  const employeeOptions = employeesForSelect
    .map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employeeOptionLabel(employee))}</option>`)
    .join("");
  $("shiftEmployee").innerHTML = employeeOptions;
  $("shiftTrainee").innerHTML = `<option value="">None</option>${employeeOptions}`;
  $("shiftTrainer").innerHTML = `<option value="">None</option>${employeeOptions}`;
  $("shiftDepartment").innerHTML = DEPARTMENTS.map((dept) => `<option>${dept}</option>`).join("");
  const defaultRole = roleById(selectedCell?.roleId) || state.roles[0];
  const base = shift || {
    id: "",
    employeeId: selectedCell?.employeeId || employeesForSelect[0]?.id || "",
    date: selectedCell?.date || formatDateKey(currentDate),
    shiftLabel: "",
    department: defaultRole?.department || "FOH",
    roleId: defaultRole?.id,
    start: "7:00 AM",
    end: state.settings.showUntilVolumeInShiftEditor ? "Until Volume" : "4:00 PM",
    untilVolume: Boolean(state.settings.showUntilVolumeInShiftEditor),
    isCloser: false,
    isLunchCloser: false,
    isFlexDouble: false,
    meals: [],
    notes: "",
    color: defaultRole?.color
  };
  base.training = base.training || {};
  $("shiftId").value = base.id;
  $("shiftDate").value = base.date;
  $("stagedShiftDate").value = base.date;
  $("shiftEmployeeId").value = base.employeeId;
  $("shiftEmployee").value = base.employeeId;
  $("shiftLabel").value = base.shiftLabel || "";
  $("shiftDepartment").value = base.department;
  $("shiftRole").value = base.roleId;
  $("shiftStart").value = base.start;
  $("shiftEnd").value = base.untilVolume ? (state.settings.showUntilVolumeInShiftEditor ? "" : "4:00 PM") : base.end;
  $("shiftUntilVolume").checked = state.settings.showUntilVolumeInShiftEditor && Boolean(base.untilVolume);
  $("shiftIsCloser").checked = Boolean(base.isCloser);
  $("shiftIsLunchCloser").checked = Boolean(base.isLunchCloser);
  $("shiftFlexDouble").checked = Boolean(base.isFlexDouble);
  $("shiftIsTraining").checked = Boolean(base.training?.isTraining);
  $("shiftTrainee").value = base.training?.traineeId || base.employeeId || "";
  $("shiftTrainer").value = base.training?.trainerId || "";
  $("shiftTrainingSegmentEnd").value = base.training?.segmentEnd || "";
  $("shiftTrainingDayOverride").value = base.training?.dayOverride || "";
  $("shiftNotes").value = base.notes || "";
  $("shiftWarnings").innerHTML = "";
  renderShiftMetadata(shift);
  refreshShiftEmployeeOptions(base.employeeId);
  $("shiftTrainee").value = base.training?.traineeId || base.employeeId || "";
  $("shiftTrainer").value = base.training?.trainerId || "";
  updateRequestOffShiftButton();
  updateShiftDialogContext();
  dialog.showModal();
}

function openStagedShiftDialog(stagedShift = null) {
  const dialog = $("shiftDialog");
  const roleOptions = state.roles.map((role) => `<option value="${role.id}">${role.name}</option>`).join("");
  const defaultRole = state.roles[0];
  const base = stagedShift || {
    id: "",
    date: formatDateKey(currentDate),
    shiftLabel: "",
    department: defaultRole?.department || "FOH",
    roleId: defaultRole?.id,
    start: "7:00 AM",
    end: state.settings.showUntilVolumeInShiftEditor ? "Until Volume" : "4:00 PM",
    untilVolume: Boolean(state.settings.showUntilVolumeInShiftEditor),
    isCloser: false,
    isLunchCloser: false,
    isFlexDouble: false,
    notes: "",
    color: defaultRole?.color
  };
  $("shiftDialogMode").value = "staged";
  $("shiftDialogTitle").textContent = stagedShift ? "Edit Unassigned Shift" : "Create Unassigned Shift";
  updateShiftUntilVolumeControl();
  $("shiftRole").innerHTML = roleOptions;
  $("shiftEmployee").innerHTML = "";
  const employeeOptions = sortedEmployeesForSelect()
    .map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employeeOptionLabel(employee))}</option>`)
    .join("");
  $("shiftTrainee").innerHTML = `<option value="">None</option>${employeeOptions}`;
  $("shiftTrainer").innerHTML = `<option value="">None</option>${employeeOptions}`;
  $("shiftDepartment").innerHTML = DEPARTMENTS.map((dept) => `<option>${dept}</option>`).join("");
  $("shiftEmployeeLabel").hidden = true;
  $("stagedShiftDateLabel").hidden = false;
  $("shiftIsTraining").closest("fieldset").hidden = false;
  $("requestOffShiftBtn").hidden = true;
  $("dayBlockShiftBtn").hidden = true;
  $("unassignShiftBtn").hidden = true;
  $("deleteShiftBtn").hidden = !stagedShift;
  $("shiftId").value = base.id;
  $("shiftDate").value = base.date;
  $("stagedShiftDate").value = base.date;
  $("shiftEmployeeId").value = "";
  $("shiftLabel").value = base.shiftLabel || "";
  $("shiftDepartment").value = base.department;
  $("shiftRole").value = base.roleId;
  $("shiftStart").value = base.start;
  $("shiftEnd").value = base.untilVolume ? (state.settings.showUntilVolumeInShiftEditor ? "" : "4:00 PM") : base.end;
  $("shiftUntilVolume").checked = state.settings.showUntilVolumeInShiftEditor && Boolean(base.untilVolume);
  $("shiftIsCloser").checked = Boolean(base.isCloser);
  $("shiftIsLunchCloser").checked = Boolean(base.isLunchCloser);
  $("shiftFlexDouble").checked = Boolean(base.isFlexDouble);
  base.training = normalizeShiftTraining(base.training);
  $("shiftIsTraining").checked = Boolean(base.training?.isTraining);
  $("shiftTrainee").value = base.training?.traineeId || "";
  $("shiftTrainer").value = base.training?.trainerId || "";
  $("shiftTrainingSegmentEnd").value = base.training?.segmentEnd || "";
  $("shiftTrainingDayOverride").value = base.training?.dayOverride || "";
  $("shiftNotes").value = base.notes || "";
  $("shiftWarnings").innerHTML = "";
  renderShiftMetadata(stagedShift);
  updateShiftDialogContext();
  dialog.showModal();
}

function updateRequestOffShiftButton() {
  const button = $("requestOffShiftBtn");
  if (!button || button.hidden) return;
  const employeeId = $("shiftEmployee").value || $("shiftEmployeeId").value;
  const dateKey = $("shiftDate").value;
  const hasManualRo = Boolean((state.timeOffRequests || []).find((request) => (
    request.employeeId === employeeId &&
    request.date === dateKey &&
    request.source === "Manual"
  )));
  button.textContent = hasManualRo ? "Remove RO" : "Add RO";
  button.classList.toggle("danger", hasManualRo);
}

function applyCloserEndTimeDefault() {
  if (state.settings.autoSetCloserEndTime === false) return;
  if (!$("shiftIsCloser")?.checked) return;
  const dateKey = $("shiftDate")?.value || $("stagedShiftDate")?.value;
  const closerEnd = defaultCloserEndTimeForDate(dateKey);
  if (!closerEnd) return;
  if ($("shiftUntilVolume")) $("shiftUntilVolume").checked = false;
  $("shiftEnd").value = closerEnd;
  refreshShiftEmployeeOptions($("shiftEmployee")?.value || $("shiftEmployeeId")?.value);
}

function setShiftEndTimeDefault(timeValue) {
  const normalized = normalizeTime(timeValue);
  if (!normalized) return;
  if ($("shiftUntilVolume")) $("shiftUntilVolume").checked = false;
  $("shiftEnd").value = normalized;
  refreshShiftEmployeeOptions($("shiftEmployee")?.value || $("shiftEmployeeId")?.value);
}

function applyFlexDoubleEndTimeDefault() {
  if (!$("shiftFlexDouble")?.checked) return;
  setShiftEndTimeDefault(state.settings.flexDoubleEndTime || "7:00 PM");
}

function applyTemplateFlexDoubleEndTimeDefault() {
  if (!$("templateFlexDouble")?.checked) return;
  if ($("templateUntilVolume")) $("templateUntilVolume").checked = false;
  $("templateEnd").value = normalizeTime(state.settings.flexDoubleEndTime || "7:00 PM");
}

function applyLunchCloserEndTimeDefault() {
  if (!$("shiftIsLunchCloser")?.checked) return;
  setShiftEndTimeDefault(state.settings.lunchCloserEndTime || "5:00 PM");
}

function shiftDialogDraftForEmployee(employeeId) {
  const role = roleById($("shiftRole").value);
  const untilVolume = state.settings.showUntilVolumeInShiftEditor && $("shiftUntilVolume").checked;
  return {
    id: $("shiftId").value || uid("shift_preview"),
    employeeId,
    date: $("shiftDate").value,
    shiftLabel: $("shiftLabel").value.trim(),
    department: $("shiftDepartment").value || role?.department || "FOH",
    roleId: $("shiftRole").value,
    start: normalizeTime($("shiftStart").value),
    end: untilVolume ? "Until Volume" : normalizeTime($("shiftEnd").value),
    untilVolume,
    isCloser: $("shiftIsCloser").checked,
    isLunchCloser: $("shiftIsLunchCloser").checked,
    isFlexDouble: $("shiftFlexDouble").checked,
    meals: [],
    notes: $("shiftNotes").value.trim(),
    color: role?.color || "#2563eb"
  };
}

function refreshShiftEmployeeOptions(preferredEmployeeId = "") {
  const select = $("shiftEmployee");
  if (!select || $("shiftDialogMode")?.value !== "assigned") return;
  const roleId = $("shiftRole").value;
  const employees = schedulableEmployees();
  const trained = employees.filter((employee) => employee.roleTraining?.includes(roleId));
  const recommended = [];
  const emergency = [];
  const warning = [];
  trained.forEach((employee) => {
    const result = validateShift(shiftDialogDraftForEmployee(employee.id));
    const row = { employee, result };
    if (result.errors.length || result.warnings.length) warning.push(row);
    else if (employeeIsEmergencyOnlyForRole(employee, roleId)) emergency.push(row);
    else recommended.push(row);
  });
  const selectedEmployee = employeeById(preferredEmployeeId);
  const selectedIncluded = trained.some((employee) => employee.id === preferredEmployeeId);
  const option = ({ employee }) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employeeOptionLabel(employee))}</option>`;
  const groups = [];
  if (recommended.length) {
    groups.push(`<optgroup label="Best fits">${recommended.map(option).join("")}</optgroup>`);
  }
  if (emergency.length) {
    groups.push(`<optgroup label="Emergency only">${emergency.map(option).join("")}</optgroup>`);
  }
  if (warning.length) {
    groups.push(`<optgroup label="Other trained employees">${warning.map(option).join("")}</optgroup>`);
  }
  if (selectedEmployee && !selectedIncluded) {
    groups.unshift(`<optgroup label="Current employee"><option value="${escapeHtml(selectedEmployee.id)}">${escapeHtml(employeeOptionLabel(selectedEmployee))}</option></optgroup>`);
  }
  select.innerHTML = groups.join("") || `<option value="">No trained employees available</option>`;
  if (preferredEmployeeId && [...select.options].some((item) => item.value === preferredEmployeeId)) {
    select.value = preferredEmployeeId;
  } else {
    select.value = select.options[0]?.value || "";
  }
  $("shiftEmployeeId").value = select.value;
  updateRequestOffShiftButton();
}

function collectStagedShiftFromDialog() {
  const existing = (state.unassignedShifts || []).find((item) => item.id === $("shiftId").value);
  const role = roleById($("shiftRole").value);
  const untilVolume = state.settings.showUntilVolumeInShiftEditor && $("shiftUntilVolume").checked;
  const isTraining = $("shiftIsTraining").checked;
  return {
    id: $("shiftId").value || uid("unassigned"),
    date: $("stagedShiftDate").value || $("shiftDate").value || formatDateKey(currentDate),
    shiftLabel: $("shiftLabel").value.trim(),
    department: $("shiftDepartment").value,
    roleId: $("shiftRole").value,
    start: normalizeTime($("shiftStart").value),
    end: untilVolume ? "Until Volume" : normalizeTime($("shiftEnd").value),
    untilVolume,
    isCloser: $("shiftIsCloser").checked,
    isLunchCloser: $("shiftIsLunchCloser").checked,
    isFlexDouble: $("shiftFlexDouble").checked,
    notes: $("shiftNotes").value.trim(),
    training: {
      isTraining,
      traineeId: isTraining ? $("shiftTrainee").value : "",
      trainerId: isTraining ? $("shiftTrainer").value : "",
      segmentEnd: isTraining ? normalizeTime($("shiftTrainingSegmentEnd").value) : "",
      dayOverride: isTraining ? $("shiftTrainingDayOverride").value : ""
    },
    color: role?.color || "#2563eb",
    ...shiftChangeMetadata(existing, "Manual")
  };
}

function collectShiftFromDialog() {
  const existing = (state.shifts || []).find((item) => item.id === $("shiftId").value);
  const role = roleById($("shiftRole").value);
  const isTraining = $("shiftIsTraining").checked;
  const traineeId = $("shiftTrainee").value || $("shiftEmployee").value;
  const untilVolume = state.settings.showUntilVolumeInShiftEditor && $("shiftUntilVolume").checked;
  return {
    id: $("shiftId").value || uid("shift"),
    employeeId: $("shiftEmployee").value,
    date: $("shiftDate").value,
    shiftLabel: $("shiftLabel").value.trim(),
    department: $("shiftDepartment").value,
    roleId: $("shiftRole").value,
    start: normalizeTime($("shiftStart").value),
    end: untilVolume ? "Until Volume" : normalizeTime($("shiftEnd").value),
    untilVolume,
    isCloser: $("shiftIsCloser").checked,
    isLunchCloser: $("shiftIsLunchCloser").checked,
    isFlexDouble: $("shiftFlexDouble").checked,
    meals: [],
    training: {
      isTraining,
      traineeId,
      trainerId: $("shiftTrainer").value,
      segmentEnd: normalizeTime($("shiftTrainingSegmentEnd").value),
      dayOverride: Number($("shiftTrainingDayOverride").value) || null
    },
    notes: $("shiftNotes").value.trim(),
    color: role?.color || "#2563eb",
    ...shiftChangeMetadata(existing, "Manual")
  };
}

function renderRoles() {
  $("roleList").innerHTML = state.roles.map((role) => `
    <div class="entity-item" data-role-id="${role.id}">
      <div><strong>${role.name}</strong><br><small>${role.department} | ${formatRate(role.defaultRate)}/hr default</small></div>
      <span style="width:22px;height:22px;border-radius:5px;background:${role.color};display:inline-block;"></span>
    </div>
  `).join("");
  document.querySelectorAll("[data-role-id]").forEach((item) => item.onclick = () => loadRole(item.dataset.roleId));
  $("employeeRoleChecks").innerHTML = state.roles.map((role) => `
    <div class="role-training-row" data-role-training-row="${role.id}">
      <label class="checkbox"><input type="checkbox" name="roleTraining" value="${role.id}"> ${role.name} <small>${role.department}</small></label>
      <label class="checkbox emergency-role-toggle"><input type="checkbox" name="emergencyRoleIds" value="${role.id}"> Emergency only</label>
      <div class="role-meal-training" aria-label="${escapeHtml(role.name)} meal training">
        ${MEALS.map((meal) => `
          <label class="checkbox"><input type="checkbox" name="roleMealTraining:${role.id}" value="${meal}"> ${meal}</label>
        `).join("")}
      </div>
    </div>
  `).join("");
  $("employeeTrainerChecks").innerHTML = state.roles.map((role) => `
    <label class="checkbox"><input type="checkbox" name="trainerRoles" value="${role.id}"> ${role.name} <small>${role.department}</small></label>
  `).join("");
  $("employeeDepartmentChecks").innerHTML = DEPARTMENTS.map((department) => `
    <label class="checkbox"><input type="checkbox" name="employeeDepartments" value="${department}"> ${department}</label>
  `).join("");
  $("templateRole").innerHTML = state.roles.map((role) => `<option value="${role.id}">${role.name}</option>`).join("");
  $("templateDepartment").innerHTML = DEPARTMENTS.map((dept) => `<option>${dept}</option>`).join("");
  renderEmployeePayRates(employeeById($("employeeId")?.value));
}

function loadRole(id) {
  const role = roleById(id);
  if (!role) return;
  $("roleId").value = role.id;
  $("roleName").value = role.name;
  $("roleDepartment").value = role.department;
  $("roleDefaultRate").value = role.defaultRate || "";
  $("roleColor").value = role.color;
}

function renderEmployees() {
  const selectedEmployee = employeeById($("employeeId")?.value);
  const search = ($("employeeSearch")?.value || "").trim().toLowerCase();
  const showArchived = Boolean($("showArchivedEmployees")?.checked);
  const employees = state.employees
    .filter((employee) => showArchived || !employee.archived)
    .slice()
    .sort((a, b) => employeeOptionLabel(a).localeCompare(employeeOptionLabel(b), undefined, { sensitivity: "base" }) || fullEmployeeName(a).localeCompare(fullEmployeeName(b)));
  const filteredEmployees = search
    ? employees.filter((employee) => {
        const haystack = [
          fullEmployeeName(employee),
          employee.nickname || "",
          employee.phone || "",
          employee.managerNotes || "",
          employee.active === false ? "inactive" : "active",
          employee.archived ? "archived" : "",
          employee.callWeekly ? "call weekly" : "",
          ...(employee.departments || []),
          ...(employee.mealTraining || []),
          ...(employee.roleTraining || []).map((roleId) => roleById(roleId)?.name || "")
        ].join(" ").toLowerCase();
        return haystack.includes(search);
      })
    : employees;
  if (!selectedEmployee && !employeeNewProfileDraft && filteredEmployees.length) {
    loadEmployee(filteredEmployees[0].id);
    return renderEmployees();
  }
  if ($("archiveEmployeeBtn")) $("archiveEmployeeBtn").hidden = Boolean(selectedEmployee?.archived);
  if ($("restoreEmployeeBtn")) $("restoreEmployeeBtn").hidden = !selectedEmployee?.archived;
  if ($("deleteEmployeeBtn")) $("deleteEmployeeBtn").hidden = !selectedEmployee?.archived;
  renderEmployeeRoster(filteredEmployees, selectedEmployee);
  renderAvailabilityPatternWorkspace(selectedEmployee);
  renderAvailabilityEditor(selectedEmployee);
  renderWeeklyAvailabilityEditor(selectedEmployee);
  renderEmployeePayRates(selectedEmployee);
  updateStickyEmployeeName();
}

function renderEmployeeRoster(employees, selectedEmployee) {
  const panel = $("employeeRosterPanel");
  const list = $("employeeRosterList");
  const count = $("employeeRosterCount");
  const toggle = $("toggleEmployeeRosterBtn");
  if (!panel || !list || !count || !toggle) return;
  panel.classList.toggle("collapsed", Boolean(state.settings.employeeRosterCollapsed));
  toggle.textContent = state.settings.employeeRosterCollapsed ? "Expand" : "Collapse";
  count.textContent = `${employees.length} employee${employees.length === 1 ? "" : "s"}`;
  list.innerHTML = employees.map((employee) => {
    const departments = normalizeEmployeeDepartments(employee).join("/");
    const roles = (employee.roleTraining || []).map((roleId) => roleById(roleId)?.name).filter(Boolean).slice(0, 3).join(", ");
    return `
      <button type="button" class="employee-roster-card ${employee.id === selectedEmployee?.id ? "selected" : ""}" data-roster-employee="${employee.id}">
        <strong>${displayName(employee)}</strong>
        <span>${fullEmployeeName(employee)}</span>
        <small>${[departments, roles, formatPhoneNumber(employee.phone || "")].filter(Boolean).join(" | ")}</small>
      </button>
    `;
  }).join("");
  list.querySelectorAll("[data-roster-employee]").forEach((button) => {
    button.onclick = async () => {
      if (button.dataset.rosterEmployee !== $("employeeId")?.value && !(await confirmDiscardEmployeeChanges())) return;
      loadEmployee(button.dataset.rosterEmployee);
    };
  });
}

function showEmployeeSavedToast(employeeName = "Employee") {
  const toast = $("employeeSaveToast");
  if (!toast) return;
  toast.textContent = `${employeeName} saved`;
  toast.hidden = false;
  toast.classList.remove("show");
  window.clearTimeout(showEmployeeSavedToast.timer);
  window.requestAnimationFrame(() => toast.classList.add("show"));
  showEmployeeSavedToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => { toast.hidden = true; }, 220);
  }, 2600);
}

function setEmployeeSaveDebugStatus(message, status = "saving") {
  const indicator = $("employeeSaveDebugStatus");
  if (!indicator) return;
  if (currentAccessRole() !== "owner") {
    indicator.hidden = true;
    return;
  }
  const timestamp = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const entry = {
    at: new Date().toISOString(),
    status,
    message: String(message || "")
  };
  try {
    const key = "shiftBay.ownerDiagnostics.v1";
    const previous = JSON.parse(localStorage.getItem(key) || "[]");
    const history = Array.isArray(previous) ? previous.slice(-29) : [];
    history.push(entry);
    localStorage.setItem(key, JSON.stringify(history));
    indicator.title = `Recent owner diagnostics (${history.length})`;
    indicator.dataset.diagnostics = JSON.stringify(history);
  } catch {
    // Diagnostics must never interfere with an employee save.
  }
  indicator.textContent = `${message} (${timestamp})`;
  indicator.dataset.state = status;
  indicator.hidden = false;
}

function renderEmployeePayRates(employee = null) {
  const rates = employee?.payRates || {};
  $("employeePayRates").innerHTML = state.roles.map((role) => {
    const override = rates[role.id]?.override || false;
    const value = rates[role.id]?.rate ?? "";
    return `
      <div class="pay-rate-row">
        <strong>${role.name}</strong>
        <span>${formatRate(role.defaultRate)}/hr default</span>
        <label class="checkbox"><input type="checkbox" data-pay-override="${role.id}" ${override ? "checked" : ""}> Override</label>
        <input type="number" min="0" step="0.01" data-pay-rate="${role.id}" value="${value}" ${override ? "" : "disabled"} placeholder="${Number(role.defaultRate) ? Number(role.defaultRate).toFixed(2) : "0.00"}">
      </div>
    `;
  }).join("");
  document.querySelectorAll("[data-pay-override]").forEach((input) => {
    input.onchange = () => {
      const rateInput = document.querySelector(`[data-pay-rate="${input.dataset.payOverride}"]`);
      rateInput.disabled = !input.checked;
      if (input.checked) rateInput.focus();
    };
  });
}

function emptyAvailability() {
  return Object.fromEntries(DAYS.map((_, index) => [index, []]));
}

function availabilityHasWindows(availability = {}) {
  return DAYS.some((_, dayIndex) => (
    Array.isArray(availability?.[dayIndex])
      && availability[dayIndex].some((range) => String(range?.start || "").trim() && String(range?.end || "").trim())
  ));
}

function currentWeekKey() {
  return formatDateKey(startOfWeek(currentDate, state.settings.weekStart));
}

function normalizeAvailabilityWeekKey(dateKey = currentWeekKey()) {
  const parsed = parseDateKey(dateKey || currentWeekKey());
  if (Number.isNaN(parsed.getTime())) return currentWeekKey();
  return formatDateKey(startOfWeek(parsed, state.settings.weekStart));
}

function normalizeAvailabilityEffectiveDate(dateKey = currentWeekKey()) {
  const parsed = parseDateKey(dateKey || currentWeekKey());
  if (Number.isNaN(parsed.getTime())) return currentWeekKey();
  return formatDateKey(parsed);
}

function selectedWeeklyAvailabilityWeekKey() {
  const inputValue = $("weeklyAvailabilityWeek")?.value || employeeWeeklyAvailabilityWeekKey || currentWeekKey();
  const parsed = parseDateKey(inputValue);
  if (Number.isNaN(parsed.getTime())) return currentWeekKey();
  return formatDateKey(startOfWeek(parsed, state.settings.weekStart));
}

function setWeeklyAvailabilityWeek(dateKey = currentWeekKey(), options = {}) {
  const parsed = parseDateKey(dateKey || currentWeekKey());
  employeeWeeklyAvailabilityWeekKey = Number.isNaN(parsed.getTime())
    ? currentWeekKey()
    : formatDateKey(startOfWeek(parsed, state.settings.weekStart));
  const input = $("weeklyAvailabilityWeek");
  if (input) input.value = employeeWeeklyAvailabilityWeekKey;
  const summary = $("weeklyAvailabilityWeekSummary");
  if (summary) {
    const weekStart = parseDateKey(employeeWeeklyAvailabilityWeekKey);
    summary.textContent = `Showing the work week of ${displayDate(weekStart)}. All dates are aligned to the restaurant's week-start setting.`;
  }
  if (options.render !== false) renderWeeklyAvailabilityEditor(employeeById($("employeeId")?.value));
}

function dateKeyForAvailabilityDay(dayIndex, weekKey = currentWeekKey()) {
  const weekStart = startOfWeek(parseDateKey(weekKey || currentWeekKey()), state.settings.weekStart);
  const offset = (Number(dayIndex) - weekStart.getDay() + 7) % 7;
  return formatDateKey(addDays(weekStart, offset));
}

function availabilityDayDateLabel(dayIndex, weekKey = currentWeekKey()) {
  const date = parseDateKey(dateKeyForAvailabilityDay(dayIndex, weekKey));
  if (Number.isNaN(date.getTime())) return DAYS[Number(dayIndex)] || "Day";
  return `${DAYS[Number(dayIndex)] || "Day"} ${date.getMonth() + 1}/${date.getDate()}`;
}

function compactAvailabilityTime(minutes) {
  return timeFromMinutes(minutes).replace(":00 ", "").replace(/\s+/g, "").toLowerCase();
}

function availabilityPresetForDay(dayIndex, preset, weekKey = currentWeekKey()) {
  if (preset === "open") return "12a-11:59p";
  const dateKey = dateKeyForAvailabilityDay(dayIndex, weekKey);
  const periods = floorPlanPeriodsForShiftDate(dateKey).sort((a, b) => a.startMinutes - b.startMinutes);
  if (!periods.length) return preset === "pm" ? "4p-11:59p" : "6a-4p";
  const dinner = periods.find((period) => period.name === "Dinner");
  if (preset === "pm") {
    const start = dinner?.startMinutes ?? Math.max(...periods.map((period) => period.startMinutes));
    const end = dinner?.endMinutes ?? Math.max(...periods.map((period) => period.endMinutes));
    return `${compactAvailabilityTime(start)}-${compactAvailabilityTime(end)}`;
  }
  const amPeriods = dinner ? periods.filter((period) => period.startMinutes < dinner.startMinutes) : periods;
  const source = amPeriods.length ? amPeriods : periods;
  const start = Math.min(...source.map((period) => period.startMinutes));
  const end = dinner?.startMinutes ?? Math.max(...source.map((period) => period.endMinutes));
  return `${compactAvailabilityTime(start)}-${compactAvailabilityTime(end)}`;
}

function setAvailabilityPreset(inputSelector, dayIndex, preset, weekKey = currentWeekKey()) {
  const input = document.querySelector(inputSelector);
  if (!input) return;
  markEmployeeFormDirty();
  const row = input.closest(".availability-day");
  const value = preset === "unavailable" ? "" : availabilityPresetForDay(dayIndex, preset, weekKey);
  const [start = "", end = ""] = value ? value.split("-").map((part) => toNativeTimeValue(part)) : ["", ""];
  row?.querySelectorAll(".availability-window").forEach((window, index) => {
    if (index === 0) {
      window.querySelector('input[data-availability-slot]')?.setAttribute("value", start);
      window.querySelector('input[data-availability-slot]') && (window.querySelector('input[data-availability-slot]').value = start);
      window.querySelector('input[data-availability-end-slot]') && (window.querySelector('input[data-availability-end-slot]').value = end);
    } else if (index > 0) window.remove();
  });
  const addButton = row?.querySelector("[data-add-availability-window]");
  if (addButton) addButton.hidden = false;
  if (!row) input.value = value;
}

function findDuplicateAvailabilityPatternName(name, employeeId = "", patternId = "") {
  const normalizedName = String(name || "").trim().toLocaleLowerCase();
  if (!normalizedName || !employeeId) return null;
  const employee = (state.employees || []).find((item) => String(item?.id || "") === String(employeeId));
  if (!employee) return null;
  for (const pattern of Array.isArray(employee.availabilityPatterns) ? employee.availabilityPatterns : []) {
    if (String(pattern.id || "") === String(patternId)) continue;
    if (String(pattern.name || "").trim().toLocaleLowerCase() === normalizedName) return { employee, pattern };
  }
  return null;
}

function defaultAvailabilityPatternName(employee = null, patternId = "") {
  const base = `${displayName(employee || {}) || "Employee"} availability`;
  return nextAvailabilityPatternName(employee, base, patternId);
}

function nextAvailabilityPatternName(employee = null, base = "Availability", patternId = "") {
  if (!findDuplicateAvailabilityPatternName(base, employee?.id || "", patternId)) return base;
  let suffix = 2;
  while (findDuplicateAvailabilityPatternName(`${base} ${suffix}`, employee?.id || "", patternId)) suffix += 1;
  return `${base} ${suffix}`;
}

function availabilityPatternsForEmployee(employee = null) {
  if (!employee) return [];
  if (Array.isArray(employee.availabilityPatterns) && employee.availabilityPatterns.length) {
    return employee.availabilityPatterns.map((pattern, index) => ({
      id: pattern.id || `pattern-${index + 1}`,
      name: pattern.name || `Availability ${index + 1}`,
      availability: pattern.availability || emptyAvailability(),
      repeatWeeks: pattern.repeatWeeks == null || pattern.repeatWeeks === "" ? null : Math.max(1, Math.min(4, Number(pattern.repeatWeeks) || 1)),
      active: pattern.active !== false,
      effectiveDate: pattern.effectiveDate ? normalizeAvailabilityEffectiveDate(pattern.effectiveDate) : "",
      // An availability can be replaced on a future date without losing its
      // history. `endsOn` is exclusive: it no longer applies on that date.
      endsOn: pattern.endsOn ? normalizeAvailabilityEffectiveDate(pattern.endsOn) : "",
      approvalStatus: String(pattern.approvalStatus || pattern.status || (pattern.approved === true ? "approved" : "")).toLowerCase(),
      approved: pattern.approved === true || String(pattern.approvalStatus || pattern.status || "").toLowerCase() === "approved"
    }));
  }
  if (!availabilityHasWindows(employee.availability)) return [];
  return [{
    id: "regular",
    name: employee.availabilityPatternName || "Regular availability",
    availability: employee.availability || emptyAvailability(),
    repeatWeeks: Math.max(1, Math.min(4, Number(employee.availabilityRepeatWeeks) || 1)),
    active: true,
    effectiveDate: normalizeAvailabilityEffectiveDate(employee.availabilityEffectiveDate || currentWeekKey()),
    endsOn: ""
  }];
}

function availabilityFromPatternsForDate(employee, dateKey) {
  if (!employee || !dateKey) return null;
  const date = parseDateKey(dateKey);
  if (Number.isNaN(date.getTime())) return null;
  const datedPatterns = availabilityPatternsForEmployee(employee)
    .filter((pattern) => (
      (pattern?.active !== false || pattern?.approved === true || pattern?.approvalStatus === "approved")
      && String(pattern.effectiveDate || "").trim()
    ));
  if (!datedPatterns.length) return null;

  // Future profiles must not replace today's availability early. Once a
  // dated profile has started, an off-cycle repeat week is intentionally
  // unavailable rather than falling back to the old profile.
  const startedPatterns = datedPatterns.filter((pattern) => {
    const effectiveDate = parseDateKey(normalizeAvailabilityEffectiveDate(pattern.effectiveDate));
    return !Number.isNaN(effectiveDate.getTime()) && effectiveDate <= date;
  });
  if (!startedPatterns.length) return null;

  const applicable = startedPatterns.filter((pattern) => availabilityPatternAppliesOnDate(pattern, date));
  const dayIndex = date.getDay();
  return applicable.flatMap((pattern) => (
    Array.isArray(pattern.availability?.[dayIndex]) ? pattern.availability[dayIndex] : []
  ));
}

function selectedAvailabilityPattern(employee = null) {
  const patterns = availabilityPatternsForEmployee(employee);
  if (!selectedAvailabilityPatternId || selectedAvailabilityPatternId === "draft") return null;
  return patterns.find((pattern) => pattern.id === selectedAvailabilityPatternId) || null;
}

function availabilityRepeatLabel(repeatWeeks) {
  const weeks = Math.max(1, Math.min(4, Number(repeatWeeks) || 1));
  return weeks === 1 ? "Every week" : `Every ${weeks} weeks`;
}

function availabilityDaySummary(availability = {}) {
  return DAYS.map((day, index) => {
    const ranges = Array.isArray(availability[index]) ? availability[index] : [];
    const text = ranges.length
      ? ranges.map((range) => `${range.start || ""} - ${range.end || ""}`).join(", ")
      : "Not available";
    return `<div><strong>${day}</strong><span>${escapeHtml(text)}</span></div>`;
  }).join("");
}

function isApprovedFutureAvailabilityPattern(pattern) {
  if (!pattern?.approved && pattern?.approvalStatus !== "approved") return false;
  const effectiveDate = normalizeAvailabilityEffectiveDate(pattern.effectiveDate);
  return Boolean(effectiveDate && effectiveDate > formatDateKey(new Date()));
}

function isFutureAvailabilityPattern(pattern) {
  const effectiveDate = normalizeAvailabilityEffectiveDate(pattern?.effectiveDate);
  return Boolean(effectiveDate && effectiveDate > formatDateKey(new Date()));
}

function availabilityPatternAppliesOnDate(pattern, date) {
  const effectiveDate = parseDateKey(normalizeAvailabilityEffectiveDate(pattern?.effectiveDate));
  if (Number.isNaN(effectiveDate.getTime()) || date < effectiveDate) return false;
  const endsOn = pattern?.endsOn ? parseDateKey(normalizeAvailabilityEffectiveDate(pattern.endsOn)) : null;
  if (endsOn && !Number.isNaN(endsOn.getTime()) && date >= endsOn) return false;
  const weekStart = startOfWeek(date, state.settings.weekStart);
  const effectiveWeekStart = startOfWeek(effectiveDate, state.settings.weekStart);
  const weeksSinceStart = Math.round((weekStart.getTime() - effectiveWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const repeatWeeks = Math.max(1, Math.min(4, Number(pattern?.repeatWeeks) || 1));
  return weeksSinceStart >= 0 && weeksSinceStart % repeatWeeks === 0;
}

function availabilityPatternsReplacedOnDate(patterns = [], replacementId = "", effectiveDate = "") {
  const replacementDate = normalizeAvailabilityEffectiveDate(effectiveDate);
  if (!replacementDate) return [];
  return patterns.filter((pattern) => {
    if (!pattern || pattern.id === replacementId || pattern.active === false) return false;
    const startsOn = normalizeAvailabilityEffectiveDate(pattern.effectiveDate);
    const endsOn = pattern.endsOn ? normalizeAvailabilityEffectiveDate(pattern.endsOn) : "";
    return startsOn && startsOn < replacementDate && (!endsOn || endsOn > replacementDate);
  });
}

function availabilityPatternConflicts(patterns = []) {
  const activePatterns = patterns.filter((pattern) => pattern?.active !== false && availabilityHasWindows(pattern.availability));
  if (activePatterns.length < 2) return null;
  const effectiveDates = activePatterns.map((pattern) => parseDateKey(normalizeAvailabilityEffectiveDate(pattern.effectiveDate)));
  const latestEffectiveDate = new Date(Math.max(...effectiveDates.map((date) => date.getTime())));
  const checkThrough = addDays(latestEffectiveDate, 56);
  for (let leftIndex = 0; leftIndex < activePatterns.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < activePatterns.length; rightIndex += 1) {
      const left = activePatterns[leftIndex];
      const right = activePatterns[rightIndex];
      for (let date = new Date(latestEffectiveDate); date <= checkThrough; date = addDays(date, 1)) {
        if (!availabilityPatternAppliesOnDate(left, date) || !availabilityPatternAppliesOnDate(right, date)) continue;
        const dayIndex = date.getDay();
        const leftWindows = left.availability?.[dayIndex] || [];
        const rightWindows = right.availability?.[dayIndex] || [];
        for (const leftWindow of leftWindows) {
          const leftStart = minutesFromTime(leftWindow.start);
          const leftEnd = minutesFromTime(leftWindow.end);
          if (leftStart == null || leftEnd == null || leftEnd <= leftStart) continue;
          for (const rightWindow of rightWindows) {
            const rightStart = minutesFromTime(rightWindow.start);
            const rightEnd = minutesFromTime(rightWindow.end);
            if (rightStart == null || rightEnd == null || rightEnd <= rightStart) continue;
            if (leftStart < rightEnd && rightStart < leftEnd) return { left, right, date: new Date(date) };
          }
        }
      }
    }
  }
  return null;
}

function pendingAvailabilitySubmissionsForEmployee(employee = null) {
  return (Array.isArray(employee?.availabilitySubmissions) ? employee.availabilitySubmissions : [])
    .filter((submission) => ["submitted", "pending"].includes(String(submission.status || "").toLowerCase()))
    .sort((left, right) => String(left.weekStart || "").localeCompare(String(right.weekStart || "")));
}

async function hydrateEmployeeAvailabilitySubmissions(employee) {
  if (!employee || !currentUser || isDemoLocation()) return;
  try {
    const result = await fetchJson("/api/staff-availability", { cache: "no-store", headers: authRequestHeaders() });
    employee.availabilitySubmissions = (result.submissions || []).filter((submission) => String(submission.legacyEmployeeId || "") === String(employee.id || ""));
    renderActiveAvailabilitySummary(employee);
  } catch (error) {
    // The profile remains usable if the separate approval queue is unavailable.
  }
}
function renderActiveAvailabilitySummary(employee = null, patterns = availabilityPatternsForEmployee(employee), selected = selectedAvailabilityPattern(employee)) {
  const tabs = $("activeAvailabilityTabs");
  if (!tabs) return;
  const activePatterns = patterns
    .filter((pattern) => pattern.active !== false || isApprovedFutureAvailabilityPattern(pattern))
    .sort((left, right) => {
      const leftFuture = isFutureAvailabilityPattern(left);
      const rightFuture = isFutureAvailabilityPattern(right);
      if (leftFuture !== rightFuture) return leftFuture ? 1 : -1;
      return String(left.effectiveDate || "").localeCompare(String(right.effectiveDate || ""));
    });
  const pendingSubmissions = pendingAvailabilitySubmissionsForEmployee(employee);
  const activeTabMarkup = activePatterns.map((pattern) => {
    const future = isFutureAvailabilityPattern(pattern);
    const stateLabel = future ? "Will be live soon" : "Live";
    return `<button type="button" class="active-availability-tab${pattern.id === selected?.id ? " selected" : ""}${future ? " future-availability" : ""}" data-active-availability-id="${escapeHtml(pattern.id)}">
      <strong>${escapeHtml(pattern.name)}</strong>
      <span>${stateLabel}</span>
    </button>`;
  }).join("");
  const pendingTabMarkup = pendingSubmissions.map((submission) => `<button type="button" class="active-availability-tab pending-availability-tab" data-availability-submission-id="${escapeHtml(submission.id || submission.weekStart || "pending")}" disabled>
    <strong>Submitted availability</strong>
    <span>Awaiting approval</span>
  </button>`).join("");
  const selectedActivePattern = activePatterns.find((pattern) => pattern.id === selected?.id);
  const selectedActiveMarkup = selectedActivePattern ? `<div class="active-availability-tab-content">
    <strong>${escapeHtml(selectedActivePattern.name)}</strong>
    <span>${isFutureAvailabilityPattern(selectedActivePattern) ? "Will be live soon" : "Live for scheduling"} - ${availabilityRepeatLabel(selectedActivePattern.repeatWeeks)} - starts ${escapeHtml(selectedActivePattern.effectiveDate || "Not set")}${selectedActivePattern.endsOn ? ` - replaced on ${escapeHtml(selectedActivePattern.endsOn)}` : ""}</span>
    <div class="active-availability-day-summary">${availabilityDaySummary(selectedActivePattern.availability)}</div>
  </div>` : "";
  tabs.innerHTML = `<div class="active-availability-tab-strip">${activeTabMarkup}${pendingTabMarkup}</div>${selectedActiveMarkup}`;
  if (!activePatterns.length && !pendingSubmissions.length) tabs.innerHTML = `<div class="active-availability-empty">No availability patterns are active for scheduling.</div>`;
  tabs.querySelectorAll("[data-active-availability-id]").forEach((button) => {
    button.onclick = () => {
      selectedAvailabilityPatternId = button.dataset.activeAvailabilityId;
      const currentEmployee = employeeById($("employeeId")?.value);
      renderAvailabilityPatternWorkspace(currentEmployee);
      renderAvailabilityEditor(currentEmployee);
    };
  });
  const conflict = availabilityPatternConflicts(patterns);
  const conflictNotice = $("activeAvailabilityConflict");
  if (conflictNotice) {
    conflictNotice.hidden = !conflict;
    conflictNotice.textContent = conflict
      ? `${conflict.left.name} and ${conflict.right.name} overlap on ${displayDate(conflict.date)}. Deactivate or edit one pattern before saving or submitting availability.`
      : "";
  }
}

function availabilityPatternGuidance(pattern) {
  const warnings = [];
  const gaps = [];
  DAYS.forEach((day, dayIndex) => {
    const windows = (pattern?.availability?.[dayIndex] || [])
      .map((range) => ({ start: minutesFromTime(range.start), end: minutesFromTime(range.end) }))
      .filter((range) => range.start != null && range.end != null)
      .sort((a, b) => a.start - b.start);
    windows.forEach((range, index) => {
      if (range.end <= range.start) warnings.push(`${day} has an end time that is not after its start time.`);
      if (index && range.start < windows[index - 1].end) warnings.push(`${day} has overlapping availability windows.`);
      if (index && range.start > windows[index - 1].end) gaps.push(day);
    });
  });
  if (warnings.length) return { text: warnings[0], warning: true };
  const repeat = Number(pattern?.repeatWeeks) || 1;
  const gapText = gaps.length ? ` Intentional gaps: ${gaps.join(", ")}.` : "";
  return { text: `Repeats ${availabilityRepeatLabel(repeat).toLowerCase()}.${gapText} Blank days mean unavailable.`, warning: false };
}

function renderAvailabilityPatternWorkspace(employee = null) {
  const list = $("availabilityPatternList");
  if (!list) return;
  const patterns = availabilityPatternsForEmployee(employee);
  if (selectedAvailabilityPatternId && !patterns.some((pattern) => pattern.id === selectedAvailabilityPatternId)) selectedAvailabilityPatternId = "";
  if (availabilityEditingPatternId && !patterns.some((pattern) => pattern.id === availabilityEditingPatternId)) {
    availabilityEditingPatternId = "";
  }
  const selected = patterns.find((pattern) => pattern.id === selectedAvailabilityPatternId) || null;
  renderActiveAvailabilitySummary(employee, patterns, selected);
  const editButton = $("editAvailabilityPatternBtn");
  if (editButton) {
    editButton.disabled = !selected || selected.active;
    editButton.title = selected?.active
      ? "Use Copy Live to start a replacement without changing the active availability."
      : "Load the selected saved availability into the editor.";
  }
  const deleteButton = $("deleteAvailabilityPatternBtn");
  const selectedStatus = String(selected?.approvalStatus || "").toLowerCase();
  const canDelete = Boolean(selected && !selected.active && !["submitted", "pending", "awaiting_approval"].includes(selectedStatus));
  if (deleteButton) {
    deleteButton.disabled = !canDelete;
    deleteButton.hidden = !canDelete;
  }
  list.innerHTML = patterns.map((pattern) => {
    const dayCount = Object.values(pattern.availability || {}).filter((ranges) => Array.isArray(ranges) && ranges.length).length;
    return `<button type="button" class="availability-pattern-card${pattern.id === selected?.id ? " selected" : ""}${pattern.active ? "" : " inactive"}" data-availability-pattern-id="${escapeHtml(pattern.id)}">
      <strong>${escapeHtml(pattern.name)}</strong>
      <span>${dayCount} available days</span>
      ${pattern.id === selected?.id ? `<div class="availability-pattern-selected-details"><strong>Selected availability</strong><div class="availability-pattern-day-grid">${availabilityDaySummary(pattern.availability)}</div></div>` : ""}
    </button>`;
  }).join("");
  list.querySelectorAll("[data-availability-pattern-id]").forEach((button) => {
    button.onclick = () => {
      selectedAvailabilityPatternId = button.dataset.availabilityPatternId;
      availabilityEditingPatternId = "";
      renderAvailabilityPatternWorkspace(employeeById($("employeeId")?.value));
    };
  });
  if ($("employeeAvailabilityPatternName") && availabilityEditingPatternId) {
    $("employeeAvailabilityPatternName").value = selected?.name || defaultAvailabilityPatternName(employee, availabilityEditingPatternId);
  }
  if ($("employeeAvailabilityRepeatWeeks") && selected) $("employeeAvailabilityRepeatWeeks").value = String(selected.repeatWeeks || 1);
  if ($("employeeAvailabilityEffectiveDate") && selected) $("employeeAvailabilityEffectiveDate").value = normalizeAvailabilityEffectiveDate(selected.effectiveDate || currentWeekKey());
  const submitButton = $("makeAvailabilityLiveBtn");
  if (submitButton) {
    submitButton.disabled = !selected;
    submitButton.textContent = !selected
      ? "Apply"
      : selected.active
      ? "Stop"
      : "Apply";
     submitButton.title = !selected
       ? "Select a saved availability before applying it."
       : selected.active
         ? "Stop using this availability for future scheduling."
         : "Use this saved availability for scheduling from the chosen date.";
    submitButton.classList.toggle("danger", Boolean(selected?.active));
  }
}
function renderAvailabilityEditor(employee = null) {
  const availability = availabilityEditingPatternId
    ? selectedAvailabilityPattern(employee)?.availability || emptyAvailability()
    : emptyAvailability();
  const editorTitle = $("availabilityEditorTitle");
  if (editorTitle) editorTitle.textContent = availabilityEditingPatternId ? "Edit availability" : "New availability";
  selectedAvailabilityDayIndex = Math.max(0, Math.min(DAYS.length - 1, Number(selectedAvailabilityDayIndex) || 0));
  const selectedDay = selectedAvailabilityDayIndex;
  const summaryForDay = (ranges) => {
    if (!ranges.length) return "Not available";
    if (ranges.length > 1) return `${ranges.length} windows`;
    const compactTime = (value) => {
      const time = toNativeTimeValue(value);
      return time
        .replace(/^0/, "")
        .replace(/:00(?=\s)/, "")
        .replace(/\sAM$/, "a")
        .replace(/\sPM$/, "p");
    };
    return `${compactTime(ranges[0].start) || "Not available"} - ${compactTime(ranges[0].end) || "Not available"}`;
  };
  const windowMarkupForDay = (day, index, ranges) => (ranges.length ? ranges : [{}]).map((range, windowIndex) => `
        <div class="availability-window" data-availability-window="${windowIndex}">
          <label class="availability-time-field"><span>Start</span><input type="text" data-time-picker data-availability-day="${index}" data-availability-slot="${windowIndex}" value="${escapeHtml(toNativeTimeValue(range.start))}" placeholder="Not available" aria-label="${day} window ${windowIndex + 1} start time; leave blank if unavailable"></label>
          <span class="availability-time-separator" aria-hidden="true">to</span>
          <label class="availability-time-field"><span>End</span><input type="text" data-time-picker data-availability-day="${index}" data-availability-end-slot="${windowIndex}" value="${escapeHtml(toNativeTimeValue(range.end))}" placeholder="Not available" aria-label="${day} window ${windowIndex + 1} end time; leave blank if unavailable"></label>
          ${windowIndex > 0 ? `<button type="button" class="icon-button availability-remove-window" data-remove-availability-window="${index}" data-availability-window-index="${windowIndex}" aria-label="Remove ${day} window ${windowIndex + 1}" title="Remove this availability window">&times;</button>` : ""}
        </div>`).join("");
  $("availabilityEditor").innerHTML = `
    <div class="availability-day-toolbar">
      <span>Editing <strong>${DAYS[selectedDay]}</strong></span>
      <div class="availability-shared-presets" role="group" aria-label="Presets for the selected day">
        <button type="button" class="small-button" data-availability-editor-preset="open" data-availability-preset="open">Open</button>
        <button type="button" class="small-button" data-availability-editor-preset="am" data-availability-preset="am">AM</button>
        <button type="button" class="small-button" data-availability-editor-preset="pm" data-availability-preset="pm">PM</button>
        <button type="button" class="small-button availability-unavailable-button" data-availability-editor-preset="unavailable" data-availability-preset="unavailable">Unavailable</button>
      </div>
    </div>
    <div class="availability-day-editor-stack">
      ${DAYS.map((day, index) => {
    const ranges = availability[index] || [];
    return `<section class="availability-day${index === selectedDay ? " selected" : ""}" data-availability-row="${index}">
      <div class="availability-day-editor">
        <div class="availability-input-stack">${windowMarkupForDay(day, index, ranges)}<button type="button" class="availability-add-window" data-add-availability-window="${index}">+ Add another time</button></div>
        <small>Leave both times blank if unavailable.</small>
  </div>
    </section>`;
  }).join("")}
    </div>
    <div class="availability-day-strip" role="tablist" aria-label="Choose a day to edit">
      ${DAYS.map((day, index) => {
        const ranges = availability[index] || [];
        return `<button type="button" class="availability-day-select${index === selectedDay ? " selected" : ""}" data-availability-day-select="${index}" role="tab" aria-selected="${index === selectedDay}">
          <strong>${day}</strong><span>${escapeHtml(summaryForDay(ranges))}</span>
        </button>`;
      }).join("")}
    </div>`;
  document.querySelectorAll("[data-availability-day-select]").forEach((button) => {
    button.onclick = () => {
      selectedAvailabilityDayIndex = Number(button.dataset.availabilityDaySelect) || 0;
      document.querySelectorAll("[data-availability-row]").forEach((row) => row.classList.toggle("selected", Number(row.dataset.availabilityRow) === selectedAvailabilityDayIndex));
      document.querySelectorAll("[data-availability-day-select]").forEach((dayButton) => {
        const selected = Number(dayButton.dataset.availabilityDaySelect) === selectedAvailabilityDayIndex;
        dayButton.classList.toggle("selected", selected);
        dayButton.setAttribute("aria-selected", String(selected));
      });
      const label = $("availabilityEditor").querySelector(".availability-day-toolbar strong");
      if (label) label.textContent = DAYS[selectedAvailabilityDayIndex];
    };
  });
  document.querySelectorAll("[data-availability-editor-preset]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      setAvailabilityPreset(
        `[data-availability-day="${selectedAvailabilityDayIndex}"][data-availability-slot="0"]`,
        selectedAvailabilityDayIndex,
        button.dataset.availabilityEditorPreset
      );
      const summary = document.querySelector(`[data-availability-day-select="${selectedAvailabilityDayIndex}"] span`);
      if (summary) summary.textContent = button.dataset.availabilityEditorPreset === "unavailable" ? "Not available" : button.textContent;
      refreshAvailabilityDayCardSummaries();
    };
  });
  document.querySelectorAll("#availabilityEditor [data-time-picker]").forEach(attachTimePickerInput);
  document.querySelectorAll("[data-add-availability-window]").forEach((button) => {
    button.onclick = () => {
      const row = button.closest(".availability-day");
      if (!row || row.querySelectorAll(".availability-window").length >= 4) return;
      const day = button.dataset.addAvailabilityWindow;
      const windowIndex = row.querySelectorAll(".availability-window").length;
      button.insertAdjacentHTML("beforebegin", `<div class="availability-window" data-availability-window="${windowIndex}"><label class="availability-time-field"><span>Start</span><input type="text" data-time-picker data-availability-day="${day}" data-availability-slot="${windowIndex}" aria-label="${DAYS[day]} window ${windowIndex + 1} start time"></label><span class="availability-time-separator" aria-hidden="true">to</span><label class="availability-time-field"><span>End</span><input type="text" data-time-picker data-availability-day="${day}" data-availability-end-slot="${windowIndex}" aria-label="${DAYS[day]} window ${windowIndex + 1} end time"></label><button type="button" class="icon-button availability-remove-window" data-remove-availability-window="${day}" data-availability-window-index="${windowIndex}" aria-label="Remove ${DAYS[day]} window ${windowIndex + 1}" title="Remove this availability window">&times;</button></div>`);
      row.querySelector("[data-remove-availability-window]:last-of-type")?.addEventListener("click", () => {
        const added = row.querySelectorAll(".availability-window");
        if (added.length <= 1) return;
        added[added.length - 1].remove();
        button.hidden = false;
      });
      row.querySelectorAll("[data-time-picker]").forEach(attachTimePickerInput);
      wireAvailabilityTabFlow("[data-availability-day]");
      wireAvailabilityDaySummaryUpdates();
      if (row.querySelectorAll(".availability-window").length >= 4) button.hidden = true;
    };
  });
  document.querySelectorAll("[data-remove-availability-window]").forEach((button) => {
    button.onclick = () => {
      const row = button.closest(".availability-day");
      const window = button.closest(".availability-window");
      if (!row || !window || row.querySelectorAll(".availability-window").length <= 1) return;
      window.remove();
      const addButton = row.querySelector("[data-add-availability-window]");
      if (addButton) addButton.hidden = false;
      refreshAvailabilityDayCardSummaries();
    };
  });
  wireAvailabilityTabFlow("[data-availability-day]");
  wireAvailabilityDaySummaryUpdates();
}

function renderWeeklyAvailabilityEditor(employee = null) {
  const weekKey = selectedWeeklyAvailabilityWeekKey();
  const input = $("weeklyAvailabilityWeek");
  if (input) input.value = weekKey;
  const summary = $("weeklyAvailabilityWeekSummary");
  if (summary) summary.textContent = `Showing the work week of ${displayDate(parseDateKey(weekKey))}. All dates are aligned to the restaurant's week-start setting.`;
  const availability = employee?.weeklyAvailability?.[weekKey] || emptyAvailability();
  $("weeklyAvailabilityEditor").innerHTML = DAYS.map((day, index) => {
    const ranges = availability[index] || [];
    const windowMarkup = (ranges.length ? ranges : [{}]).map((range, windowIndex) => `
          <div class="availability-window" data-availability-window="${windowIndex}">
            <label class="availability-time-field"><span>Start</span><input type="text" data-time-picker data-weekly-availability-day="${index}" data-availability-slot="${windowIndex}" value="${escapeHtml(toNativeTimeValue(range.start))}" placeholder="Not available" aria-label="${day} window ${windowIndex + 1} start time; leave blank if unavailable"></label>
            <span class="availability-time-separator" aria-hidden="true">to</span>
            <label class="availability-time-field"><span>End</span><input type="text" data-time-picker data-weekly-availability-day="${index}" data-availability-end-slot="${windowIndex}" value="${escapeHtml(toNativeTimeValue(range.end))}" placeholder="Not available" aria-label="${day} window ${windowIndex + 1} end time; leave blank if unavailable"></label>
            ${windowIndex > 0 ? `<button type="button" class="icon-button availability-remove-window" data-remove-weekly-window="${index}" aria-label="Remove ${day} window ${windowIndex + 1}" title="Remove this availability window">&times;</button>` : ""}
          </div>`).join("");
    const dayDate = availabilityDayDateLabel(index, weekKey);
    return `
      <section class="availability-day weekly-availability-day">
        <div class="availability-day-heading">
          <strong>${day}</strong>
          <span>${escapeHtml(dayDate)}</span>
        </div>
        <div class="availability-day-editor">
          <div class="availability-input-stack">${windowMarkup}<button type="button" class="availability-add-window" data-add-weekly-window="${index}">+ Add another time</button></div>
          <small>Leave both times blank if unavailable.</small>
          <div class="availability-shared-presets weekly-day-presets" role="group" aria-label="${day} availability presets">
            <button type="button" class="small-button" data-weekly-availability-preset="open" data-weekly-availability-preset-day="${index}">Open</button>
            <button type="button" class="small-button" data-weekly-availability-preset="am" data-weekly-availability-preset-day="${index}">AM</button>
            <button type="button" class="small-button" data-weekly-availability-preset="pm" data-weekly-availability-preset-day="${index}">PM</button>
            <button type="button" class="small-button availability-unavailable-button" data-weekly-availability-preset="unavailable" data-weekly-availability-preset-day="${index}">Unavailable</button>
          </div>
        </div>
      </section>
    `;
  }).join("");
  document.querySelectorAll("[data-weekly-availability-preset]").forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setAvailabilityPreset(
      `[data-weekly-availability-day="${button.dataset.weeklyAvailabilityPresetDay}"][data-availability-slot="0"]`,
      button.dataset.weeklyAvailabilityPresetDay,
      button.dataset.weeklyAvailabilityPreset,
      weekKey
        );
      };
  });
  document.querySelectorAll("#weeklyAvailabilityEditor [data-time-picker]").forEach(attachTimePickerInput);
  document.querySelectorAll("[data-add-weekly-window]").forEach((button) => {
    button.onclick = () => {
      const row = button.closest(".availability-day");
      if (!row || row.querySelectorAll(".availability-window").length >= 4) return;
      const day = button.dataset.addWeeklyWindow;
      const windowIndex = row.querySelectorAll(".availability-window").length;
      button.insertAdjacentHTML("beforebegin", `<div class="availability-window" data-availability-window="${windowIndex}"><label class="availability-time-field"><span>Start</span><input type="text" data-time-picker data-weekly-availability-day="${day}" data-availability-slot="${windowIndex}" aria-label="${DAYS[day]} window ${windowIndex + 1} start time"></label><span class="availability-time-separator" aria-hidden="true">to</span><label class="availability-time-field"><span>End</span><input type="text" data-time-picker data-weekly-availability-day="${day}" data-availability-end-slot="${windowIndex}" aria-label="${DAYS[day]} window ${windowIndex + 1} end time"></label><button type="button" class="icon-button availability-remove-window" data-remove-weekly-window="${day}" aria-label="Remove ${DAYS[day]} window ${windowIndex + 1}" title="Remove this availability window">&times;</button></div>`);
      row.querySelector("[data-remove-weekly-window]:last-of-type")?.addEventListener("click", () => {
        const added = row.querySelectorAll(".availability-window");
        if (added.length <= 1) return;
        added[added.length - 1].remove();
        button.hidden = false;
      });
      if (row.querySelectorAll(".availability-window").length >= 4) button.hidden = true;
    };
  });
  document.querySelectorAll("[data-remove-weekly-window]").forEach((button) => {
    button.onclick = () => {
      const window = button.closest(".availability-window");
      const row = button.closest(".availability-day");
      if (!window || !row || row.querySelectorAll(".availability-window").length <= 1) return;
      window.remove();
      row.querySelector("[data-add-weekly-window]")?.removeAttribute("hidden");
    };
  });
      wireAvailabilityTabFlow("[data-weekly-availability-day]");
}

function wireAvailabilityTabFlow(selector) {
  const inputs = Array.from(document.querySelectorAll(selector));
  inputs.forEach((input, index) => {
    input.onkeydown = (event) => {
      if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
      const nextIndex = event.shiftKey ? index - 1 : index + 1;
      const nextInput = inputs[nextIndex];
      if (!nextInput) return;
      event.preventDefault();
      nextInput.focus();
      nextInput.select?.();
    };
  });
}

function renderWeeklyRuleEditor(employee = null) {
  const rules = employee?.weeklyRules || [];
  $("weeklyRuleEditor").innerHTML = rules.map((rule) => weeklyRuleRow(rule)).join("");
  if (!rules.length) {
    $("weeklyRuleEditor").innerHTML = `<p class="hint">No weekly work rules yet.</p>`;
  }
  wireWeeklyRuleButtons();
}

function weeklyRuleRow(rule = {}) {
  const days = (rule.days || [5, 6, 0]).map(Number);
  return `
    <div class="weekly-rule-row">
      <label>Applies To
        <div class="day-checks">
          ${DAYS.map((day, index) => `
            <label class="day-chip"><input type="checkbox" data-rule-day value="${index}" ${days.includes(index) ? "checked" : ""}> ${day.slice(0, 3)}</label>
          `).join("")}
        </div>
      </label>
      <label>Max days <input type="number" min="1" step="1" data-rule-max value="${rule.maxWorkDays || 2}"></label>
      <label>Note <input data-rule-note value="${rule.note || ""}" placeholder="Needs one day off"></label>
      <button type="button" class="small-button danger" data-remove-rule>Remove</button>
    </div>
  `;
}

function wireWeeklyRuleButtons() {
  document.querySelectorAll("[data-remove-rule]").forEach((button) => {
    button.onclick = () => {
      button.closest(".weekly-rule-row").remove();
      if (!document.querySelector(".weekly-rule-row")) {
        $("weeklyRuleEditor").innerHTML = `<p class="hint">No weekly work rules yet.</p>`;
      }
    };
  });
}

function addWeeklyRuleRow() {
  markEmployeeFormDirty();
  const placeholder = $("weeklyRuleEditor").querySelector(".hint");
  if (placeholder) $("weeklyRuleEditor").innerHTML = "";
  $("weeklyRuleEditor").insertAdjacentHTML("beforeend", weeklyRuleRow());
  wireWeeklyRuleButtons();
}

function setAvailabilityInputs(selector, value) {
  markEmployeeFormDirty();
  document.querySelectorAll(selector).forEach((input) => {
    input.value = value;
  });
}

function wireAvailabilityDaySummaryUpdates() {
  document.querySelectorAll("#availabilityEditor [data-availability-day]").forEach((input) => {
    if (input.dataset.summaryWired === "true") return;
    input.dataset.summaryWired = "true";
    input.addEventListener("input", refreshAvailabilityDayCardSummaries);
    input.addEventListener("change", refreshAvailabilityDayCardSummaries);
  });
  refreshAvailabilityDayCardSummaries();
}

function refreshAvailabilityDayCardSummaries() {
  document.querySelectorAll("#availabilityEditor [data-availability-row]").forEach((row) => {
    const windows = Array.from(row.querySelectorAll(".availability-window")).map((window) => ({
      start: window.querySelector('[data-availability-slot]')?.value.trim() || "",
      end: window.querySelector('[data-availability-end-slot]')?.value.trim() || ""
    })).filter((range) => range.start && range.end);
    const summary = document.querySelector(`[data-availability-day-select="${row.dataset.availabilityRow}"] span`);
    if (!summary) return;
    summary.textContent = !windows.length
      ? "Not available"
      : windows.length > 1
        ? `${windows.length} availability windows`
        : `${windows[0].start} to ${windows[0].end}`;
  });
}

function parseWeeklyRules() {
  return Array.from(document.querySelectorAll(".weekly-rule-row")).map((row) => ({
    days: Array.from(row.querySelectorAll("[data-rule-day]:checked")).map((input) => Number(input.value)),
    maxWorkDays: Number(row.querySelector("[data-rule-max]").value) || 0,
    note: row.querySelector("[data-rule-note]").value.trim()
  })).filter((rule) => rule.days.length && rule.maxWorkDays);
}

function collectEmployeePayRates() {
  const payRates = {};
  state.roles.forEach((role) => {
    const override = document.querySelector(`[data-pay-override="${role.id}"]`)?.checked || false;
    const rate = Number(document.querySelector(`[data-pay-rate="${role.id}"]`)?.value) || 0;
    if (override) payRates[role.id] = { override, rate };
  });
  return payRates;
}

function parseAvailability() {
  const availability = emptyAvailability();
  document.querySelectorAll("[data-availability-day][data-availability-slot]").forEach((input) => {
    const day = input.dataset.availabilityDay;
    const window = input.closest(".availability-window");
    const end = window?.querySelector("[data-availability-end-slot]")?.value || "";
    if (input.value.trim() && end.trim()) availability[day].push({ start: normalizeTime(input.value), end: normalizeTime(end) });
  });
  return availability;
}

function populateAvailabilityEditor(availability = {}) {
  setAvailabilityInputs("[data-availability-day]", "");
  Object.entries(availability || {}).forEach(([day, ranges]) => {
    (ranges || []).forEach((range, index) => {
      if (index === 0) setAvailabilityPreset(`[data-availability-day="${day}"][data-availability-slot="0"]`, Number(day), "open");
      const row = document.querySelector(`[data-availability-row="${day}"]`);
      const add = row?.querySelector("[data-add-availability-window]");
      while (row && row.querySelectorAll(".availability-window").length <= index && add) add.click();
      const window = row?.querySelectorAll(".availability-window")[index];
      if (!window) return;
      window.querySelector("[data-availability-slot]").value = toNativeTimeValue(range.start);
      window.querySelector("[data-availability-end-slot]").value = toNativeTimeValue(range.end);
    });
  });
  refreshAvailabilityDayCardSummaries();
}

function parseWeeklyAvailability() {
  const availability = emptyAvailability();
  document.querySelectorAll("[data-weekly-availability-day][data-availability-slot]").forEach((input) => {
    const day = input.dataset.weeklyAvailabilityDay;
    const window = input.closest(".availability-window");
    const end = window?.querySelector("[data-availability-end-slot]")?.value || "";
    if (input.value.trim() && end.trim()) availability[day].push({ start: normalizeTime(input.value), end: normalizeTime(end) });
  });
  return availability;
}

function loadEmployee(id) {
  const employee = employeeById(id);
  if (!employee) return;
  employeeFormHydrating = true;
  employeeFormDirty = false;
  selectedAvailabilityPatternId = "";
  availabilityEditingPatternId = "";
  employeeNewProfileDraft = false;
  $("employeeId").value = employee.id;
  $("firstName").value = employee.firstName;
  $("lastName").value = employee.lastName;
  $("employeeNickname").value = employee.nickname || "";
  $("employeeBirthday").value = employee.birthday || "";
  $("employeePhone").value = formatPhoneNumber(employee.phone || "");
  bindPhoneFormatter($("employeePhone"));
  $("employeeManagerNotes").value = employee.managerNotes || "";
  $("employeeActive").checked = employee.active !== false;
  $("employeeCanClose").checked = Boolean(employee.canClose);
  $("employeeCanLunchClose").checked = Boolean(employee.canLunchClose);
  $("employeeNoDoubles").checked = Boolean(employee.noDoubles);
  $("employeeAlwaysPrintEndTime").checked = Boolean(employee.alwaysPrintFloorEndTime);
  setCheckedValues("employeeDepartments", normalizeEmployeeDepartments(employee));
  $("employeeCallWeekly").checked = Boolean(employee.callWeekly);
  $("employeeAvailabilityEffectiveDate").value = normalizeAvailabilityEffectiveDate(employee.availabilityEffectiveDate || currentWeekKey());
  $("employeeAvailabilityPatternName").value = defaultAvailabilityPatternName(employee);
  $("employeeAvailabilityRepeatWeeks").value = String(employee.availabilityRepeatWeeks || 1);
  syncEmployeeAvailabilityMode();
  setWeeklyAvailabilityWeek(employeeWeeklyAvailabilityWeekKey || currentWeekKey(), { render: false });
  renderEmployeePayRates(employee);
  setCheckedValues("mealTraining", employee.mealTraining || []);
  setCheckedValues("roleTraining", employee.roleTraining || []);
  setCheckedValues("emergencyRoleIds", employee.emergencyRoleIds || []);
  setRoleMealTrainingValues(employee.roleMealTraining || {});
  setCheckedValues("trainerRoles", employee.trainerRoles || []);
  renderAvailabilityPatternWorkspace(employee);
  renderAvailabilityEditor(employee);
  renderWeeklyAvailabilityEditor(employee);
  hydrateEmployeeAvailabilitySubmissions(employee);
  renderWeeklyRuleEditor(employee);
  updateStickyEmployeeName();
  employeeFormHydrating = false;
  markEmployeeFormClean();
}

function updateStickyEmployeeName() {
  const employee = employeeById($("employeeId")?.value);
  const typedName = `${$("firstName")?.value || ""} ${$("lastName")?.value || ""}`.trim();
  const name = employee ? fullEmployeeName(employee) : typedName || "Unsaved employee";
  const label = $("stickyEmployeeName");
  if (label) label.textContent = name;
  const title = $("employeeProfileTitle");
  if (title) title.textContent = name;
}

function activateEmployeeProfileTab(tabName = "profile") {
  const tabs = Array.from(document.querySelectorAll("[data-employee-profile-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-employee-profile-panel]"));
  const target = panels.some((panel) => panel.dataset.employeeProfilePanel === tabName) ? tabName : "profile";
  tabs.forEach((tab) => {
    const active = tab.dataset.employeeProfileTab === target;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.employeeProfilePanel !== target;
  });
}

function resetEmployeeForm() {
  employeeFormHydrating = true;
  employeeFormDirty = false;
  employeeNewProfileDraft = true;
  $("employeeForm").reset();
  $("employeeId").value = "";
  $("employeeActive").checked = true;
  $("employeeCanClose").checked = false;
  $("employeeCanLunchClose").checked = false;
  $("employeeNoDoubles").checked = false;
  $("employeeAlwaysPrintEndTime").checked = false;
  setCheckedValues("employeeDepartments", ["FOH"]);
  $("employeeBirthday").value = "";
  $("employeeManagerNotes").value = "";
  $("employeeCallWeekly").checked = false;
  $("employeeAvailabilityEffectiveDate").value = currentWeekKey();
  syncEmployeeAvailabilityMode();
  setWeeklyAvailabilityWeek(currentWeekKey(), { render: false });
  renderEmployeePayRates();
  renderAvailabilityEditor();
  renderWeeklyAvailabilityEditor();
  renderWeeklyRuleEditor();
  setCheckedValues("emergencyRoleIds", []);
  setRoleMealTrainingValues({});
  activateEmployeeProfileTab("profile");
  employeeFormHydrating = false;
  markEmployeeFormClean();
}

function renderTemplates() {
  const selectedTemplateId = $("templateId")?.value || "";
  const selectedShiftId = $("templateShiftId")?.value || "";
  $("templateList").innerHTML = state.templates.map((template) => {
    const isExpanded = expandedTemplateSets.has(template.id);
    const dayCounts = DAYS.map((day, dayIndex) => ({
      day,
      dayIndex,
      count: (template.shifts || []).filter((shift) => Number(shift.dayIndex) === dayIndex).length
    }));
    const totalHours = (template.shifts || []).reduce((sum, shift) => sum + shiftDurationHours(shift), 0);
    return `
    <div class="template-set ${selectedTemplateId === template.id ? "selected" : ""}">
      <div class="template-set-title">
        <button type="button" class="template-expand-button" aria-label="${isExpanded ? "Collapse" : "Expand"} ${escapeHtml(template.name)}" data-template-toggle="${template.id}">${isExpanded ? "-" : "+"}</button>
        <button type="button" class="template-title-button ${selectedTemplateId === template.id && !selectedShiftId ? "selected" : ""}" data-template-load="${template.id}"><strong>${template.name}</strong></button>
        <small>${template.shifts?.length || 0} shift${template.shifts?.length === 1 ? "" : "s"}${totalHours ? ` / ${roundHours(totalHours)} hrs` : ""}</small>
        <button type="button" class="small-button template-primary-action" data-template-add-all="${template.id}">Add to Bay</button>
        <button type="button" class="small-button danger template-delete-action" data-template-delete="${template.id}">Delete Template</button>
      </div>
      <div class="template-day-summary" aria-label="Template day counts">
        ${dayCounts.map((item) => `<button type="button" class="${item.count ? "has-shifts" : ""}" data-template-day-jump="${template.id}:${item.dayIndex}" title="${item.day}: ${item.count} shift${item.count === 1 ? "" : "s"}"><span>${item.day.slice(0, 3)}</span><strong>${item.count}</strong></button>`).join("")}
      </div>
      <div class="template-week-list" ${isExpanded ? "" : "hidden"}>
        ${DAYS.map((day, dayIndex) => {
          const shifts = (template.shifts || [])
            .filter((shift) => Number(shift.dayIndex) === dayIndex)
            .sort((a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0));
          const dayKey = templateDayCollapseKey(template.id, dayIndex);
          const dayCollapsed = collapsedTemplateDays.has(dayKey);
          return `
            <section class="template-day-group ${dayCollapsed ? "collapsed" : ""}">
              <button type="button" class="template-day-toggle" data-template-day-toggle="${template.id}:${dayIndex}" aria-expanded="${dayCollapsed ? "false" : "true"}" title="${dayCollapsed ? "Expand" : "Collapse"} ${day}">
                <span>${day}</span>
                <strong>${shifts.length} shift${shifts.length === 1 ? "" : "s"}</strong>
                <em>${dayCollapsed ? "+" : "-"}</em>
              </button>
              <div class="template-day-shifts" ${dayCollapsed ? "hidden" : ""}>
              ${shifts.map((shift) => {
                const role = roleById(shift.roleId);
                return `
                  <div class="entity-item template-shift-item ${selectedTemplateId === template.id && selectedShiftId === shift.id ? "selected" : ""}" data-template-id="${template.id}" data-template-shift-id="${shift.id}">
                    <span class="template-shift-color" style="background:${shiftColor(shift)};"></span>
                    <div>
                      <strong>${role?.name || "No role"}${shift.isCloser ? " | Closer" : ""}${shift.isFlexDouble ? " | Flex Double" : ""}</strong>
                      <small>${shift.department} | ${shift.start}-${shift.untilVolume ? "Until Volume" : shift.end}</small>
                    </div>
                    <div class="template-shift-actions">
                      <button type="button" class="icon-button" title="Duplicate shift" aria-label="Duplicate shift" data-template-shift-copy="${template.id}:${shift.id}">+</button>
                      <button type="button" class="icon-button danger" title="Delete shift" aria-label="Delete shift" data-template-shift-delete="${template.id}:${shift.id}">X</button>
                    </div>
                  </div>
                `;
              }).join("") || `<p class="hint">No regular shifts.</p>`}
              </div>
            </section>
          `;
        }).join("")}
      </div>
    </div>
  `;
  }).join("") || `<p class="hint">No weekly templates yet. Name a template and save the first shift to start one.</p>`;
  document.querySelectorAll("[data-template-toggle]").forEach((button) => button.onclick = () => toggleTemplateSet(button.dataset.templateToggle));
  document.querySelectorAll("[data-template-load]").forEach((button) => button.onclick = () => loadTemplate(button.dataset.templateLoad));
  document.querySelectorAll("[data-template-add-all]").forEach((button) => button.onclick = async () => addTemplateToTray(button.dataset.templateAddAll));
  document.querySelectorAll("[data-template-delete]").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      armDeleteButton(button, () => deleteTemplate(button.dataset.templateDelete));
    };
  });
  document.querySelectorAll("[data-template-day-jump]").forEach((button) => button.onclick = () => expandTemplateAtDay(button.dataset.templateDayJump));
  document.querySelectorAll("[data-template-day-toggle]").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      toggleTemplateDay(button.dataset.templateDayToggle);
    };
  });
  document.querySelectorAll("[data-template-shift-id]").forEach((item) => item.onclick = () => loadTemplateShift(item.dataset.templateId, item.dataset.templateShiftId));
  document.querySelectorAll("[data-template-shift-copy]").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      const [templateId, shiftId] = button.dataset.templateShiftCopy.split(":");
      duplicateTemplateShift(templateId, shiftId);
    };
  });
  document.querySelectorAll("[data-template-shift-delete]").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      armDeleteButton(button, () => {
        const [templateId, shiftId] = button.dataset.templateShiftDelete.split(":");
        deleteTemplateShift(templateId, shiftId);
      });
    };
  });
}

function shiftDurationHours(shift = {}) {
  if (shift.untilVolume) return 0;
  const start = minutesFromTime(shift.start);
  const end = minutesFromTime(shift.end);
  if (start == null || end == null) return 0;
  const adjustedEnd = end < start ? end + 24 * 60 : end;
  return Math.max(0, adjustedEnd - start) / 60;
}

function roundHours(hours) {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function toggleTemplateDay(value = "") {
  const [templateId, dayIndex] = value.split(":");
  if (!templateId) return;
  const key = templateDayCollapseKey(templateId, dayIndex);
  if (collapsedTemplateDays.has(key)) collapsedTemplateDays.delete(key);
  else collapsedTemplateDays.add(key);
  expandedTemplateSets.add(templateId);
  saveCollapsedTemplateDays();
  saveExpandedTemplateSets();
  renderTemplates();
}

function expandTemplateAtDay(value = "") {
  const [templateId, dayIndex] = value.split(":");
  if (!templateId) return;
  expandedTemplateSets.add(templateId);
  collapsedTemplateDays.delete(templateDayCollapseKey(templateId, dayIndex));
  saveExpandedTemplateSets();
  saveCollapsedTemplateDays();
  loadTemplate(templateId);
  $("templateDay").value = dayIndex || String(state.settings.weekStart ?? 2);
}

function duplicateTemplateShift(templateId, shiftId) {
  const template = templateById(templateId);
  const shift = template?.shifts?.find((item) => item.id === shiftId);
  if (!template || !shift) return;
  pushUndo();
  const copy = { ...JSON.parse(JSON.stringify(shift)), id: uid("templateShift") };
  const index = template.shifts.findIndex((item) => item.id === shiftId);
  template.shifts.splice(index + 1, 0, copy);
  $("templateId").value = template.id;
  $("templateShiftId").value = copy.id;
  $("templateName").value = template.name;
  expandedTemplateSets.add(template.id);
  saveExpandedTemplateSets();
  saveState();
  loadTemplateShift(template.id, copy.id);
  showConflict(`Duplicated ${roleById(copy.roleId)?.name || "template shift"} on ${DAYS[Number(copy.dayIndex)]}.`);
}

function deleteTemplateShift(templateId, shiftId) {
  const template = templateById(templateId);
  if (!template) return;
  pushUndo();
  template.shifts = (template.shifts || []).filter((shift) => shift.id !== shiftId);
  if (!template.shifts.length) {
    state.templates = state.templates.filter((item) => item.id !== template.id);
    $("templateForm").reset();
    clearTemplateShiftFields(true);
  } else {
    $("templateId").value = template.id;
    $("templateShiftId").value = "";
    $("templateName").value = template.name;
    clearTemplateShiftFields(false);
  }
  saveState();
  renderAll();
}

function deleteTemplate(templateId) {
  const template = templateById(templateId);
  if (!template) return;
  pushUndo();
  state.templates = state.templates.filter((item) => item.id !== templateId);
  expandedTemplateSets.delete(templateId);
  [...collapsedTemplateDays].forEach((key) => { if (key.startsWith(`${templateId}:`)) collapsedTemplateDays.delete(key); });
  saveExpandedTemplateSets();
  saveCollapsedTemplateDays();
  if ($("templateId").value === templateId) {
    $("templateForm").reset();
    clearTemplateShiftFields(true);
  }
  saveState();
  renderAll();
  showConflict(`Deleted template ${template.name}.`);
}

function toggleTemplateSet(templateId) {
  if (!templateId) return;
  if (expandedTemplateSets.has(templateId)) expandedTemplateSets.delete(templateId);
  else expandedTemplateSets.add(templateId);
  saveExpandedTemplateSets();
  renderTemplates();
}

function loadTemplate(id) {
  const template = templateById(id);
  if (!template) return;
  $("templateId").value = template.id;
  $("templateShiftId").value = "";
  $("templateName").value = template.name;
  expandedTemplateSets.add(template.id);
  saveExpandedTemplateSets();
  clearTemplateShiftFields(false);
  $("deleteTemplateBtn").textContent = "Delete Entire Template";
  renderTemplates();
}

function loadTemplateShift(id, shiftId) {
  const template = templateById(id);
  const shift = template?.shifts?.find((item) => item.id === shiftId);
  if (!template || !shift) return;
  $("templateId").value = template.id;
  $("templateShiftId").value = shift.id;
  $("templateName").value = template.name;
  expandedTemplateSets.add(template.id);
  saveExpandedTemplateSets();
  $("templateDay").value = String(shift.dayIndex);
  $("templateDepartment").value = shift.department;
  $("templateRole").value = shift.roleId;
  $("templateStart").value = shift.start;
  $("templateEnd").value = shift.untilVolume ? "" : shift.end;
  $("templateUntilVolume").checked = Boolean(shift.untilVolume);
  $("templateIsCloser").checked = Boolean(shift.isCloser);
  $("templateFlexDouble").checked = Boolean(shift.isFlexDouble);
  $("templateColor").value = shift.color || roleById(shift.roleId)?.color || "#2563eb";
  $("deleteTemplateBtn").textContent = "Delete Selected Shift";
  renderTemplates();
}

function clearTemplateShiftFields(clearTemplate = false) {
  const templateId = $("templateId").value;
  const templateName = $("templateName").value;
  $("templateShiftId").value = "";
  if (clearTemplate) {
    $("templateId").value = "";
    $("templateName").value = "";
  } else {
    $("templateId").value = templateId;
    $("templateName").value = templateName;
  }
  $("templateDay").value = String(state.settings.weekStart ?? 2);
  $("templateDepartment").value = "FOH";
  const firstFohRole = state.roles.find((role) => role.department === "FOH") || state.roles[0];
  if (firstFohRole) {
    $("templateRole").value = firstFohRole.id;
    $("templateColor").value = firstFohRole.color || "#2563eb";
  } else {
    $("templateColor").value = "#2563eb";
  }
  $("templateStart").value = "";
  $("templateEnd").value = "";
  $("templateUntilVolume").checked = false;
  $("templateIsCloser").checked = false;
  $("templateFlexDouble").checked = false;
  $("deleteTemplateBtn").textContent = clearTemplate || !$("templateId").value ? "Delete Selected Shift" : "Delete Entire Template";
}

function renderSettings() {
  $("weekStart").value = String(state.settings.weekStart);
  $("nameDisplay").value = state.settings.nameDisplay;
  $("staffingBuffer").value = Number(state.settings.staffingBuffer) || 0;
  $("dragScrollSpeed").value = Number(state.settings.dragScrollSpeed) || 5;
  $("ignoreWarnings").checked = Boolean(state.settings.ignoreWarnings);
  $("showUntilVolumeInShiftEditor").checked = Boolean(state.settings.showUntilVolumeInShiftEditor);
  $("showShiftNameFields").checked = Boolean(state.settings.showShiftNameFields);
  updateShiftNameVisibility();
  $("autoSetCloserEndTime").checked = state.settings.autoSetCloserEndTime !== false;
  $("closerEndBufferMinutes").value = String(Number(state.settings.closerEndBufferMinutes ?? 60));
  $("floorPlanCleanupMinutes").value = String(Number(state.settings.floorPlanCleanupMinutes ?? 90));
  $("flexDoubleEndTime").value = normalizeTime(state.settings.flexDoubleEndTime || "7:00 PM");
  $("lunchCloserEndTime").value = normalizeTime(state.settings.lunchCloserEndTime || "5:00 PM");
  $("closerTrainingRule").value = state.settings.closerTrainingRule || "onePerDay";
  $("departmentChecks").innerHTML = DEPARTMENTS.map((department) => `
    <label class="checkbox"><input type="checkbox" name="visibleDepartmentSetting" value="${department}" ${state.settings.visibleDepartments.includes(department) ? "checked" : ""}> ${department}</label>
  `).join("");
  renderScheduleRoleOrderEditor();
  renderMealHoursEditor();
  renderDefaultCoverageEditor();
  renderCloserRequirementsEditor();
  renderProjectionRulesEditor();
  renderFloorPlanPrintRulesEditor();
  renderFloorPlanNoteSettingsEditor();
  renderTrainingSettingsEditor();
  renderDismissedIssueSettings();
  setupSettingsCollapsibles();
}

function loadCollapsedSettingsSections() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_SETTINGS_SECTIONS_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedSettingsSections(collapsed) {
  try {
    localStorage.setItem(COLLAPSED_SETTINGS_SECTIONS_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Settings sections still collapse for this session if local storage is unavailable.
  }
}

function settingsSectionKey(fieldset, index) {
  const legendText = fieldset.querySelector("legend")?.textContent?.trim() || `section-${index}`;
  return legendText.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `section-${index}`;
}

function setupSettingsCollapsibles() {
  const fieldsets = Array.from(document.querySelectorAll("#settings .settings-editor > fieldset"));
  const collapsed = loadCollapsedSettingsSections();
  fieldsets.forEach((fieldset, index) => {
    const legend = fieldset.querySelector("legend");
    if (!legend) return;
    const key = settingsSectionKey(fieldset, index);
    fieldset.dataset.settingsSection = key;
    fieldset.classList.add("settings-collapsible-section");
    fieldset.classList.toggle("settings-section-collapsed", collapsed.has(key));
    if (!legend.querySelector(".settings-collapse-toggle")) {
      const title = legend.textContent.trim();
      legend.textContent = "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-collapse-toggle";
      button.innerHTML = `<span>${escapeHtml(title)}</span><strong aria-hidden="true"></strong>`;
      legend.append(button);
    }
    const button = legend.querySelector(".settings-collapse-toggle");
    button.setAttribute("aria-expanded", collapsed.has(key) ? "false" : "true");
    button.onclick = () => {
      const nextCollapsed = !fieldset.classList.contains("settings-section-collapsed");
      fieldset.classList.toggle("settings-section-collapsed", nextCollapsed);
      button.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
      const next = loadCollapsedSettingsSections();
      if (nextCollapsed) next.add(key);
      else next.delete(key);
      saveCollapsedSettingsSections(next);
    };
  });
}

function renderDismissedIssueSettings() {
  const target = $("dismissedIssuesEditor");
  if (!target) return;
  if (!dismissedScheduleIssues.length) {
    target.innerHTML = `<p class="hint">No dismissed notifications.</p>`;
    return;
  }
  target.innerHTML = dismissedScheduleIssues.slice().reverse().map((item) => `
    <div class="dismissed-issue-row">
      <span>${escapeHtml(item.message || "Dismissed notification")}</span>
      <button type="button" data-restore-issue="${escapeHtml(item.id)}">Restore</button>
    </div>
  `).join("");
  target.querySelectorAll("[data-restore-issue]").forEach((button) => {
    button.onclick = () => restoreDismissedIssue(button.dataset.restoreIssue);
  });
}

function renderMealHoursEditor() {
  $("mealHoursEditor").innerHTML = DAYS.map((day, dayIndex) => {
    const periods = state.settings.mealPeriods?.[dayIndex] || [];
    const rows = MEALS.map((meal) => {
      const period = periods.find((item) => item.name === meal) || {};
      return `
        <div class="meal-hour-row">
          <label class="checkbox"><input type="checkbox" data-meal-enabled="${dayIndex}:${meal}" ${period.name ? "checked" : ""}> ${meal}</label>
          <input data-meal-start="${dayIndex}:${meal}" placeholder="Start" value="${period.start || ""}">
          <input data-meal-end="${dayIndex}:${meal}" placeholder="End" value="${period.end || ""}">
        </div>
      `;
    }).join("");
    return `<section class="settings-day"><h3>${day}</h3>${rows}</section>`;
  }).join("");
  document.querySelectorAll("[data-meal-start], [data-meal-end]").forEach(attachTimePickerInput);
}

function collectMealPeriods() {
  const periods = {};
  DAYS.forEach((_, dayIndex) => {
    periods[dayIndex] = MEALS.map((meal) => {
      const enabled = document.querySelector(`[data-meal-enabled="${dayIndex}:${meal}"]`)?.checked;
      const start = normalizeTime(document.querySelector(`[data-meal-start="${dayIndex}:${meal}"]`)?.value);
      const end = normalizeTime(document.querySelector(`[data-meal-end="${dayIndex}:${meal}"]`)?.value);
      return enabled && start && end ? { name: meal, start, end } : null;
    }).filter(Boolean);
  });
  return periods;
}

function renderDefaultCoverageEditor() {
  const roles = fohRoles();
  $("defaultCoverageEditor").innerHTML = DAYS.map((day, dayIndex) => {
    const dateForDay = formatDateKey(addDays(startOfWeek(new Date(), 0), dayIndex));
    const periods = state.settings.mealPeriods?.[dayIndex] || getMealPeriodsForDate(dateForDay);
    const rows = periods.map((period) => {
      const cells = roles.map((role) => {
        const value = state.settings.defaultCoverage?.[dayIndex]?.[period.name]?.[role.id] || "";
        return `
          <label>${role.name}
            <input type="number" min="0" step="1" data-default-coverage="${dayIndex}:${period.name}:${role.id}" value="${value}">
          </label>
        `;
      }).join("");
      return `<div class="coverage-default-row"><strong>${period.name}</strong>${cells}</div>`;
    }).join("");
    return `<section class="settings-day"><h3>${day}</h3>${rows || `<p class="hint">No meal periods enabled.</p>`}</section>`;
  }).join("");
}

function collectDefaultCoverage() {
  const defaults = {};
  document.querySelectorAll("[data-default-coverage]").forEach((input) => {
    const [dayIndex, meal, roleId] = input.dataset.defaultCoverage.split(":");
    const count = Number(input.value) || 0;
    if (!defaults[dayIndex]) defaults[dayIndex] = {};
    if (!defaults[dayIndex][meal]) defaults[dayIndex][meal] = {};
    defaults[dayIndex][meal][roleId] = count;
  });
  return defaults;
}

function renderCloserRequirementsEditor() {
  const requirements = { ...defaultCloserRequirements(), ...(state.settings.closerRequirements || {}) };
  $("closerRequirementsEditor").innerHTML = DAYS.map((day, dayIndex) => `
    <label class="coverage-role-control closer-requirement-control">
      <span>${day}</span>
      <small>closers needed</small>
      <input type="number" min="0" step="1" data-closer-requirement="${dayIndex}" value="${Number(requirements[dayIndex]) || 0}">
    </label>
  `).join("");
}

function collectCloserRequirements() {
  const requirements = {};
  document.querySelectorAll("[data-closer-requirement]").forEach((input) => {
    requirements[input.dataset.closerRequirement] = Number(input.value) || 0;
  });
  return requirements;
}

function renderProjectionRulesEditor() {
  const roles = fohRoles();
  $("projectionRulesEditor").innerHTML = MEALS.map((meal) => {
    const rows = roles.map((role) => {
      const rule = state.settings.projectionRules?.[meal]?.[role.id] || {};
      return `
        <div class="projection-rule-row">
          <strong>${role.name}</strong>
          <label>Minimum
            <input type="number" min="0" step="1" data-projection-minimum="${meal}:${role.id}" value="${rule.minimum || ""}">
          </label>
          <label>Sales per staff
            <input type="number" min="0" step="50" data-projection-dollars="${meal}:${role.id}" value="${rule.dollarsPerStaff || ""}" placeholder="2500">
          </label>
        </div>
      `;
    }).join("");
    return `<section class="settings-day"><h3>${meal}</h3>${rows}</section>`;
  }).join("");
}

function collectProjectionRules() {
  const rules = {};
  document.querySelectorAll("[data-projection-minimum]").forEach((minimumInput) => {
    const [meal, roleId] = minimumInput.dataset.projectionMinimum.split(":");
    const dollarsInput = document.querySelector(`[data-projection-dollars="${meal}:${roleId}"]`);
    const minimum = Number(minimumInput.value) || 0;
    const dollarsPerStaff = Number(dollarsInput?.value) || 0;
    if (!minimum && !dollarsPerStaff) return;
    if (!rules[meal]) rules[meal] = {};
    rules[meal][roleId] = { minimum, dollarsPerStaff };
  });
  return rules;
}

function floorPlanOptions() {
  return [
    { value: "all", label: "All-Day" },
    { value: "am", label: "AM" },
    { value: "pm", label: "PM" },
    { value: "Breakfast", label: "Breakfast" },
    { value: "Lunch", label: "Lunch" },
    { value: "Dinner", label: "Dinner" },
    { value: "Brunch", label: "Brunch" }
  ];
}

function renderFloorPlanPrintRulesEditor() {
  const rules = state.settings.floorPlanPrintRules || defaultFloorPlanPrintRules();
  $("floorPlanPrintRulesEditor").innerHTML = DAYS.map((day, dayIndex) => {
    const selected = rules[dayIndex] || [];
    const checks = floorPlanOptions().map((option) => `
      <label class="checkbox"><input type="checkbox" data-floor-print-rule="${dayIndex}:${option.value}" ${selected.includes(option.value) ? "checked" : ""}> ${option.label}</label>
    `).join("");
    return `<section class="settings-day"><h3>${day}</h3><div class="inline-checks">${checks}</div></section>`;
  }).join("");
}

function collectFloorPlanPrintRules() {
  const rules = {};
  document.querySelectorAll("[data-floor-print-rule]:checked").forEach((input) => {
    const [dayIndex, period] = input.dataset.floorPrintRule.split(":");
    if (!rules[dayIndex]) rules[dayIndex] = [];
    rules[dayIndex].push(period);
  });
  return rules;
}

function renderFloorPlanNoteSettingsEditor() {
  const settings = { ...defaultFloorPlanNoteSettings(state.roles), ...(state.settings.floorPlanCrossRoleNotes || {}) };
  const roles = fohRoles();
  const target = $("floorPlanNoteSettingsEditor");
  if (!target) return;
  target.innerHTML = roles.map((role) => `
    <label class="checkbox checkbox-direct floor-note-toggle">
      <input type="checkbox" data-floor-note-role="${role.id}" ${settings[role.id] !== false ? "checked" : ""}>
      <span>${role.name}</span>
    </label>
  `).join("");
}

function collectFloorPlanNoteSettings() {
  const settings = { ...defaultFloorPlanNoteSettings(state.roles) };
  document.querySelectorAll("[data-floor-note-role]").forEach((input) => {
    settings[input.dataset.floorNoteRole] = input.checked;
  });
  return settings;
}

function shouldShowFloorPlanCrossRoleNote(shift) {
  const settings = { ...defaultFloorPlanNoteSettings(state.roles), ...(state.settings.floorPlanCrossRoleNotes || {}) };
  return settings[shift?.roleId] !== false;
}
function renderTrainingSettingsEditor() {
  $("trainingSettingsEditor").innerHTML = state.roles.map((role) => {
    const config = state.settings.trainingRequirements?.[role.id] || {};
    const requiredShifts = config.requiredShifts || (config.requiredLabels || []).map((name) => ({ name, dayIndex: "" }));
    return `
      <section class="settings-day training-role-settings" data-training-role="${role.id}">
        <h3>${role.name}</h3>
        <label>Training shifts
          <input type="number" min="0" step="1" data-training-days="${role.id}" value="${config.days || ""}">
        </label>
        <div class="required-shift-list" data-required-shifts="${role.id}">
          ${requiredShifts.map((item) => requiredShiftRow(role.id, item)).join("") || `<p class="hint">No specific required shifts.</p>`}
        </div>
        <button type="button" class="small-button" data-add-required-shift="${role.id}">Add Required Shift</button>
      </section>
    `;
  }).join("");
  wireRequiredShiftButtons();
}

function requiredShiftRow(roleId, item = {}) {
  return `
    <div class="required-shift-row">
      <label>Shift name <input data-required-name="${roleId}" value="${item.name || ""}" placeholder="Fish Fry, Brunch"></label>
      <label>Day
        <select data-required-day="${roleId}">
          <option value="">Any day</option>
          ${DAYS.map((day, index) => `<option value="${index}" ${String(item.dayIndex) === String(index) ? "selected" : ""}>${day}</option>`).join("")}
        </select>
      </label>
      <button type="button" class="small-button danger" data-remove-required-shift>Remove</button>
    </div>
  `;
}

function wireRequiredShiftButtons() {
  document.querySelectorAll("[data-add-required-shift]").forEach((button) => {
    button.onclick = () => {
      const roleId = button.dataset.addRequiredShift;
      const list = document.querySelector(`[data-required-shifts="${roleId}"]`);
      const placeholder = list.querySelector(".hint");
      if (placeholder) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", requiredShiftRow(roleId));
      wireRequiredShiftButtons();
    };
  });
  document.querySelectorAll("[data-remove-required-shift]").forEach((button) => {
    button.onclick = () => {
      const row = button.closest(".required-shift-row");
      const list = row.parentElement;
      row.remove();
      if (!list.querySelector(".required-shift-row")) list.innerHTML = `<p class="hint">No specific required shifts.</p>`;
    };
  });
}

function collectTrainingRequirements() {
  const requirements = {};
  state.roles.forEach((role) => {
    const days = Number(document.querySelector(`[data-training-days="${role.id}"]`)?.value) || 0;
    const names = Array.from(document.querySelectorAll(`[data-required-name="${role.id}"]`));
    const dayInputs = Array.from(document.querySelectorAll(`[data-required-day="${role.id}"]`));
    const requiredShifts = names.map((input, index) => ({
      name: input.value.trim(),
      dayIndex: dayInputs[index]?.value ?? ""
    })).filter((item) => item.name);
    requirements[role.id] = { days, requiredShifts };
  });
  return requirements;
}

function renderMonthly() {
  const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const gridStart = startOfWeek(monthStart, state.settings.weekStart);
  $("monthLabel").textContent = currentMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const grid = $("monthlyGrid");
  grid.innerHTML = "";
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const key = formatDateKey(date);
    const cell = document.createElement("div");
    cell.className = `month-cell ${date.getMonth() === currentMonth.getMonth() ? "" : "muted"}`;
    const shifts = state.shifts.filter((shift) => shift.date === key && visibleShift(shift));
    cell.innerHTML = `<div class="month-date">${date.getDate()}</div>`;
    shifts.slice(0, 5).forEach((shift) => {
      const employee = employeeById(shift.employeeId);
      const role = roleById(shift.roleId);
      const div = document.createElement("div");
      div.className = "month-shift";
      div.style.borderLeftColor = shiftColor(shift);
      div.textContent = `${displayName(employee)} ${role?.name || ""} ${shift.start}`;
      cell.append(div);
    });
    if (shifts.length > 5) {
      const more = document.createElement("div");
      more.className = "month-shift";
      more.textContent = `+${shifts.length - 5} more`;
      cell.append(more);
    }
    grid.append(cell);
  }
}

function renderScheduleHistory() {
  if (!$("historySummary") || !$("historyPatterns")) return;
  const weeks = state.scheduleHistory || [];
  const shifts = historyShifts();
  const matchedEmployees = shifts.filter((shift) => shift.employeeId).length;
  $("historySummary").innerHTML = `
    <div class="summary-card"><strong>${weeks.length}</strong><span>imported week${weeks.length === 1 ? "" : "s"}</span></div>
    <div class="summary-card"><strong>${shifts.length}</strong><span>historical shift${shifts.length === 1 ? "" : "s"}</span></div>
    <div class="summary-card"><strong>${matchedEmployees}</strong><span>matched employees</span></div>
  `;
  const patterns = historyShiftPatterns().slice(0, 80);
  if (!patterns.length) {
    $("historyPatterns").innerHTML = `<p class="hint">Import Ctuit schedule exports here. Shift Bay will save those weeks and use them to suggest template shifts and coverage pars.</p>`;
    return;
  }
  $("historyPatterns").innerHTML = `
    <table>
      <thead><tr><th>Day</th><th>Role</th><th>Time</th><th>Seen</th><th>Template</th></tr></thead>
      <tbody>
        ${patterns.map((pattern) => {
          const role = roleById(pattern.roleId);
          return `<tr><td>${DAYS[pattern.dayIndex]}</td><td>${role?.name || "Unknown role"}</td><td>${pattern.start} - ${pattern.end}</td><td>${pattern.count}</td><td>${pattern.templateCount || ""}</td></tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

function historyShifts() {
  return (state.scheduleHistory || []).flatMap((week) => (week.shifts || []).map((shift) => ({
    ...shift,
    sourceWeekId: week.id,
    sourceWeekStart: week.weekStart
  })));
}

function historyShiftPatterns() {
  const template = state.templates.find((item) => item.name === "History Pattern Template");
  const templateCounts = countTemplateShifts(template?.shifts || []);
  const patterns = new Map();
  historyShifts().filter((shift) => shift.roleId && shift.date && shift.start).forEach((shift) => {
    const role = roleById(shift.roleId);
    const comparable = {
      id: uid("historyPattern"),
      dayIndex: parseDateKey(shift.date).getDay(),
      department: shift.department || role?.department || "FOH",
      roleId: shift.roleId,
      start: normalizeTime(shift.start),
      end: shift.untilVolume ? "Until Volume" : normalizeTime(shift.end),
      untilVolume: Boolean(shift.untilVolume),
      isCloser: Boolean(shift.isCloser),
      isLunchCloser: Boolean(shift.isLunchCloser),
      color: shift.color || role?.color || "#2563eb"
    };
    const signature = templateShiftSignature(comparable);
    const bucket = patterns.get(signature) || { ...comparable, signature, count: 0, sourceWeeks: new Set() };
    bucket.sourceWeeks.add(shift.sourceWeekId);
    bucket.count += 1;
    patterns.set(signature, bucket);
  });
  return Array.from(patterns.values()).map((pattern) => ({
    ...pattern,
    count: pattern.sourceWeeks.size || pattern.count,
    templateCount: templateCounts.get(pattern.signature)?.count || 0
  })).sort((a, b) => b.count - a.count || Number(a.dayIndex) - Number(b.dayIndex) || (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0));
}

function applyHistoryPatternTemplate() {
  const patterns = historyShiftPatterns();
  if (!patterns.length) return showConflict("Import schedule history before building a history template.");
  const weekCount = Math.max(1, (state.scheduleHistory || []).length);
  const threshold = weekCount <= 2 ? 1 : Math.ceil(weekCount * 0.5);
  const shifts = patterns.filter((pattern) => pattern.count >= threshold).map((pattern) => ({
    id: uid("templateShift"),
    dayIndex: pattern.dayIndex,
    department: pattern.department,
    roleId: pattern.roleId,
    start: pattern.start,
    end: pattern.end,
    untilVolume: pattern.untilVolume,
    isCloser: pattern.isCloser,
    isLunchCloser: Boolean(pattern.isLunchCloser),
    color: pattern.color
  }));
  if (!shifts.length) return showConflict("No repeated historical patterns were strong enough to add to a template yet.");
  pushUndo();
  const existing = state.templates.find((template) => template.name === "History Pattern Template");
  if (existing) existing.shifts = shifts;
  else state.templates.push({ id: uid("template"), name: "History Pattern Template", shifts });
  renderAll();
  showConflict(`Updated History Pattern Template with ${shifts.length} recurring shift${shifts.length === 1 ? "" : "s"}.`);
}

function applyHistoryCoveragePars() {
  if (!historyShifts().length) return showConflict("Import schedule history before updating coverage pars.");
  const buckets = {};
  (state.scheduleHistory || []).forEach((week) => {
    (week.shifts || []).forEach((shift) => {
      if (!shift.roleId || !shift.date) return;
      getMealsForShift(shift).forEach((meal) => {
        const dayIndex = parseDateKey(shift.date).getDay();
        const key = `${dayIndex}:${meal}:${shift.roleId}:${week.id}`;
        buckets[key] = (buckets[key] || 0) + 1;
      });
    });
  });
  const grouped = {};
  Object.entries(buckets).forEach(([key, count]) => {
    const [dayIndex, meal, roleId] = key.split(":");
    const groupKey = `${dayIndex}:${meal}:${roleId}`;
    grouped[groupKey] = grouped[groupKey] || [];
    grouped[groupKey].push(count);
  });
  pushUndo();
  state.settings.defaultCoverage = { ...(state.settings.defaultCoverage || {}) };
  Object.entries(grouped).forEach(([key, counts]) => {
    const [dayIndex, meal, roleId] = key.split(":");
    const sorted = counts.slice().sort((a, b) => a - b);
    const suggested = sorted[Math.floor(sorted.length / 2)] || 0;
    if (!state.settings.defaultCoverage[dayIndex]) state.settings.defaultCoverage[dayIndex] = {};
    if (!state.settings.defaultCoverage[dayIndex][meal]) state.settings.defaultCoverage[dayIndex][meal] = {};
    state.settings.defaultCoverage[dayIndex][meal][roleId] = suggested;
  });
  renderAll();
  showConflict("Updated default coverage pars from imported schedule history.");
}

function staffingRows() {
  const buffer = Number(state.settings.staffingBuffer) || 0;
  const rows = [];
  DAYS.forEach((day, dayIndex) => {
    const periods = state.settings.mealPeriods?.[dayIndex] || [];
    periods.forEach((period) => {
      const start = minutesFromTime(period.start);
      const end = minutesFromTime(period.end);
      fohRoles().forEach((role) => {
        const required = Number(state.settings.defaultCoverage?.[dayIndex]?.[period.name]?.[role.id]) || 0;
        if (!required) return;
        const availableEmployees = schedulableEmployees().filter((employee) => (
          employee.roleTraining?.includes(role.id) &&
          employee.mealTraining?.includes(period.name) &&
          rangeInsideAvailabilityByDay(employee, dayIndex, start, end, dateKeyForAvailabilityDay(dayIndex, currentWeekKey()))
        ));
        const target = required + buffer;
        const available = availableEmployees.length;
        rows.push({
          day,
          dayIndex,
          meal: period.name,
          time: `${period.start} - ${period.end}`,
          role,
          required,
          buffer,
          target,
          available,
          hireNeed: Math.max(0, target - available),
          employees: availableEmployees.map(displayName).sort()
        });
      });
    });
  });
  return rows.sort((a, b) => b.hireNeed - a.hireNeed || a.dayIndex - b.dayIndex || a.meal.localeCompare(b.meal) || a.role.name.localeCompare(b.role.name));
}

function renderStaffingAnalysis() {
  if (!$("staffingAnalysis")) return;
  const rows = staffingRows();
  const problemRows = rows.filter((row) => row.hireNeed > 0);
  const totalHireNeed = problemRows.reduce((sum, row) => sum + row.hireNeed, 0);
  $("staffingSummary").innerHTML = `
    <div class="summary-card"><strong>${problemRows.length}</strong><span>problem area${problemRows.length === 1 ? "" : "s"}</span></div>
    <div class="summary-card"><strong>${totalHireNeed}</strong><span>suggested hire slot${totalHireNeed === 1 ? "" : "s"}</span></div>
    <div class="summary-card"><strong>${state.settings.staffingBuffer || 0}</strong><span>bench target</span></div>
  `;
  if (!rows.length) {
    $("staffingAnalysis").innerHTML = `<p class="hint">Add default coverage numbers in Settings to analyze weekly staffing needs.</p>`;
    return;
  }
  $("staffingAnalysis").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Day</th>
          <th>Meal</th>
          <th>Role</th>
          <th>Need</th>
          <th>Bench</th>
          <th>Available</th>
          <th>Suggested Hires</th>
          <th>Available Employees</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr class="${row.hireNeed ? "staffing-short" : "staffing-ok"}">
            <td>${row.day}</td>
            <td>${row.meal}<br><small>${row.time}</small></td>
            <td>${row.role.name}</td>
            <td>${row.required}</td>
            <td>${row.buffer}</td>
            <td>${row.available}</td>
            <td>${row.hireNeed}</td>
            <td>${row.employees.join(", ") || "None"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function checkedValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
}

function setCheckedValues(name, values) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = values.includes(input.value);
  });
}

function collectRoleMealTraining() {
  const trainedRoles = new Set(checkedValues("roleTraining"));
  const roleMealTraining = {};
  state.roles.forEach((role) => {
    if (!trainedRoles.has(role.id)) return;
    const meals = checkedValues(`roleMealTraining:${role.id}`);
    if (meals.length) roleMealTraining[role.id] = meals;
  });
  return roleMealTraining;
}

function setRoleMealTrainingValues(roleMealTraining = {}) {
  state.roles.forEach((role) => {
    setCheckedValues(`roleMealTraining:${role.id}`, roleMealTraining?.[role.id] || []);
  });
}

async function addSelectedTemplateToTray() {
  await addTemplateToTray($("quickTemplate").value);
}

function clearOpenShiftBayForWeek() {
  const weekStartKey = formatDateKey(currentDate);
  const weekEndKey = formatDateKey(addDays(currentDate, 6));
  const currentWeekShifts = (state.unassignedShifts || []).filter((shift) => shift.date >= weekStartKey && shift.date <= weekEndKey);
  if (!currentWeekShifts.length) return;
  pushUndo();
  const currentWeekIds = new Set(currentWeekShifts.map((shift) => shift.id));
  state.unassignedShifts = (state.unassignedShifts || []).filter((shift) => !currentWeekIds.has(shift.id));
  selectedUnassignedShiftId = null;
  pendingDeleteUnassignedShiftId = null;
  pendingTrayWarning = null;
  renderAll();
  showConflict(`Cleared ${currentWeekShifts.length} bay shift${currentWeekShifts.length === 1 ? "" : "s"} from this week's Shift Bay.`);
}

async function addTemplateToTray(templateId) {
  const template = templateById(templateId);
  if (!template || !template.shifts?.length) return showConflict("Choose a template with at least one saved shift.");
  const duplicatePlan = planTemplateMissingShifts(template);
  pushUndo();
  state.unassignedShifts = state.unassignedShifts || [];
  let addedFromTemplate = 0;
  const skippedDuplicates = duplicatePlan.skipped.length;
  const templateShiftsToAdd = duplicatePlan.toAdd;
  templateShiftsToAdd.forEach((templateShift) => {
    const date = dateForWeekday(Number(templateShift.dayIndex));
    state.unassignedShifts.push({
      ...templateShift,
      id: uid("unassigned"),
      templateId: template.id,
      templateShiftId: templateShift.id,
      shiftLabel: template.name,
      date
    });
    addedFromTemplate += 1;
  });
  renderAll();
  if (!addedFromTemplate && skippedDuplicates) {
    showConflict(`${template.name} is already represented on this week.`);
    return;
  }
  const remainingCoverageCount = weekDates()
    .map(formatDateKey)
    .flatMap((dateKey) => coverageShortfalls(dateKey, { includeUnassigned: true }))
    .reduce((total, item) => total + (Number(item.missing) || 0), 0);
  showConflict(`Added ${addedFromTemplate} bay shift${addedFromTemplate === 1 ? "" : "s"} to the Shift Bay from ${template.name}${skippedDuplicates ? `. Skipped ${skippedDuplicates} already represented on this week.` : ""}${remainingCoverageCount ? `. ${remainingCoverageCount} coverage shift${remainingCoverageCount === 1 ? " is" : "s are"} still missing; use Add Missing Coverage if you want Shift Bay to create those separately.` : ""}.`);
}

function planTemplateMissingShifts(template) {
  const existingCounts = countExistingWeekShiftSignatures();
  const toAdd = [];
  const skipped = [];
  const all = template.shifts || [];
  all.forEach((templateShift) => {
    const date = dateForWeekday(Number(templateShift.dayIndex));
    const signature = shiftTemplateSignature({ ...templateShift, date });
    const existing = existingCounts.get(signature) || 0;
    if (existing > 0) {
      existingCounts.set(signature, existing - 1);
      skipped.push({ templateShift, date, signature });
      return;
    }
    toAdd.push(templateShift);
  });
  return { all, toAdd, skipped };
}

function countExistingWeekShiftSignatures() {
  const dateKeys = new Set(weekDates().map(formatDateKey));
  const counts = new Map();
  const add = (shift) => {
    if (!dateKeys.has(shift.date)) return;
    const signature = shiftTemplateSignature(shift);
    counts.set(signature, (counts.get(signature) || 0) + 1);
  };
  (state.shifts || []).forEach(add);
  (state.unassignedShifts || []).forEach(add);
  return counts;
}

function shiftTemplateSignature(shift) {
  const end = shift.untilVolume ? "until-volume" : normalizeShiftTimeForSignature(shift.end);
  return [
    shift.date || "",
    shift.department || roleById(shift.roleId)?.department || "FOH",
    shift.roleId || "",
    normalizeShiftTimeForSignature(shift.start),
    end,
    shift.isFlexDouble ? "flex" : "",
    shift.isCloser ? "closer" : "",
    shift.isLunchCloser ? "lunch-closer" : ""
  ].join("|").toLowerCase();
}

function normalizeShiftTimeForSignature(value) {
  const minutes = minutesFromTime(value);
  return minutes == null ? cleanCell(value).toLowerCase() : String(minutes);
}

function describeTemplateDuplicateSkip(item) {
  const role = roleById(item.templateShift.roleId)?.name || "Shift";
  const end = item.templateShift.untilVolume ? "Until Volume" : item.templateShift.end || "";
  return `${displayDate(parseDateKey(item.date))}: ${role} ${item.templateShift.start || ""}${end ? ` - ${end}` : ""}`;
}

function addCoverageShortfallShifts(dateKeys) {
  let added = 0;
  dateKeys.forEach((dateKey) => {
    let safety = 0;
    while (safety < 200) {
      safety += 1;
      const shortfall = coverageShortfalls(dateKey, { includeUnassigned: true })[0];
      if (!shortfall) break;
      const role = roleById(shortfall.roleId);
      const period = getMealPeriodsForDate(dateKey).find((item) => item.name === shortfall.meal);
      if (!role || !period) break;
      state.unassignedShifts.push({
        id: uid("unassigned"),
        date: dateKey,
        shiftLabel: `${shortfall.meal} ${role.name}`,
        department: role.department || "FOH",
        roleId: role.id,
        start: period.start,
        end: period.end,
        untilVolume: false,
        isCloser: false,
        isLunchCloser: false,
        isFlexDouble: false,
        color: role.color || "#2563eb",
        coverageSource: {
          dateKey,
          meal: shortfall.meal,
          roleId: role.id
        }
      });
      added += 1;
    }
  });
  return added;
}

function saveCurrentWeekAsTemplate() {
  const name = $("templateName").value.trim();
  if (!name) return showConflict("Name the weekly template before saving the current week.");
  const dates = new Set(weekDates().map(formatDateKey));
  const sourceShifts = [
    ...state.shifts.filter((shift) => dates.has(shift.date)),
    ...(state.unassignedShifts || []).filter((shift) => dates.has(shift.date))
  ];
  const seen = new Set();
  const shifts = sourceShifts
    .map((shift) => {
      const role = roleById(shift.roleId);
      return {
        id: uid("templateShift"),
        dayIndex: parseDateKey(shift.date).getDay(),
        department: shift.department || role?.department || "FOH",
        roleId: shift.roleId,
        start: shift.start,
        end: shift.untilVolume ? "Until Volume" : shift.end,
        untilVolume: Boolean(shift.untilVolume),
        isCloser: Boolean(shift.isCloser),
        isLunchCloser: Boolean(shift.isLunchCloser),
        isFlexDouble: Boolean(shift.isFlexDouble),
        color: shift.color || role?.color || "#2563eb"
      };
    })
    .filter((shift) => shift.roleId && shift.start)
    .filter((shift) => {
      const key = [shift.dayIndex, shift.department, shift.roleId, shift.start, shift.end, shift.untilVolume, shift.isCloser, shift.isLunchCloser, shift.isFlexDouble].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(a.dayIndex) - Number(b.dayIndex) || (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0));
  if (!shifts.length) return showConflict("There are no assigned or open shifts in the current week to save as a template.");
  pushUndo();
  const id = $("templateId").value || state.templates.find((template) => template.name.toLowerCase() === name.toLowerCase())?.id || uid("template");
  const existing = state.templates.find((template) => template.id === id);
  if (existing) {
    existing.name = name;
    existing.shifts = shifts;
  } else {
    state.templates.push({ id, name, shifts });
  }
  $("templateId").value = id;
  clearTemplateShiftFields(false);
  renderAll();
  $("templateId").value = id;
  $("templateName").value = name;
  showConflict(`Saved ${shifts.length} current-week shift${shifts.length === 1 ? "" : "s"} to ${name}.`);
}

function templateShiftSignature(shift) {
  return [
    Number(shift.dayIndex),
    shift.department || roleById(shift.roleId)?.department || "FOH",
    shift.roleId || "",
    normalizeTime(shift.start),
    shift.untilVolume ? "Until Volume" : normalizeTime(shift.end),
    Boolean(shift.untilVolume),
    Boolean(shift.isCloser),
    Boolean(shift.isLunchCloser),
    Boolean(shift.isFlexDouble)
  ].join("|");
}

function templateComparableFromWeekShift(shift) {
  const role = roleById(shift.roleId);
  return {
    id: uid("templateShift"),
    dayIndex: parseDateKey(shift.date).getDay(),
    department: shift.department || role?.department || "FOH",
    roleId: shift.roleId,
    start: normalizeTime(shift.start),
    end: shift.untilVolume ? "Until Volume" : normalizeTime(shift.end),
    untilVolume: Boolean(shift.untilVolume),
    isCloser: Boolean(shift.isCloser),
    isLunchCloser: Boolean(shift.isLunchCloser),
    isFlexDouble: Boolean(shift.isFlexDouble),
    color: shift.color || role?.color || "#2563eb"
  };
}

function currentWeekTemplateCandidates() {
  const dates = new Set(weekDates().map(formatDateKey));
  const seen = new Set();
  return [
    ...state.shifts.filter((shift) => dates.has(shift.date)),
    ...(state.unassignedShifts || []).filter((shift) => dates.has(shift.date))
  ]
    .filter((shift) => shift.department === "FOH" && shift.roleId && shift.start)
    .map(templateComparableFromWeekShift)
    .filter((shift) => {
      const key = `${templateShiftSignature(shift)}|${seen.size}`;
      seen.add(key);
      return true;
    });
}

function countTemplateShifts(shifts) {
  const counts = new Map();
  shifts.forEach((shift) => {
    const signature = templateShiftSignature(shift);
    const bucket = counts.get(signature) || { count: 0, shifts: [] };
    bucket.count += 1;
    bucket.shifts.push(shift);
    counts.set(signature, bucket);
  });
  return counts;
}

function templateShiftLabel(shift) {
  const role = roleById(shift.roleId);
  return `${DAYS[Number(shift.dayIndex)]} ${role?.name || "Role"} ${shift.start}-${shift.untilVolume ? "Until Volume" : shift.end}`;
}

function buildTemplateSuggestions(template) {
  const templateCounts = countTemplateShifts(template.shifts || []);
  const actualShifts = currentWeekTemplateCandidates();
  const actualCounts = countTemplateShifts(actualShifts);
  const signatures = new Set([...templateCounts.keys(), ...actualCounts.keys()]);
  const suggestions = [];
  signatures.forEach((signature) => {
    const templateBucket = templateCounts.get(signature) || { count: 0, shifts: [] };
    const actualBucket = actualCounts.get(signature) || { count: 0, shifts: [] };
    if (actualBucket.count > templateBucket.count) {
      for (let index = 0; index < actualBucket.count - templateBucket.count; index++) {
        const shift = actualBucket.shifts[index] || actualBucket.shifts[0];
        suggestions.push({
          type: "add",
          templateId: template.id,
          shift: { ...shift, id: uid("templateShift") },
          label: `Add ${templateShiftLabel(shift)}`
        });
      }
    }
    if (templateBucket.count > actualBucket.count) {
      for (let index = 0; index < templateBucket.count - actualBucket.count; index++) {
        const shift = templateBucket.shifts[index] || templateBucket.shifts[0];
        suggestions.push({
          type: "remove",
          templateId: template.id,
          signature,
          label: `Remove ${templateShiftLabel(shift)}`
        });
      }
    }
  });
  return suggestions.sort((a, b) => a.label.localeCompare(b.label));
}

function openTemplateSuggestions() {
  const id = $("templateId").value || $("quickTemplate").value || state.templates[0]?.id;
  const template = templateById(id);
  if (!template) return showConflict("Select a weekly template first.");
  $("templateId").value = template.id;
  $("templateName").value = template.name;
  templateSuggestions = buildTemplateSuggestions(template);
  renderTemplateSuggestions();
  $("templateSuggestionsDialog").showModal();
}

function renderTemplateSuggestions() {
  const target = $("templateSuggestionsResults");
  if (!templateSuggestions.length) {
    target.innerHTML = `<p class="hint">No template changes suggested from the current week.</p>`;
    return;
  }
  target.innerHTML = `
    <table>
      <thead><tr><th>Action</th><th>Suggestion</th><th></th></tr></thead>
      <tbody>
        ${templateSuggestions.map((suggestion, index) => `
          <tr>
            <td>${suggestion.type === "add" ? "Add" : "Remove"}</td>
            <td>${suggestion.label}</td>
            <td><button type="button" class="small-button" data-apply-template-suggestion="${index}">Apply</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  target.querySelectorAll("[data-apply-template-suggestion]").forEach((button) => {
    button.onclick = () => applyTemplateSuggestion(Number(button.dataset.applyTemplateSuggestion));
  });
}

function applyTemplateSuggestion(index) {
  const suggestion = templateSuggestions[index];
  const template = templateById(suggestion?.templateId);
  if (!suggestion || !template) return;
  pushUndo();
  if (suggestion.type === "add") {
    template.shifts = [...(template.shifts || []), { ...suggestion.shift, id: uid("templateShift") }];
  } else if (suggestion.type === "remove") {
    let removed = false;
    template.shifts = (template.shifts || []).filter((shift) => {
      if (!removed && templateShiftSignature(shift) === suggestion.signature) {
        removed = true;
        return false;
      }
      return true;
    });
  }
  templateSuggestions.splice(index, 1);
  renderTemplates();
  renderTemplateSuggestions();
  saveState();
}

function applyAllTemplateSuggestions() {
  while (templateSuggestions.length) applyTemplateSuggestion(0);
  showConflict("Template suggestions applied.");
}

function copyPreviousWeekToOpenShiftBay() {
  const targetDates = weekDates();
  const sourceStart = addDays(currentDate, -7);
  const sourceKeys = new Set(Array.from({ length: 7 }, (_, index) => formatDateKey(addDays(sourceStart, index))));
  const targetByDay = Object.fromEntries(targetDates.map((date) => [date.getDay(), formatDateKey(date)]));
  const sourceShifts = state.shifts.filter((shift) => sourceKeys.has(shift.date) && visibleShift(shift));
  if (!sourceShifts.length) return showConflict("No visible shifts found in the previous week to copy.");
  pushUndo();
  state.unassignedShifts = state.unassignedShifts || [];
  sourceShifts.forEach((shift) => {
    const role = roleById(shift.roleId);
    state.unassignedShifts.push({
      id: uid("unassigned"),
      date: targetByDay[parseDateKey(shift.date).getDay()],
      department: shift.department || role?.department || "FOH",
      roleId: shift.roleId,
      start: shift.start,
      end: shift.end,
      untilVolume: Boolean(shift.untilVolume),
      isCloser: Boolean(shift.isCloser),
      isLunchCloser: Boolean(shift.isLunchCloser),
      isFlexDouble: Boolean(shift.isFlexDouble),
      notes: shift.notes || "Copied from previous week",
      color: shift.color || role?.color || "#2563eb"
    });
  });
  selectedUnassignedShiftId = state.unassignedShifts[state.unassignedShifts.length - 1]?.id || null;
  saveState();
  renderAll();
  showConflict(`Copied ${sourceShifts.length} previous-week shift${sourceShifts.length === 1 ? "" : "s"} into the Shift Bay.`);
}

function selectedScheduleDate() {
  if (selectedCell?.date) return selectedCell.date;
  const shift = state.shifts.find((item) => item.id === selectedShiftId);
  return shift?.date || formatDateKey(currentDate);
}

function selectedScheduleEmployeeId() {
  if (selectedCell?.employeeId) return selectedCell.employeeId;
  const shift = state.shifts.find((item) => item.id === selectedShiftId);
  return shift?.employeeId || "";
}

function clearSelectedDay() {
  const dateKey = selectedScheduleDate();
  const shifts = state.shifts.filter((shift) => shift.date === dateKey && visibleShift(shift));
  if (!shifts.length) return showConflict("No visible shifts found on the selected day.");
  pushUndo();
  state.shifts = state.shifts.filter((shift) => !(shift.date === dateKey && visibleShift(shift)));
  selectedShiftId = null;
  saveState();
  renderAll();
  showConflict(`Cleared ${shifts.length} visible shift${shifts.length === 1 ? "" : "s"} from ${displayDate(parseDateKey(dateKey))}.`);
}

function clearSelectedEmployee() {
  const employeeId = selectedScheduleEmployeeId();
  if (!employeeId) return showConflict("Select an employee row or shift first.");
  const dates = new Set(weekDates().map(formatDateKey));
  const shifts = state.shifts.filter((shift) => shift.employeeId === employeeId && dates.has(shift.date) && visibleShift(shift));
  if (!shifts.length) return showConflict("No visible shifts found for that employee this week.");
  pushUndo();
  state.shifts = state.shifts.filter((shift) => !(shift.employeeId === employeeId && dates.has(shift.date) && visibleShift(shift)));
  selectedShiftId = null;
  saveState();
  renderAll();
  showConflict(`Cleared ${shifts.length} visible shift${shifts.length === 1 ? "" : "s"} for ${displayName(employeeById(employeeId))}.`);
}

function copySelectedShift() {
  const request = (state.timeOffRequests || []).find((item) => item.id === selectedTimeOffRequestId);
  if (request) {
    clipboardTimeOffRequest = JSON.parse(JSON.stringify(request));
    clipboardShift = null;
    showConflict(`Copied ${isScheduleBlock(request) ? "Block" : "RO"} for ${displayName(employeeById(request.employeeId))}.`);
    return;
  }
  const shift = state.shifts.find((item) => item.id === selectedShiftId);
  if (!shift) return showConflict("Select a shift, RO, or Block to copy.");
  clipboardShift = JSON.parse(JSON.stringify(shift));
  clipboardTimeOffRequest = null;
  showConflict(`Copied ${roleById(shift.roleId)?.name || "shift"} ${shift.start} - ${shift.untilVolume ? "Until Volume" : shift.end}.`);
}

async function pasteShift() {
  if (!selectedCell?.employeeId || !selectedCell?.date) return showConflict("Select an employee/day cell to paste into.");
  if (clipboardTimeOffRequest) {
    const request = cloneCopiedTimeOffForCell(clipboardTimeOffRequest, selectedCell);
    const duplicate = (state.timeOffRequests || []).some((item) => timeOffRequestMatches(item, request));
    if (duplicate) return showConflict(`That ${isScheduleBlock(request) ? "Block" : "RO"} is already in that cell.`);
    pushUndo();
    state.timeOffRequests = [...(state.timeOffRequests || []), request];
    selectedTimeOffRequestId = request.id;
    selectedShiftId = null;
    selectedUnassignedShiftId = null;
    pendingDeleteShiftId = null;
    pendingDeleteTimeOffRequestId = null;
    saveState();
    renderAll();
    showConflict(`Pasted ${isScheduleBlock(request) ? "Block" : "RO"} for ${displayName(employeeById(request.employeeId))} on ${displayDate(parseDateKey(request.date))}.`);
    return;
  }
  if (!clipboardShift) return showConflict("Copy a shift, RO, or Block first.");
  const shift = cloneCopiedShiftForCell(clipboardShift, selectedCell);
  const result = validateShift(shift);
  if (result.errors.length) return showConflict(result.errors.join(" "));
  if (!(await confirmWarnings(result.warnings, { confirmText: "Save Anyway" }))) return;
  pushUndo();
  state.shifts.push(shift);
  selectedShiftId = shift.id;
  selectedTimeOffRequestId = null;
  selectedUnassignedShiftId = null;
  pendingDeleteShiftId = null;
  pendingDeleteTimeOffRequestId = null;
  saveState();
  renderAll();
  showConflict(`Pasted ${roleById(shift.roleId)?.name || "shift"} for ${displayName(employeeById(shift.employeeId))} on ${displayDate(parseDateKey(shift.date))}.`);
}

function cloneCopiedShiftForCell(sourceShift, targetCell) {
  const copy = JSON.parse(JSON.stringify(sourceShift || {}));
  delete copy.id;
  delete copy.createdAt;
  delete copy.updatedAt;
  return {
    ...copy,
    id: uid("shift"),
    employeeId: targetCell.employeeId,
    date: targetCell.date,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    updatedBy: currentSaveActor()
  };
}

function cloneCopiedTimeOffForCell(sourceRequest, targetCell) {
  const copy = JSON.parse(JSON.stringify(sourceRequest || {}));
  delete copy.id;
  delete copy.createdAt;
  delete copy.updatedAt;
  return {
    ...copy,
    id: uid(isScheduleBlock(copy) ? "block" : "ro"),
    employeeId: targetCell.employeeId,
    date: targetCell.date,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    updatedBy: currentSaveActor()
  };
}

function timeOffRequestMatches(a = {}, b = {}) {
  return a.employeeId === b.employeeId &&
    a.date === b.date &&
    timeOffShortLabel(a) === timeOffShortLabel(b) &&
    requestOffIsFullDay(a) === requestOffIsFullDay(b) &&
    (a.start || "") === (b.start || "") &&
    (a.end || "") === (b.end || "") &&
    (a.daypart || "") === (b.daypart || "") &&
    scheduleBlockType(a) === scheduleBlockType(b);
}

function exportCsv() {
  const rows = [["Date", "Employee", "Department", "Role", "Meals", "Start Time", "End Time", "Until Volume", "Flex Double", "Notes"]];
  state.shifts
    .filter(visibleShift)
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
    .forEach((shift) => {
      rows.push([
        shift.date,
        displayName(employeeById(shift.employeeId)),
        shift.department,
        roleById(shift.roleId)?.name || "",
        getMealsForShift(shift).join("/"),
        shift.start,
        shift.untilVolume ? "Until Volume" : shift.end,
        shift.untilVolume ? "Yes" : "No",
        shift.isFlexDouble ? "Yes" : "No",
        shift.notes || ""
      ]);
    });
  downloadFile(`schedule_${formatDateKey(currentDate)}.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv");
}

async function checkPrintCoverage() {
  const shortfalls = weekDates().flatMap((date) => coverageShortfalls(formatDateKey(date)));
  if (shortfalls.length) {
    const lines = shortfalls.slice(0, 12).map((item) => {
      const role = roleById(item.roleId);
      return `${displayDate(parseDateKey(item.dateKey))} ${item.meal}: ${role?.name || "Role"} needs ${item.need}, scheduled ${item.have}`;
    });
    const more = shortfalls.length > 12 ? `\n...and ${shortfalls.length - 12} more.` : "";
    const proceed = await showAppConfirm({
      title: "Missing Coverage",
      message: "Some days are missing required coverage. Print anyway?",
      items: [...lines, ...(more ? [more.replace(/^\n/, "")] : [])],
      confirmText: "Print Anyway"
    });
    if (!proceed) return false;
  }
  return true;
}

function openPrintDialog() {
  updateCompactPrintAdvancedVisibility();
  renderCompactPrintRoleOrderEditor();
  renderPrintWarningChecklist();
  $("printDialog").showModal();
}

function compactPrintShiftOrder() {
  return $("compactPrintShiftOrder")?.value || "time";
}

function compactPrintShiftOrderLabel(value) {
  return {
    time: "start time",
    endTime: "end time",
    role: "role",
    shift: "shift name",
    employee: "employee name",
    longest: "longest shift first",
    shortest: "shortest shift first"
  }[value] || "start time";
}

function isCompactPrintLayout(layout) {
  return layout === "simpleRole" || layout === "simpleRoleWithBay" || layout === "simpleEmployee";
}

function updateCompactPrintAdvancedVisibility() {
  const advanced = $("compactPrintAdvanced");
  if (!advanced) return;
  const layout = $("printLayout")?.value;
  advanced.hidden = !isCompactPrintLayout(layout);
  const departmentFilters = $("printDepartmentFilters");
  if (departmentFilters) departmentFilters.hidden = !isCompactPrintLayout(layout);
  if (isCompactPrintLayout(layout)) renderPrintDepartmentOptions();
  if (!advanced.hidden) renderCompactPrintRoleOrderEditor();
}

function printDepartmentList() {
  return Array.from(new Set((state.roles || [])
    .map((role) => String(role.department || "").trim())
    .filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function selectedPrintDepartments() {
  const options = Array.from(document.querySelectorAll("#printDepartmentOptions input[data-print-department]"));
  if (!options.length) return null;
  return new Set(options.filter((input) => input.checked).map((input) => input.value));
}

function printDepartmentMatches(shift, departments) {
  if (!departments) return true;
  const department = String(roleById(shift.roleId)?.department || shift.department || "").trim();
  return departments.has(department);
}

function renderPrintDepartmentOptions() {
  const target = $("printDepartmentOptions");
  if (!target) return;
  const previous = new Set(Array.from(target.querySelectorAll("input[data-print-department]:checked"), (input) => input.value));
  const departments = printDepartmentList();
  target.innerHTML = departments.map((department) => `
    <label class="print-department-option">
      <input type="checkbox" data-print-department value="${escapeHtml(department)}" ${!previous.size || previous.has(department) ? "checked" : ""}>
      <span>${escapeHtml(department)}</span>
    </label>
  `).join("") || `<span class="hint">No departments are configured.</span>`;
  target.querySelectorAll("input[data-print-department]").forEach((input) => {
    input.addEventListener("change", renderPrintWarningChecklist);
  });
}

function renderCompactPrintRoleOrderEditor() {
  const target = $("compactPrintRoleOrderEditor");
  if (!target) return;
  const roles = orderedRolesForPrint();
  target.innerHTML = `
    <div class="compact-print-role-list">
      ${roles.map((role, index) => `
        <div class="compact-print-role-row" style="--role-color:${role.color || "#2563eb"}">
          <span>${escapeHtml(role.name)}</span>
          <button type="button" data-print-role-move="${role.id}" data-direction="-1" ${index === 0 ? "disabled" : ""} title="Move ${escapeHtml(role.name)} up">Up</button>
          <button type="button" data-print-role-move="${role.id}" data-direction="1" ${index === roles.length - 1 ? "disabled" : ""} title="Move ${escapeHtml(role.name)} down">Down</button>
        </div>
      `).join("")}
    </div>
    <button class="small-button" type="button" id="resetCompactPrintRoleOrderBtn">Reset role order</button>
  `;
  target.querySelectorAll("[data-print-role-move]").forEach((button) => {
    button.addEventListener("click", () => movePrintRole(button.dataset.printRoleMove, Number(button.dataset.direction)));
  });
  target.querySelector("#resetCompactPrintRoleOrderBtn")?.addEventListener("click", resetPrintRoleOrder);
}

function movePrintRole(roleId, direction) {
  const order = orderedRolesForPrint().map((role) => role.id);
  const index = order.indexOf(roleId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
  const [role] = order.splice(index, 1);
  order.splice(nextIndex, 0, role);
  state.settings.printRoleOrder = order;
  saveState();
  renderCompactPrintRoleOrderEditor();
  renderPrintWarningChecklist();
  if (document.body.classList.contains("compact-preview")) {
    renderSimpleRolePrintView($("printSort")?.value || "role", { shiftOrder: compactPrintShiftOrder() });
  }
}

function resetPrintRoleOrder() {
  state.settings.printRoleOrder = defaultPrintRoleOrder();
  saveState();
  renderCompactPrintRoleOrderEditor();
  renderPrintWarningChecklist();
  if (document.body.classList.contains("compact-preview")) {
    renderSimpleRolePrintView($("printSort")?.value || "role", { shiftOrder: compactPrintShiftOrder() });
  }
}

function renderPrintWarningChecklist() {
  const target = $("printWarningChecklist");
  if (!target) return;
  const issues = collectScheduleIssues();
  const hiddenEmployees = schedulableEmployees().filter((employee) => !visibleEmployee(employee)).length;
  const rows = [
    { warn: issues.length > 0, text: issues.length ? `${issues.length} schedule warning/error${issues.length === 1 ? "" : "s"} found.` : "No schedule warnings found." },
    { warn: hiddenEmployees > 0, text: hiddenEmployees ? `${hiddenEmployees} active employee${hiddenEmployees === 1 ? "" : "s"} hidden by filters.` : "No active employees hidden by filters." },
    { warn: false, text: printLayoutDescription($("printLayout")?.value) },
    ...(isCompactPrintLayout($("printLayout")?.value) ? [{
      warn: false,
      text: `Departments: ${Array.from(selectedPrintDepartments() || printDepartmentList()).join(", ") || "none"}.`
    }] : []),
    ...(isCompactPrintLayout($("printLayout")?.value) ? [{ warn: false, text: `Shift order inside cells: ${compactPrintShiftOrderLabel(compactPrintShiftOrder())}.` }] : [])
  ];
  target.innerHTML = `
    <strong>Before printing</strong>
    ${rows.map((row) => `<div class="print-warning-row ${row.warn ? "warn" : ""}">${row.text}</div>`).join("")}
  `;
}

async function printSchedule() {
  const layout = $("printLayout").value;
  if (layout !== "currentPage" && !(await checkPrintCoverage())) return;
  preparePrintView(layout, $("printSort").value, {
    shiftOrder: compactPrintShiftOrder(),
    departments: selectedPrintDepartments()
  });
  window.print();
  window.setTimeout(clearPrintView, 500);
}

function preparePrintView(layout, sortMode, options = {}) {
  document.body.classList.remove("printing-simple", "printing-grid", "printing-ctuit-entry", "printing-employee-compact", "printing-current-page");
  if (layout === "currentPage") {
    clearPrintView();
    document.body.classList.add("printing-current-page");
    return;
  }
  if (layout === "ctuitEntry") {
    renderCtuitEntryPrintView();
    document.body.classList.add("printing-simple", "printing-ctuit-entry");
    return;
  }
  if (layout === "simpleRole" || layout === "simpleRoleWithBay") {
    renderSimpleRolePrintView(sortMode, {
      includeOpenShiftBoxes: layout === "simpleRoleWithBay",
      shiftOrder: options.shiftOrder,
      departments: options.departments
    });
    document.body.classList.add("printing-simple");
    return;
  }
  if (layout === "simpleEmployee") {
    renderSimpleEmployeePrintView(sortMode, { shiftOrder: options.shiftOrder, departments: options.departments });
    document.body.classList.add("printing-simple", "printing-employee-compact");
    return;
  }
  clearPrintView();
  document.body.classList.add("printing-grid");
}

function printLayoutDescription(layout) {
  if (layout === "ctuitEntry") return "Ctuit entry checklist selected.";
  if (layout === "simpleEmployee") return "Compact employee grid selected. Multiple roles are combined in the same employee line.";
  if (layout === "simpleRoleWithBay") return "Compact role grid with open Shift Bay boxes selected.";
  if (layout === "simpleRole") return "Compact role grid selected.";
  if (layout === "currentPage") return "Current page selected. The active screen will be printed intentionally.";
  return "Current grid layout selected.";
}

function clearPrintView() {
  document.body.classList.remove("printing-simple", "printing-grid", "printing-ctuit-entry", "printing-employee-compact", "printing-current-page", "compact-preview");
  updateCompactPreviewButton();
  $("printView").hidden = true;
  $("printView").innerHTML = "";
  updateZoomVisibility();
}

function toggleCompactPreview() {
  if (document.body.classList.contains("compact-preview")) {
    clearPrintView();
    return;
  }
  renderSimpleRolePrintView($("printSort")?.value || "role", { shiftOrder: compactPrintShiftOrder() });
  document.body.classList.add("compact-preview");
  updateCompactPreviewButton();
  updateZoomVisibility();
  $("printView")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSimpleRolePrintView(sortMode, options = {}) {
  const dates = weekDates();
  const dateKeys = new Set(dates.map(formatDateKey));
  const visible = state.shifts.filter((shift) => (
    dateKeys.has(shift.date) &&
    isPrintableScheduledEmployee(shift.employeeId) &&
    visibleShift(shift) &&
    printDepartmentMatches(shift, options.departments)
  ));
  const roleGroups = groupPrintShiftsByRole(visible, sortMode, options.departments);
  const openShiftBoxes = options.includeOpenShiftBoxes ? renderOpenShiftPrintBoxes(options.departments) : "";
  const shiftOrder = options.shiftOrder || "time";
  $("printView").hidden = false;
  $("printView").innerHTML = `
    ${openShiftBoxes}
    ${roleGroups.map((group, index) => renderSimpleRoleGrid(group, sortMode, shouldBreakBeforeRole(group, roleGroups[index - 1]), shiftOrder)).join("")}
  `;
}

function renderSimpleEmployeePrintView(sortMode, options = {}) {
  const dates = weekDates();
  const dateKeys = dates.map(formatDateKey);
  const visible = state.shifts.filter((shift) => (
    dateKeys.includes(shift.date) &&
    isPrintableScheduledEmployee(shift.employeeId) &&
    visibleShift(shift) &&
    printDepartmentMatches(shift, options.departments)
  ));
  const shiftOrder = options.shiftOrder || "time";
  const employeeIds = Array.from(new Set([
    ...visible.map((shift) => shift.employeeId).filter(Boolean),
    ...schedulableEmployees()
      .filter(visibleEmployee)
      .filter((employee) => employeeHasPrintableWeekExceptions(employee, dateKeys))
      .map((employee) => employee.id)
  ])).sort((a, b) => comparePrintEmployees(a, b, visible, sortMode));
  $("printView").hidden = false;
  $("printView").innerHTML = `
    <section class="simple-print-section simple-employee-print-section">
      <h3>Compact Schedule by Employee</h3>
      <table class="simple-week-table simple-employee-week-table">
        <colgroup>
          <col class="simple-week-employee-col">
          ${dates.map(() => `<col class="simple-week-day-col">`).join("")}
        </colgroup>
        <thead>
          <tr>
            <th>Employee</th>
            ${dates.map((date) => `<th>${displayDate(date)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${employeeIds.map((employeeId) => `
            <tr class="employee-row">
              <th>${displayName(employeeById(employeeId))}</th>
              ${dateKeys.map((dateKey) => `<td>${renderSimpleEmployeeAllRolesCell(employeeId, dateKey, shiftOrder, options.departments)}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderSimpleEmployeeAllRolesCell(employeeId, dateKey, shiftOrder, departments = null) {
  const employee = employeeById(employeeId);
  const extras = renderSimplePrintExtras(employee, employeeId, dateKey);
  const dayShifts = state.shifts
    .filter((shift) => shift.date === dateKey && shift.employeeId === employeeId && visibleShift(shift) && printDepartmentMatches(shift, departments))
    .sort((a, b) => compareCompactCellShifts(a, b, shiftOrder));
  const shiftLines = dayShifts.map((shift) => {
    const role = roleById(shift.roleId);
    const end = shift.untilVolume ? "Vol" : shift.end;
    const flags = [shift.isCloser ? "CL" : "", shift.isFlexDouble ? "Flex" : ""].filter(Boolean).join(" ");
    const note = cleanCell(shift.notes);
    return `
      <div class="simple-week-line simple-week-shift simple-week-employee-shift" style="--shift-color:${shiftColor(shift)}">
        <strong>${role?.name || "Role"}</strong>
        <em>${shift.start} - ${end}${flags ? ` ${flags}` : ""}</em>
        ${note ? `<span class="simple-week-note">${escapeHtml(note)}</span>` : ""}
      </div>
    `;
  });
  return [...extras, ...shiftLines].join("");
}

function renderCtuitEntryPrintView() {
  const dates = weekDates();
  const dateKeys = dates.map(formatDateKey);
  const shifts = state.shifts
    .filter((shift) => dateKeys.includes(shift.date) && visibleShift(shift))
    .sort((a, b) => (
      a.date.localeCompare(b.date) ||
      (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0) ||
      (roleById(a.roleId)?.name || "").localeCompare(roleById(b.roleId)?.name || "") ||
      displayName(employeeById(a.employeeId)).localeCompare(displayName(employeeById(b.employeeId)))
    ));
  const grouped = new Map(dateKeys.map((dateKey) => [dateKey, []]));
  shifts.forEach((shift) => {
    if (!grouped.has(shift.date)) grouped.set(shift.date, []);
    grouped.get(shift.date).push(shift);
  });
  $("printView").hidden = false;
  $("printView").innerHTML = `
    <section class="ctuit-entry-print">
      <header class="ctuit-entry-header">
        <div>
          <h2>Ctuit Entry List</h2>
          <p>${displayDate(dates[0])} - ${displayDate(dates[dates.length - 1])}</p>
        </div>
        <div class="ctuit-entry-total">${shifts.length} shifts</div>
      </header>
      <p class="ctuit-entry-hint">Work from top to bottom. Check each box after the shift is entered in Ctuit.</p>
      ${Array.from(grouped.entries()).map(([dateKey, dayShifts]) => renderCtuitEntryDay(dateKey, dayShifts)).join("")}
    </section>
  `;
}

function renderCtuitEntryDay(dateKey, shifts) {
  return `
    <section class="ctuit-entry-day">
      <h3>${displayDate(parseDateKey(dateKey))}<span>${shifts.length} shifts</span></h3>
      <table class="ctuit-entry-table">
        <thead>
          <tr>
            <th class="ctuit-entry-check">Done</th>
            <th class="ctuit-entry-time">Time</th>
            <th class="ctuit-entry-role">Role</th>
            <th class="ctuit-entry-name">Employee</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${shifts.map(renderCtuitEntryRow).join("") || `<tr><td colspan="5" class="ctuit-entry-empty">No shifts</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

function renderCtuitEntryRow(shift) {
  const role = roleById(shift.roleId);
  const employee = employeeById(shift.employeeId);
  const end = shift.untilVolume ? "Until Volume" : shift.end;
  const flags = [];
  if (shift.isCloser) flags.push("CL");
  if (shift.isFlexDouble) flags.push("Flex");
  trainingBadgesForShift(shift).forEach((trainingNote) => flags.push(trainingNote));
  if (shift.notes) flags.push(shift.notes);
  const roleClass = `role-${(role?.name || "other").toLowerCase().replace(/\s+/g, "-")}`;
  return `
    <tr>
      <td class="ctuit-entry-check"><span class="ctuit-entry-box"></span></td>
      <td class="ctuit-entry-time">${shift.start} - ${end}</td>
      <td class="ctuit-entry-role ${roleClass}">${role?.name || "Role"}</td>
      <td class="ctuit-entry-name">${displayName(employee)}</td>
      <td>${flags.join("; ")}</td>
    </tr>
  `;
}

function renderOpenShiftPrintBoxes(departments = null) {
  const shifts = currentWeekOpenShifts().filter((shift) => printDepartmentMatches(shift, departments));
  if (!shifts.length) {
    return `
      <section class="open-shift-print-section">
        <h2>Open Shift Bay</h2>
        <p class="open-shift-print-empty">No open shifts are currently in the Shift Bay for this week.</p>
      </section>
    `;
  }
  const grouped = new Map();
  shifts.forEach((shift) => {
    if (!grouped.has(shift.date)) grouped.set(shift.date, []);
    grouped.get(shift.date).push(shift);
  });
  return `
    <section class="open-shift-print-section">
      <h2>Open Shift Bay</h2>
      <div class="open-shift-print-grid">
        ${Array.from(grouped.entries()).map(([dateKey, dayShifts]) => `
          <section class="open-shift-print-day">
            <h3>${displayDate(parseDateKey(dateKey))}</h3>
            ${dayShifts
              .sort((a, b) => (roleById(a.roleId)?.name || "").localeCompare(roleById(b.roleId)?.name || "") || (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0))
              .map(renderOpenShiftPrintBox)
              .join("")}
          </section>
        `).join("")}
      </div>
    </section>
  `;
}

function renderOpenShiftPrintBox(shift) {
  const role = roleById(shift.roleId);
  const end = shift.untilVolume ? "Vol" : shift.end;
  const meals = getMealsForShift(shift).join(", ");
  return `
    <div class="open-shift-print-box" style="--shift-color:${shiftColor(shift)}">
      <strong>${role?.name || "Role"}</strong>
      <span>${shift.start} - ${end}${shift.isFlexDouble ? " Flex" : ""}</span>
      ${meals ? `<em>${meals}</em>` : ""}
      <div class="open-shift-write-line">Employee</div>
    </div>
  `;
}

function groupPrintShiftsByRole(shifts, sortMode, departments = null) {
  const groups = {};
  const ensureGroup = (roleName, roleId = "") => {
    if (!groups[roleName]) groups[roleName] = { roleName, roleId, shifts: [], employeeIds: new Set() };
    if (roleId && !groups[roleName].roleId) groups[roleName].roleId = roleId;
    return groups[roleName];
  };
  shifts.forEach((shift) => {
    const role = roleById(shift.roleId);
    const key = role?.name || "Other";
    const group = ensureGroup(key, role?.id || shift.roleId || "");
    group.shifts.push(shift);
    group.employeeIds.add(shift.employeeId);
  });
  const dates = weekDates().map(formatDateKey);
  schedulableEmployees()
    .filter(visibleEmployee)
    .filter((employee) => employeeHasPrintableWeekExceptions(employee, dates))
    .forEach((employee) => {
      (employee.roleTraining || []).forEach((roleId) => {
        const role = roleById(roleId);
        if (!role || !state.settings.visibleDepartments.includes(role.department) || (departments && !departments.has(role.department))) return;
        ensureGroup(role.name, role.id).employeeIds.add(employee.id);
      });
    });
  return Object.values(groups).sort((a, b) => comparePrintRoleGroups(a, b, sortMode));
}

function employeeHasPrintableWeekExceptions(employee, dateKeys) {
  return dateKeys.some((dateKey) => (
    timeOffForEmployeeDate(employee.id, dateKey).length ||
    unavailableRangesForEmployeeDate(employee, dateKey).length
  ));
}

function shouldBreakBeforeRole(group, previousGroup) {
  if (!previousGroup) return false;
  const previousWasServer = previousGroup.roleName.toLowerCase().includes("server");
  const currentIsServer = group.roleName.toLowerCase().includes("server");
  return previousWasServer && !currentIsServer;
}

function renderSimpleRoleGrid(group, sortMode, breakBefore, shiftOrder = "time") {
  const dates = weekDates();
  const employeeIds = Array.from(group.employeeIds || new Set(group.shifts.map((shift) => shift.employeeId)))
    .filter(isPrintableScheduledEmployee)
    .sort((a, b) => comparePrintEmployees(a, b, group.shifts, sortMode));
  const roleColor = group.shifts.map((shift) => shiftColor(shift)).find(Boolean) || "#2563eb";
  return `
    <section class="simple-print-section simple-role-print-section ${breakBefore ? "simple-print-break" : ""}" style="--role-print-color:${roleColor}">
      <header class="simple-role-print-header">
        <h3>${escapeHtml(group.roleName)}</h3>
        <span class="simple-role-print-stroke" aria-hidden="true"></span>
      </header>
      <table class="simple-week-table">
        <colgroup>
          <col class="simple-week-employee-col">
          ${dates.map(() => `<col class="simple-week-day-col">`).join("")}
        </colgroup>
        <thead>
          <tr>
            <th>Employee</th>
            ${dates.map((date) => `<th>${displayDate(date)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${employeeIds.map((employeeId) => `
            <tr class="role-row">
              <th>${displayName(employeeById(employeeId))}</th>
              ${dates.map((date) => `<td>${renderSimpleEmployeePrintCell(group, employeeId, formatDateKey(date), shiftOrder)}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderSimpleEmployeePrintCell(group, employeeId, dateKey, shiftOrder) {
  const employee = employeeById(employeeId);
  const extras = renderSimplePrintExtras(employee, employeeId, dateKey);
  const dayShifts = group.shifts
    .filter((shift) => shift.date === dateKey && shift.employeeId === employeeId)
    .sort((a, b) => compareCompactCellShifts(a, b, shiftOrder));
  const shiftLines = dayShifts.map((shift) => {
    const end = shift.untilVolume ? "Vol" : shift.end;
    const closer = shift.isCloser ? " CL" : "";
    const flex = shift.isFlexDouble ? " Flex" : "";
    const color = shiftColor(shift);
    const note = cleanCell(shift.notes);
    return `
      <div class="simple-week-line simple-week-shift" style="--shift-color:${color}">
        <strong>${shift.start} - ${end}${closer}${flex}</strong>
        ${note ? `<span class="simple-week-note">${escapeHtml(note)}</span>` : ""}
      </div>
    `;
  });
  const ghostLines = state.shifts
    .filter((shift) => (
      shift.date === dateKey &&
      shift.employeeId === employeeId &&
      visibleShift(shift) &&
      shift.roleId !== group.roleId
    ))
    .sort((a, b) => compareCompactCellShifts(a, b, shiftOrder))
    .map((shift) => {
      const role = roleById(shift.roleId);
      const end = shift.untilVolume ? "Vol" : shift.end;
      return `
        <div class="simple-week-line simple-week-ghost" title="Also working ${role?.name || "another role"}">
          <strong>${role?.name || "Other"}</strong><em>${shift.start} - ${end}</em>
        </div>
      `;
    });
  return [...extras, ...shiftLines, ...ghostLines].join("");
}

function renderSimplePrintExtras(employee, employeeId, dateKey) {
  const extras = [];
  timeOffForEmployeeDate(employeeId, dateKey).forEach((request) => {
    const isBlock = isScheduleBlock(request);
    const timeText = isBlock && !requestOffIsFullDay(request) ? `${request.start || ""} - ${request.end || ""}` : (request.daypart || "All day");
    const details = [isBlock ? scheduleBlockType(request) : "Request off", timeText, request.note].filter(Boolean).join(" - ");
    extras.push(`<div class="simple-week-line ${isBlock ? "simple-week-block" : "simple-week-ro"}" title="${escapeHtml(details)}"><strong>${isBlock ? "BLOCK" : "RO"}</strong></div>`);
  });
  const unavailableRanges = employee ? unavailableRangesForEmployeeDate(employee, dateKey) : [];
  const allDayUnavailable = unavailableRanges.some((range) => range.start <= 0 && range.end >= 1440);
  if (allDayUnavailable) {
    extras.push(`<div class="simple-week-line simple-week-unavailable-x" title="Unavailable all day"><strong>X</strong></div>`);
  } else if (unavailableRanges.length) {
    const unavailableLabels = unavailableRanges.map(unavailableRangeLabel);
    extras.push(`<div class="simple-week-line simple-week-unavailable"><strong>Unavail</strong><em>${unavailableLabels.join(", ")}</em></div>`);
  }
  return extras;
}

function comparePrintEmployees(aId, bId, shifts, sortMode) {
  if (sortMode === "time" || sortMode === "shift") {
    const aShift = shifts.filter((shift) => shift.employeeId === aId).sort((a, b) => comparePrintShifts(a, b, sortMode))[0];
    const bShift = shifts.filter((shift) => shift.employeeId === bId).sort((a, b) => comparePrintShifts(a, b, sortMode))[0];
    return comparePrintShifts(aShift, bShift, sortMode);
  }
  return displayName(employeeById(aId)).localeCompare(displayName(employeeById(bId)));
}

function compareCompactCellShifts(a, b, shiftOrder = "time") {
  if (!a || !b) return !a && !b ? 0 : !a ? 1 : -1;
  const fallback = () => comparePrintShifts(a, b, "time") ||
    (roleById(a.roleId)?.name || "").localeCompare(roleById(b.roleId)?.name || "") ||
    displayName(employeeById(a.employeeId)).localeCompare(displayName(employeeById(b.employeeId)));
  if (shiftOrder === "endTime") {
    return (a.untilVolume ? 9999 : (minutesFromTime(a.end) ?? 9999)) - (b.untilVolume ? 9999 : (minutesFromTime(b.end) ?? 9999)) || fallback();
  }
  if (shiftOrder === "role") {
    return (roleById(a.roleId)?.name || "").localeCompare(roleById(b.roleId)?.name || "") || fallback();
  }
  if (shiftOrder === "shift") {
    return (a.shiftLabel || "").localeCompare(b.shiftLabel || "") || fallback();
  }
  if (shiftOrder === "employee") {
    return displayName(employeeById(a.employeeId)).localeCompare(displayName(employeeById(b.employeeId))) || fallback();
  }
  if (shiftOrder === "longest") {
    return shiftHours(b) - shiftHours(a) || fallback();
  }
  if (shiftOrder === "shortest") {
    return shiftHours(a) - shiftHours(b) || fallback();
  }
  return fallback();
}

function comparePrintShifts(a, b, sortMode) {
  if (!a || !b) return !a && !b ? 0 : !a ? 1 : -1;
  if (sortMode === "name") return displayName(employeeById(a.employeeId)).localeCompare(displayName(employeeById(b.employeeId))) || comparePrintShifts(a, b, "time");
  if (sortMode === "shift") return (a.shiftLabel || "").localeCompare(b.shiftLabel || "") || comparePrintShifts(a, b, "time");
  if (sortMode === "time") return (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0);
  return (roleById(a.roleId)?.name || "").localeCompare(roleById(b.roleId)?.name || "") || comparePrintShifts(a, b, "time");
}

function printStaffingAnalysis() {
  activateTab("staffing");
  renderStaffingAnalysis();
  window.print();
}

function syncFloorPlanDateToActiveWeek(options = {}) {
  const input = $("floorPlanDate");
  if (!input) return;
  const activeKey = focusedDateKey || formatDateKey(currentDate);
  if (options.handoffDateKey) {
    input.value = options.handoffDateKey;
  } else if (!input.value) {
    input.value = activeKey;
  }
}
function renderFloorPlan(options = {}) {
  if (!$("floorPlanDate")) return;
  syncFloorPlanDateToActiveWeek();
  const dateKey = $("floorPlanDate").value;
  const period = $("floorPlanPeriod").value || "all";
  const noteWarnings = [];
  const groups = floorPlanGroups(dateKey, period, { ...options, noteWarnings });
  const dateText = floorPlanDateText(dateKey);
  setFloorText("date", dateText);
  setFloorText("day", floorPlanDayMarker(dateKey));
  setFloorText("meal", floorPlanMealMarkers(period));
  setFloorText("host", groups.host);
  setFloorText("expo", groups.expo);
  setFloorText("servers", groups.servers);
  setFloorText("busser", groups.busser);
  setFloorText("bartender", groups.bartender);
  setFloorText("banquet", groups.banquet);
  renderFloorPlanDailyNote(dateKey);
  const total = Object.values(groups).reduce((sum, names) => sum + names.length, 0);
  const warningText = noteWarnings.length
    ? ` ${noteWarnings.length} floor-plan note${noteWarnings.length === 1 ? " was" : "s were"} shortened: ${[...new Set(noteWarnings)].slice(0, 3).join("; ")}${noteWarnings.length > 3 ? "..." : ""}`
    : "";
  $("floorPlanSummary").textContent = `${total} scheduled FOH employee${total === 1 ? "" : "s"} found for ${displayDate(parseDateKey(dateKey))} / ${floorPlanPeriodLabel(period)}.${warningText}`;
}

function dayNoteForDate(dateKey) {
  return String(state.dailyNotes?.[dateKey] || "").trim();
}

function renderFloorPlanDailyNote(dateKey) {
  const target = document.querySelector('[data-floor-output="day-notes"]');
  if (target) target.textContent = dayNoteForDate(dateKey);
}

function floorPlanDailyNoteMarkup(dateKey) {
  return `<div class="floor-overlay floor-day-notes">${escapeHtml(dayNoteForDate(dateKey))}</div>`;
}

function openDayNotesDialog(dateKey = focusedDateKey || formatDateKey(currentDate)) {
  const dialog = $("dayNotesDialog");
  if (!dialog) return;
  $("dayNotesDate").textContent = `These notes will print on the floor chart for ${displayDate(parseDateKey(dateKey))}.`;
  $("dayNotesInput").value = dayNoteForDate(dateKey);
  $("clearDayNotesBtn").onclick = () => {
    $("dayNotesInput").value = "";
    $("dayNotesInput").focus();
  };
  $("cancelDayNotesBtn").onclick = () => dialog.close();
  $("dayNotesForm").onsubmit = async (event) => {
    event.preventDefault();
    const note = $("dayNotesInput").value.trim();
    if (note === dayNoteForDate(dateKey)) {
      dialog.close();
      return;
    }
    pushUndo();
    state.dailyNotes ||= {};
    if (note) state.dailyNotes[dateKey] = note;
    else delete state.dailyNotes[dateKey];
    dialog.close();
    if ($("floorPlanDate")?.value === dateKey) renderFloorPlan();
    if (focusedDateKey === dateKey) renderSchedule();
    await saveState({ immediate: true });
  };
  if (dialog.open) dialog.close();
  dialog.showModal();
  window.setTimeout(() => $("dayNotesInput")?.focus(), 50);
}

function floorPlanGroups(dateKey, period, options = {}) {
  const groups = { host: [], expo: [], servers: [], busser: [], bartender: [], banquet: [] };
  const dayShifts = state.shifts
    .filter((shift) => shift.date === dateKey && shift.department === "FOH");
  const floorShifts = state.shifts
    .filter((shift) => shift.date === dateKey && shift.department === "FOH" && shiftMatchesFloorPlanPeriod(shift, period))
    .sort((a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0));
  const firstNameCounts = floorPlanFirstNameCounts(floorShifts);
  const pushEntry = (groupKey, employee, shift) => {
    groups[groupKey].push({
      html: floorPlanEmployeeLine(employee, shift, firstNameCounts, { ...options, period, dayShifts, groupKey }),
      shift
    });
  };
  floorShifts.forEach((shift) => {
      const roleName = roleById(shift.roleId)?.name?.toLowerCase() || "";
      const employee = employeeById(shift.employeeId);
      if (!employee) return;
      if (roleName.includes("host")) pushEntry("host", employee, shift);
      else if (roleName.includes("expo")) pushEntry("expo", employee, shift);
      else if (roleName.includes("bus")) pushEntry("busser", employee, shift);
      else if (roleName.includes("bar")) pushEntry("bartender", employee, shift);
      else if (isBanquetRole(shift)) pushEntry("banquet", employee, shift);
      else if (roleName.includes("server")) pushEntry("servers", employee, shift);
    });
  Object.keys(groups).forEach((key) => {
    const seen = new Set();
    groups[key] = groups[key]
      .filter((entry) => {
        if (seen.has(entry.html)) return false;
        seen.add(entry.html);
        return true;
      })
      .sort((a, b) => {
        if (key === "servers" && Boolean(a.shift.isCloser) !== Boolean(b.shift.isCloser)) {
          return a.shift.isCloser ? 1 : -1;
        }
        return (minutesFromTime(a.shift.start) ?? 0) - (minutesFromTime(b.shift.start) ?? 0);
      })
      .map((entry) => entry.html);
  });
  return groups;
}

function floorPlanFirstNameCounts(shifts) {
  const employeeIds = new Set(shifts.map((shift) => shift.employeeId).filter(Boolean));
  const counts = {};
  employeeIds.forEach((employeeId) => {
    const employee = employeeById(employeeId);
    const first = cleanCell(employee?.nickname || employee?.firstName).toLowerCase();
    if (!first) return;
    counts[first] = (counts[first] || 0) + 1;
  });
  return counts;
}

function floorPlanShiftTime(shift, employee) {
  const start = floorPlanTimeNumber(shift.start);
  if (shift.isCloser) return `${start} - CL`;
  if (shift.isLunchCloser || employee?.alwaysPrintFloorEndTime) {
    const end = floorPlanTimeNumber(shift.end);
    return end ? `${start} - ${end}` : start;
  }
  if (shift.isFlexDouble || shift.untilVolume) return `${start} - ?`;
  return start;
}

function floorPlanTrainingSegmentText(shift) {
  const end = floorPlanTimeNumber(shift.training?.segmentEnd);
  return end ? ` til ${end}` : "";
}

function floorPlanTrainingNote(shift) {
  const notes = [];
  const trainerLinks = state.shifts.filter((item) => trainingShiftMatchesTrainerShift(item, shift));
  const segmentText = floorPlanTrainingSegmentText(shift);
  const hasDetailedTrainerLink = trainerLinks.some((item) => floorPlanTrainingSegmentText(item));
  if (shift.training?.isTraining) {
    const trainee = employeeById(shift.training.traineeId);
    const trainer = employeeById(shift.training.trainerId);
    if (shift.employeeId === shift.training.trainerId) {
      if ((trainee || !trainerLinks.length) && !hasDetailedTrainerLink) notes.push(`Trains ${trainee ? floorPlanEmployeeName(trainee) : "trainee"}${segmentText}`);
    } else if (shift.employeeId === shift.training.traineeId) {
      notes.push(`TR w/${trainer ? floorPlanEmployeeName(trainer) : "trainer"}${segmentText}`);
    } else {
      if (trainee) notes.push(`Trainee ${floorPlanEmployeeName(trainee)}${segmentText}`);
      if (trainer) notes.push(`Trainer ${floorPlanEmployeeName(trainer)}${segmentText}`);
    }
  }
  trainerLinks.forEach((item) => {
    const trainee = employeeById(item.training.traineeId || item.employeeId);
    notes.push(`Trains ${trainee ? floorPlanEmployeeName(trainee) : "trainee"}${floorPlanTrainingSegmentText(item)}`);
  });
  return [...new Set(notes)].join(" | ");
}

function isBanquetRole(shift) {
  const roleName = roleById(shift.roleId)?.name?.toLowerCase() || "";
  return roleName.includes("banquet") || roleName.includes("bqt");
}

function floorPlanOperationalNotes(employee, shift, context = {}) {
  if (!shouldShowFloorPlanCrossRoleNote(shift)) return [];
  const notes = [];
  const dayShifts = context.dayShifts || [];
  const otherShifts = dayShifts.filter((item) => item.id !== shift.id && item.employeeId === employee.id);
  const period = context.period || "all";
  const oppositePeriod = period === "am" ? "pm" : period === "pm" ? "am" : "";
  const oppositePeriodShifts = oppositePeriod
    ? otherShifts.filter((item) => shiftMatchesFloorPlanPeriod(item, oppositePeriod))
    : [];
  const shiftTimeAlreadyShowsOpenEnd = shift.isFlexDouble || shift.untilVolume || shift.isCloser;
  const otherRoleNotes = [...new Set(otherShifts
    .filter((item) => floorPlanRoleAbbrev(item) !== floorPlanRoleAbbrev(shift))
    .map((item) => `/ ${floorPlanRoleAbbrev(item)}`))];
  if (otherRoleNotes.length) {
    notes.push(...otherRoleNotes);
  } else if (!shiftTimeAlreadyShowsOpenEnd && oppositePeriodShifts.length) {
    notes.push("- ?");
  }
  const hasBanquet = otherShifts.some((item) => isBanquetRole(item));
  const pairedFloorRole = otherShifts.find((item) => !isBanquetRole(item));
  if (isBanquetRole(shift) && pairedFloorRole) notes.push(`/ ${floorPlanRoleAbbrev(pairedFloorRole)}`);
  if (!isBanquetRole(shift) && hasBanquet) notes.push("/ BQT");
  return notes;
}

function floorPlanRoleAbbrev(shift) {
  const roleName = roleById(shift.roleId)?.name?.toLowerCase() || "";
  if (isBanquetRole(shift)) return "BQT";
  if (roleName.includes("bar")) return "BAR";
  if (roleName.includes("host")) return "HOST";
  if (roleName.includes("expo")) return "EXPO";
  if (roleName.includes("bus")) return "BUS";
  if (roleName.includes("server")) return "SERV";
  return "FLOOR";
}

function splitFloorPlanNote(note) {
  const clean = cleanCell(note);
  if (!clean || clean.length <= FLOOR_PLAN_NOTE_LIMIT) return { primary: clean, extra: "", truncated: false, original: clean };
  const splitAt = clean.lastIndexOf(" ", FLOOR_PLAN_NOTE_LIMIT);
  const primaryEnd = splitAt > 6 ? splitAt : FLOOR_PLAN_NOTE_LIMIT;
  const primary = clean.slice(0, primaryEnd).trim();
  const remaining = clean.slice(primaryEnd).trim();
  const extra = remaining.slice(0, FLOOR_PLAN_NOTE_EXTRA_LIMIT).trim();
  return { primary, extra, truncated: remaining.length > extra.length, original: clean };
}

function floorPlanTimeNumber(time) {
  return String(time || "")
    .replace(/\s*(AM|PM)\b/gi, "")
    .replace(/:00\b/g, "")
    .trim();
}

function floorPlanEmployeeName(employee, firstNameCounts = {}) {
  const first = cleanCell(employee?.nickname || employee?.firstName);
  if (!first) return displayName(employee);
  const duplicate = (firstNameCounts[first.toLowerCase()] || 0) > 1;
  return duplicate ? `${first} ${employee.lastName?.[0] || ""}.` : first;
}

function floorPlanEmployeeLine(employee, shift, firstNameCounts = {}, context = {}) {
  const notes = [floorPlanTrainingNote(shift), cleanCell(shift.notes), ...floorPlanOperationalNotes(employee, shift, context)].filter(Boolean);
  const noteText = [...new Set(notes)].join(" | ").replace(/\s+\|\s+-\s+\?/g, " - ?");
  const noteParts = splitFloorPlanNote(noteText);
  if (noteParts.truncated && Array.isArray(context.noteWarnings)) {
    context.noteWarnings.push(`${floorPlanEmployeeName(employee, firstNameCounts)} (${floorPlanShiftTime(shift, employee)})`);
  }
  const tightFloorArea = ["host"].includes(context.groupKey);
  const crossRoleNote = noteParts.primary?.startsWith("/") || noteParts.primary?.startsWith("-");
  const primaryNote = tightFloorArea && crossRoleNote ? "" : noteParts.primary;
  const extraNote = tightFloorArea && crossRoleNote
    ? [noteParts.primary, noteParts.extra].filter(Boolean).join(" ").trim()
    : noteParts.extra;
  const noteSeparator = primaryNote?.startsWith("/") || primaryNote?.startsWith("-") ? " " : " | ";
  const timeText = `${floorPlanShiftTime(shift, employee)}${primaryNote ? `${noteSeparator}${primaryNote}` : ""}`;
  const nameClass = extraNote ? "floor-name floor-name-with-extra" : "floor-name";
  return `<span class="${nameClass}">${floorPlanEmployeeName(employee, firstNameCounts)}</span><span class="floor-time">${timeText}</span>${extraNote ? `<span class="floor-note-extra">${extraNote}</span>` : ""}`;
}

function floorPlanPeriodLabel(period) {
  if (period === "am") return "AM";
  if (period === "pm") return "PM";
  if (MEALS.includes(period)) return period;
  return "All-Day";
}

function floorPlanDateText(dateKey) {
  const date = parseDateKey(dateKey);
  return `
    <span class="floor-date-month">${String(date.getMonth() + 1).padStart(2, "0")}</span>
    <span class="floor-date-day">${String(date.getDate()).padStart(2, "0")}</span>
  `;
}

function floorPlanDayMarker(dateKey) {
  const dayIndex = parseDateKey(dateKey).getDay();
  return `<span class="floor-circle floor-day-${dayIndex}"></span>`;
}

function floorPlanMealsForPeriod(period) {
  if (period === "am") return ["Breakfast", "Lunch"];
  if (period === "pm") return ["Dinner"];
  if (MEALS.includes(period)) return [period];
  return ["Breakfast", "Lunch", "Dinner"];
}

function floorPlanMealMarkers(period) {
  return floorPlanMealsForPeriod(period)
    .map((meal) => `<span class="floor-circle floor-meal-${meal.toLowerCase()}"></span>`)
    .join("");
}

function shiftMatchesFloorPlanPeriod(shift, period) {
  const periods = floorPlanPeriodsForShiftDate(shift.date);
  if (!periods.length) return false;
  const range = floorPlanShiftRange(shift);
  if (range.start == null || range.end == null) return false;
  const sortedPeriods = [...periods].sort((a, b) => a.startMinutes - b.startMinutes);
  const dinner = sortedPeriods.find((mealPeriod) => mealPeriod.name === "Dinner");
  if (period === "pm") {
    if (shift.isFlexDouble || shift.untilVolume) return true;
    if (!dinner) return false;
    const dinnerIndex = sortedPeriods.indexOf(dinner);
    const previousMeal = [...sortedPeriods.slice(0, dinnerIndex)].reverse().find((mealPeriod) => mealPeriod.endMinutes != null);
    const serviceCutoff = previousMeal?.endMinutes ?? dinner.startMinutes;
    const cleanupMinutes = Math.max(0, Number(state.settings.floorPlanCleanupMinutes ?? 90) || 0);
    return range.start >= dinner.startMinutes || range.end > serviceCutoff + cleanupMinutes;
  }
  if (period === "am") return dinner ? range.start < dinner.startMinutes : true;
  const startsInNamedPeriod = (names) => sortedPeriods
    .filter((mealPeriod) => names.includes(mealPeriod.name))
    .some((mealPeriod) => {
      const isFirstPeriod = sortedPeriods[0]?.name === mealPeriod.name;
      return (isFirstPeriod && range.start < mealPeriod.endMinutes) ||
        (range.start >= mealPeriod.startMinutes && range.start < mealPeriod.endMinutes);
    });
  if (MEALS.includes(period)) return startsInNamedPeriod([period]);
  return periods.some((mealPeriod) => rangesOverlap(range.start, range.end, mealPeriod.startMinutes, mealPeriod.endMinutes));
}

function floorPlanPeriodsForShiftDate(dateKey) {
  return getMealPeriodsForDate(dateKey).map((period) => {
    let endMinutes = period.endMinutes;
    if (endMinutes != null && period.startMinutes != null && endMinutes <= period.startMinutes) endMinutes += 1440;
    return { ...period, endMinutes };
  });
}

function floorPlanShiftRange(shift) {
  const start = minutesFromTime(shift.start);
  if (start == null) return { start: null, end: null };
  let end = shift.untilVolume ? estimatedUntilVolumeEnd({ ...shift, isFlexDouble: false }) : minutesFromTime(shift.end);
  if (end == null) end = minutesFromTime(shift.end);
  if (end == null) end = start + 60;
  if (end <= start) end += 1440;
  return { start, end };
}

function setFloorText(key, values) {
  const target = document.querySelector(`[data-floor-output="${key}"]`);
  if (!target) return;
  const list = Array.isArray(values) ? values : [values];
  target.innerHTML = list.filter(Boolean).map((value) => `<div>${value}</div>`).join("");
}

function printFloorPlan() {
  activateTab("floorplans");
  renderFloorPlan({ forPrint: true });
  window.print();
}

function renderFloorPlanSheetMarkup(dateKey, period, options = {}) {
  const noteWarnings = [];
  const groups = floorPlanGroups(dateKey, period, { ...options, noteWarnings });
  const warning = noteWarnings.length
    ? `<div class="floor-overlay floor-note-warning">Shortened note: ${escapeHtml([...new Set(noteWarnings)].slice(0, 2).join("; "))}${noteWarnings.length > 2 ? "..." : ""}</div>`
    : "";
  const overlay = (className, values) => {
    const list = Array.isArray(values) ? values : [values];
    return `<div class="floor-overlay ${className}">${list.filter(Boolean).map((value) => `<div>${value}</div>`).join("")}</div>`;
  };
  return `
    <div class="floor-plan-sheet floor-plan-print-page">
      <img src="assets/shed-floor-plan.png?v=shiftbay-20260626-no-bqt-at" alt="Shed floor plan template">
      ${overlay("floor-date-line", floorPlanDateText(dateKey))}
      <div class="floor-overlay floor-day-circles">${floorPlanDayMarker(dateKey)}</div>
      <div class="floor-overlay floor-meal-circles">${floorPlanMealMarkers(period)}</div>
      ${overlay("floor-host", groups.host)}
      ${overlay("floor-expo", groups.expo)}
      ${overlay("floor-servers", groups.servers)}
      ${overlay("floor-busser", groups.busser)}
      ${overlay("floor-bartender", groups.bartender)}
      ${overlay("floor-banquet", groups.banquet)}
      ${floorPlanDailyNoteMarkup(dateKey)}
      ${warning}
    </div>
  `;
}

function floorPlanWeekJobs() {
  const rules = state.settings.floorPlanPrintRules || defaultFloorPlanPrintRules();
  return weekDates().flatMap((date) => {
    const dayIndex = date.getDay();
    return (rules[dayIndex] || []).map((period) => ({ dateKey: formatDateKey(date), period }));
  });
}

function printFloorPlanWeek() {
  activateTab("floorplans");
  const jobs = floorPlanWeekJobs();
  if (!jobs.length) {
    showConflict("No floor plan sheets are selected in Settings.");
    return;
  }
  $("floorPlanWeekPrint").innerHTML = jobs.map((job) => renderFloorPlanSheetMarkup(job.dateKey, job.period, { forPrint: true })).join("");
  $("floorPlanWeekPrint").hidden = false;
  document.body.classList.add("printing-floor-week");
  window.print();
  window.setTimeout(() => {
    document.body.classList.remove("printing-floor-week");
    $("floorPlanWeekPrint").hidden = true;
    $("floorPlanWeekPrint").innerHTML = "";
  }, 250);
}

async function printCompletedWeek() {
  if (!(await checkPrintCoverage())) return;
  activateTab("floorplans");
  const jobs = floorPlanWeekJobs();
  if (!jobs.length) {
    showConflict("No floor plan sheets are selected in Settings.");
    return;
  }
  renderSimpleRolePrintView("role");
  $("floorPlanWeekPrint").innerHTML = jobs.map((job) => renderFloorPlanSheetMarkup(job.dateKey, job.period, { forPrint: true })).join("");
  $("floorPlanWeekPrint").hidden = false;
  document.body.classList.add("printing-simple", "printing-floor-week", "printing-completed-week");
  window.print();
  window.setTimeout(() => {
    document.body.classList.remove("printing-simple", "printing-floor-week", "printing-completed-week");
    $("floorPlanWeekPrint").hidden = true;
    $("floorPlanWeekPrint").innerHTML = "";
    clearPrintView();
  }, 500);
}

function printCallWeeklySheet() {
  const employees = schedulableEmployees()
    .filter((employee) => employee.callWeekly)
    .sort((a, b) => fullEmployeeName(a).localeCompare(fullEmployeeName(b)));
  $("callWeeklySheet").hidden = false;
  $("callWeeklySheet").innerHTML = `
    <h2>Weekly Availability Calls</h2>
    <p>${displayDate(currentDate)} - ${displayDate(addDays(currentDate, 6))}</p>
    <table class="call-weekly-table">
      <thead>
        <tr>
          <th>Employee</th>
          <th>Phone</th>
          ${weekDates().map((date) => `<th>${DAYS[date.getDay()].slice(0, 3)}<br><small>${date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</small></th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${employees.map((employee) => `
          <tr>
            <th>${fullEmployeeName(employee)}${employee.nickname ? `<br><small>${employee.nickname}</small>` : ""}</th>
            <td>${formatPhoneNumber(employee.phone || "")}</td>
            ${weekDates().map(() => `<td class="write-box"></td>`).join("")}
          </tr>
        `).join("") || `<tr><td colspan="9">No active employees are marked Call Weekly.</td></tr>`}
      </tbody>
    </table>
  `;
  activateTab("employees");
  document.body.classList.add("printing-call-weekly");
  window.print();
  window.setTimeout(() => {
    document.body.classList.remove("printing-call-weekly");
    $("callWeeklySheet").hidden = true;
  }, 250);
}

function openTrainingPlanDialog() {
  $("planTrainee").innerHTML = sortedEmployeesForSelect()
    .map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employeeOptionLabel(employee))}</option>`)
    .join("");
  $("planRole").innerHTML = state.roles.map((role) => `<option value="${role.id}">${role.name}</option>`).join("");
  $("planStartDate").value = formatDateKey(currentDate);
  trainingPlanSuggestions = [];
  $("trainingPlanResults").innerHTML = `<p class="hint">Choose a trainee, role, and start date, then find available trainer shifts.</p>`;
  $("trainingPlanDialog").showModal();
}

function generateTrainingPlan() {
  const traineeId = $("planTrainee").value;
  const roleId = $("planRole").value;
  const startDate = $("planStartDate").value;
  const config = state.settings.trainingRequirements?.[roleId] || {};
  const needed = Number(config.days) || 0;
  if (!traineeId || !roleId || !startDate || !needed) {
    $("trainingPlanResults").innerHTML = `<p class="hint">Set a trainee, role, start date, and required training shift count in Settings.</p>`;
    return;
  }
  const usedTrainerDateKeys = new Set(state.shifts
    .filter((shift) => shift.training?.isTraining && shift.roleId === roleId)
    .map((shift) => `${shift.training.trainerId}:${shift.date}`));
  const candidates = state.shifts
    .filter((shift) => {
      const trainer = employeeById(shift.employeeId);
      return shift.date >= startDate &&
        shift.roleId === roleId &&
        !shift.training?.isTraining &&
        trainer?.trainerRoles?.includes(roleId) &&
        !usedTrainerDateKeys.has(`${shift.employeeId}:${shift.date}`);
    })
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
  const requiredShifts = config.requiredShifts || (config.requiredLabels || []).map((name) => ({ name, dayIndex: "" }));
  const chosen = [];
  requiredShifts.forEach((requirement) => {
    const label = String(requirement.name || "").toLowerCase();
    const match = candidates.find((shift) => (
      !chosen.includes(shift) &&
      trainingCandidateText(shift).includes(label) &&
      (requirement.dayIndex === "" || String(parseDateKey(shift.date).getDay()) === String(requirement.dayIndex))
    ));
    if (match) chosen.push(match);
  });
  candidates.forEach((shift) => {
    if (chosen.length < needed && !chosen.includes(shift)) chosen.push(shift);
  });
  trainingPlanSuggestions = chosen.slice(0, needed).map((shift, index) => ({
    sourceShiftId: shift.id,
    date: shift.date,
      employeeId: traineeId,
      department: shift.department,
      shiftLabel: shift.shiftLabel || "Training",
      roleId: shift.roleId,
    start: shift.start,
    end: shift.end,
    untilVolume: shift.untilVolume,
    meals: [],
    notes: "Training",
    color: roleById(shift.roleId)?.color,
    training: {
      isTraining: true,
      traineeId,
      trainerId: shift.employeeId,
      segmentEnd: "",
      dayOverride: index + 1
    }
  }));
  renderTrainingPlanResults();
}

function trainingCandidateText(shift) {
  const role = roleById(shift.roleId);
  return `${shift.shiftLabel || ""} ${role?.name || ""} ${getMealsForShift(shift).join(" ")} ${shift.start} ${shift.end} ${shift.notes || ""}`.toLowerCase();
}

function renderTrainingPlanResults() {
  if (!trainingPlanSuggestions.length) {
    $("trainingPlanResults").innerHTML = `<p class="hint">No available trainer shifts were found after that start date.</p>`;
    return;
  }
  $("trainingPlanResults").innerHTML = `
    <table>
      <thead><tr><th>Day</th><th>Role</th><th>Trainer</th><th>Time</th><th>Training Day</th></tr></thead>
      <tbody>
        ${trainingPlanSuggestions.map((shift) => {
          const role = roleById(shift.roleId);
          const trainer = employeeById(shift.training.trainerId);
          return `<tr><td>${displayDate(parseDateKey(shift.date))}</td><td>${role?.name || ""}</td><td>${trainer ? displayName(trainer) : ""}</td><td>${shift.start} - ${shift.untilVolume ? "Until Volume" : shift.end}</td><td>${shift.training.dayOverride}</td></tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

function addTrainingPlan() {
  if (!trainingPlanSuggestions.length) return;
  pushUndo();
  trainingPlanSuggestions.forEach((shift) => {
    state.shifts.push({ ...shift, id: uid("shift") });
  });
  $("trainingPlanDialog").close();
  renderAll();
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function backup() {
  saveState();
  const envelope = {
    app: "restaurant-scheduler",
    schemaVersion: DATA_SCHEMA_VERSION,
    exportedAt: nowIso(),
    exportedByDeviceId: getDeviceId(),
    data: state
  };
  downloadFile(`restaurant_scheduler_backup_${formatDateKey(new Date())}.json`, JSON.stringify(envelope, null, 2), "application/json");
}

function openStorageInfo() {
  saveState();
  const counts = {
    roles: state.roles?.length || 0,
    employees: state.employees?.length || 0,
    activeEmployees: schedulableEmployees().length,
    templates: state.templates?.length || 0,
    templateShifts: (state.templates || []).reduce((sum, template) => sum + (template.shifts?.length || 0), 0),
    assignedShifts: state.shifts?.length || 0,
    openBayShifts: state.unassignedShifts?.length || 0,
    timeOffRequests: state.timeOffRequests?.length || 0
  };
  $("storageInfoBody").innerHTML = `
    <table>
      <tbody>
        <tr><th>Schema version</th><td>${state.meta?.schemaVersion || DATA_SCHEMA_VERSION}</td></tr>
        <tr><th>Storage mode</th><td>${SERVER_STORAGE_ENABLED ? "Shared file server" : "Browser local only"}</td></tr>
        <tr><th>Storage status</th><td>${storageStatusLabel(storageStatus)}</td></tr>
        <tr><th>Document ID</th><td>${state.meta?.documentId || ""}</td></tr>
        <tr><th>This device ID</th><td>${getDeviceId()}</td></tr>
        <tr><th>Created</th><td>${state.meta?.createdAt || ""}</td></tr>
        <tr><th>Last saved</th><td>${state.meta?.updatedAt || ""}</td></tr>
        ${Object.entries(counts).map(([label, count]) => `<tr><th>${label}</th><td>${count}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
  $("storageInfoDialog").showModal();
}

function formatAuditChangeSummary(summary = {}) {
  const items = [
    [summary.shiftsCreated, "shifts created"],
    [summary.shiftsEdited, "shifts edited"],
    [summary.shiftsDeleted, "shifts deleted"],
    [summary.openShiftsCreated, "open shifts added"],
    [summary.openShiftsEdited, "open shifts edited"],
    [summary.openShiftsDeleted, "open shifts deleted"],
    [summary.requestOffsCreated, "ROs/blocks added"],
    [summary.requestOffsEdited, "ROs/blocks edited"],
    [summary.requestOffsDeleted, "ROs/blocks deleted"],
    [summary.employeesChanged, "employees changed"],
    [summary.templatesChanged, "templates changed"]
  ].filter(([count]) => Number(count) > 0);
  return items.length ? items.map(([, label]) => label).join(" / ") : "No schedule records changed";
}

function updateRecentActivityDetailsButton() {
  const button = $("toggleRecentActivityDetailsBtn");
  if (!button) return;
  button.textContent = recentActivityDetailsVisible ? "-" : "+";
  button.setAttribute("aria-expanded", String(recentActivityDetailsVisible));
  button.title = recentActivityDetailsVisible ? "Hide advanced audit details" : "Show advanced audit details";
}

function renderRecentActivityEvents(events = recentActivityEvents) {
  const body = $("recentActivityBody");
  updateRecentActivityDetailsButton();
  if (!body) return;
  if (!events.length) {
    body.innerHTML = `<p class="hint">No recent cloud activity has been recorded yet.</p>`;
    return;
  }
  body.innerHTML = events.map(formatAuditEvent).join("");
}

function formatAuditEvent(event) {
  const details = event.details || {};
  const when = event.created_at ? new Date(event.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "Unknown time";
  const device = details.savedByDeviceId ? String(details.savedByDeviceId).slice(0, 8) : "";
  const label = event.event_type === "scheduler_state_saved" ? "Schedule saved" : String(event.event_type || "Activity").replaceAll("_", " ");
  const user = details.savedByEmail || event.user_email || (event.user_id ? `User ${String(event.user_id).slice(0, 8)}` : "Unknown user");
  const summary = details.changeSummary;
  const role = details.savedByRole || "";
  const meta = [
    role ? `Role: ${role}` : "",
    details.schemaVersion ? `Schema: ${details.schemaVersion}` : "",
    device ? `Device: ${device}` : ""
  ].filter(Boolean);
  return `
    <article class="recent-activity-card">
      <div class="recent-activity-main">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(when)}</span>
      </div>
      <div class="recent-activity-user">Saved by ${escapeHtml(user)}</div>
      ${summary ? `<div class="recent-activity-summary">${escapeHtml(formatAuditChangeSummary(summary))}</div>` : ""}
      ${recentActivityDetailsVisible && meta.length ? `<div class="recent-activity-meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
    </article>
  `;
}

async function openRecentActivity() {
  const body = $("recentActivityBody");
  if (body) body.innerHTML = `<p class="hint">Loading recent cloud activity...</p>`;
  $("recentActivityDialog")?.showModal();
  try {
    const result = await fetchJson("/api/audit/recent", {
      cache: "no-store",
      headers: authRequestHeaders()
    });
    recentActivityEvents = Array.isArray(result.events) ? result.events : [];
    renderRecentActivityEvents();
  } catch {
    if (body) body.innerHTML = `<p class="hint">Recent cloud activity is not available in this version yet.</p>`;
  }
}
function managerRoleLabel(role = "") {
  const labels = { owner: "Owner", manager: "Manager", viewer: "Viewer" };
  return labels[String(role).toLowerCase()] || role || "Manager";
}

function setManagerAccessMessage(message = "") {
  const target = $("managerAccessMessage");
  if (target) target.textContent = message;
}

function renderTemporaryManagerLogin(details = null) {
  const target = $("managerTempLogin");
  if (!target) return;
  if (!details?.temporaryPassword) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const loginUrl = details.loginUrl || "https://shift-bay.netlify.app";
  target.hidden = false;
  target.innerHTML = [
    `<strong>${details.temporaryPasswordReissued ? "New temporary password issued. The previous password no longer works." : details.inviteEmailSent ? "Invitation email sent." : details.reusedExistingLogin ? "Existing manager login relinked. Copy this new temporary password before closing." : "Manager login created. Copy this before closing."}</strong>`,
    `<div>Email: <code>${escapeHtml(details.email || "")}</code></div>`,
    `<div>Temporary password: <code>${escapeHtml(details.temporaryPassword)}</code></div>`,
    `<div>Login URL: <code>${escapeHtml(loginUrl)}</code></div>`,
    details.temporaryPasswordReissued
      ? "<small>This replacement password remains valid until the manager creates a permanent password.</small>"
      : details.inviteEmailSent
      ? "<small>The email includes these login details. Keep this panel available as a backup until the manager confirms receipt.</small>"
      : `<small>Email was not sent${details.inviteEmailError ? `: ${escapeHtml(details.inviteEmailError)}` : "."} Share this password directly for now.</small>`
  ].join("");
}

function renderManagerAccessList(managers = []) {
  const target = $("managerAccessList");
  if (!target) return;
  if (!managers.length) {
    target.innerHTML = `<p class="hint">No managers are linked yet.</p>`;
    return;
  }
  target.innerHTML = `
    <div class="manager-access-list">
      ${managers.map((manager) => `
        <section class="manager-access-card" data-manager-user-id="${escapeHtml(manager.userId)}">
          <div class="manager-access-person">
            <strong>${escapeHtml(manager.email || manager.userId)}</strong>
            <small>${escapeHtml(manager.userId)}</small>
          </div>
          <label>Role
            <select class="manager-access-role-select" data-manager-role>
              ${["owner", "manager", "viewer"].map((role) => `<option value="${role}" ${role === manager.role ? "selected" : ""}>${managerRoleLabel(role)}</option>`).join("")}
            </select>
          </label>
          <span class="manager-access-added">${manager.createdAt ? escapeHtml(new Date(manager.createdAt).toLocaleDateString()) : ""}</span>
          <button type="button" class="temporary-password-action" data-manager-temp-password ${manager.passwordChangeRequired ? "" : "disabled title=\"This password has already been replaced by a permanent password.\""}>${manager.passwordChangeRequired ? "Issue temp password" : "Password set"}</button>
          <button type="button" data-manager-remove ${manager.userId === currentUser?.id ? "disabled" : ""}>Remove</button>
        </section>
      `).join("")}
    </div>
  `;
  target.querySelectorAll("[data-manager-role]").forEach((select) => {
    select.addEventListener("change", async (event) => {
      const row = event.target.closest("[data-manager-user-id]");
      await updateManagerRole(row?.dataset.managerUserId, event.target.value);
    });
  });
  target.querySelectorAll("[data-manager-remove]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const row = event.target.closest("[data-manager-user-id]");
      await removeManagerAccess(row?.dataset.managerUserId);
    });
  });
  target.querySelectorAll("[data-manager-temp-password]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const row = event.target.closest("[data-manager-user-id]");
      await issueManagerTemporaryPassword(row?.dataset.managerUserId, button);
    });
  });
}
async function loadManagerAccess() {
  setManagerAccessMessage("Loading manager access...");
  try {
    const result = await fetchJson("/api/managers", {
      cache: "no-store",
      headers: authRequestHeaders()
    });
    renderManagerAccessList(Array.isArray(result.managers) ? result.managers : []);
    setManagerAccessMessage("Owner-only manager access controls.");
  } catch (error) {
    setManagerAccessMessage(error.message || "Could not load manager access.");
    renderManagerAccessList([]);
  }
}

async function openManagerAccess() {
  if (currentUser?.role !== "owner") return;
  renderTemporaryManagerLogin(null);
  $("managerAccessDialog")?.showModal();
  await loadManagerAccess();
}

async function sendManagerInvite(event) {
  event.preventDefault();
  const button = $("sendManagerInviteBtn");
  const email = $("managerInviteEmail")?.value.trim();
  const role = $("managerInviteRole")?.value || "manager";
  if (!email) {
    setManagerAccessMessage("Enter an email address first.");
    return;
  }
  renderTemporaryManagerLogin(null);
  if (button) { button.disabled = true; button.textContent = "Creating..."; }
  try {
    const result = await fetchJson("/api/managers/invite", {
      method: "POST",
      headers: authRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ email, role })
    });
    $("managerInviteEmail").value = "";
    renderTemporaryManagerLogin({
      email,
      temporaryPassword: result.temporaryPassword,
      loginUrl: result.loginUrl,
      reusedExistingLogin: Boolean(result.reusedExistingLogin),
      inviteEmailSent: Boolean(result.inviteEmailSent),
      inviteEmailError: result.inviteEmailError || ""
    });
    setManagerAccessMessage(result.reusedExistingLogin
      ? result.inviteEmailSent
        ? `Existing login for ${email} was relinked and the invitation email was sent.`
        : `Existing login for ${email} was relinked. Email delivery was unavailable.`
      : result.inviteEmailSent
        ? `Login created for ${email}. The invitation email was sent.`
        : `Login created for ${email}. Email delivery was unavailable.`);
    await loadManagerAccess();
  } catch (error) {
    setManagerAccessMessage(error.message || "Could not create manager login.");
  } finally {
    if (button) { button.disabled = false; button.textContent = "Create Login"; }
  }
}

async function updateManagerRole(userId, role) {
  if (!userId || !role) return;
  setManagerAccessMessage("Updating role...");
  try {
    await fetchJson("/api/managers/role", {
      method: "POST",
      headers: authRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ userId, role })
    });
    setManagerAccessMessage("Manager role updated.");
    await loadManagerAccess();
  } catch (error) {
    setManagerAccessMessage(error.message || "Could not update role.");
    await loadManagerAccess();
  }
}

async function removeManagerAccess(userId) {
  if (!userId) return;
  setManagerAccessMessage("Removing access...");
  try {
    await fetchJson("/api/managers/remove", {
      method: "POST",
      headers: authRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ userId })
    });
    setManagerAccessMessage("Manager access removed.");
    await loadManagerAccess();
  } catch (error) {
    setManagerAccessMessage(error.message || "Could not remove manager access.");
  }
}

async function issueManagerTemporaryPassword(userId, button) {
  if (!userId || button?.disabled) return;
  button.disabled = true;
  setManagerAccessMessage("Issuing a replacement temporary password...");
  try {
    const result = await fetchJson("/api/managers/temporary-password", {
      method: "POST",
      headers: authRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ userId })
    });
    renderTemporaryManagerLogin({
      email: result.email,
      temporaryPassword: result.temporaryPassword,
      loginUrl: result.loginUrl,
      temporaryPasswordReissued: true,
      inviteEmailSent: Boolean(result.inviteEmailSent),
      inviteEmailError: result.inviteEmailError || ""
    });
    setManagerAccessMessage("A replacement temporary password is ready above. The old one is no longer valid.");
    await loadManagerAccess();
  } catch (error) {
    setManagerAccessMessage(error.message || "Could not issue a temporary password.");
    button.disabled = false;
  }
}

function staffAccountStatusLabel(status = "") {
  const labels = { invited: "Invited", active: "Active", disabled: "Disabled" };
  return labels[String(status).toLowerCase()] || status || "Invited";
}

function staffPhoneVisibilityLabel(value = "managers_only") {
  return String(value).toLowerCase() === "all_staff" ? "Phone: All staff" : "Phone: Managers only";
}

function staffAccessEmployees() {
  return [...state.employees]
    .filter((employee) => employee.active !== false && !employee.archived)
    .sort((a, b) => fullEmployeeName(a).localeCompare(fullEmployeeName(b)));
}

function populateStaffInviteEmployees() {
  const select = $("staffInviteEmployee");
  if (!select) return;
  const employees = staffAccessEmployees();
  select.innerHTML = employees.length
    ? employees.map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(fullEmployeeName(employee))}</option>`).join("")
    : `<option value="">No active employees</option>`;
}

function setStaffAccessMessage(message = "") {
  const target = $("staffAccessMessage");
  if (target) target.textContent = message;
}

function renderTemporaryStaffLogin(details = null) {
  const target = $("staffTempLogin");
  if (!target) return;
  if (!details?.temporaryPassword) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const loginUrl = details.loginUrl || window.location.origin;
  target.hidden = false;
  target.innerHTML = [
    `<strong>${details.temporaryPasswordReissued ? "New temporary password issued. The previous password no longer works." : details.inviteEmailSent ? "Invitation email sent." : details.reusedExistingLogin ? "Existing staff login relinked. Copy this new temporary password before closing." : "Staff login created. Copy this before closing."}</strong>`,
    `<div>Employee: <code>${escapeHtml(details.displayName || "")}</code></div>`,
    `<div>Email: <code>${escapeHtml(details.email || "")}</code></div>`,
    `<div>Temporary password: <code>${escapeHtml(details.temporaryPassword)}</code></div>`,
    `<div>Login URL: <code>${escapeHtml(loginUrl)}</code></div>`,
    details.temporaryPasswordReissued
      ? "<small>This replacement password remains valid until the staff member creates a permanent password.</small>"
      : details.inviteEmailSent
      ? "<small>The email includes these login details. Keep this panel available as a backup until the staff member confirms receipt.</small>"
      : `<small>Email was not sent${details.inviteEmailError ? `: ${escapeHtml(details.inviteEmailError)}` : "."} Share this password directly for now.</small>`
  ].join("");
}

function renderStaffAccessList(staff = []) {
  const target = $("staffAccessList");
  if (!target) return;
  if (!staff.length) {
    target.innerHTML = `<p class="hint">No staff logins are linked yet.</p>`;
    return;
  }
  target.innerHTML = `
    <div class="staff-access-list">
      ${staff.map((account) => {
        const employee = account.legacyEmployeeId ? employeeById(account.legacyEmployeeId) : null;
        const name = employee ? fullEmployeeName(employee) : account.displayName || "Unlinked staff";
        return `
          <section class="staff-access-card">
            <div class="staff-access-person">
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(account.email || account.userId || "No email")}</small>
            </div>
            <span class="staff-access-status">${staffAccountStatusLabel(account.status)}</span>
            <span class="staff-access-privacy">${escapeHtml(staffPhoneVisibilityLabel(account.phoneVisibility))}</span>
            <span class="manager-access-added">${account.invitedAt ? escapeHtml(new Date(account.invitedAt).toLocaleDateString()) : ""}</span>
            <button type="button" class="temporary-password-action" data-staff-temp-password="${escapeHtml(account.id || "")}" data-staff-user-id="${escapeHtml(account.userId || "")}" ${account.passwordChangeRequired ? "" : "disabled title=\"This password has already been replaced by a permanent password.\""}>${account.passwordChangeRequired ? "Issue temp password" : "Password set"}</button>
            <button type="button" class="staff-access-remove" data-staff-remove="${escapeHtml(account.id || "")}" data-staff-user-id="${escapeHtml(account.userId || "")}">Remove Login</button>
          </section>
        `;
      }).join("")}
    </div>
  `;
  target.querySelectorAll("[data-staff-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      await removeStaffLogin(button.dataset.staffRemove, button.dataset.staffUserId, button);
    });
  });
  target.querySelectorAll("[data-staff-temp-password]").forEach((button) => {
    button.addEventListener("click", async () => {
      await issueStaffTemporaryPassword(button.dataset.staffTempPassword, button.dataset.staffUserId, button);
    });
  });
}

async function removeStaffLogin(accountId, userId, button) {
  if (!accountId || !userId) {
    setStaffAccessMessage("This staff login is missing its account details and cannot be removed safely.");
    return;
  }
  const confirmed = await showAppConfirm({
    title: "Remove Staff Login",
    message: "This removes the staff portal login and its link to the employee. The employee profile and schedule will remain.",
    confirmText: "Remove Login",
    cancelText: "Keep Login"
  });
  if (!confirmed) return;
  if (button) button.disabled = true;
  setStaffAccessMessage("Removing staff login...");
  try {
    await fetchJson("/api/staff-accounts/remove", {
      method: "POST",
      headers: authRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ accountId, userId })
    });
    renderTemporaryStaffLogin(null);
    setStaffAccessMessage("Staff portal login removed. The employee profile was kept.");
    await loadStaffAccess();
  } catch (error) {
    setStaffAccessMessage(error.message || "Could not remove staff login.");
    if (button) button.disabled = false;
  }
}

async function issueStaffTemporaryPassword(accountId, userId, button) {
  if (!accountId || !userId || button?.disabled) return;
  button.disabled = true;
  setStaffAccessMessage("Issuing a replacement temporary password...");
  try {
    const result = await fetchJson("/api/staff-accounts/temporary-password", {
      method: "POST",
      headers: authRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ accountId, userId })
    });
    renderTemporaryStaffLogin({
      email: result.email,
      displayName: result.displayName,
      temporaryPassword: result.temporaryPassword,
      loginUrl: result.loginUrl,
      temporaryPasswordReissued: true,
      inviteEmailSent: Boolean(result.inviteEmailSent),
      inviteEmailError: result.inviteEmailError || ""
    });
    setStaffAccessMessage("A replacement temporary password is ready above. The old one is no longer valid.");
    await loadStaffAccess();
  } catch (error) {
    setStaffAccessMessage(error.message || "Could not issue a temporary password.");
    button.disabled = false;
  }
}

async function loadStaffAccess() {
  setStaffAccessMessage("Loading staff access...");
  try {
    const result = await fetchJson("/api/staff-accounts", {
      cache: "no-store",
      headers: authRequestHeaders()
    });
    if (result.schemaReady === false) {
      renderStaffAccessList([]);
      setStaffAccessMessage("Run the staff account schema before creating staff logins.");
      return;
    }
    renderStaffAccessList(Array.isArray(result.staff) ? result.staff : []);
    setStaffAccessMessage("Create staff logins here. Temporary passwords are meant to be shared directly for now.");
  } catch (error) {
    setStaffAccessMessage(error.message || "Could not load staff access.");
    renderStaffAccessList([]);
  }
}

async function openStaffAccess() {
  if (!["owner", "manager"].includes(String(currentUser?.role || "").toLowerCase())) return;
  populateStaffInviteEmployees();
  renderTemporaryStaffLogin(null);
  $("staffAccessDialog")?.showModal();
  await loadStaffAccess();
}

function setStaffRequestsMessage(message = "") {
  const target = $("staffRequestsMessage");
  if (target) target.textContent = message;
}

function staffRequestEmployeeName(request) {
  return fullEmployeeName(employeeById(request.legacyEmployeeId)) || request.legacyEmployeeId || "Staff member";
}

function renderStaffRequestsReview(requests = [], submissions = []) {
  const requestTarget = $("staffRequestsList");
  const availabilityTarget = $("staffAvailabilityReviewList");
  if (requestTarget) {
    requestTarget.innerHTML = requests.length ? requests.map((request) => `
      <section class="staff-review-row">
        <div><strong>${escapeHtml(staffRequestEmployeeName(request))}</strong><span>${escapeHtml(request.startDate)} - ${escapeHtml(request.endDate)}${request.startTime && request.endTime ? ` | ${escapeHtml(request.startTime)} - ${escapeHtml(request.endTime)}` : " | Full day"}</span>${request.note ? `<small>${escapeHtml(request.note)}</small>` : ""}</div>
        <div class="staff-review-actions"><b>${escapeHtml(request.status)}</b>${request.status === "pending" ? `<button type="button" data-staff-request-review="${escapeHtml(request.id)}" data-review-status="approved">Approve</button><button type="button" data-staff-request-review="${escapeHtml(request.id)}" data-review-status="denied">Deny</button>` : ""}</div>
      </section>`).join("") : `<p class="hint">No request-offs have been submitted.</p>`;
    requestTarget.querySelectorAll("[data-staff-request-review]").forEach((button) => button.addEventListener("click", () => reviewStaffRequest(button.dataset.staffRequestReview, button.dataset.reviewStatus)));
  }
  if (availabilityTarget) {
    availabilityTarget.innerHTML = submissions.length ? submissions.map((submission) => `
      <section class="staff-review-row"><div><strong>${escapeHtml(staffRequestEmployeeName(submission))}</strong><span>Week of ${escapeHtml(submission.weekStart)} | ${escapeHtml(submission.status)}</span>${submission.note ? `<small>${escapeHtml(submission.note)}</small>` : ""}</div><div class="staff-review-actions"><code>${escapeHtml(JSON.stringify(submission.availability || {}))}</code>${["submitted", "pending", "awaiting_approval"].includes(String(submission.status || "").toLowerCase()) ? `<button type="button" data-staff-request-review="${escapeHtml(submission.id)}" data-review-status="approved">Approve</button><button type="button" data-staff-request-review="${escapeHtml(submission.id)}" data-review-status="denied">Deny</button>` : ""}</div></section>`).join("") : `<p class="hint">No availability submissions have been received.</p>`;
  }
}

async function loadStaffRequestsReview() {
  setStaffRequestsMessage("Loading staff requests...");
  try {
    const [requests, submissions] = await Promise.all([
      fetchJson("/api/staff-requests", { cache: "no-store", headers: authRequestHeaders() }),
      fetchJson("/api/staff-availability", { cache: "no-store", headers: authRequestHeaders() })
    ]);
    renderStaffRequestsReview(requests.requests || [], submissions.submissions || []);
    setStaffRequestsMessage("Manager review queue");
  } catch (error) {
    setStaffRequestsMessage(error.message || "Could not load staff requests.");
    renderStaffRequestsReview([], []);
  }
}

async function openStaffRequests() {
  if (!["owner", "manager"].includes(String(currentUser?.role || "").toLowerCase())) return;
  $("staffRequestsDialog")?.showModal();
  await loadStaffRequestsReview();
}

async function reviewStaffRequest(requestId, status) {
  if (!requestId || !status) return;
  setStaffRequestsMessage("Saving review...");
  try {
    await fetchJson("/api/staff-requests/review", { method: "POST", headers: authRequestHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ requestId, status }) });
    await loadStaffRequestsReview();
  } catch (error) {
    setStaffRequestsMessage(error.message || "Could not review request-off.");
  }
}

async function sendStaffInvite(event) {
  event.preventDefault();
  const button = $("sendStaffInviteBtn");
  const employeeId = $("staffInviteEmployee")?.value;
  const employee = employeeById(employeeId);
  const email = $("staffInviteEmail")?.value.trim();
  if (!employee) {
    setStaffAccessMessage("Choose an employee first.");
    return;
  }
  if (!email) {
    setStaffAccessMessage("Enter an email address first.");
    return;
  }
  renderTemporaryStaffLogin(null);
  if (button) { button.disabled = true; button.textContent = "Creating..."; }
  const name = fullEmployeeName(employee);
  try {
    const result = await fetchJson("/api/staff-accounts/invite", {
      method: "POST",
      headers: authRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        email,
        legacyEmployeeId: employee.id,
        displayName: name
      })
    });
    $("staffInviteEmail").value = "";
    renderTemporaryStaffLogin({
      email,
      displayName: name,
      temporaryPassword: result.temporaryPassword,
      loginUrl: result.loginUrl,
      reusedExistingLogin: Boolean(result.reusedExistingLogin),
      inviteEmailSent: Boolean(result.inviteEmailSent),
      inviteEmailError: result.inviteEmailError || ""
    });
    setStaffAccessMessage(result.reusedExistingLogin
      ? result.inviteEmailSent
        ? `Existing login for ${email} was linked to ${name} and the invitation email was sent.`
        : `Existing login for ${email} was linked to ${name}. Email delivery was unavailable.`
      : result.inviteEmailSent
        ? `Login created for ${name}. The invitation email was sent.`
        : `Login created for ${name}. Email delivery was unavailable.`);
    await loadStaffAccess();
  } catch (error) {
    setStaffAccessMessage(error.message || "Could not create staff login.");
  } finally {
    if (button) { button.disabled = false; button.textContent = "Create Login"; }
  }
}
async function importEmployeesFromFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    event.target.value = "";
    showConflict("PDF files need to be converted first. Export the list as TXT or CSV, or use the PDF helper script in the tools folder.");
    return;
  }
  let text = "";
  try {
    text = await file.text();
  } catch {
    event.target.value = "";
    showConflict("I could not read that file. Try exporting the employee list as CSV or plain TXT.");
    return;
  }
  const records = name.endsWith(".txt") || file.type === "text/plain"
    ? parseEmployeeText(text)
    : parseEmployeeCsv(text);
  await importEmployeeRecords(records, event.target);
}

async function importScheduleHistoryFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  let text = "";
  try {
    text = await file.text();
  } catch {
    event.target.value = "";
    showConflict("I could not read that schedule file. Try exporting it as CSV or TXT.");
    return;
  }
  const parsed = parseScheduleHistoryText(text, file.name);
  event.target.value = "";
  if (!parsed.shifts.length) {
    showConflict("I could not find schedule shifts in that file yet. Once you upload a Ctuit sample, I can tune the importer to its exact columns.");
    return;
  }
  pushUndo();
  state.scheduleHistory = state.scheduleHistory || [];
  const existingIndex = state.scheduleHistory.findIndex((week) => week.weekStart === parsed.weekStart && week.sourceName === parsed.sourceName);
  const record = {
    id: existingIndex >= 0 ? state.scheduleHistory[existingIndex].id : uid("history"),
    sourceName: parsed.sourceName,
    importedAt: nowIso(),
    weekStart: parsed.weekStart,
    shifts: parsed.shifts
  };
  if (existingIndex >= 0) state.scheduleHistory[existingIndex] = record;
  else state.scheduleHistory.push(record);
  renderAll();
  showConflict(`Imported ${record.shifts.length} historical shift${record.shifts.length === 1 ? "" : "s"} from ${file.name}.`);
}

function parseScheduleHistoryText(text, sourceName = "Ctuit schedule") {
  let rows = parseCsv(text);
  if (rows.length && rows[0].length < 2 && text.includes("\t")) {
    rows = text.split(/\r?\n/).map((line) => line.split("\t")).filter((row) => row.some((value) => cleanCell(value)));
  }
  const csvResult = parseScheduleHistoryCsvRows(rows, sourceName);
  if (csvResult.shifts.length) return csvResult;
  return parseScheduleHistoryLooseText(text, sourceName);
}

function parseScheduleHistoryCsvRows(rows, sourceName) {
  if (rows.length < 2) return { sourceName, weekStart: currentWeekKey(), shifts: [] };
  const headers = rows[0].map((header) => cleanCell(header).toLowerCase());
  const dateIndex = findHeader(headers, ["date", "shift date", "business date", "day"]);
  const employeeIndex = findHeader(headers, ["employee", "employee name", "name", "team member", "staff"]);
  const firstIndex = findHeader(headers, ["first", "first name"]);
  const lastIndex = findHeader(headers, ["last", "last name"]);
  const roleIndex = findHeader(headers, ["role", "job", "job code", "job name", "position", "department"]);
  const startIndex = findHeader(headers, ["start", "start time", "in", "in time", "scheduled in", "scheduled start", "shift start"]);
  const endIndex = findHeader(headers, ["end", "end time", "out", "out time", "scheduled out", "scheduled end", "shift end"]);
  if (dateIndex === -1 || roleIndex === -1 || startIndex === -1 || (employeeIndex === -1 && firstIndex === -1)) {
    return { sourceName, weekStart: currentWeekKey(), shifts: [] };
  }
  const shifts = rows.slice(1).map((row) => {
    const dateKey = parseHistoryDate(row[dateIndex]);
    const role = matchHistoryRole(row[roleIndex]);
    const employeeName = employeeIndex >= 0 ? cleanCell(row[employeeIndex]) : `${cleanCell(row[firstIndex])} ${cleanCell(row[lastIndex])}`.trim();
    const employee = matchHistoryEmployee(employeeName);
    const start = normalizeTime(row[startIndex]);
    const endRaw = endIndex >= 0 ? cleanCell(row[endIndex]) : "";
    const end = /volume/i.test(endRaw) ? "Until Volume" : normalizeTime(endRaw);
    if (!dateKey || !role || !start) return null;
    return {
      id: uid("historyShift"),
      date: dateKey,
      employeeName,
      employeeId: employee?.id || "",
      department: role.department || "FOH",
      roleId: role.id,
      start,
      end: end || "Until Volume",
      untilVolume: !end || /until\s*volume/i.test(end),
      color: role.color || "#2563eb"
    };
  }).filter(Boolean);
  const weekStart = shifts.length ? formatDateKey(startOfWeek(parseDateKey(shifts[0].date), state.settings.weekStart)) : currentWeekKey();
  return { sourceName, weekStart, shifts };
}

function parseScheduleHistoryLooseText(text, sourceName) {
  const shifts = [];
  text.split(/\r?\n/).forEach((line) => {
    const dateMatch = line.match(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/);
    const timeMatch = line.match(/\b\d{1,2}(?::\d{2})?\s*(?:a|am|p|pm)?\s*[-â€“]\s*\d{1,2}(?::\d{2})?\s*(?:a|am|p|pm)?\b/i);
    if (!dateMatch || !timeMatch) return;
    const role = state.roles.find((item) => new RegExp(`\\b${item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(line));
    if (!role) return;
    const [startRaw, endRaw] = timeMatch[0].split(/[-â€“]/).map(cleanCell);
    const dateKey = parseHistoryDate(dateMatch[0]);
    const nameText = cleanImportedName(line.replace(dateMatch[0], "").replace(timeMatch[0], "").replace(role.name, ""));
    const employee = matchHistoryEmployee(nameText);
    shifts.push({
      id: uid("historyShift"),
      date: dateKey,
      employeeName: nameText,
      employeeId: employee?.id || "",
      department: role.department || "FOH",
      roleId: role.id,
      start: normalizeTime(startRaw),
      end: normalizeTime(endRaw),
      untilVolume: false,
      color: role.color || "#2563eb"
    });
  });
  const weekStart = shifts.length ? formatDateKey(startOfWeek(parseDateKey(shifts[0].date), state.settings.weekStart)) : currentWeekKey();
  return { sourceName, weekStart, shifts: shifts.filter((shift) => shift.date && shift.start && shift.roleId) };
}

function parseHistoryDate(value) {
  const text = cleanCell(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (!match) return "";
  const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : currentDate.getFullYear();
  return formatDateKey(new Date(year, Number(match[1]) - 1, Number(match[2])));
}

function matchHistoryRole(value) {
  const wanted = normalizeNameKey(value);
  if (!wanted) return null;
  return state.roles.find((role) => normalizeNameKey(role.name) === wanted) ||
    state.roles.find((role) => wanted.includes(normalizeNameKey(role.name)) || normalizeNameKey(role.name).includes(wanted)) ||
    null;
}

function matchHistoryEmployee(name) {
  const parsedName = splitName(name);
  return findEmployeeImportMatch(parsedName).employee || null;
}

function parseEmployeeCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return parseEmployeeText(text);
  }
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const firstIndex = findHeader(headers, ["first name", "firstname", "first"]);
  const lastIndex = findHeader(headers, ["last name", "lastname", "last"]);
  const fullIndex = findHeader(headers, ["name", "employee", "employee name"]);
  const phoneIndex = findHeader(headers, ["phone", "phone number", "mobile", "cell"]);
  if (firstIndex === -1 && fullIndex === -1) {
    return parseEmployeeText(text);
  }
  return rows.slice(1).map((row) => {
    const parsedName = fullIndex >= 0 ? splitName(row[fullIndex]) : null;
    return {
      firstName: cleanCell(firstIndex >= 0 ? row[firstIndex] : parsedName?.firstName),
      lastName: cleanCell(lastIndex >= 0 ? row[lastIndex] : parsedName?.lastName),
      phone: cleanCell(phoneIndex >= 0 ? row[phoneIndex] : "")
    };
  });
}

function parseEmployeeText(text) {
  const records = [];
  const phonePattern = /(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]?)\d{3}[\s.\-]?\d{4}/g;
  text.split(/\r?\n/).forEach((line) => {
    const cleanLine = line.trim();
    if (!cleanLine) return;
    const matches = [...line.matchAll(phonePattern)];
    if (!matches.length) {
      const parsedName = splitName(cleanImportedName(cleanLine));
      if (parsedName.firstName || parsedName.lastName) records.push({ ...parsedName, phone: "" });
      return;
    }
    matches.forEach((match) => {
      const phone = normalizePhone(match[0]);
      const before = cleanImportedName(line.slice(0, match.index));
      const after = cleanImportedName(line.slice((match.index || 0) + match[0].length));
      const nameText = before || after;
      const parsedName = splitName(nameText);
      if (!parsedName.firstName && !parsedName.lastName) return;
      records.push({ ...parsedName, phone });
    });
  });
  return records;
}

function previewPastedEmployees() {
  const text = $("pasteEmployeesText").value;
  const records = parseEmployeeText(text);
  const preview = $("pasteEmployeesPreview");
  if (!records.length) {
    preview.innerHTML = `<p class="hint">No employee names found yet.</p>`;
    return records;
  }
  preview.innerHTML = `
    <table>
      <thead><tr><th>First</th><th>Last</th><th>Phone</th><th>Status</th></tr></thead>
      <tbody>
        ${records.slice(0, 30).map((record) => {
          const firstName = cleanCell(record.firstName);
          const lastName = cleanCell(record.lastName);
          const match = findEmployeeImportMatch({ firstName, lastName, phone: cleanCell(record.phone) });
          const status = match.employee ? `Update ${displayName(match.employee)} (${match.reason})` : match.possible?.length ? `Possible: ${match.possible.map(displayName).join(", ")}` : "New";
          return `<tr><td>${firstName}</td><td>${lastName}</td><td>${cleanCell(record.phone)}</td><td>${status}</td></tr>`;
        }).join("")}
      </tbody>
    </table>
    ${records.length > 30 ? `<p class="hint">Showing first 30 of ${records.length} parsed employees.</p>` : ""}
  `;
  return records;
}

function employeeNameTokens(employee) {
  return [
    fullEmployeeName(employee),
    employee.firstName,
    employee.nickname,
    displayName(employee)
  ].map(normalizeNameKey).filter(Boolean);
}

function normalizeNameKey(value) {
  return cleanCell(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function phoneKey(value) {
  return String(value || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

function firstLastInitialKey(firstName, lastName) {
  const first = normalizeNameKey(firstName);
  const initial = normalizeNameKey(lastName).charAt(0);
  return first && initial ? `${first} ${initial}` : "";
}

function findEmployeeImportMatch(record) {
  const firstName = cleanCell(record.firstName);
  const lastName = cleanCell(record.lastName);
  const importedFullName = normalizeNameKey(`${firstName} ${lastName}`);
  const importedFirst = normalizeNameKey(firstName);
  const importedLast = normalizeNameKey(lastName);
  const importedPhone = phoneKey(record.phone);
  if (importedPhone) {
    const phoneMatch = state.employees.find((employee) => phoneKey(employee.phone) === importedPhone);
    if (phoneMatch) return { employee: phoneMatch, reason: "phone" };
  }
  const exactName = state.employees.find((employee) => normalizeNameKey(fullEmployeeName(employee)) === importedFullName);
  if (exactName) return { employee: exactName, reason: "name" };
  const exactDisplay = state.employees.find((employee) => employeeNameTokens(employee).includes(importedFullName));
  if (exactDisplay) return { employee: exactDisplay, reason: "nickname/display" };
  const importedInitial = firstLastInitialKey(firstName, lastName);
  if (importedInitial) {
    const initialMatch = state.employees.find((employee) => (
      firstLastInitialKey(employee.firstName, employee.lastName) === importedInitial ||
      firstLastInitialKey(employee.nickname || employee.firstName, employee.lastName) === importedInitial
    ));
    if (initialMatch) return { employee: initialMatch, reason: "first + last initial" };
  }
  const possible = state.employees.filter((employee) => {
    const sameLast = importedLast && normalizeNameKey(employee.lastName) === importedLast;
    const nameTokens = employeeNameTokens(employee);
    const firstMatchesNickname = importedFirst && nameTokens.includes(importedFirst);
    const importedLooksLikeNickname = importedFullName && nameTokens.includes(importedFullName);
    return (sameLast && firstMatchesNickname) || importedLooksLikeNickname;
  });
  return { employee: null, possible };
}

function openPasteEmployeesDialog() {
  $("pasteEmployeesText").value = "";
  $("pasteEmployeesPreview").innerHTML = `<p class="hint">Paste employee names here, then preview before importing.</p>`;
  $("pasteEmployeesDialog").showModal();
  setTimeout(() => $("pasteEmployeesText").focus(), 0);
}

async function importPastedEmployees(event) {
  event.preventDefault();
  const records = previewPastedEmployees();
  if (!records.length) return;
  await importEmployeeRecords(records, { value: "" });
  $("pasteEmployeesDialog").close();
  $("pasteEmployeesText").value = "";
  $("pasteEmployeesPreview").innerHTML = "";
}

async function importEmployeeRecords(records, fileInput) {
  const cleanRecords = records
    .map((record) => ({
      firstName: cleanCell(record.firstName),
      lastName: cleanCell(record.lastName),
      phone: cleanCell(record.phone)
    }))
    .filter((record) => record.firstName || record.lastName);
  if (!cleanRecords.length) {
    fileInput.value = "";
    showConflict("I did not find any employee names. For TXT imports, each employee should be on a line with a phone number.");
    return;
  }
  pushUndo();
  let imported = 0;
  let updated = 0;
  let possibleDuplicates = 0;
  cleanRecords.forEach(({ firstName, lastName, phone }) => {
    if (!firstName && !lastName) return;
    const match = findEmployeeImportMatch({ firstName, lastName, phone });
    const existing = match.employee;
    if (existing) {
      existing.phone = phone || existing.phone || "";
      existing.active = existing.active !== false;
      existing.updatedAt = nowIso();
      updated++;
    } else if (match.possible?.length) {
      possibleDuplicates++;
    } else {
      state.employees.push({
        id: uid("employee"),
        firstName,
        lastName,
        nickname: "",
        birthday: "",
        phone,
        active: true,
        canClose: false,
        canLunchClose: false,
        alwaysPrintFloorEndTime: false,
        departments: ["FOH"],
        callWeekly: false,
        mealTraining: [],
        roleTraining: [],
        weeklyAvailability: {},
        availability: emptyAvailability(),
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
      imported++;
    }
  });
  fileInput.value = "";
  await saveState({ immediate: true });
  renderAll();
  showConflict(`Imported ${imported} new employee${imported === 1 ? "" : "s"} and updated ${updated}${possibleDuplicates ? `. Skipped ${possibleDuplicates} possible duplicate${possibleDuplicates === 1 ? "" : "s"} for manual review.` : ""}.`);
}

async function importLaborNeedsFromCsv(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const rows = parseCsv(text);
  event.target.value = "";
  if (rows.length < 2) {
    showConflict("That labor needs CSV did not contain any rows.");
    return;
  }
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const dateIndex = findHeader(headers, ["date", "event date"]);
  const roleIndex = findHeader(headers, ["role", "position"]);
  const mealIndex = findHeader(headers, ["meal", "meal period", "period"]);
  const countIndex = findHeader(headers, ["required count", "count", "required", "need"]);
  const sourceIndex = findHeader(headers, ["source", "event", "event name", "party"]);
  const notesIndex = findHeader(headers, ["notes", "note"]);
  if (dateIndex === -1 || roleIndex === -1 || mealIndex === -1 || countIndex === -1) {
    showConflict("Labor import needs Date, Role, Meal, and Required Count columns.");
    return;
  }
  pushUndo();
  let imported = 0;
  rows.slice(1).forEach((row) => {
    const dateKey = normalizeImportDate(row[dateIndex]);
    const role = findRoleByName(row[roleIndex]);
    const meal = normalizeMealName(row[mealIndex]);
    const count = Number(row[countIndex]) || 0;
    if (!dateKey || !role || !meal || !count) return;
    if (!state.coverageRequirements[dateKey]) state.coverageRequirements[dateKey] = defaultCoverageForDate(dateKey);
    if (!state.coverageRequirements[dateKey][meal]) state.coverageRequirements[dateKey][meal] = {};
    state.coverageRequirements[dateKey][meal][role.id] = (Number(state.coverageRequirements[dateKey][meal][role.id]) || 0) + count;
    imported++;
  });
  saveState();
  renderAll();
  showConflict(`Imported ${imported} event labor need${imported === 1 ? "" : "s"} into day coverage.`);
}

async function importCtuitTimeOff(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  showAppAlert({
    title: "Import Started",
    message: `Reading ${files.length} request-off file${files.length === 1 ? "" : "s"} now.`
  });
  const pdfFiles = files.filter((file) => /\.pdf$/i.test(file.name) || file.type === "application/pdf");
  const textFiles = files.filter((file) => !pdfFiles.includes(file));
  const parsedGroups = [];
  try {
    if (pdfFiles.length) parsedGroups.push(await parseRequestOffPdfFiles(pdfFiles));
    for (const file of textFiles) {
      const text = await file.text();
      parsedGroups.push(parseRequestOffDocument(text));
    }
  } catch (error) {
    event.target.value = "";
    showAppAlert({
      title: "RO Import Issue",
      message: error.message || "I could not read that request-off file.",
      type: "error"
    });
    return;
  }
  event.target.value = "";
  const parsed = mergeRequestOffParses(parsedGroups);
  if (!parsed.requests.length) {
    const diagnostic = parsed.diagnostics?.undatedSections?.length
      ? ` I found ${parsed.diagnostics.undatedSections.length} employee section${parsed.diagnostics.undatedSections.length === 1 ? "" : "s"} without dated request rows.`
      : "";
    showAppAlert({
      title: "No ROs Found",
      message: `I did not find any request-off entries in the selected file${files.length === 1 ? "" : "s"}.${diagnostic}`,
      type: "warning",
      items: parsed.diagnostics?.errors?.map((item) => `${item.fileName}: ${item.error}`) || []
    });
    return;
  }
  applyParsedRequestOffs(parsed);
}

let requestOffPdfJsPromise = null;

async function loadRequestOffPdfJs() {
  if (!requestOffPdfJsPromise) {
    requestOffPdfJsPromise = import("./assets/vendor/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("./assets/vendor/pdf.worker.mjs", location.href).href;
      return pdfjs;
    });
  }
  return requestOffPdfJsPromise;
}

function roPdfSplitReportName(value) {
  const text = cleanCell(value).replace(/^,+|,+$/g, "");
  if (!text) return { firstName: "", lastName: "" };
  if (text.includes(",")) {
    const [lastName, firstName] = text.split(",", 2).map(cleanCell);
    return { firstName, lastName };
  }
  const parts = text.split(/\s+/);
  return { firstName: parts.shift() || "", lastName: parts.join(" ") };
}

function roPdfNormalizeRequestTimeLabel(value) {
  const match = cleanCell(value).match(/^(\d{1,2})(?::?(\d{2}))?\s*(a|am|p|pm)$/i);
  if (!match) return cleanCell(value).toUpperCase();
  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const period = match[3].toLowerCase().startsWith("p") ? "PM" : "AM";
  if (hour > 12) hour -= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute.padStart(2, "0")} ${period}`;
}

function roPdfRequestDaypart(info) {
  const text = cleanCell(info);
  if (/\bAll\s+Day\b/i.test(text)) return "All day";
  const range = text.match(/\b(\d{1,2}(?::?\d{2})?\s*(?:a|am|p|pm))\s*(?:to|-|until|through|thru)\s*(\d{1,2}(?::?\d{2})?\s*(?:a|am|p|pm))\b/i);
  return range ? `${roPdfNormalizeRequestTimeLabel(range[1])} to ${roPdfNormalizeRequestTimeLabel(range[2])}` : "";
}

function roPdfColumnForX(x) {
  if (x < 122) return "submitted";
  if (x < 150) return "recurring";
  if (x < 205) return "employee";
  // CTUIT places the request date near x=206 and the request details near x=241.
  // Keep the boundary between those columns narrow enough for compact reports.
  if (x < 230) return "date";
  if (x < 295) return "info";
  if (x < 340) return "note";
  if (x < 452) return "approvedBy";
  return "";
}

function roPdfJoinColumnItems(items) {
  return items
    .sort((a, b) => (b.y - a.y) || (a.x - b.x))
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function roPdfRowToRequest(row, fileName) {
  const byColumn = {};
  row.forEach((item) => {
    const column = roPdfColumnForX(item.x);
    if (!column) return;
    if (!byColumn[column]) byColumn[column] = [];
    byColumn[column].push(item);
  });
  const cells = Object.fromEntries(Object.entries(byColumn).map(([key, items]) => [key, roPdfJoinColumnItems(items)]));
  cells.employee = cleanCell(cells.employee).replace(/\bEmployee\b/gi, "").trim();
  cells.date = cleanCell(cells.date).replace(/\bDOB\b/gi, "").trim();
  cells.info = cleanCell(cells.info).replace(/\bInformation\b/gi, "").trim();
  cells.note = cleanCell(cells.note).replace(/\bNote\b/gi, "").trim();
  cells.approvedBy = cleanCell(cells.approvedBy).replace(/\bApproved\b|\bBy\b/gi, "").trim();
  if (!cells.employee || !cells.date || !cells.info) return null;
  if (/^Employee$/i.test(cells.employee)) return null;
  const date = normalizeImportDate(cells.date) || normalizeImportDate(cells.info);
  if (!date) return null;
  const { firstName, lastName } = roPdfSplitReportName(cells.employee);
  if (!firstName || !lastName) return null;
  const daypart = roPdfRequestDaypart(cells.info) || "All day";
  return {
    firstName,
    lastName,
    date,
    daypart,
    note: cells.note,
    status: cells.approvedBy ? `Approved by ${cells.approvedBy}` : "",
    source: `Ctuit RO PDF: ${fileName}`
  };
}

function roPdfParsePageItems(items, fileName) {
  const textItems = items
    .map((item) => ({ text: cleanCell(item.str), x: Number(item.transform?.[4]) || 0, y: Number(item.transform?.[5]) || 0 }))
    .filter((item) => item.text);
  const anchors = textItems
    .filter((item) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(item.text) && item.x >= 190 && item.x < 230)
    .sort((a, b) => b.y - a.y);
  const requests = [];
  anchors.forEach((anchor, index) => {
    const nextY = anchors[index + 1]?.y ?? -999;
    const previousY = anchors[index - 1]?.y;
    const rowTop = previousY ? Math.min(anchor.y + 24, anchor.y + ((previousY - anchor.y) * 0.5)) : anchor.y + 34;
    const previousGap = previousY ? previousY - anchor.y : 999;
    const noteTop = previousY
      ? (previousGap < 70 ? anchor.y + 12 : Math.min(previousY - 14, anchor.y + 140))
      : anchor.y + 140;
    const rowItems = textItems.filter((item) => {
      const column = roPdfColumnForX(item.x);
      if (column === "note") return item.y <= noteTop && item.y > nextY + 4;
      return item.y <= rowTop && item.y > nextY + 4;
    });
    const request = roPdfRowToRequest(rowItems, fileName);
    if (request) requests.push(request);
  });
  return requests;
}

function toNativeTimeValue(value = "") {
  const normalized = normalizeTime(value);
  if (!normalized) return "";
  const minutes = minutesFromTime(normalized);
  return minutes == null ? normalized : timeFromMinutes(minutes);
}

function roPdfParseRequestedDateRows(items, fileName) {
  const textItems = items
    .map((item) => ({ text: cleanCell(item.str), x: Number(item.transform?.[4]) || 0, y: Number(item.transform?.[5]) || 0 }))
    .filter((item) => item.text);
  const anchors = textItems
    .filter((item) => item.x >= 190 && item.x < 230 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(item.text))
    .sort((a, b) => b.y - a.y);
  return anchors.map((anchor, index) => {
    const previousY = anchors[index - 1]?.y;
    const nextY = anchors[index + 1]?.y;
    const upper = previousY ? Math.min(anchor.y + 18, ((previousY + anchor.y) / 2) + 6) : anchor.y + 18;
    const lower = nextY ? Math.max(anchor.y - 30, ((anchor.y + nextY) / 2) - 6) : anchor.y - 30;
    return roPdfRowToRequest(textItems.filter((item) => item.y <= upper && item.y >= lower), fileName);
  }).filter((request) => request && request.firstName && request.lastName && request.daypart);
}

function roPdfPlausibleRequest(request) {
  const name = `${request.firstName} ${request.lastName}`.trim();
  return Boolean(name)
    && !/[0-9]/.test(name)
    && !/\b(?:Approve|Disallow|Manager|All\s+Day|AM|PM|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(name);
}

async function parseRequestOffPdfFilesInBrowser(files) {
  const pdfjs = await loadRequestOffPdfJs();
  const results = [];
  const errors = [];
  for (const [index, file] of files.entries()) {
    const fileName = cleanCell(file.name) || `request-off-${index + 1}.pdf`;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const document = await pdfjs.getDocument({ data }).promise;
      const requests = [];
      const pageText = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const items = content.items || [];
        const dateColumnRequests = roPdfParseRequestedDateRows(items, fileName);
        const primaryRequests = roPdfParsePageItems(items, fileName);
        // CTUIT's compact report includes submitted-date rows and requested-date
        // rows. For this layout, the submitted-date pass can manufacture partial
        // rows, so prefer the requested-date recovery pass whenever it found
        // complete rows. Keep the primary pass as a fallback for other exports.
        const pageRequests = dateColumnRequests.length ? dateColumnRequests : primaryRequests;
        const pageSeen = new Set();
        pageRequests.forEach((request) => {
          if (!roPdfPlausibleRequest(request)) return;
          const key = [request.firstName, request.lastName, request.date, request.daypart]
            .map((value) => cleanCell(value).toLowerCase())
            .join("|");
          if (pageSeen.has(key)) return;
          pageSeen.add(key);
          requests.push(request);
        });
        pageText.push(items.map((item) => cleanCell(item.str)).filter(Boolean).join("\n"));
      }
      const fallbackRequests = parseCtuitAvailabilityTimeOffText(pageText.join("\n"), fileName);
      const combinedRequests = [];
      const seen = new Set();
      [...requests, ...fallbackRequests].forEach((request) => {
        const key = [request.firstName, request.lastName, request.date, request.daypart]
          .map((value) => cleanCell(value).toLowerCase())
          .join("|");
        if (seen.has(key) || !roPdfPlausibleRequest(request)) return;
        seen.add(key);
        combinedRequests.push(request);
      });
      results.push({ fileName, pages: document.numPages, requests: combinedRequests });
    } catch (error) {
      errors.push({ fileName, error: error.message || "Could not parse PDF." });
    }
  }
  const requests = [];
  const seen = new Set();
  let duplicates = 0;
  results.forEach((result) => {
    result.requests.forEach((request) => {
      const key = [request.firstName, request.lastName, request.date, request.daypart]
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
function parseCtuitAvailabilityTimeOffText(text, fileName = "Ctuit RO PDF") {
  const lines = text.split(/\r?\n/).map((line) => cleanCell(line)).filter(Boolean);
  const requests = [];
  const datePattern = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;
  const dayNames = new Set(DAYS.map((day) => day.toLowerCase()));
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const nameMatch = line.match(/^([A-Z][A-Za-z' -]+),\s*$/)
      || line.match(/^([A-Z][A-Za-z' -]+),\s*(?:Disallow|Approve|All Day|\d|Manager\b|$)/i)
      || line.match(/^([A-Z][A-Za-z' -]+),\s*[A-Z][A-Za-z' -]+?\d{1,2}\/\d{1,2}\/\d{4}/i);
    if (!nameMatch) continue;
    const lastName = cleanCell(nameMatch[1]);
    const previous = lines[index - 1] || "";
    const next = lines[index + 1] || "";
    const combined = [lines[index - 3], lines[index - 2], previous, line, next, lines[index + 2], lines[index + 3], lines[index + 4]].filter(Boolean).join(" ");
    const firstNameMatch = combined.match(new RegExp(`${lastName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},\\s*(?:Disallow\\s+)?([A-Z][A-Za-z' -]+?)(?:\\s+All\\s+Day|\\s+Manager\\b|\\s+Disallow|\\s+Approve|\\s+\\d|$)`, "i"));
    const inlineFirstName = line.match(/^[A-Z][A-Za-z' -]+,\s*([A-Z][A-Za-z' -]+?)(?=\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1];
    const firstName = cleanCell(inlineFirstName || firstNameMatch?.[1] || next.replace(/\b(All Day|Manager Note:|Disallow|Approve)\b/gi, ""));
    if (!firstName || dayNames.has(firstName.toLowerCase())) continue;
    const dateMatches = [...combined.matchAll(datePattern)].map((match) => normalizeImportDate(match[0])).filter(Boolean);
    const requestDate = dateMatches.find((dateKey) => {
      const year = Number(dateKey.slice(0, 4));
      return year >= 2020;
    });
    if (!requestDate) continue;
    const daypart = /\bAll\s+Day\b/i.test(combined) ? "All Day" : normalizeRequestDaypart(combined);
    const notePieces = [];
    for (let look = index + 1; look <= Math.min(lines.length - 1, index + 8); look++) {
      const noteLine = lines[look];
      if (/^Approve$/i.test(noteLine) || /Manager Note:/i.test(noteLine) || /^(Disallow|All Day)$/i.test(noteLine)) continue;
      if (datePattern.test(noteLine) || /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(noteLine)) continue;
      if (/^[A-Z][A-Za-z' -]+,\s*$/i.test(noteLine)) break;
      if (DAYS.some((day) => new RegExp(`^${day}$`, "i").test(noteLine))) break;
      if (noteLine.length > 2 && !dayNames.has(noteLine.toLowerCase())) notePieces.push(noteLine);
    }
    requests.push({
      firstName,
      lastName,
      date: requestDate,
      daypart: daypart || "All Day",
      note: notePieces.join(" ").slice(0, 180),
      source: `Ctuit RO PDF: ${fileName}`
    });
  }
  const seen = new Set();
  return requests.filter((request) => {
    const key = [request.firstName, request.lastName, request.date, request.daypart].map((value) => cleanCell(value).toLowerCase()).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function pdfParserUrl() {
  if (!SERVER_STORAGE_ENABLED) return "";
  if (["localhost", "127.0.0.1"].includes(location.hostname)) return "/api/parse-time-off-pdf";
  return "/.netlify/functions/parseTimeOffPdf";
}

async function parseRequestOffPdfFiles(files) {
  const browserParsed = await parseRequestOffPdfFilesInBrowser(files);
  if (browserParsed.requests?.length || !browserParsed.diagnostics?.errors?.length) return browserParsed;
  const parserUrl = pdfParserUrl();
  if (!parserUrl) {
    throw new Error("PDF request-off imports need Shift Bay opened from the hosted site or the Shift Bay Cloud local launcher.");
  }
  const payloadFiles = [];
  for (const file of files) {
    const buffer = await file.arrayBuffer();
    payloadFiles.push({
      name: file.name,
      type: file.type || "application/pdf",
      dataBase64: arrayBufferToBase64(buffer)
    });
  }
  const response = await fetch(parserUrl, {
    method: "POST",
    headers: authRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ files: payloadFiles })
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(parsed.error || "Shift Bay could not parse that request-off PDF.");
  }
  return parsed;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function mergeRequestOffParses(groups) {
  const requests = [];
  const seen = new Set();
  const diagnostics = { undatedSections: [], errors: [], files: [], duplicates: 0 };
  groups.filter(Boolean).forEach((group) => {
    (group.requests || []).forEach((request) => {
      const key = [request.firstName, request.lastName, request.date, request.daypart]
        .map((value) => cleanCell(value).toLowerCase()).join("|");
      if (seen.has(key)) {
        diagnostics.duplicates++;
        return;
      }
      seen.add(key);
      requests.push(request);
    });
    diagnostics.undatedSections.push(...(group.diagnostics?.undatedSections || []));
    diagnostics.errors.push(...(group.diagnostics?.errors || []));
    diagnostics.files.push(...(group.diagnostics?.files || []));
    diagnostics.duplicates += Number(group.diagnostics?.duplicates) || 0;
  });
  return { requests, source: groups.find((group) => group?.source)?.source || "Request Off", diagnostics };
}

function applyParsedRequestOffs(parsed) {
  pushUndo();
  state.timeOffRequests = state.timeOffRequests || [];
  let imported = 0;
  let skipped = 0;
  let duplicates = 0;
  const unmatched = new Set();
  const unmatchedRequests = [];
  const duplicateRequests = [];
  parsed.requests.forEach((request) => {
    const employee = findEmployeeByReportName(request.lastName, request.firstName);
    if (!employee) {
      skipped++;
      unmatched.add(`${request.firstName} ${request.lastName}`.trim());
      unmatchedRequests.push({ ...request, reason: "No matching employee found" });
      return;
    }
    const nextRequest = {
      id: uid("timeoff"),
      employeeId: employee.id,
      date: request.date,
      daypart: request.daypart || "",
      note: [request.note, request.status && request.status !== "Active" ? request.status : ""].filter(Boolean).join(" - "),
      source: request.source || parsed.source || "Request Off"
    };
    const duplicate = state.timeOffRequests.some((item) => (
      item.employeeId === nextRequest.employeeId &&
      item.date === nextRequest.date &&
      sameRequestOffDaypart(item.daypart, nextRequest.daypart)
    ));
    if (!duplicate) {
      state.timeOffRequests.push(nextRequest);
      imported++;
    } else {
      duplicates++;
      duplicateRequests.push({ ...request, reason: "Already exists for this employee and date" });
    }
  });
  const parserDuplicates = Number(parsed.diagnostics?.duplicates) || 0;
  state.requestOffImportLog = Array.isArray(state.requestOffImportLog) ? state.requestOffImportLog : [];
  state.requestOffImportLog.unshift({
    id: uid("ro-import"),
    importedAt: new Date().toISOString(),
    files: (parsed.diagnostics?.files || []).map((file) => ({
      fileName: file.fileName,
      pages: file.pages,
      readableRows: file.requests?.length || 0
    })),
    imported,
    alreadyExisting: duplicates,
    duplicateRowsInFiles: parserDuplicates,
    unmatched: unmatchedRequests,
    duplicates: duplicateRequests
  });
  state.requestOffImportLog = state.requestOffImportLog.slice(0, 50);
  if (!imported && undoStack.length) undoStack.pop();
  saveState();
  renderAll();
  const unmatchedList = Array.from(unmatched).slice(0, 5).join(", ");
  const suffix = skipped ? ` Skipped ${skipped} unmatched request${skipped === 1 ? "" : "s"}${unmatchedList ? ` (${unmatchedList}${unmatched.size > 5 ? ", ..." : ""})` : ""}.` : "";
  const diagnostic = parsed.diagnostics?.undatedSections?.length
    ? ` Review needed: ${parsed.diagnostics.undatedSections.length} employee section${parsed.diagnostics.undatedSections.length === 1 ? "" : "s"} had no dated request rows in the TXT export (${parsed.diagnostics.undatedSections.slice(0, 5).join(", ")}${parsed.diagnostics.undatedSections.length > 5 ? ", ..." : ""}).`
    : "";
  const fileItems = (parsed.diagnostics?.files || []).map((file) => `${file.fileName}: ${file.requests?.length || 0} readable RO row${file.requests?.length === 1 ? "" : "s"}`);
  const errorItems = (parsed.diagnostics?.errors || []).map((item) => `${item.fileName}: ${item.error}`);
  showAppAlert({
    title: "RO Import Complete",
    message: `Imported ${imported} request-off entr${imported === 1 ? "y" : "ies"} as RO blocks.${duplicates ? ` Skipped ${duplicates} already-imported entr${duplicates === 1 ? "y" : "ies"}.` : ""}${parserDuplicates ? ` Ignored ${parserDuplicates} duplicate row${parserDuplicates === 1 ? "" : "s"} found within the selected files.` : ""}${suffix}${diagnostic}`,
    type: skipped || diagnostic || errorItems.length ? "warning" : "info",
    items: [...fileItems, ...errorItems]
  });
}

function sameRequestOffDaypart(left, right) {
  const normalize = (value) => cleanCell(value).toLowerCase().replace(/\s+/g, " ") || "all day";
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  return (a === "all day" && !right) || (b === "all day" && !left);
}

async function importManagerNotesJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    event.target.value = "";
    showConflict("That Manager Notes file was not valid JSON.");
    return;
  }
  const employees = Array.isArray(payload.employees) ? payload.employees : [];
  if (!employees.length) {
    event.target.value = "";
    showConflict("That Manager Notes file did not include any employees.");
    return;
  }
  applyManagerNotesPayload(payload);
  event.target.value = "";
}

function applyBuiltInManagerNotes() {
  if (!window.MANAGER_NOTES_IMPORT) {
    showConflict("No built-in manager notes data is available.");
    return;
  }
  applyManagerNotesPayload(window.MANAGER_NOTES_IMPORT);
}

function applyManagerNotesPayload(payload) {
  const employees = Array.isArray(payload.employees) ? payload.employees : [];
  if (!employees.length) {
    showConflict("No manager notes employees were found.");
    return;
  }
  pushUndo();
  let created = 0;
  let updated = 0;
  employees.forEach((incoming) => {
    const employee = findOrCreateEmployeeFromName(incoming.name);
    if (!employee) return;
    if (!state.employees.some((item) => item.id === employee.id)) {
      state.employees.push(employee);
      created++;
    } else {
      updated++;
    }
    if (incoming.availability) employee.availability = incoming.availability;
    if (incoming.callWeekly) employee.callWeekly = true;
    if (incoming.roleNames?.length) {
      const roleIds = incoming.roleNames.map((name) => findRoleByName(name)?.id).filter(Boolean);
      employee.roleTraining = [...new Set([...(employee.roleTraining || []), ...roleIds])];
    }
    const noteText = (incoming.notes || []).filter(Boolean).join("; ");
    if (noteText) {
      employee.managerNotes = noteText;
      employee.weeklyRules = [...(employee.weeklyRules || []), ...weeklyRulesFromManagerNotes(noteText)];
    }
  });
  saveState();
  renderAll();
  const review = payload.reviewItems?.length ? ` ${payload.reviewItems.length} notes need review.` : "";
  showConflict(`Imported manager notes for ${employees.length} employee${employees.length === 1 ? "" : "s"} (${created} created, ${updated} updated).${review}`);
}

function findOrCreateEmployeeFromName(name) {
  const parsed = splitName(name);
  if (!parsed.firstName && !parsed.lastName) return null;
  const existing = state.employees.find((employee) => (
    employee.firstName.toLowerCase() === parsed.firstName.toLowerCase() &&
    employee.lastName.toLowerCase() === parsed.lastName.toLowerCase()
  )) || state.employees.find((employee) => (
    displayName(employee).toLowerCase() === name.toLowerCase() ||
    fullEmployeeName(employee).toLowerCase() === name.toLowerCase()
  ));
  if (existing) return existing;
  return {
    id: uid("employee"),
    firstName: parsed.firstName || name,
    lastName: parsed.lastName || "",
    nickname: parsed.firstName || name,
    birthday: "",
    phone: "",
    active: true,
    canClose: false,
    canLunchClose: false,
    alwaysPrintFloorEndTime: false,
    departments: ["FOH"],
    callWeekly: false,
    mealTraining: [...MEALS],
    roleTraining: [],
    trainerRoles: [],
    payRates: {},
    availability: emptyAvailability(),
    weeklyAvailability: {},
    weeklyRules: []
  };
}

function weeklyRulesFromManagerNotes(text) {
  const lower = text.toLowerCase();
  const rules = [];
  if (lower.includes("fri") && lower.includes("sat") && lower.includes("sun") && lower.includes("off")) {
    rules.push({ days: [5, 6, 0], maxWorkDays: 2, note: "Manager note: needs one Fri/Sat/Sun off" });
  }
  return rules;
}

function parseRequestOffDocument(text) {
  const csvRequests = parseRequestOffCsv(text);
  if (csvRequests.length) return { requests: csvRequests, source: "Request Off", diagnostics: {} };
  const ctuit = parseCtuitTimeOffReport(text);
  if (ctuit.requests.length) return { requests: ctuit.requests, source: "Ctuit", diagnostics: ctuit.diagnostics || {} };
  const textRequests = parseRequestOffText(text);
  if (textRequests.length) return { requests: textRequests, source: "Request Off", diagnostics: ctuit.diagnostics || {} };
  return { requests: ctuit.requests, source: "Ctuit", diagnostics: ctuit.diagnostics || {} };
}

function parseRequestOffCsv(text) {
  let rows = parseCsv(text);
  if (rows.length && rows[0].length < 2 && /\t/.test(text)) {
    rows = text.split(/\r?\n/).map((line) => line.split("\t")).filter((row) => row.some((value) => cleanCell(value)));
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => cleanCell(header).toLowerCase());
  const nameIndex = findHeader(headers, ["employee", "employee name", "name", "staff", "team member"]);
  const firstIndex = findHeader(headers, ["first name", "firstname", "first"]);
  const lastIndex = findHeader(headers, ["last name", "lastname", "last"]);
  const dateIndex = findHeader(headers, ["date", "request date", "time off date", "off date", "start date", "from date", "begin date"]);
  const endDateIndex = findHeader(headers, ["end date", "through date", "to date", "until date", "thru date"]);
  const daypartIndex = findHeader(headers, ["daypart", "meal", "period", "shift", "meal period"]);
  const noteIndex = findHeader(headers, ["note", "notes", "reason", "comment", "comments", "request"]);
  if (dateIndex === -1 || (nameIndex === -1 && (firstIndex === -1 || lastIndex === -1))) return [];
  const requests = [];
  rows.slice(1).forEach((row) => {
    const parsedName = nameIndex >= 0 ? splitName(row[nameIndex]) : { firstName: row[firstIndex], lastName: row[lastIndex] };
    const startDate = normalizeImportDate(row[dateIndex]);
    const endDate = endDateIndex >= 0 ? normalizeImportDate(row[endDateIndex]) : "";
    if (!startDate || (!parsedName.firstName && !parsedName.lastName)) return;
    expandDateRange(startDate, endDate || startDate).forEach((date) => {
      requests.push({
        firstName: cleanCell(parsedName.firstName),
        lastName: cleanCell(parsedName.lastName),
        date,
        daypart: normalizeRequestDaypart(row[daypartIndex]),
        note: noteIndex >= 0 ? cleanCell(row[noteIndex]) : ""
      });
    });
  });
  return requests;
}

function parseRequestOffText(text) {
  const requests = [];
  const datePattern = /\b(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g;
  text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const dateMatches = [...line.matchAll(datePattern)].map((match) => normalizeImportDate(match[0])).filter(Boolean);
    if (!dateMatches.length) return;
    const firstDateText = line.match(datePattern)?.[0] || "";
    const nameText = cleanCell(line.slice(0, line.indexOf(firstDateText)).replace(/[-:,|]+$/g, ""));
    const parsedName = splitName(nameText);
    if (!parsedName.firstName && !parsedName.lastName) return;
    const daypart = normalizeRequestDaypart(line);
    const note = cleanCell(line.replace(nameText, "").replace(datePattern, "").replace(/\b(request off|ro|off)\b/gi, ""));
    const dates = dateMatches.length >= 2 && /\b(to|through|thru|-)\b/i.test(line)
      ? expandDateRange(dateMatches[0], dateMatches[1])
      : dateMatches;
    dates.forEach((date) => requests.push({
      firstName: parsedName.firstName,
      lastName: parsedName.lastName,
      date,
      daypart,
      note
    }));
  });
  return requests;
}

function normalizeRequestDaypart(value) {
  const text = cleanCell(value);
  if (!text) return "All Day";
  const timeRange = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p))\s*(?:-|to|until|through|thru)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p))\b/i);
  if (timeRange) return `${normalizeTime(timeRange[1])} to ${normalizeTime(timeRange[2])}`;
  return "All Day";
}

function expandDateRange(startDateKey, endDateKey) {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  if (!(start instanceof Date) || !(end instanceof Date) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [startDateKey];
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    dates.push(formatDateKey(date));
  }
  return dates;
}

function parseCtuitTimeOffReport(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const requests = [];
  const sections = [];
  let currentDates = [];
  let currentEmployee = null;
  let currentDaypart = "";
  let inNotes = false;
  let currentSection = null;
  const finishSection = () => {
    if (currentSection) sections.push(currentSection);
    currentSection = null;
  };
  lines.forEach((line) => {
    if (/^Date Range:/i.test(line) || /^Page \d+/i.test(line) || /^Report Generator:/i.test(line)) return;
    if (/^(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*,\s*)+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(line)) {
      currentDates = line.split(",").map(normalizeImportDate).filter(Boolean);
      currentEmployee = null;
      currentDaypart = "";
      inNotes = false;
      return;
    }
    if (/^Employee Name,Daypart/i.test(line)) return;
    if (/^NOTES$/i.test(line)) {
      inNotes = true;
      return;
    }
    const employeeMatch = line.match(/^([^,]+),\s*([^,]+),\s*(Breakfast|Lunch|Dinner|Brunch)\b/i);
    if (employeeMatch) {
      finishSection();
      currentEmployee = {
        lastName: cleanCell(employeeMatch[1]),
        firstName: cleanCell(employeeMatch[2])
      };
      currentSection = {
        employeeName: `${currentEmployee.firstName} ${currentEmployee.lastName}`.trim(),
        datedRows: 0,
        dayparts: new Set([normalizeMealName(employeeMatch[3])].filter(Boolean))
      };
      currentDaypart = normalizeMealName(employeeMatch[3]);
      inNotes = false;
      return;
    }
    const daypartMatch = line.match(/^,\s*(Breakfast|Lunch|Dinner|Brunch)\b/i);
    if (daypartMatch) {
      currentDaypart = normalizeMealName(daypartMatch[1]);
      currentSection?.dayparts.add(currentDaypart);
      inNotes = false;
      return;
    }
    const noteMatch = line.match(/^(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY),(.+)$/i);
    if (noteMatch && currentEmployee && currentDates.length) {
      const dayIndex = DAYS.findIndex((day) => day.toUpperCase() === noteMatch[1].toUpperCase());
      const date = currentDates.find((dateKey) => parseDateKey(dateKey).getDay() === dayIndex);
      if (!date) return;
      if (currentSection) currentSection.datedRows++;
      requests.push({
        ...currentEmployee,
        date,
        daypart: normalizeRequestDaypart(noteMatch[2]),
        note: cleanCell(noteMatch[2])
      });
    }
  });
  finishSection();
  const undatedSections = sections
    .filter((section) => section.datedRows === 0)
    .map((section) => section.employeeName)
    .filter(Boolean);
  return { requests, diagnostics: { undatedSections } };
}

function findEmployeeByReportName(lastName, firstName) {
  const first = cleanCell(firstName).toLowerCase();
  const last = cleanCell(lastName).toLowerCase();
  const fullKey = normalizeNameKey(`${firstName} ${lastName}`);
  return state.employees.find((employee) => (
    employee.firstName.toLowerCase() === first &&
    employee.lastName.toLowerCase() === last
  )) || state.employees.find((employee) => (
    fullKey && employeeNameTokens(employee).includes(fullKey)
  )) || state.employees.find((employee) => (
    first && employeeNameTokens(employee).includes(normalizeNameKey(first)) && (!last || employee.lastName.toLowerCase() === last)
  )) || state.employees.find((employee) => (
    employee.lastName.toLowerCase() === last &&
    employee.firstName.toLowerCase().startsWith(first.slice(0, 3))
  ));
}

function normalizeImportDate(value) {
  const text = cleanCell(value);
  if (!text) return "";
  let match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (match) return formatDateKey(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return "";
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  return formatDateKey(new Date(year, Number(match[1]) - 1, Number(match[2])));
}

function findRoleByName(value) {
  const wanted = cleanCell(value).toLowerCase();
  return state.roles.find((role) => role.name.toLowerCase() === wanted);
}

function normalizeMealName(value) {
  const wanted = cleanCell(value).toLowerCase();
  const match = MEALS.find((meal) => meal.toLowerCase() === wanted);
  return match || cleanCell(value);
}

function findHeader(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(header));
}

function splitName(value) {
  const text = cleanImportedName(value);
  if (!text) return { firstName: "", lastName: "" };
  if (text.includes(",")) {
    const [lastName, firstName] = text.split(",").map(cleanCell);
    return { firstName, lastName };
  }
  const parts = text.split(/\s+/);
  return { firstName: parts.shift() || "", lastName: parts.join(" ") };
}

function cleanCell(value) {
  return String(value || "").trim();
}

function cleanImportedName(value) {
  return cleanCell(value)
    .replace(/\b(phone|cell|mobile|home|work|employee|server|host|busser|bartender|manager)\b/gi, "")
    .replace(/[|:;\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,.\-\s]+|[,.\-\s]+$/g, "");
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return cleanCell(value);
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

function formatPhoneNumber(value) {
  return normalizePhone(value);
}

function normalizeSavedEmployeePhones() {
  let changed = false;
  (state.employees || []).forEach((employee) => {
    const formatted = formatPhoneNumber(employee.phone || "");
    if (formatted !== (employee.phone || "")) {
      employee.phone = formatted;
      changed = true;
    }
  });
  return changed;
}

function bindPhoneFormatter(input) {
  if (!input || input.dataset.phoneFormatterBound === "true") return;
  input.dataset.phoneFormatterBound = "true";
  const apply = () => {
    const formatted = formatPhoneNumber(input.value);
    if (formatted && input.value !== formatted) input.value = formatted;
  };
  input.addEventListener("input", apply);
  input.addEventListener("blur", apply);
  apply();
}

function bindPhoneFormatters(root = document) {
  root.querySelectorAll("[data-phone-input], input[type=tel]").forEach(bindPhoneFormatter);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cellValue = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted && char === "\"" && next === "\"") {
      cellValue += "\"";
      i++;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cellValue);
      cellValue = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cellValue);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cellValue = "";
    } else {
      cellValue += char;
    }
  }
  row.push(cellValue);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function downloadFile(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setupTimePicker() {
  const picker = document.createElement("div");
  picker.id = "timePicker";
  picker.className = "time-picker";
  document.body.append(picker);

  ["templateStart", "templateEnd", "shiftStart", "shiftEnd", "shiftTrainingSegmentEnd", "dayBlockStart", "dayBlockEnd", "timeOffEditStart", "timeOffEditEnd"].forEach((id) => attachTimePickerInput($(id)));

  document.addEventListener("mousedown", (event) => {
    if (!event.target.closest("#timePicker") && event.target !== activeTimeInput) closeTimePicker();
  });
  window.addEventListener("resize", closeTimePicker);
  window.addEventListener("scroll", (event) => {
    if (event.target?.closest?.("#timePicker")) return;
    closeTimePicker();
  }, true);
}

function attachTimePickerInput(input) {
  if (!input || input.dataset.timePickerAttached) return;
  input.dataset.timePickerAttached = "true";
  input.setAttribute("autocomplete", "off");
  input.addEventListener("focus", () => {
    openTimePicker(input);
    selectTimeInputText(input);
  });
  input.addEventListener("click", () => {
    openTimePicker(input);
    selectTimeInputText(input);
  });
  input.addEventListener("input", () => openTimePicker(input));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTimePicker();
  });
}

function selectTimeInputText(input) {
  if (!input || input.readOnly || input.disabled) return;
  window.setTimeout(() => {
    if (document.activeElement === input) input.select();
  }, 0);
}

function wirePasswordToggles(root = document) {
  root.querySelectorAll("[data-password-toggle]").forEach((button) => {
    if (button.dataset.passwordToggleBound === "true") return;
    button.dataset.passwordToggleBound = "true";
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      button.textContent = visible ? "Show" : "Hide";
      button.setAttribute("aria-pressed", String(!visible));
    });
  });
}

function openTimePicker(input) {
  activeTimeInput = input;
  const picker = $("timePicker");
  const hostDialog = input.closest("dialog");
  const host = hostDialog || document.body;
  if (picker.parentElement !== host) host.append(picker);
  const currentMinutes = minutesFromTime(input.value);
  const timeOptions = Array.from({ length: 96 }, (_, index) => index * 15);
  if (currentMinutes != null && !timeOptions.includes(currentMinutes)) {
    timeOptions.push(currentMinutes);
    timeOptions.sort((a, b) => a - b);
  }
  const optionButtons = [];
  const canUseUntilVolume = input.id === "templateEnd" || input.id === "shiftEnd";
  const allowUntilVolumeOption = input.id !== "shiftEnd" || state.settings.showUntilVolumeInShiftEditor;
  if (input.id.toLowerCase().includes("end") && !input.dataset.mealEnd && canUseUntilVolume && allowUntilVolumeOption) {
    optionButtons.push(`<button class="time-option${/until\s*volume/i.test(input.value) ? " selected" : ""}" type="button" data-time="Until Volume">Until Volume</button>`);
  }
  optionButtons.push(...timeOptions.map((minutes) => {
    const time = timeFromMinutes(minutes);
    const selected = currentMinutes === minutes ? " selected" : "";
    return `<button class="time-option${selected}" type="button" data-time="${time}" data-minutes="${minutes}">${time}</button>`;
  }));
  picker.innerHTML = optionButtons.join("");
  picker.querySelectorAll("[data-time]").forEach((button) => {
    button.onclick = () => {
      input.value = button.dataset.time;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (input.id === "templateEnd") $("templateUntilVolume").checked = button.dataset.time === "Until Volume";
      if (input.id === "shiftEnd") $("shiftUntilVolume").checked = state.settings.showUntilVolumeInShiftEditor && button.dataset.time === "Until Volume";
      closeTimePicker();
    };
  });
  const rect = input.getBoundingClientRect();
  if (hostDialog) {
    const hostRect = hostDialog.getBoundingClientRect();
    picker.style.left = `${rect.left - hostRect.left + hostDialog.scrollLeft}px`;
    picker.style.top = `${rect.bottom - hostRect.top + hostDialog.scrollTop + 4}px`;
  } else {
    picker.style.left = `${rect.left}px`;
    picker.style.top = `${rect.bottom + 4}px`;
  }
  picker.style.width = `${Math.max(rect.width, 150)}px`;
  picker.classList.add("open");
  requestAnimationFrame(() => centerSelectedTimeOption(picker));
}

function closeTimePicker() {
  const picker = $("timePicker");
  if (picker) picker.classList.remove("open");
  activeTimeInput = null;
}

function centerSelectedTimeOption(picker) {
  const selected = picker.querySelector(".time-option.selected");
  if (!selected) {
    picker.scrollTop = 0;
    return;
  }
  const target = selected.offsetTop - (picker.clientHeight / 2) + (selected.offsetHeight / 2);
  picker.scrollTop = Math.max(0, Math.min(target, picker.scrollHeight - picker.clientHeight));
}

function armDeleteButton(button, onConfirm) {
  if (button.classList.contains("confirm-armed")) {
    button.classList.remove("confirm-armed");
    button.textContent = button.dataset.originalText || button.textContent;
    onConfirm();
    return;
  }
  document.querySelectorAll(".confirm-armed").forEach((armed) => {
    armed.classList.remove("confirm-armed");
    armed.textContent = armed.dataset.originalText || armed.textContent;
  });
  button.dataset.originalText = button.textContent;
  button.classList.add("confirm-armed");
  button.textContent = "X";
}

function wireEvents() {
  wirePasswordToggles();
  document.querySelectorAll(".toolbar-menu").forEach((menu) => {
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      document.querySelectorAll(".toolbar-menu").forEach((other) => {
        if (other !== menu) other.open = false;
      });
    });
  });
  document.addEventListener("click", (event) => {
    if (gridFiltersChangedWhileOpen && !eventInsideGridFilters(event)) {
      gridFiltersStayOpen = false;
      gridFiltersChangedWhileOpen = false;
      const filterDetails = $("scheduleFiltersDetails");
      if (filterDetails) filterDetails.open = false;
    }
    if (selectedUnassignedShiftId && !event.target.closest(".unassigned-shift-tray, .staged-shift-info, .schedule-grid, .role-jump-strip")) {
      clearOpenShiftSelectionWithoutFullRender();
    }
    if (pendingTrayWarning && !event.target.closest(".pending-tray-warning")) {
      pendingTrayWarning = null;
      renderSchedule();
    }
    if (!event.target.closest(".projection-menu")) closeProjectionPopovers();
    if (event.target.closest(".toolbar-menu")) return;
    document.querySelectorAll(".toolbar-menu").forEach((menu) => menu.open = false);
  });
  document.querySelectorAll(".menu-panel button, .menu-panel .file-label input").forEach((control) => {
    control.addEventListener("click", () => {
      window.setTimeout(() => {
        document.querySelectorAll(".toolbar-menu").forEach((menu) => menu.open = false);
      }, 100);
    });
  });
  document.addEventListener("dragover", updateDragAutoScroll);
  document.addEventListener("wheel", handleDragWheel, { passive: false, capture: true });
  window.addEventListener("wheel", handleDragWheel, { passive: false, capture: true });
  document.addEventListener("selectstart", suppressSelectionWhileDragging, { capture: true });
  document.addEventListener("dragstart", suppressSelectionWhileDragging, { capture: true });
  document.addEventListener("drop", () => {
    dragScrollVelocity = 0;
    document.body.classList.remove("dragging-open-shift");
    document.body.classList.remove("dragging-assigned-shift");
  });
  $("prevWeekBtn").onclick = () => { setCurrentWeek(addDays(currentDate, -7)); renderAll(); };
  $("nextWeekBtn").onclick = () => { setCurrentWeek(addDays(currentDate, 7)); renderAll(); };
  $("weekPicker").onchange = () => { setCurrentWeek(parseDateKey($("weekPicker").value)); renderAll(); };
  $("weekViewBtn")?.addEventListener("click", exitDayFocus);
  $("dayViewBtn")?.addEventListener("click", () => enterDayFocus());
  document.querySelectorAll("[data-mobile-view]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.mobileView === "day") enterDayFocus();
      else toggleCompactPreview();
    });
  });
  $("issueBtn").onclick = (event) => {
    event.stopPropagation();
    toggleIssuePopover();
  };
  document.addEventListener("click", (event) => {
    if (!issuePopoverOpen) return;
    if (event.target.closest("#issuePopover") || event.target.closest("#issueBtn")) return;
    issuePopoverOpen = false;
    renderIssuePopover([]);
  });
  window.addEventListener("resize", () => {
    if (issuePopoverOpen) positionIssuePopover();
    layoutScheduleRail();
  });
  window.addEventListener("scroll", () => {
    if (issuePopoverOpen) positionIssuePopover();
  }, true);
  $("zoomOutBtn").onclick = () => adjustScheduleZoom(-0.05);
  $("zoomInBtn").onclick = () => adjustScheduleZoom(0.05);
  if ($("toggleUnavailablePanelBtn")) $("toggleUnavailablePanelBtn").onclick = () => {
    state.settings.showUnavailablePanel = !state.settings.showUnavailablePanel;
    saveState();
    renderSchedule();
  };
  if ($("toggleRoleSummaryBtn")) $("toggleRoleSummaryBtn").onclick = () => {
    state.settings.showWeeklyRoleSummary = state.settings.showWeeklyRoleSummary === false;
    saveState();
    renderWeeklyRoleSummary();
  };
  $("scheduleGrid").addEventListener("wheel", handleScheduleGridWheel, { passive: false });
  $("compactViewBtn").onclick = toggleCompactPreview;
  $("printBtn").onclick = openPrintDialog;
  $("cancelPrintBtn").onclick = () => $("printDialog").close();
  $("printLayout").onchange = () => {
    updateCompactPrintAdvancedVisibility();
    renderPrintWarningChecklist();
  };
  $("printSort").onchange = renderPrintWarningChecklist;
  $("compactPrintShiftOrder").onchange = renderPrintWarningChecklist;
  $("printForm").onsubmit = async (event) => {
    event.preventDefault();
    $("printDialog").close();
    await printSchedule();
  };
  $("quickTemplate").onchange = renderSchedule;
  $("openShiftBaySort").onchange = () => {
    state.settings.openShiftBaySort = $("openShiftBaySort").value;
    if (state.settings.openShiftBaySort !== "role") openShiftBayRoleFocusId = "";
    saveState();
    renderSchedule();
  };
  $("addOpenShiftBtn").onclick = () => openStagedShiftDialog();
  $("autoAssignCleanBayBtn").onclick = autoAssignCleanOpenShiftBay;
  $("addWeekMissingCoverageBtn").onclick = addWeekMissingCoverageToShiftBay;
  $("addTemplateToTrayBtn").onclick = addSelectedTemplateToTray;
  $("clearOpenShiftBayBtn").onclick = () => armDeleteButton($("clearOpenShiftBayBtn"), clearOpenShiftBayForWeek);
  $("copyBtn").onclick = copySelectedShift;
  $("pasteBtn").onclick = pasteShift;
  $("undoBtn").onclick = restoreUndo;
  $("exportCsvBtn").onclick = exportCsv;
  $("problemFocusBtn").onclick = () => {
    state.settings.problemFocusMode = !state.settings.problemFocusMode;
    saveState();
    renderSchedule();
  };
  $("duplicatePrevWeekBtn").onclick = copyPreviousWeekToOpenShiftBay;
  $("clearSelectedDayBtn").onclick = () => armDeleteButton($("clearSelectedDayBtn"), clearSelectedDay);
  $("clearSelectedEmployeeBtn").onclick = () => armDeleteButton($("clearSelectedEmployeeBtn"), clearSelectedEmployee);
  $("trainingPlanBtn").onclick = openTrainingPlanDialog;
  $("laborImportInput").onchange = importLaborNeedsFromCsv;
  $("employeeImportInput").onchange = importEmployeesFromFile;
  $("scheduleHistoryImportInput").onchange = importScheduleHistoryFile;
  $("applyHistoryTemplateBtn").onclick = applyHistoryPatternTemplate;
  $("applyHistoryCoverageBtn").onclick = applyHistoryCoveragePars;
  $("timeOffImportInput").onchange = importCtuitTimeOff;
  $("requestOffImportBtn").onclick = () => {
    $("timeOffImportInput").value = "";
    $("timeOffImportInput").click();
  };
  $("managerNotesImportInput").onchange = importManagerNotesJson;
  $("applyManagerNotesBtn").onclick = applyBuiltInManagerNotes;
  $("backupBtn").onclick = backup;
  $("storageInfoBtn").onclick = openStorageInfo;
  $("storageStatusBtn").onclick = openStorageInfo;
  $("recentActivityBtn")?.addEventListener("click", openRecentActivity);
  $("manageManagersBtn")?.addEventListener("click", openManagerAccess);
  $("resetDemoDataBtn")?.addEventListener("click", resetDemoData);
  $("locationSwitcher")?.addEventListener("change", handleLocationSwitcherChange);
  $("signInMenuBtn")?.addEventListener("click", () => showLoginOverlay("Sign in to open the cloud scheduler."));
  $("signOutBtn")?.addEventListener("click", () => {
    clearAuthSession();
    updateAccountUi();
    showLoginOverlay("Signed out. Sign in to open the cloud scheduler.");
  });
  $("loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("loginSubmitBtn");
    if (button) { button.disabled = true; button.textContent = "Signing in..."; }
    try {
      setLoginMessage("Checking account...");
      const user = await signInWithPassword($("loginEmail").value.trim(), $("loginPassword").value);
      if (user?.redirectingToStaffPortal) return;
      if (user?.passwordChangeRequired) {
        showPasswordChangeDialog();
        return;
      }
      hideLoginOverlay();
      await hydrateStateFromServer();
    } catch (error) {
      clearAuthSession();
      updateAccountUi();
      const errorMessage = String(error?.message || "");
      setLoginMessage("Sign in failed. Check the email and password, then try again.", errorMessage);
    } finally {
      if (button) { button.disabled = false; button.textContent = "Sign In"; }
    }
  });
  $("passwordChangeDialog")?.addEventListener("cancel", (event) => {
    if (currentUser?.passwordChangeRequired) event.preventDefault();
  });
  $("passwordChangeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
      const password = $("newManagerPassword")?.value || "";
      const confirm = $("confirmManagerPassword")?.value || "";
    if (password.length < 8) { setPasswordChangeMessage("Use at least 8 characters."); return; }
    if (password !== confirm) { setPasswordChangeMessage("The passwords do not match."); return; }
    const button = $("passwordChangeSubmitBtn");
    if (button) { button.disabled = true; button.textContent = "Saving..."; }
    try {
      setPasswordChangeMessage("Saving password...");
      await changeRequiredPassword(password);
      // Supabase can invalidate the temporary-password session after the
      // admin password update. Re-authenticate before loading the scheduler so
      // the next request does not fail with a misleading blank-login error.
      const email = currentLoginEmail
        || currentUser?.email
        || authSession?.email
        || authSession?.user?.email
        || $("passwordChangeDialog")?.dataset.loginEmail
        || "";
      if (!email) throw new Error("Your login email could not be recovered. Sign in again before saving the password.");
      await signInWithPassword(email, password);
      hidePasswordChangeDialog();
      hideLoginOverlay();
      await hydrateStateFromServer();
    } catch (error) {
      setPasswordChangeMessage(error.message || "Could not change password.");
    } finally {
      if (button) { button.disabled = false; button.textContent = "Save Password"; }
    }
  });
  $("closeStorageInfoBtn").onclick = () => $("storageInfoDialog").close();
  $("closeRecentActivityBtn")?.addEventListener("click", () => $("recentActivityDialog").close());
  $("toggleRecentActivityDetailsBtn")?.addEventListener("click", () => {
    recentActivityDetailsVisible = !recentActivityDetailsVisible;
    renderRecentActivityEvents();
  });
  $("closeManagerAccessBtn")?.addEventListener("click", () => $("managerAccessDialog").close());
  $("managerInviteForm")?.addEventListener("submit", sendManagerInvite);
  $("staffAccessBtn")?.addEventListener("click", openStaffAccess);
  $("closeStaffAccessBtn")?.addEventListener("click", () => $("staffAccessDialog").close());
  $("staffInviteForm")?.addEventListener("submit", sendStaffInvite);
  $("staffRequestsBtn")?.addEventListener("click", openStaffRequests);
  $("closeStaffRequestsBtn")?.addEventListener("click", () => $("staffRequestsDialog").close());
  $("sandboxStaffPortalBtn")?.addEventListener("click", () => {
    if (isDemoLocation()) window.location.href = "staff.html?demo=1";
  });
  $("pasteEmployeesBtn").onclick = openPasteEmployeesDialog;
  $("revealArchiveAllEmployees").onchange = () => {
    $("archiveAllEmployeesBtn").hidden = !$("revealArchiveAllEmployees").checked;
  };
  $("previewPastedEmployeesBtn").onclick = previewPastedEmployees;
  $("pasteEmployeesForm").onsubmit = importPastedEmployees;
  $("cancelPasteEmployeesBtn").onclick = () => $("pasteEmployeesDialog").close();
  $("refreshStaffingBtn").onclick = renderStaffingAnalysis;
  $("printStaffingBtn").onclick = printStaffingAnalysis;
  $("printCallWeeklyBtn").onclick = printCallWeeklySheet;
  $("floorPlanDate").onchange = renderFloorPlan;
  $("floorPlanPeriod").onchange = renderFloorPlan;
  $("printFloorPlanBtn").onclick = printFloorPlan;
  $("printFloorPlanWeekBtn").onclick = printFloorPlanWeek;
  $("printCompletedWeekBtn").onclick = printCompletedWeek;
  $("monthPrevBtn").onclick = () => { currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1); renderMonthly(); };
  $("monthNextBtn").onclick = () => { currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1); renderMonthly(); };
  $("defaultCoverageBtn").onclick = useCoverageDefaults;
  $("projectionCoverageBtn").onclick = useProjectionCoverage;
  $("previousCoverageBtn").onclick = usePreviousWeekCoverage;
  $("addMissingCoverageBtn").onclick = addMissingCoverageToShiftBay;
  $("cancelCoverageBtn").onclick = () => $("coverageDialog").close();
  $("coverageEditor").oninput = () => renderCoverageSummary($("coverageDate").value);
  $("coverageForm").onsubmit = (event) => {
    event.preventDefault();
    pushUndo();
    state.coverageRequirements[$("coverageDate").value] = collectCoverageEditor();
    $("coverageDialog").close();
    renderAll();
  };
  $("generateTrainingPlanBtn").onclick = generateTrainingPlan;
  $("addTrainingPlanBtn").onclick = addTrainingPlan;
  $("cancelTrainingPlanBtn").onclick = () => $("trainingPlanDialog").close();
  $("dayBlockShiftBtn").onclick = () => {
    const employeeId = $("shiftEmployee").value || $("shiftEmployeeId").value;
    const dateKey = $("shiftDate").value;
    openDayBlockDialog(employeeId, dateKey);
  };
  $("requestOffShiftBtn").onclick = () => {
    const employeeId = $("shiftEmployee").value || $("shiftEmployeeId").value;
    const dateKey = $("shiftDate").value;
    if (!employeeId || !dateKey) return showConflict("Choose an employee and date before adding RO.");
    const hasManualRo = Boolean((state.timeOffRequests || []).find((request) => (
      request.employeeId === employeeId &&
      request.date === dateKey &&
      request.source === "Manual"
    )));
    if (hasManualRo) {
      toggleManualRequestOff(employeeId, dateKey);
      updateRequestOffShiftButton();
      $("shiftDialog").close();
      return;
    }
    const startKey = window.prompt("RO start date", dateKey) || "";
    if (!startKey) return;
    const endKey = window.prompt("RO end date", startKey) || "";
    if (!endKey) return;
    addManualRequestOffRange(employeeId, startKey, endKey);
    updateRequestOffShiftButton();
    $("shiftDialog").close();
  };
  $("dayBlockAllDay").onchange = updateDayBlockTimeControls;
  $("dayBlockForm").onsubmit = saveDayBlock;
  $("cancelDayBlockBtn").onclick = () => $("dayBlockDialog").close();
  $("timeOffEditDaypart").onchange = updateTimeOffEditTimeControls;
  $("timeOffEditForm").onsubmit = saveTimeOffEdit;
  $("cancelTimeOffEditBtn").onclick = () => $("timeOffEditDialog").close();
  $("shiftEmployee").onchange = () => {
    $("shiftEmployeeId").value = $("shiftEmployee").value;
    updateRequestOffShiftButton();
    updateShiftDialogContext();
  };
  const refreshShiftEmployeeSelect = () => refreshShiftEmployeeOptions($("shiftEmployee").value || $("shiftEmployeeId").value);
  ["shiftDate", "shiftRole", "shiftStart", "shiftEnd", "shiftUntilVolume", "shiftIsCloser", "shiftIsLunchCloser", "shiftFlexDouble"].forEach((id) => {
    const input = $(id);
    if (!input) return;
    input.addEventListener("change", refreshShiftEmployeeSelect);
    input.addEventListener("input", refreshShiftEmployeeSelect);
  });
  $("shiftIsCloser").addEventListener("change", applyCloserEndTimeDefault);
  $("shiftFlexDouble").addEventListener("change", applyFlexDoubleEndTimeDefault);
  $("shiftIsLunchCloser").addEventListener("change", applyLunchCloserEndTimeDefault);
  $("templateFlexDouble").addEventListener("change", applyTemplateFlexDoubleEndTimeDefault);
  $("shiftDate").addEventListener("change", applyCloserEndTimeDefault);
  $("stagedShiftDate").addEventListener("change", applyCloserEndTimeDefault);
  $("shiftDate").addEventListener("change", updateShiftDialogContext);
  $("stagedShiftDate").addEventListener("change", updateShiftDialogContext);

  $("restoreInput").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const restored = JSON.parse(text);
    pushUndo();
    state = restored.data || restored;
    migrateState(state, state);
    saveState();
    renderAll();
  };

  $("roleForm").onsubmit = (event) => {
    event.preventDefault();
    pushUndo();
    const id = $("roleId").value || uid("role");
    const role = {
      id,
      name: $("roleName").value.trim(),
      department: $("roleDepartment").value,
      defaultRate: Number($("roleDefaultRate").value) || 0,
      color: $("roleColor").value
    };
    state.roles = state.roles.some((item) => item.id === id) ? state.roles.map((item) => item.id === id ? role : item) : [...state.roles, role];
    $("roleForm").reset();
    $("roleDefaultRate").value = "";
    $("roleColor").value = "#2563eb";
    renderAll();
  };
  $("newRoleBtn").onclick = () => { $("roleForm").reset(); $("roleId").value = ""; $("roleDefaultRate").value = ""; $("roleColor").value = "#2563eb"; };
  $("deleteRoleBtn").onclick = () => {
    const id = $("roleId").value;
    if (!id) return;
    armDeleteButton($("deleteRoleBtn"), () => {
      pushUndo();
      state.roles = state.roles.filter((role) => role.id !== id);
      renderAll();
    });
  };

  $("employeeForm").addEventListener("input", (event) => {
    if (event.target?.id !== "weeklyAvailabilityWeek") markEmployeeFormDirty();
  });
  $("employeeForm").addEventListener("change", (event) => {
    if (event.target?.id !== "weeklyAvailabilityWeek") markEmployeeFormDirty();
  });
  $("employeeForm").onsubmit = async (event) => {
    event.preventDefault();
    setEmployeeSaveDebugStatus("Employee form handler reached");
    const saveAvailability = availabilitySaveRequested;
    const activateSubmittedAvailability = submitAvailabilityPatternRequested;
    const deactivateAvailabilityPattern = deactivateAvailabilityPatternRequested;
    availabilitySaveRequested = false;
    submitAvailabilityPatternRequested = false;
    deactivateAvailabilityPatternRequested = false;
    pushUndo();
    const id = $("employeeId").value || uid("employee");
    const existingEmployee = state.employees.find((item) => item.id === id);
    const firstName = $("firstName").value.trim();
    const lastName = $("lastName").value.trim();
    const importMatch = !existingEmployee ? findEmployeeImportMatch({
      firstName,
      lastName,
      phone: formatPhoneNumber($("employeePhone").value.trim())
    }) : { employee: null, possible: [] };
    const duplicateEmployee = importMatch.employee || importMatch.possible?.[0];
    if (duplicateEmployee) {
      undoStack.pop();
      setEmployeeSaveDebugStatus("Save stopped: possible duplicate employee", "failed");
      showConflict(`${displayName(duplicateEmployee)} may already be in the employee list. I opened that profile instead of creating a duplicate.`);
      loadEmployee(duplicateEmployee.id);
      return;
    }
    const callWeekly = $("employeeCallWeekly").checked;
    const weeklyPanelOpen = !$("weeklyAvailabilityFieldset").hidden;
    const availabilityEffectiveDate = normalizeAvailabilityEffectiveDate($("employeeAvailabilityEffectiveDate").value || existingEmployee?.availabilityEffectiveDate || currentWeekKey());
    $("employeeAvailabilityEffectiveDate").value = availabilityEffectiveDate;
    const parsedAvailability = parseAvailability();
    const existingPatterns = existingEmployee ? availabilityPatternsForEmployee(existingEmployee) : [];
    const selectedPatternId = (availabilityEditingPatternId || (saveAvailability ? "" : selectedAvailabilityPatternId) || "").replace(/^draft$/, "") || `pattern-${Date.now()}`;
    const selectedPattern = existingPatterns.find((pattern) => pattern.id === selectedPatternId);
    const patternName = $("employeeAvailabilityPatternName").value.trim()
      || selectedPattern?.name
      || existingEmployee?.availabilityPatternName
      || defaultAvailabilityPatternName(existingEmployee || { id, firstName, lastName });
    // Call Weekly has its own per-week availability records. The regular
    // availability editor is hidden in this mode, so its naming and overlap
    // rules must not block or rewrite a Call Weekly profile save.
    const regularAvailabilityMode = !callWeekly;
    const availabilityAction = regularAvailabilityMode && (saveAvailability || activateSubmittedAvailability || deactivateAvailabilityPattern);
    const duplicatePattern = saveAvailability
      ? findDuplicateAvailabilityPatternName(patternName, existingEmployee?.id || id, selectedPatternId)
      : null;
    if (duplicatePattern) {
      undoStack.pop();
      setEmployeeSaveDebugStatus("Save stopped: duplicate availability name", "failed");
      showAppAlert({
        title: "Availability Not Saved",
        message: `This employee already has a saved availability named "${patternName}". Give this availability a different name, then save it again.`,
        type: "warning"
      });
      return;
    }
    const patternAvailability = saveAvailability ? parsedAvailability : (selectedPattern?.availability || parsedAvailability);
    const patternActive = availabilityAction
      && !deactivateAvailabilityPattern
      && (activateSubmittedAvailability || selectedPattern?.active === true);
    const updatedPattern = {
      id: selectedPatternId,
      name: patternName,
      availability: patternAvailability,
      repeatWeeks: patternActive ? Math.max(1, Math.min(4, Number($("employeeAvailabilityRepeatWeeks").value) || 1)) : null,
      active: patternActive,
      effectiveDate: patternActive ? availabilityEffectiveDate : "",
      endsOn: selectedPattern?.endsOn || "",
      approvalStatus: selectedPattern?.approvalStatus || "",
      approved: selectedPattern?.approved === true
    };
    const replacedPatterns = availabilityAction && patternActive && !deactivateAvailabilityPattern
      ? availabilityPatternsReplacedOnDate(existingPatterns, selectedPatternId, availabilityEffectiveDate)
      : [];
    if (replacedPatterns.length) {
      const replacementDate = displayDate(parseDateKey(availabilityEffectiveDate));
      const shouldReplace = await showAppConfirm({
        title: "Replace Availability?",
        message: `This availability will take over for scheduling starting ${replacementDate}. The prior availability stays saved in this profile.`,
        items: replacedPatterns.map((pattern) => `${pattern.name} stops applying on ${replacementDate}`),
        confirmText: "Replace",
        cancelText: "Keep Current"
      });
      if (!shouldReplace) {
        undoStack.pop();
        setEmployeeSaveDebugStatus("Availability replacement cancelled", "idle");
        return;
      }
    }
    const availabilityPatterns = availabilityAction
      ? (existingPatterns.some((pattern) => pattern.id === selectedPatternId)
        ? existingPatterns.map((pattern) => {
          if (pattern.id === selectedPatternId) return updatedPattern;
          return replacedPatterns.some((replaced) => replaced.id === pattern.id)
            ? { ...pattern, endsOn: availabilityEffectiveDate }
            : pattern;
        })
        : [updatedPattern, ...existingPatterns.map((pattern) => (
          replacedPatterns.some((replaced) => replaced.id === pattern.id)
            ? { ...pattern, endsOn: availabilityEffectiveDate }
            : pattern
        ))])
      : existingPatterns;
    const availabilityConflict = availabilityAction
      ? availabilityPatternConflicts(availabilityPatterns)
      : null;
    if (availabilityConflict) {
      undoStack.pop();
      setEmployeeSaveDebugStatus("Save stopped: availability patterns overlap", "failed");
      showConflict(`${availabilityConflict.left.name} and ${availabilityConflict.right.name} overlap on ${displayDate(availabilityConflict.date)}. Deactivate or edit one pattern before saving or submitting availability.`);
      return;
    }
    const availabilitySchedule = Array.isArray(existingEmployee?.availabilitySchedule)
      ? existingEmployee.availabilitySchedule.map((item) => ({ ...item, availability: { ...(item.availability || {}) } }))
      : [];
    if (availabilityAction && patternActive) {
      const scheduledIndex = availabilitySchedule.findIndex((item) => item.effectiveDate === availabilityEffectiveDate);
      const scheduledVersion = { effectiveDate: availabilityEffectiveDate, availability: updatedPattern.availability };
      if (scheduledIndex >= 0) availabilitySchedule[scheduledIndex] = scheduledVersion;
      else availabilitySchedule.push(scheduledVersion);
      availabilitySchedule.sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)));
    }
    const weeklyAvailability = { ...(existingEmployee?.weeklyAvailability || {}) };
    const weeklyAvailabilityWeekKey = selectedWeeklyAvailabilityWeekKey();
    if (callWeekly || weeklyPanelOpen) {
      weeklyAvailability[weeklyAvailabilityWeekKey] = parseWeeklyAvailability();
    }
    employeeNewProfileDraft = false;
    const employee = {
      id,
      firstName,
      lastName,
      nickname: $("employeeNickname").value.trim(),
      birthday: $("employeeBirthday").value,
      phone: formatPhoneNumber($("employeePhone").value.trim()),
      managerNotes: $("employeeManagerNotes").value.trim(),
      active: existingEmployee ? $("employeeActive").checked : true,
      canClose: $("employeeCanClose").checked,
      canLunchClose: $("employeeCanLunchClose").checked,
      noDoubles: $("employeeNoDoubles").checked,
      alwaysPrintFloorEndTime: $("employeeAlwaysPrintEndTime").checked,
      archived: Boolean(existingEmployee?.archived),
      departments: checkedValues("employeeDepartments"),
      callWeekly,
      mealTraining: checkedValues("mealTraining"),
      roleTraining: checkedValues("roleTraining"),
      emergencyRoleIds: checkedValues("emergencyRoleIds").filter((roleId) => checkedValues("roleTraining").includes(roleId)),
      roleMealTraining: collectRoleMealTraining(),
      trainerRoles: checkedValues("trainerRoles"),
      payRates: collectEmployeePayRates(),
      availabilityEffectiveDate: availabilityAction ? availabilityEffectiveDate : (existingEmployee?.availabilityEffectiveDate || availabilityEffectiveDate),
      availabilityPatternName: availabilityAction ? patternName : (existingEmployee?.availabilityPatternName || patternName),
      availabilityRepeatWeeks: availabilityAction ? Math.max(1, Math.min(4, Number($("employeeAvailabilityRepeatWeeks").value) || 1)) : (existingEmployee?.availabilityRepeatWeeks || 1),
      availabilityPatterns,
      availabilitySchedule,
      availability: availabilityAction && patternActive && (availabilityEffectiveDate <= formatDateKey(currentDate) || !existingEmployee)
        ? updatedPattern.availability
        : (existingEmployee?.availability || emptyAvailability()),
      weeklyAvailability,
      weeklyRules: parseWeeklyRules()
    };
    const isExisting = state.employees.some((item) => item.id === id);
    state.employees = isExisting ? state.employees.map((item) => item.id === id ? employee : item) : [...state.employees, employee];
    // Employee profile edits should be durable before the user switches
    // profiles; waiting for the general schedule debounce can lose a fast edit.
    const profileSaveUpdatedAt = state.meta?.updatedAt || "";
    state.meta = {
      ...(state.meta || {}),
      schemaVersion: DATA_SCHEMA_VERSION,
      deviceId: getDeviceId(),
      // Employee profile saves use a separate server override and must not
      // make the whole schedule document appear newer than it is.
      updatedAt: SERVER_STORAGE_ENABLED ? profileSaveUpdatedAt : nowIso(),
      updatedBy: currentSaveActor()
    };
    migrateState(state, state);
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    const saved = SERVER_STORAGE_ENABLED
      ? await persistEmployeeProfileToServer(employee)
      : (saveState(), true);
    // The scoped employee save already completed above. Do not let this render
    // immediately enqueue a stale whole-schedule write behind it.
    renderAll({ skipSave: true });
    loadEmployee(id);
    if (callWeekly || weeklyPanelOpen) setWeeklyAvailabilityWeek(weeklyAvailabilityWeekKey);
    if (saved || !SERVER_STORAGE_ENABLED) {
      markEmployeeFormClean();
      showEmployeeSavedToast(displayName(employee));
      return true;
    } else {
      showConflict("The employee profile was kept in this browser, but the shared save did not confirm. Refresh before continuing schedule edits.");
      return false;
    }
  };
  $("newEmployeeBtn").onclick = async () => {
    if (!(await confirmDiscardEmployeeChanges())) return;
    resetEmployeeForm();
    renderEmployees();
    $("firstName")?.focus();
  };
  $("employeeSearch").oninput = renderEmployees;
  $("showArchivedEmployees").onchange = renderEmployees;
  $("toggleEmployeeRosterBtn").onclick = () => {
    state.settings.employeeRosterCollapsed = !state.settings.employeeRosterCollapsed;
    saveState();
    renderEmployees();
  };
  document.querySelectorAll("[data-employee-profile-tab]").forEach((button) => {
    button.onclick = () => activateEmployeeProfileTab(button.dataset.employeeProfileTab);
  });
  ["firstName", "lastName"].forEach((id) => {
    $(id).addEventListener("input", updateStickyEmployeeName);
  });
  $("openAllAvailabilityBtn").onclick = () => {
    DAYS.forEach((_, dayIndex) => setAvailabilityPreset(`[data-availability-day="${dayIndex}"][data-availability-slot="0"]`, dayIndex, "open"));
    refreshAvailabilityDayCardSummaries();
  };
  $("clearAllAvailabilityBtn").onclick = () => {
    DAYS.forEach((_, dayIndex) => setAvailabilityPreset(`[data-availability-day="${dayIndex}"][data-availability-slot="0"]`, dayIndex, "unavailable"));
    refreshAvailabilityDayCardSummaries();
  };
  $("openAllWeeklyAvailabilityBtn").onclick = () => setAvailabilityInputs("[data-weekly-availability-day]", "12a-11:59p");
  $("clearAllWeeklyAvailabilityBtn").onclick = () => setAvailabilityInputs("[data-weekly-availability-day]", "");
  $("saveAvailabilityPatternBtn").onclick = async () => {
    const button = $("saveAvailabilityPatternBtn");
    if (button?.disabled) return;
    const current = employeeById($("employeeId")?.value);
    const nameInput = $("employeeAvailabilityPatternName");
    let name = nameInput?.value.trim();
    if (!name) {
      showAppAlert({ title: "Availability Needs a Name", message: "Give this availability a name before saving it.", type: "warning" });
      return;
    }
    const currentPatterns = current ? availabilityPatternsForEmployee(current) : [];
    const selectedExisting = currentPatterns.find((pattern) => pattern.id === selectedAvailabilityPatternId);
    const editingExisting = currentPatterns.find((pattern) => pattern.id === availabilityEditingPatternId);
    // A profile switch or a new draft can leave an old edit target behind.
    // Never let that stale id redirect this save to another employee/profile.
    if (availabilityEditingPatternId && !editingExisting) availabilityEditingPatternId = "";
    // Selecting a card only selects it for review or Apply. It never turns a
    // Save click into an overwrite; explicit Edit is required for that.
    const duplicate = findDuplicateAvailabilityPatternName(name, current?.id || "", availabilityEditingPatternId || "");
    if (duplicate) {
      showAppAlert({
        title: "Availability Not Saved",
        message: `This employee already has a saved availability named "${name}". Give this availability a different name, then save it again.`,
        type: "warning"
      });
      return;
    }
    if (!availabilityEditingPatternId && !selectedExisting && selectedAvailabilityPatternId === "draft") {
      selectedAvailabilityPatternId = "pattern-" + Date.now();
    }
    markEmployeeFormDirty();
    availabilitySaveRequested = true;
    // Save Availability is a scoped employee-profile action. Use the same
    // direct handler as Save Employee so hidden/unrelated required fields
    // cannot silently prevent the availability save from reaching the
    // profile-save path.
    if (button) {
      button.disabled = true;
      button.dataset.originalLabel = button.textContent || "Save";
      button.textContent = "Saving...";
    }
    try {
      await submitEmployeeFormDirectly();
    } finally {
      const currentButton = $("saveAvailabilityPatternBtn");
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = currentButton.dataset.originalLabel || "Save";
        delete currentButton.dataset.originalLabel;
      }
    }
  };
  $("editAvailabilityPatternBtn")?.addEventListener("click", () => {
    const employee = employeeById($("employeeId")?.value);
    const selected = availabilityPatternsForEmployee(employee).find((pattern) => pattern.id === selectedAvailabilityPatternId);
    if (!selected || selected.active) return;
    const openSelected = () => {
      availabilityEditingPatternId = selected.id;
      $("employeeAvailabilityPatternName").value = selected.name;
      renderAvailabilityEditor(employee);
      populateAvailabilityEditor(selected.availability);
      markEmployeeFormClean();
    };
    if (employeeFormHasUnsavedChanges()) {
      showAppConfirm({
        title: "Discard Draft?",
        message: "Opening this saved availability will replace the unsaved availability currently in the editor.",
        confirmText: "Open",
        cancelText: "Keep Draft"
      }).then((confirmed) => {
        if (confirmed) openSelected();
      });
      return;
    }
    openSelected();
  });
  $("newAvailabilityPatternBtn").onclick = () => {
    const employee = employeeById($("employeeId")?.value);
    selectedAvailabilityPatternId = "";
    availabilityEditingPatternId = "";
    $("employeeAvailabilityPatternName").value = defaultAvailabilityPatternName(employee);
    $("employeeAvailabilityRepeatWeeks").value = "1";
    $("employeeAvailabilityEffectiveDate").value = currentWeekKey();
    renderAvailabilityPatternWorkspace(employee);
    renderAvailabilityEditor(employee);
    markEmployeeFormDirty();
  };
  $("copyLiveAvailabilityBtn")?.addEventListener("click", () => {
    const employee = employeeById($("employeeId")?.value);
    const live = availabilityPatternsForEmployee(employee)
      .filter((pattern) => pattern.active && !isFutureAvailabilityPattern(pattern))
      .sort((left, right) => String(right.effectiveDate || "").localeCompare(String(left.effectiveDate || "")))[0];
    if (!employee || !live) {
      $("newAvailabilityPatternBtn").click();
      return;
    }
    selectedAvailabilityPatternId = "";
    availabilityEditingPatternId = "";
    $("employeeAvailabilityPatternName").value = nextAvailabilityPatternName(employee, `${live.name} copy`);
    $("employeeAvailabilityRepeatWeeks").value = "1";
    $("employeeAvailabilityEffectiveDate").value = currentWeekKey();
    renderAvailabilityPatternWorkspace(employee);
    renderAvailabilityEditor(employee);
    populateAvailabilityEditor(live.availability);
    markEmployeeFormDirty();
  });
  $("deleteAvailabilityPatternBtn")?.addEventListener("click", () => {
    const employee = employeeById($("employeeId")?.value);
    const selected = availabilityPatternsForEmployee(employee).find((pattern) => pattern.id === selectedAvailabilityPatternId);
    const status = String(selected?.approvalStatus || "").toLowerCase();
    if (!employee || !selected || selected.active || ["submitted", "pending", "awaiting_approval"].includes(status)) return;
    if (!window.confirm(`Delete the saved availability "${selected.name}"?`)) return;
    markEmployeeFormDirty();
    state.employees = state.employees.map((item) => item.id === employee.id ? { ...item, availabilityPatterns: (item.availabilityPatterns || []).filter((pattern) => pattern.id !== selected.id) } : item);
    selectedAvailabilityPatternId = "";
    availabilityEditingPatternId = "";
    saveState();
    renderAll();
    loadEmployee(employee.id);
  });
  $("makeAvailabilityLiveBtn").onclick = () => {
    const employee = employeeById($("employeeId")?.value);
    const selected = availabilityPatternsForEmployee(employee).find((pattern) => pattern.id === selectedAvailabilityPatternId);
    if (!selected) return;
    const form = $("employeeForm");
    if (!form) return;
    if (selected.active) {
      markEmployeeFormDirty();
      deactivateAvailabilityPatternRequested = true;
      availabilityEditingPatternId = selected.id;
      // Invoke the existing save path without native form validation blocking
      // the availability action on an unrelated employee field.
      submitEmployeeFormDirectly();
      return;
    }
    if (!availabilityHasWindows(selected.availability)) {
      showAppConfirm({
        title: "No availability in this AV",
        message: `Every day in "${selected.name}" is marked Not available. Making it live will tell scheduling that this employee is unavailable for the selected period. Continue?`,
        confirmText: "Make Unavailable",
        cancelText: "Go Back"
      }).then((confirmed) => {
        if (!confirmed) return;
        markEmployeeFormDirty();
        submitAvailabilityPatternRequested = true;
        availabilityEditingPatternId = selected.id;
        submitEmployeeFormDirectly();
      });
      return;
    }
    const guidance = availabilityPatternGuidance(selected);
    if (guidance.warning) {
      showConflict(guidance.text);
      return;
    }
    markEmployeeFormDirty();
    submitAvailabilityPatternRequested = true;
    availabilityEditingPatternId = selected.id;
    // Keep the selected card in place so the new live state is visible after
    // the save instead of briefly showing a stale, deselected copy.
    submitEmployeeFormDirectly();
  };
  $("weeklyAvailabilityWeek").onchange = () => {
    setWeeklyAvailabilityWeek($("weeklyAvailabilityWeek").value);
  };
  $("useActiveScheduleWeekBtn").onclick = () => {
    markEmployeeFormDirty();
    setWeeklyAvailabilityWeek(currentWeekKey());
  };
  $("employeeCallWeekly").onchange = () => {
    syncEmployeeAvailabilityMode();
    if ($("employeeCallWeekly").checked && !employeeWeeklyAvailabilityWeekKey) setWeeklyAvailabilityWeek(currentWeekKey(), { render: false });
    renderWeeklyAvailabilityEditor(employeeById($("employeeId").value));
  };
  $("employeeAvailabilityEffectiveDate").onchange = () => {
    const normalized = normalizeAvailabilityEffectiveDate($("employeeAvailabilityEffectiveDate").value);
    $("employeeAvailabilityEffectiveDate").value = normalized;
    markEmployeeFormDirty();
  };
  $("stickySaveEmployeeBtn").onclick = () => {
    setEmployeeSaveDebugStatus("Save Employee button clicked");
    submitEmployeeFormDirectly();
  };
  $("toggleWeeklyAvailabilityBtn").onclick = () => {
    markEmployeeFormDirty();
    $("employeeCallWeekly").checked = true;
    if (!employeeWeeklyAvailabilityWeekKey) setWeeklyAvailabilityWeek(currentWeekKey(), { render: false });
    syncEmployeeAvailabilityMode();
    renderWeeklyAvailabilityEditor(employeeById($("employeeId").value));
  };
  $("addWeeklyRuleBtn").onclick = addWeeklyRuleRow;
  $("archiveEmployeeBtn").onclick = () => {
    const id = $("employeeId").value;
    if (!id) return;
    pushUndo();
    state.employees = state.employees.map((employee) => employee.id === id ? { ...employee, archived: true, active: false } : employee);
    selectedCell = null;
    selectedShiftId = null;
    renderAll();
  };
  $("restoreEmployeeBtn").onclick = () => {
    const id = $("employeeId").value;
    if (!id) return;
    pushUndo();
    state.employees = state.employees.map((employee) => employee.id === id ? { ...employee, archived: false, active: true } : employee);
    $("showArchivedEmployees").checked = false;
    renderAll();
    loadEmployee(id);
  };
  $("archiveAllEmployeesBtn").onclick = () => {
    armDeleteButton($("archiveAllEmployeesBtn"), () => {
      pushUndo();
      state.employees = state.employees.map((employee) => ({ ...employee, archived: true, active: false }));
      selectedCell = null;
      selectedShiftId = null;
      resetEmployeeForm();
      renderAll();
    });
  };
  $("deleteEmployeeBtn").onclick = () => {
    const id = $("employeeId").value;
    if (!id) return;
    armDeleteButton($("deleteEmployeeBtn"), () => {
      pushUndo();
      state.employees = state.employees.filter((employee) => employee.id !== id);
      renderAll();
    });
  };

  $("templateForm").onsubmit = (event) => {
    event.preventDefault();
    pushUndo();
    const name = $("templateName").value.trim();
    const id = $("templateId").value || state.templates.find((template) => template.name.toLowerCase() === name.toLowerCase())?.id || uid("template");
    const shiftId = $("templateShiftId").value || uid("templateShift");
    const templateShift = {
      id: shiftId,
      dayIndex: Number($("templateDay").value),
      department: $("templateDepartment").value,
      roleId: $("templateRole").value,
      start: normalizeTime($("templateStart").value),
      end: $("templateUntilVolume").checked ? "Until Volume" : normalizeTime($("templateEnd").value),
      untilVolume: $("templateUntilVolume").checked,
      isCloser: $("templateIsCloser").checked,
      isFlexDouble: $("templateFlexDouble").checked,
      color: $("templateColor").value
    };
    const existing = state.templates.find((template) => template.id === id);
    if (existing) {
      existing.name = name;
      existing.shifts = existing.shifts?.some((shift) => shift.id === shiftId)
        ? existing.shifts.map((shift) => shift.id === shiftId ? templateShift : shift)
        : [...(existing.shifts || []), templateShift];
    } else {
      state.templates.push({ id, name, shifts: [templateShift] });
    }
    $("templateId").value = "";
    $("templateId").value = id;
    $("templateName").value = name;
    clearTemplateShiftFields(false);
    renderAll();
    $("templateId").value = id;
    $("templateName").value = name;
  };
  $("newTemplateBtn").onclick = () => clearTemplateShiftFields(false);
  $("newWeeklyTemplateBtn").onclick = () => {
    $("templateForm").reset();
    clearTemplateShiftFields(true);
  };
  $("saveCurrentWeekTemplateBtn").onclick = saveCurrentWeekAsTemplate;
  $("analyzeTemplateBtn").onclick = openTemplateSuggestions;
  $("applyAllTemplateSuggestionsBtn").onclick = applyAllTemplateSuggestions;
  $("closeTemplateSuggestionsBtn").onclick = () => $("templateSuggestionsDialog").close();
  $("addTemplateFromBuilderBtn").onclick = async () => {
    const id = $("templateId").value || state.templates.find((template) => template.name.toLowerCase() === $("templateName").value.trim().toLowerCase())?.id;
    await addTemplateToTray(id);
  };
  $("deleteTemplateBtn").onclick = () => {
    const id = $("templateId").value;
    if (!id) return;
    armDeleteButton($("deleteTemplateBtn"), () => {
      const shiftId = $("templateShiftId").value;
      if (!shiftId) {
        deleteTemplate(id);
        return;
      }
      pushUndo();
      state.templates = state.templates.map((template) => {
        if (template.id !== id) return template;
        return { ...template, shifts: (template.shifts || []).filter((shift) => shift.id !== shiftId) };
      }).filter((template) => template && template.shifts?.length);
      const stillExists = state.templates.some((template) => template.id === id);
      if (stillExists) {
        $("templateId").value = id;
        $("templateShiftId").value = "";
        clearTemplateShiftFields(false);
      } else {
        $("templateForm").reset();
        clearTemplateShiftFields(true);
      }
      saveState();
      renderAll();
    });
  };

  $("settingsForm").onsubmit = (event) => {
    event.preventDefault();
    pushUndo();
    state.settings.weekStart = Number($("weekStart").value);
    state.settings.nameDisplay = $("nameDisplay").value;
    state.settings.visibleDepartments = checkedValues("visibleDepartmentSetting");
    state.settings.scheduleRoleOrder = normalizeScheduleRoleOrder(state.settings.scheduleRoleOrder || []);
    state.settings.ignoreWarnings = $("ignoreWarnings").checked;
    state.settings.showUntilVolumeInShiftEditor = $("showUntilVolumeInShiftEditor").checked;
    state.settings.showShiftNameFields = $("showShiftNameFields").checked;
    state.settings.autoSetCloserEndTime = $("autoSetCloserEndTime").checked;
    state.settings.closerEndBufferMinutes = Number($("closerEndBufferMinutes").value) || 0;
    state.settings.floorPlanCleanupMinutes = Math.max(0, Number($("floorPlanCleanupMinutes").value) || 0);
    state.settings.flexDoubleEndTime = normalizeTime($("flexDoubleEndTime").value) || "7:00 PM";
    state.settings.lunchCloserEndTime = normalizeTime($("lunchCloserEndTime").value) || "5:00 PM";
    state.settings.closerTrainingRule = $("closerTrainingRule").value || "onePerDay";
    state.settings.staffingBuffer = Number($("staffingBuffer").value) || 0;
    state.settings.dragScrollSpeed = Number($("dragScrollSpeed").value) || 5;
    state.settings.mealPeriods = collectMealPeriods();
    state.settings.defaultCoverage = collectDefaultCoverage();
    state.settings.closerRequirements = collectCloserRequirements();
    state.settings.projectionRules = collectProjectionRules();
    state.settings.floorPlanPrintRules = collectFloorPlanPrintRules();
    state.settings.floorPlanCrossRoleNotes = collectFloorPlanNoteSettings();
    state.settings.trainingRequirements = collectTrainingRequirements();
    setCurrentWeek(currentDate);
    renderAll();
  };
  $("stickySaveSettingsBtn").onclick = () => $("settingsForm").requestSubmit();

  $("shiftForm").onsubmit = async (event) => {
    event.preventDefault();
    if ($("shiftDialogMode").value === "staged") {
      const staged = collectStagedShiftFromDialog();
      if (!staged.roleId || !staged.start) {
        $("shiftWarnings").innerHTML = "<div>Choose a role and start time.</div>";
        return;
      }
      pushUndo();
      state.unassignedShifts = state.unassignedShifts?.some((item) => item.id === staged.id)
        ? state.unassignedShifts.map((item) => item.id === staged.id ? staged : item)
        : [...(state.unassignedShifts || []), staged];
      focusDayOnOpenShiftDate(staged);
      selectedUnassignedShiftId = staged.id;
      $("shiftDialog").close();
      renderAll();
      return;
    }
    const shift = collectShiftFromDialog();
    const result = validateShift(shift);
    $("shiftWarnings").innerHTML = [...result.errors, ...result.warnings].map((item) => `<div>${item}</div>`).join("");
    if (result.errors.length) return;
    if (!(await confirmWarnings(result.warnings, { confirmText: "Save Anyway" }))) return;
    pushUndo();
    state.shifts = state.shifts.some((item) => item.id === shift.id) ? state.shifts.map((item) => item.id === shift.id ? shift : item) : [...state.shifts, shift];
    selectedShiftId = shift.id;
    selectedCell = { employeeId: shift.employeeId, date: shift.date };
    $("shiftDialog").close();
    renderAll();
  };
  $("unassignShiftBtn").onclick = () => {
    const id = $("shiftId").value;
    if (!id || $("shiftDialogMode").value !== "assigned") return;
    unassignShift(id);
  };
  $("deleteShiftBtn").onclick = () => {
    const id = $("shiftId").value;
    if (!id) return;
    armDeleteButton($("deleteShiftBtn"), () => {
      pushUndo();
      if ($("shiftDialogMode").value === "staged") {
        state.unassignedShifts = (state.unassignedShifts || []).filter((shift) => shift.id !== id);
        if (selectedUnassignedShiftId === id) selectedUnassignedShiftId = null;
        $("shiftDialog").close();
        renderAll();
      } else {
        state.shifts = state.shifts.filter((shift) => shift.id !== id);
        $("shiftDialog").close();
        renderAllPreservingScheduleScroll();
      }
    });
  };
  $("cancelShiftBtn").onclick = () => $("shiftDialog").close();

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea, select")) return;
    if (event.ctrlKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelectedShift();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "v") {
      event.preventDefault();
      pasteShift();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      restoreUndo();
    }
    const scheduleActive = document.querySelector(".tab.active")?.dataset.tab === "schedule";
    if (scheduleActive && (event.ctrlKey || event.metaKey) && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      adjustScheduleZoom(0.05);
    }
    if (scheduleActive && (event.ctrlKey || event.metaKey) && event.key === "-") {
      event.preventDefault();
      adjustScheduleZoom(-0.05);
    }
    if (scheduleActive && (event.ctrlKey || event.metaKey) && event.key === "0") {
      event.preventDefault();
      setScheduleZoom(1);
    }
    if (scheduleActive && ((event.altKey && event.key === "ArrowRight") || event.key === "]")) {
      event.preventDefault();
      selectAdjacentOpenShift(1);
      return;
    }
    if (scheduleActive && ((event.altKey && event.key === "ArrowLeft") || event.key === "[")) {
      event.preventDefault();
      selectAdjacentOpenShift(-1);
      return;
    }
    if (scheduleActive && selectedUnassignedShiftId && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      skipSelectedOpenShift();
      return;
    }
    if (scheduleActive && selectedUnassignedShiftId && /^[1-9]$/.test(event.key)) {
      if (assignSelectedOpenShiftCandidate(Number(event.key) - 1)) {
        event.preventDefault();
        return;
      }
    }
    if (scheduleActive && !event.ctrlKey && !event.metaKey && !event.altKey && /^[a-z]$/i.test(event.key)) {
      if (jumpToEmployeeByLetter(event.key)) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Enter" && selectedShiftId) {
      const shift = state.shifts.find((item) => item.id === selectedShiftId);
      if (shift) openShiftDialog(shift);
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedUnassignedShiftId) {
      event.preventDefault();
      pendingDeleteUnassignedShiftId = selectedUnassignedShiftId;
      pendingDeleteShiftId = null;
      pendingDeleteTimeOffRequestId = null;
      renderSchedulePreservingGridScroll();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedTimeOffRequestId) {
      event.preventDefault();
      pendingDeleteTimeOffRequestId = selectedTimeOffRequestId;
      pendingDeleteShiftId = null;
      pendingDeleteUnassignedShiftId = null;
      renderSchedulePreservingGridScroll();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedShiftId) {
      event.preventDefault();
      const shift = state.shifts.find((item) => item.id === selectedShiftId);
      if (shift) {
        pendingDeleteShiftId = selectedShiftId;
        pendingDeleteTimeOffRequestId = null;
        renderSchedulePreservingGridScroll();
      }
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".confirm-armed")) {
      document.querySelectorAll(".confirm-armed").forEach((armed) => {
        armed.classList.remove("confirm-armed");
        armed.textContent = armed.dataset.originalText || armed.textContent;
      });
    }
    if (!pendingDeleteShiftId && !pendingDeleteUnassignedShiftId && !pendingDeleteTimeOffRequestId) return;
    if (event.target.closest(".delete-confirm-button, .unassign-confirm-button, .delete-start-button")) return;
    pendingDeleteShiftId = null;
    pendingDeleteUnassignedShiftId = null;
    pendingDeleteTimeOffRequestId = null;
    renderSchedulePreservingGridScroll();
  });

}

setupTimePicker();
wireEvents();
if (!initialReadSourceHydrationPending) {
  renderAll();
  updateZoomVisibility();
}
updateStorageStatus();
if (!SERVER_STORAGE_ENABLED) {
  showConflict("This window is in local file mode. Use https://shift-bay.netlify.app or the Shift Bay Cloud launcher so employees save to the cloud schedule.");
}
initializeAuth().then(async (canLoad) => {
  if (canLoad) {
    await hydrateStateFromServer();
    await runNormalizedEmployeeShadowCheck();
    await runNormalizedScheduleShadowCheck();
    await runNormalizedAvailabilityShadowCheck();
  } else if (initialReadSourceHydrationPending) {
    // The sign-in overlay is visible, but retain a usable local fallback if
    // authentication cannot load the requested read source.
    finishInitialReadSourceHydrationRender();
  }
});
window.addEventListener("beforeunload", warnBeforeLeavingWithUnsavedCloudChanges);
window.addEventListener("beforeunload", warnBeforeLeavingWithUnsavedEmployeeChanges);
window.addEventListener("beforeunload", flushServerSaveOnClose);
window.addEventListener("focus", () => { checkForNewerSharedSchedule(); });
window.addEventListener("online", () => { checkForNewerSharedSchedule(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkForNewerSharedSchedule();
});
window.setInterval(checkForNewerSharedSchedule, 30000);

