const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const staff = fs.readFileSync(path.join(root, "staff.js"), "utf8");
const staffHtml = fs.readFileSync(path.join(root, "staff.html"), "utf8");
const edgeFunction = fs.readFileSync(path.join(root, "supabase", "functions", "shift-bay-api", "index.ts"), "utf8");
const employeeMigration = fs.readFileSync(path.join(root, "supabase", "employee-normalization-migration.sql"), "utf8");
const phoneMigration = fs.readFileSync(path.join(root, "supabase", "format-phone-numbers.sql"), "utf8");

function includes(source, value, message) {
  assert.ok(source.includes(value), message || `Expected source to include ${value}`);
}

function excludes(source, value, message) {
  assert.ok(!source.includes(value), message || `Expected source not to include ${value}`);
}

function run() {
  includes(app, "function syncFloorPlanDateToActiveWeek", "floor-plan date handoff must exist");
  includes(app, "const DEMO_SEED_VERSION = \"2026-08-18-v1\"", "demo bootstrap must use an explicit seed version");
  includes(app, "function demoStateNeedsBootstrap", "demo bootstrap must detect an unmistakably empty shared state");
  includes(app, "demo.meta.demoSeedVersion = DEMO_SEED_VERSION", "demo bootstrap must mark the shared seed version");
  includes(app, "focusedDateKey || formatDateKey(currentDate)", "floor plans must prefer the focused day");
  includes(app, "function openDayNotesDialog", "day view must provide date-scoped floor-chart notes");
  includes(app, "state.dailyNotes", "day notes must be saved with the schedule state");
  includes(app, "floorPlanDailyNoteMarkup(dateKey)", "weekly floor-plan printing must include the day note");
  includes(index, 'data-floor-output="day-notes"', "the live floor plan must include a day-notes output area");
  includes(index, 'id="dayNotesDialog"', "day notes must use the Shift Bay dialog styling instead of a browser prompt");
  includes(index, 'class="day-notes-content"', "day-notes content must be isolated from the dialog footer");
  includes(index, 'class="hint day-notes-hint"', "day-notes helper text must have its own layout treatment");
  includes(fs.readFileSync(path.join(root, "styles.css"), "utf8"), "#dayNotesDialog .day-notes-editor", "day-notes dialog must override the shared alert footer layout");
  excludes(app, "data-day-focus-date=", "redundant per-day buttons should stay removed");
  includes(app, "Double-click the date header to open Day View.", "day-header guidance must remain available");
  includes(app, "repeat click on it return to the weekly grid", "the active Schedule tab must provide a forgiving return from Day View");
  includes(app, "Week Grid", "Day View must label its direct return action as the weekly grid");
  includes(app, "day-focus-view-label", "Day View must identify the currently active schedule mode");

  includes(app, "const RECOMMENDATION_FACTORS", "recommendation factors must be explicit");
  includes(app, "minimumWeeks: 2", "one historical occurrence must not drive a recommendation");
  includes(app, "function recommendationFactorWeight", "recommendation weights must have a future configuration hook");
  includes(app, "function historicalRecommendationForOpenShift", "historical recommendation selection must exist");
  includes(app, "function historicalMostRecentMatchDate", "historical recommendation ties must use recency");
  includes(app, "historicalMostRecentDate.localeCompare", "historical recommendation ties must prefer the most recent assignment");
  includes(app, "Schedule pattern", "recommendations should use plain schedule-pattern language");
  assert.ok(!app.includes("${renderRecentStagedSection(recent)}"), "selected shift info should not show the misleading recent section");
  includes(app, "day-focus-pattern-chip", "day-view pattern styling must target only the eligible name chip");
  includes(app, "staged-info-history-recommendation", "historical recommendations must be visible in the bay info panel");
  includes(app, "day-focus-pattern-chip", "historical recommendations must be visible in day view");
  includes(app, 'data-availability-preset="unavailable"', "regular availability must offer an unavailable preset");
  includes(app, 'preset === "unavailable"', "unavailable preset must clear the day availability");
  includes(app, "function showDayFocusChipTooltip", "day-view eligibility tooltips must escape the scroll container");
  includes(app, "id = \"dayFocusChipTooltip\"", "day-view eligibility tooltip must use a page-level host");
  includes(app, 'orderedRolesForSchedule("")', "expanding day-view eligibility must preserve role order");
  includes(app, "employeeAvailabilityEffectiveDate", "manager availability needs an effective-date control");
  includes(app, "availabilitySchedule", "manager availability needs effective-dated versions");
  includes(app, 'data-availability-end-slot', "manager availability needs paired start/end time controls");
  includes(app, 'data-add-availability-window', "manager availability needs an add-window action");
  includes(app, "availabilityEffectiveDate", "manager availability must preserve the effective date");
  includes(app, "function availabilityShiftConflictDetails", "availability activation must identify already-scheduled conflicts");
  includes(app, "function showAvailabilityShiftConflictReview", "availability activation must provide a manager conflict review");
  includes(app, "Move Selected to Shift Bay", "availability conflict review must offer an explicit unassign action");
  includes(app, "Keep Shifts", "availability conflict review must preserve scheduled shifts by default");
  includes(app, "function moveAssignedShiftsToBay", "selected availability conflicts must move to Shift Bay without deleting shifts");
  includes(app, "employeeProfileSavePriority", "employee profile saves must take priority over queued full-schedule writes");
  includes(app, "another large schedule request", "employee profile saves must reserve the next cloud write");
  includes(app, "function schedulerMutationFingerprint", "scheduler saves must distinguish real state changes from screen redraws");
  includes(app, "lastConfirmedMutationFingerprint", "scheduler saves must remember the last confirmed mutation");
  includes(app, "queuedMutationFingerprint", "scheduler save debouncing must coalesce identical pending payloads");
  includes(app, "if (mutationFingerprint === inFlightMutationFingerprint) return false", "a redraw during an in-flight save must not queue a duplicate atomic write");
  includes(app, "stateOverride: requestState", "a save response must confirm the snapshot that was actually sent");
  includes(index, 'id="employeeSaveDebugStatus"', "employee profile saves must expose their current stage");
  includes(app, "Save Employee button clicked", "the employee save button must immediately confirm its click handler ran");
  includes(app, "Cloud save confirmed", "employee profile saves must visibly confirm the cloud response");
  includes(app, "saveAttemptId", "employee profile saves must send a traceable attempt id");
  includes(edgeFunction, "saveAttemptId", "employee profile audit events must retain the traceable attempt id");
  includes(edgeFunction, "syncNormalizedEmployeeProfile", "employee saves must begin the normalized profile migration");
  includes(edgeFunction, "availability_rules", "employee saves must mirror weekly availability into normalized rules");
  includes(edgeFunction, "syncNormalizedAvailabilityProfiles", "employee saves must mirror saved availability profiles into normalized rows");
  includes(edgeFunction, "snapshotAvailabilityProfiles", "availability profile windows must stay separate from assignment metadata");
  includes(edgeFunction, "employee_id=eq.${encodeURIComponent(employeeId)}&source=eq.snapshot_bridge", "availability reconciliation must stay scoped to the saved employee");
  includes(employeeMigration, "employees_location_legacy_unique", "employee migration must provide a stable legacy identity");
  includes(employeeMigration, "availability_rules_employee_day_idx", "employee migration must index availability windows");
  includes(app, "function formatPhoneNumber", "manager employee phones must have a shared formatter");
  includes(app, "function applyTemplateFlexDoubleEndTimeDefault", "template Flex Double shifts must use the configured end-time default");
  includes(app, '$("templateFlexDouble").addEventListener("change", applyTemplateFlexDoubleEndTimeDefault)', "template Flex Double toggle must apply its configured end-time default");
  includes(app, "normalizeSavedEmployeePhones", "existing scheduler employee phones must be normalized on load");
  includes(index, 'id="employeePhone" type="tel"', "manager phone input must be typed as a phone field");
  includes(staff, "function formatPhoneNumber", "staff portal phones must have a shared formatter");
  includes(staffHtml, 'id="staffPhoneNumber" type="tel"', "staff portal phone input must be typed as a phone field");
  includes(server, "function formatPhoneNumber", "local staff API must normalize phone values");
  includes(edgeFunction, "function formatPhoneNumber", "hosted staff API must normalize phone values");
  includes(phoneMigration, "public.scheduler_state_documents", "phone cleanup must normalize the compatibility schedule copy");
  includes(phoneMigration, "public.staff_accounts", "phone cleanup must normalize staff account phones");
  includes(app, "const regularAvailabilityMode = !callWeekly", "Call Weekly saves must use a separate availability-validation branch");
  includes(app, "const duplicatePattern = saveAvailability", "Only explicit availability saves may be blocked by duplicate availability names");
  includes(app, "availabilitySaveRequested = true", "Save Availability must explicitly request availability validation");
  includes(app, 'currentAccessRole() !== "owner"', "temporary employee save diagnostics must remain owner-only");
  includes(app, "rebaseCloudRecovery", "stale browser edits must be rebased onto the newest shared schedule");
  includes(app, "checkForNewerSharedSchedule", "the app must check for newer shared schedule versions after reconnecting");
  includes(app, "refreshBlockedCloudRecovery(state)", "edits made while stale must remain in the recovery copy");
  includes(app, "NORMALIZED_EMPLOYEE_SHADOW_MODE", "normalized employee comparison must remain explicitly opt-in");
  includes(app, "function runNormalizedEmployeeShadowCheck", "Sandbox must be able to compare normalized employees without changing scheduler reads");
  includes(app, "function runNormalizedAvailabilityShadowCheck", "Sandbox must be able to compare normalized availability without changing scheduler reads");
  includes(app, '"/api/normalized/availability"', "normalized availability shadow check must use the guarded availability route");
  includes(app, "normalizedAvailabilityShadowDifferences", "normalized availability comparison must report profile, window, and assignment differences");
  includes(app, "NORMALIZED_AVAILABILITY_READ_MODE", "normalized availability reads must remain independently controllable");
  includes(app, "applyNormalizedAvailabilityRead", "normalized availability read mode must overlay only the Sandbox state");
  includes(app, "The primary schedule document is connected at this point", "cloud status must turn connected before a slow secondary availability read finishes");
  includes(app, "renderAll({ skipSave: true })", "hydrating a shared read must not queue an automatic compatibility save");
  includes(fs.readFileSync(path.join(root, "tools", "plan_location_normalized_migration.js"), "utf8"), "mode: \"read-only-plan\"", "live normalized migration planning must be explicitly read-only");
  includes(fs.readFileSync(path.join(root, "tools", "plan_location_normalized_migration.js"), "utf8"), "limit=${pageSize}&offset=${offset}", "normalized migration planning must paginate Supabase reads");
  includes(app, 'authFetch("/api/normalized/employees"', "normalized employee comparison must use the protected API route");
  includes(app, "Switch to the Sandbox location", "normalized employee comparison must refuse production checks");
  includes(app, "normalizedEmployeeShadowDifferences", "normalized employee comparison must report record differences");
  includes(app, "NORMALIZED_SCHEDULE_SHADOW_MODE", "normalized schedule comparison must remain explicitly opt-in");
  includes(app, "function runNormalizedScheduleShadowCheck", "Sandbox must be able to compare normalized schedule records without changing scheduler reads");
  includes(app, 'authFetch("/api/normalized/schedule"', "normalized schedule comparison must use the protected API route");
  includes(app, "normalizedScheduleShadowDifferences", "normalized schedule comparison must report record differences");
  includes(app, "NORMALIZED_SCHEDULE_READ_MODE", "normalized schedule reads must remain independently controllable");
  includes(app, 'NORMALIZED_SCHEDULE_MODE === "read"', "normalized schedule reads must remain behind an explicit opt-in during cutover");
  includes(app, "NORMALIZED_SCHEDULE_DIRECT_WRITE_MODE", "the Sandbox direct-write canary must require an explicit app mode");
  includes(app, "NORMALIZED_SCHEDULE_REVISION_CANARY_MODE", "the revision-locked Sandbox canary must require an explicit app mode");
  includes(app, '"normalized-sandbox-direct"', "the app must identify direct Sandbox schedule saves explicitly");
  includes(app, '"normalized-sandbox-direct-revision"', "the app must identify revision-locked Sandbox schedule saves explicitly");
  includes(app, "!NORMALIZED_SCHEDULE_DIRECT_WRITE_MODE && !readSourceChanged", "the direct-write canary must not compare normalized saves against the untouched snapshot");
  includes(app, "LEGACY_SNAPSHOT_OVERRIDE", "the normalized default must retain an immediate compatibility rollback override");
  includes(app, "!LEGACY_SNAPSHOT_OVERRIDE && !NORMALIZED_SCHEDULE_DIRECT_WRITE_MODE && !readSourceChanged && !skipLocalRecovery", "read-source switches and direct Sandbox saves must not create a false stale-state recovery");
  includes(app, "quarantinedByLegacySnapshot", "the compatibility rollback view must not auto-replay a previously captured browser recovery");
  includes(app, "function readSourceKey", "read-source tracking must stay scoped to the selected location");
  includes(app, "readSourceChanged", "switching read sources must not be treated as a schedule edit");
  includes(app, "DEFER_INITIAL_RENDER_FOR_READ_OVERRIDE", "explicit snapshot and direct-read routes must not briefly paint cached schedule data");
  includes(app, "finishInitialReadSourceHydrationRender", "the selected read source must render only after hydration finishes");
  includes(app, "if (!initialReadSourceHydrationPending)", "explicit read-source overrides must defer the initial browser-cache render");
  includes(app, '"/api/state?normalizedSchedule=read"', "normalized schedule read mode must request the guarded state path");
  includes(app, "Loaded normalized Sandbox schedule data.", "normalized read testing must identify the active read source");
  includes(app, "function setNormalizedScheduleReadBadge", "normalized read mode must expose a persistent confirmed source marker");
  includes(app, 'setNormalizedScheduleReadBadge(envelope.readSource === "normalized-sandbox" || envelope.readSource === "normalized-live-canary" ? "active" : "unavailable")', "normalized read marker must only show as active after a confirmed normalized response");
  includes(index, 'id="normalizedReadBadge"', "normalized read marker must be present in the header");
  includes(index, 'data-password-toggle="loginPassword"', "manager login must provide a show-password control");
  includes(index, 'data-password-toggle="newManagerPassword"', "manager password creation must provide a show-password control");
  excludes(index, "Staff Portal sign in", "the manager login must not expose a separate staff sign-in link");
  includes(staffHtml, "Use Shift Bay sign in", "the staff page must point unauthenticated users to the shared login");
  excludes(staffHtml, 'id="staffLoginForm"', "the staff page must not expose a second credential form");
  includes(staffHtml, 'data-password-toggle="newStaffPassword"', "staff password creation must provide a show-password control");
  includes(app, 'result.accountType === "staff"', "shared login must route linked staff accounts to the staff portal");
  includes(app, "currentLoginEmail = result.profile?.user?.email || normalizedEmail", "staff redirects must retain the login email for password recovery");
  includes(app, 'locationId: result.profile?.locationId || ""', "staff sessions must retain their linked location");
  includes(server, 'accountType: "staff"', "local login must identify linked staff accounts");
  includes(edgeFunction, 'accountType: "staff"', "hosted login must identify linked staff accounts");
  excludes(edgeFunction, 'loginUrl: `${cfg.siteUrl.replace(/\/$/, "")}/staff.html`', "staff invitations must use the shared root login");
  includes(app, '"/api/managers/temporary-password"', "manager access must provide a safe temporary-password replacement flow");
  includes(app, '"/api/staff-accounts/temporary-password"', "staff access must provide a safe temporary-password replacement flow");
  includes(edgeFunction, 'path === "/managers/temporary-password"', "the manager temporary-password route must be deployed through the protected API");
  includes(edgeFunction, 'path === "/staff-accounts/temporary-password"', "the staff temporary-password route must be deployed through the protected API");
  includes(edgeFunction, "passwordChangeRequired: Boolean(row.password_change_required)", "access lists must expose whether the temporary password is still pending");
  includes(edgeFunction, "async function syncNormalizedSchedule", "schedule saves must mirror normalized records");
  includes(edgeFunction, 'saveMode === "normalized-sandbox-direct"', "the server must gate the direct-write canary explicitly");
  includes(edgeFunction, "Direct normalized schedule writes are limited to the Sandbox location.", "direct normalized writes must reject live locations");
  includes(edgeFunction, "claimNormalizedScheduleRevision", "revision-locked normalized writes must claim a server revision");
  includes(edgeFunction, "Revision-locked normalized schedule writes are limited to the Sandbox location.", "revision-locked direct writes must reject live locations");
  includes(edgeFunction, 'if (!normalizedScheduleMirrorAllowed(locationId)) return { synced: false, skipped: "snapshot bridge remains authoritative" }', "ordinary schedule mirroring must remain limited to the Sandbox during cutover");
  includes(edgeFunction, "const normalizedScheduleSync = await syncNormalizedSchedule(locationId, state, (existingRow?.state || null) as JsonRecord | null);", "the normal schedule save path must refresh the normalized mirror");
  includes(edgeFunction, "changedSnapshotItems", "live schedule mirroring must limit normal saves to changed records");
  includes(edgeFunction, 'mode: "delta"', "normal schedule mirror responses must report delta synchronization");
  includes(edgeFunction, "removeNormalizedLegacyRowsNotIn", "normalized schedule mirroring must reconcile deletions");
  includes(edgeFunction, 'const normalizedScheduleRead = new URL(request.url).searchParams.get("normalizedSchedule") === "read"', "the server must recognize the explicit normalized read flag");
  includes(edgeFunction, "readSource: locationId === SANDBOX_LOCATION_ID ? \"normalized-sandbox\" : \"normalized-live-canary\"", "normalized schedule reads must identify their source");
  includes(edgeFunction, "department: shift.department || \"FOH\"", "normalized schedule reads must preserve shift departments for visibility filtering");
  includes(edgeFunction, "Normalized schedule reads are not enabled for this location.", "normalized schedule reads must refuse unconfigured locations");
  includes(edgeFunction, "async function handleNormalizedAvailability", "normalized availability reads must have a protected probe route");
  includes(edgeFunction, 'path === "/normalized/availability"', "normalized availability reads must use an explicit route");
  includes(edgeFunction, "Normalized availability reads are not enabled for this location.", "normalized availability reads must refuse unconfigured locations");
  includes(edgeFunction, "repeatWeeks: Number(assignment.repeat_interval_weeks || 1)", "normalized availability reads must keep repeat behavior on assignments");
  includes(edgeFunction, "async function loadWriteControl", "migration write control must be readable by the Edge Function");
  includes(edgeFunction, "async function enforceWriteControl", "migration write control must guard write routes");
  includes(edgeFunction, "return json(423", "paused migration writes must return a distinct read-only response");
  includes(edgeFunction, "writeControl: writeControl ?", "status must expose the migration write-control epoch");
  includes(app, "function applyWriteControl", "the browser must react to the global migration write-control state");
  includes(app, "cloudWritesPaused", "the browser must stop queuing writes while a migration is paused");

  includes(index, "id=\"scheduleGrid\"", "weekly schedule grid must remain present");
  includes(index, "id=\"floorPlanDate\"", "floor-plan date control must remain present");
  includes(index, "id=\"unassignedShiftTray\"", "Shift Bay tray must remain present");
  includes(index, "id=\"stagedShiftDateLabel\" class=\"shift-dialog-date-control\"", "unassigned shift dates must be a prominent top-level control");
  includes(index, "This determines where the open shift appears in Shift Bay.", "unassigned shift dates must explain their scheduling effect");
  includes(app, "Choose the shift date before setting its role and times.", "unassigned shift creation must foreground the date before shift details");
  includes(index, "class=\"mobile-access-notice\"", "narrow-screen access guidance must remain present");
  includes(index, 'data-mobile-view="day"', "narrow-screen day review action must remain present");
  includes(index, 'data-mobile-view="compact"', "narrow-screen compact review action must remain present");
  includes(staff, 'data-staff-availability-preset="unavailable"', "staff availability needs an explicit unavailable preset");
  includes(staff, 'data-staff-availability-end-slot', "staff availability needs paired start/end time controls");
  includes(staff, 'data-add-staff-window', "staff availability needs an add-window action");
  includes(staff, "function renderAvailabilityDays", "staff availability UI must remain present");
  includes(staff, "let currentStaffLoginEmail = readSession()?.email || \"\"", "staff password recovery must retain the email across the shared-login redirect");
  includes(staff, "function rememberStaffProfileLocation", "staff sessions must persist the account-resolved location");
  includes(staff, "return \"\";", "real staff login must not inherit the manager's browser-selected location");

  // Keep the local bridge and hosted Edge Function route surfaces in lockstep.
  // A missing route here otherwise appears to users as an unexplained
  // "Unknown API endpoint" after a deploy.
  const sharedRoutes = [
    "/auth/config", "/auth/login", "/auth/refresh", "/auth/change-password", "/auth/session",
    "/locations", "/state", "/staff/login", "/staff/change-password", "/staff/me", "/staff/schedule",
    "/staff/availability", "/staff/privacy", "/staff/profile", "/staff/request-offs", "/staff/directory",
    "/staff-requests", "/staff-availability", "/staff-requests/review", "/staff-accounts",
    "/staff-accounts/invite", "/staff-accounts/temporary-password", "/staff-accounts/remove",
    "/status", "/state", "/audit/recent"
  ];
  for (const route of sharedRoutes) {
    includes(server, `"/api${route}`, `local bridge route must include /api${route}`);
    includes(edgeFunction, `"${route}`, `hosted Edge Function route must include ${route}`);
  }
  console.log("app contract tests passed");
}

run();
