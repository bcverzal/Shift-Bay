const { loadEnvFile } = require("../config/load-env");
const {
  isScheduleBlock,
  normalizedTime,
  weekStartFor
} = require("./migrate_sandbox_schedule_to_normalized");

const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const SANDBOX_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";

function values(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  return String(value || "");
}

function equalTime(left, right) {
  return stringValue(normalizedTime(left)) === stringValue(right);
}

async function request(baseUrl, key, pathName) {
  const pageSize = 1000;
  const rows = [];
  let offset = 0;
  while (true) {
    const separator = pathName.includes("?") ? "&" : "?";
    const response = await fetch(`${baseUrl}/rest/v1/${pathName}${separator}limit=${pageSize}&offset=${offset}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(body?.message || body?.hint || `Supabase request failed with ${response.status}: ${pathName}`);
    const page = values(body);
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

function listDifferences(source, normalized, maps, weeks, isOpenBay) {
  const normalizedByLegacyId = new Map(normalized.filter((row) => row.legacy_id).map((row) => [String(row.legacy_id), row]));
  const missing = [];
  const mismatches = [];
  for (const shift of source) {
    const actual = normalizedByLegacyId.get(stringValue(shift.id));
    if (!actual) {
      missing.push({ legacyId: shift.id, date: shift.date, label: shift.shiftLabel || "" });
      continue;
    }
    const expectedEmployeeId = isOpenBay ? null : maps.employees.get(stringValue(shift.employeeId)) || null;
    const expectedRoleId = maps.roles.get(stringValue(shift.roleId)) || null;
    const expectedWeekId = weeks.get(weekStartFor(shift.date, maps.weekStartDay)) || null;
    const fields = [];
    if (actual.employee_id !== expectedEmployeeId) fields.push("employee");
    if (actual.role_id !== expectedRoleId) fields.push("role");
    if (actual.schedule_week_id !== expectedWeekId) fields.push("schedule week");
    if (Boolean(actual.is_open_bay) !== Boolean(isOpenBay)) fields.push("open-bay state");
    if (stringValue(actual.shift_date) !== stringValue(shift.date)) fields.push("date");
    if (!equalTime(shift.start, actual.start_time)) fields.push("start time");
    if (!equalTime(shift.end, actual.end_time)) fields.push("end time");
    if (Boolean(actual.is_closer) !== Boolean(shift.isCloser)) fields.push("closer");
    if (Boolean(actual.is_lunch_closer) !== Boolean(shift.isLunchCloser)) fields.push("lunch closer");
    if (Boolean(actual.is_flex_double) !== Boolean(shift.isFlexDouble)) fields.push("flex double");
    if (stringValue(actual.notes) !== stringValue(shift.notes)) fields.push("notes");
    if (fields.length) mismatches.push({ legacyId: shift.id, fields });
  }
  const sourceIds = new Set(source.map((shift) => stringValue(shift.id)));
  const extra = normalized
    .filter((row) => Boolean(row.is_open_bay) === Boolean(isOpenBay) && row.legacy_id && !sourceIds.has(stringValue(row.legacy_id)))
    .map((row) => ({ legacyId: row.legacy_id, date: row.shift_date, label: row.shift_name }));
  return { expected: source.length, normalized: normalized.filter((row) => Boolean(row.is_open_bay) === Boolean(isOpenBay)).length, missing, mismatches, extra };
}

async function main() {
  loadEnvFile(ROOT);
  const args = process.argv.slice(2);
  const configuredLocation = String(process.env.SHIFT_BAY_LOCATION_ID || "");
  const liveConfirmed = args.includes("--confirm-live");
  const locationIndex = args.indexOf("--location");
  const locationId = locationIndex >= 0
    ? args[locationIndex + 1] || ""
    : (liveConfirmed ? configuredLocation : SANDBOX_LOCATION_ID);
  const baseUrl = stringValue(process.env.SUPABASE_URL).replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const documentKey = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";
  if (!baseUrl || !key) throw new Error("Missing Supabase credentials in .env.");
  const isSandbox = locationId === SANDBOX_LOCATION_ID;
  const isConfirmedLive = liveConfirmed && locationId === configuredLocation && locationId !== SANDBOX_LOCATION_ID;
  if (!isSandbox && !isConfirmedLive) throw new Error("Refusing this location. Use Sandbox or pass --confirm-live for the configured live location.");

  const encodedLocation = encodeURIComponent(locationId);
  const documents = await request(baseUrl, key, `scheduler_state_documents?location_id=eq.${encodedLocation}&document_key=eq.${encodeURIComponent(documentKey)}&order=updated_at.desc&select=state,saved_at,updated_at`);
  const state = documents[0]?.state;
  if (!state) throw new Error("Sandbox scheduler snapshot was not found.");
  const [employees, roles, scheduleWeeks, shifts, requestOffs, blocks, templates] = await Promise.all([
    request(baseUrl, key, `employees?location_id=eq.${encodedLocation}&select=id,legacy_id`),
    request(baseUrl, key, `roles?location_id=eq.${encodedLocation}&select=id,legacy_id`),
    request(baseUrl, key, `schedule_weeks?location_id=eq.${encodedLocation}&select=id,week_start,status`),
    request(baseUrl, key, `shifts?location_id=eq.${encodedLocation}&select=legacy_id,employee_id,role_id,schedule_week_id,shift_date,shift_name,start_time,end_time,is_closer,is_lunch_closer,is_flex_double,is_open_bay,notes`),
    request(baseUrl, key, `request_offs?location_id=eq.${encodedLocation}&select=legacy_id,employee_id,request_date,start_time,end_time,all_day,kind,daypart,reason`),
    request(baseUrl, key, `schedule_blocks?location_id=eq.${encodedLocation}&select=legacy_id,employee_id,block_date,start_time,end_time,all_day,block_type,note`),
    request(baseUrl, key, `templates?location_id=eq.${encodedLocation}&select=id,legacy_id,name,active`)
  ]);
  const templateIds = templates.map((template) => template.id).filter(Boolean);
  const templateShifts = templateIds.length
    ? await request(baseUrl, key, `template_shifts?template_id=in.(${templateIds.join(",")})&select=template_id,legacy_id,day_index,role_id,department,shift_name,start_time,end_time,is_closer,is_lunch_closer,is_flex_double,notes,sort_order`)
    : [];
  const maps = {
    employees: new Map(employees.filter((row) => row.legacy_id).map((row) => [stringValue(row.legacy_id), row.id])),
    roles: new Map(roles.filter((row) => row.legacy_id).map((row) => [stringValue(row.legacy_id), row.id])),
    weekStartDay: Number(state.settings?.weekStart || 0)
  };
  const weekIds = new Map(scheduleWeeks.map((week) => [stringValue(week.week_start), week.id]));
  const assigned = values(state.shifts);
  const open = values(state.unassignedShifts);
  const requestSource = values(state.timeOffRequests).filter((item) => !isScheduleBlock(item));
  const blockSource = values(state.timeOffRequests).filter(isScheduleBlock);
  const assignedReport = listDifferences(assigned, shifts, maps, weekIds, false);
  const openReport = listDifferences(open, shifts, maps, weekIds, true);

  const normalizedRequests = new Map(requestOffs.filter((row) => row.legacy_id).map((row) => [stringValue(row.legacy_id), row]));
  const requestMismatches = requestSource.flatMap((item) => {
    const actual = normalizedRequests.get(stringValue(item.id));
    if (!actual) return [{ legacyId: item.id, fields: ["missing"] }];
    const fields = [];
    if (actual.employee_id !== maps.employees.get(stringValue(item.employeeId))) fields.push("employee");
    if (stringValue(actual.request_date) !== stringValue(item.date)) fields.push("date");
    if (Boolean(actual.all_day) !== (item.allDay !== false)) fields.push("all-day state");
    if (!equalTime(item.start, actual.start_time)) fields.push("start time");
    if (!equalTime(item.end, actual.end_time)) fields.push("end time");
    if (stringValue(actual.kind) !== "ro") fields.push("kind");
    return fields.length ? [{ legacyId: item.id, fields }] : [];
  });
  const normalizedBlocks = new Map(blocks.filter((row) => row.legacy_id).map((row) => [stringValue(row.legacy_id), row]));
  const blockMismatches = blockSource.flatMap((item) => {
    const actual = normalizedBlocks.get(stringValue(item.id));
    if (!actual) return [{ legacyId: item.id, fields: ["missing"] }];
    const fields = [];
    if (actual.employee_id !== maps.employees.get(stringValue(item.employeeId))) fields.push("employee");
    if (stringValue(actual.block_date) !== stringValue(item.date)) fields.push("date");
    if (Boolean(actual.all_day) !== (item.allDay !== false)) fields.push("all-day state");
    if (!equalTime(item.start, actual.start_time)) fields.push("start time");
    if (!equalTime(item.end, actual.end_time)) fields.push("end time");
    return fields.length ? [{ legacyId: item.id, fields }] : [];
  });
  const normalizedTemplates = new Map(templates.filter((row) => row.legacy_id).map((row) => [stringValue(row.legacy_id), row]));
  const templateMismatches = [];
  const expectedTemplateShiftIds = new Set();
  for (const sourceTemplate of values(state.templates)) {
    const actualTemplate = normalizedTemplates.get(stringValue(sourceTemplate.id));
    if (!actualTemplate) {
      templateMismatches.push({ legacyId: sourceTemplate.id, fields: ["missing template"] });
      continue;
    }
    const actualShifts = new Map(templateShifts.filter((row) => row.template_id === actualTemplate.id && row.legacy_id).map((row) => [stringValue(row.legacy_id), row]));
    for (const [sortOrder, sourceShift] of values(sourceTemplate.shifts).entries()) {
      expectedTemplateShiftIds.add(`${actualTemplate.id}:${stringValue(sourceShift.id)}`);
      const actualShift = actualShifts.get(stringValue(sourceShift.id));
      if (!actualShift) {
        templateMismatches.push({ legacyId: sourceTemplate.id, shiftLegacyId: sourceShift.id, fields: ["missing shift"] });
        continue;
      }
      const fields = [];
      if (actualShift.role_id !== maps.roles.get(stringValue(sourceShift.roleId))) fields.push("role");
      if (Number(actualShift.day_index) !== Number(sourceShift.dayIndex)) fields.push("day");
      if (Number(actualShift.sort_order) !== sortOrder) fields.push("sort order");
      if (!equalTime(sourceShift.start, actualShift.start_time)) fields.push("start time");
      if (!equalTime(sourceShift.end, actualShift.end_time)) fields.push("end time");
      if (fields.length) templateMismatches.push({ legacyId: sourceTemplate.id, shiftLegacyId: sourceShift.id, fields });
    }
    for (const actualShift of actualShifts.values()) {
      if (!expectedTemplateShiftIds.has(`${actualTemplate.id}:${stringValue(actualShift.legacy_id)}`)) {
        templateMismatches.push({ legacyId: sourceTemplate.id, shiftLegacyId: actualShift.legacy_id, fields: ["unexpected shift"] });
      }
    }
  }
  const sourceWeeks = new Set([...assigned, ...open].map((shift) => weekStartFor(shift.date, maps.weekStartDay)));
  const missingWeeks = [...sourceWeeks].filter((weekStart) => !weekIds.has(weekStart));
  const report = {
    generatedAt: new Date().toISOString(),
    locationId,
    snapshotSavedAt: documents[0]?.saved_at || documents[0]?.updated_at || null,
    counts: {
      expectedScheduleWeeks: sourceWeeks.size,
      normalizedScheduleWeeks: scheduleWeeks.length,
      assignedShifts: assignedReport,
      openBayShifts: openReport,
      requestOffs: { expected: requestSource.length, normalized: requestOffs.length, mismatches: requestMismatches },
      scheduleBlocks: { expected: blockSource.length, normalized: blocks.length, mismatches: blockMismatches },
      templates: { expected: values(state.templates).length, normalized: templates.length, templateShifts: { expected: values(state.templates).reduce((total, template) => total + values(template.shifts).length, 0), normalized: templateShifts.length }, mismatches: templateMismatches }
    },
    findings: { missingWeeks },
    readyForNormalizedScheduleReads: missingWeeks.length === 0 && assignedReport.missing.length === 0 && assignedReport.mismatches.length === 0 && assignedReport.extra.length === 0 && openReport.missing.length === 0 && openReport.mismatches.length === 0 && openReport.extra.length === 0 && requestMismatches.length === 0 && blockMismatches.length === 0 && templateMismatches.length === 0
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
