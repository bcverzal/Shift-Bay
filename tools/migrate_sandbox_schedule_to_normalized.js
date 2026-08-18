const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile } = require("../config/load-env");

const ROOT = path.join(__dirname, "..");
const SANDBOX_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";

function values(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return text || null;
  let hour = Number(match[1]);
  const minute = match[2];
  const period = match[3].toUpperCase();
  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${minute}:00`;
}

function weekStartFor(dateKey, weekStartDay = 0) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid schedule date: ${dateKey}`);
  const offset = (date.getUTCDay() - Number(weekStartDay || 0) + 7) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function isScheduleBlock(item = {}) {
  return String(item.kind || "").toLowerCase() === "block" || Boolean(item.blockType);
}

function shiftPayload(shift, locationId, maps, weekId, isOpenBay = false) {
  const employeeId = isOpenBay ? null : maps.employeesByLegacyId.get(String(shift.employeeId || ""))?.id || null;
  const roleId = maps.rolesByLegacyId.get(String(shift.roleId || ""))?.id || null;
  if (!roleId) throw new Error(`Shift ${shift.id || "(unknown)"} references an unknown role.`);
  if (!isOpenBay && shift.employeeId && !employeeId) throw new Error(`Shift ${shift.id || "(unknown)"} references an unknown employee.`);
  return {
    location_id: locationId,
    schedule_week_id: weekId,
    legacy_id: String(shift.id || ""),
    employee_id: employeeId,
    role_id: roleId,
    department: String(shift.department || "FOH"),
    shift_date: String(shift.date || ""),
    shift_name: String(shift.shiftLabel || ""),
    start_time: normalizedTime(shift.start),
    end_time: normalizedTime(shift.end),
    until_volume: Boolean(shift.untilVolume),
    is_closer: Boolean(shift.isCloser),
    is_lunch_closer: Boolean(shift.isLunchCloser),
    is_flex_double: Boolean(shift.isFlexDouble),
    is_open_bay: Boolean(isOpenBay),
    color: shift.color || null,
    notes: String(shift.notes || ""),
    source: "snapshot-bridge",
    legacy_created_at: shift.createdAt || null,
    legacy_updated_at: shift.updatedAt || null,
    metadata: {
      meals: values(shift.meals),
      training: shift.training || {},
      legacy: { shiftLabel: shift.shiftLabel || "", createdAt: shift.createdAt || "", updatedAt: shift.updatedAt || "" }
    }
  };
}

function requestPayload(item, locationId, employeeId) {
  return {
    location_id: locationId,
    legacy_id: String(item.id || ""),
    employee_id: employeeId,
    request_date: String(item.date || ""),
    start_time: normalizedTime(item.start),
    end_time: normalizedTime(item.end),
    all_day: item.allDay !== false,
    reason: String(item.reason || item.note || ""),
    source: String(item.source || "snapshot-bridge"),
    source_fingerprint: `legacy:${String(item.id || "")}`,
    kind: "ro",
    daypart: String(item.daypart || ""),
    metadata: { note: item.note || "", createdAt: item.createdAt || "", updatedAt: item.updatedAt || "" },
    updated_at: item.updatedAt || new Date().toISOString()
  };
}

function blockPayload(item, locationId, employeeId) {
  return {
    location_id: locationId,
    legacy_id: String(item.id || ""),
    employee_id: employeeId,
    block_date: String(item.date || ""),
    block_type: String(item.blockType || "event"),
    start_time: normalizedTime(item.start),
    end_time: normalizedTime(item.end),
    all_day: item.allDay !== false,
    note: String(item.note || item.reason || ""),
    source: String(item.source || "snapshot-bridge"),
    metadata: { daypart: item.daypart || "", kind: item.kind || "", createdAt: item.createdAt || "", updatedAt: item.updatedAt || "" },
    updated_at: item.updatedAt || new Date().toISOString()
  };
}

function templatePayload(template, locationId) {
  return {
    location_id: locationId,
    legacy_id: String(template.id || ""),
    name: String(template.name || "Untitled template"),
    active: template.active !== false,
    legacy_created_at: template.createdAt || null,
    legacy_updated_at: template.updatedAt || null,
    metadata: {}
  };
}

function templateShiftPayload(shift, templateId, maps, sortOrder) {
  const roleId = maps.rolesByLegacyId.get(String(shift.roleId || ""))?.id || null;
  if (!roleId) throw new Error(`Template shift ${shift.id || "(unknown)"} references an unknown role.`);
  return {
    template_id: templateId,
    legacy_id: String(shift.id || ""),
    day_index: Number(shift.dayIndex),
    role_id: roleId,
    department: String(shift.department || "FOH"),
    shift_name: String(shift.shiftLabel || ""),
    start_time: normalizedTime(shift.start),
    end_time: normalizedTime(shift.end),
    until_volume: Boolean(shift.untilVolume),
    is_closer: Boolean(shift.isCloser),
    is_lunch_closer: Boolean(shift.isLunchCloser),
    is_flex_double: Boolean(shift.isFlexDouble),
    color: shift.color || null,
    notes: String(shift.notes || ""),
    sort_order: sortOrder,
    legacy_created_at: shift.createdAt || null,
    legacy_updated_at: shift.updatedAt || null,
    metadata: { meals: values(shift.meals), training: shift.training || {} }
  };
}

async function request(baseUrl, key, pathName, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathName}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || body?.hint || `Supabase request failed with ${response.status}: ${pathName}`);
  return body;
}

async function listAll(baseUrl, key, pathName) {
  const pageSize = 1000;
  const rows = [];
  let offset = 0;
  while (true) {
    const separator = pathName.includes("?") ? "&" : "?";
    const page = values(await request(baseUrl, key, `${pathName}${separator}limit=${pageSize}&offset=${offset}`));
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function snapshotForLocation(baseUrl, key, locationId, documentKey) {
  const rows = await request(baseUrl, key, `scheduler_state_documents?location_id=eq.${encodeURIComponent(locationId)}&document_key=eq.${encodeURIComponent(documentKey)}&select=state,saved_at,updated_at`);
  const snapshot = values(rows)[0];
  if (!snapshot?.state) throw new Error("Scheduler snapshot was not found for this location.");
  return snapshot;
}

async function normalizedMaps(baseUrl, key, locationId) {
  const [employees, roles] = await Promise.all([
    request(baseUrl, key, `employees?location_id=eq.${encodeURIComponent(locationId)}&select=id,legacy_id`),
    request(baseUrl, key, `roles?location_id=eq.${encodeURIComponent(locationId)}&select=id,legacy_id`)
  ]);
  return {
    employeesByLegacyId: new Map(values(employees).filter((row) => row.legacy_id).map((row) => [String(row.legacy_id), row])),
    rolesByLegacyId: new Map(values(roles).filter((row) => row.legacy_id).map((row) => [String(row.legacy_id), row]))
  };
}

async function upsertByLegacy(baseUrl, key, table, locationId, legacyId, payload) {
  const existing = await request(baseUrl, key, `${table}?location_id=eq.${encodeURIComponent(locationId)}&legacy_id=eq.${encodeURIComponent(legacyId)}&select=id`);
  const row = values(existing)[0];
  return row?.id
    ? values(await request(baseUrl, key, `${table}?id=eq.${encodeURIComponent(row.id)}`, { method: "PATCH", body: JSON.stringify(payload) }))[0]
    : values(await request(baseUrl, key, table, { method: "POST", body: JSON.stringify([payload]) }))[0];
}

async function upsertTemplateShift(baseUrl, key, templateId, legacyId, payload) {
  const existing = await request(baseUrl, key, `template_shifts?template_id=eq.${encodeURIComponent(templateId)}&legacy_id=eq.${encodeURIComponent(legacyId)}&select=id`);
  const row = values(existing)[0];
  return row?.id
    ? values(await request(baseUrl, key, `template_shifts?id=eq.${encodeURIComponent(row.id)}`, { method: "PATCH", body: JSON.stringify(payload) }))[0]
    : values(await request(baseUrl, key, "template_shifts", { method: "POST", body: JSON.stringify([payload]) }))[0];
}

async function removeStaleSnapshotShifts(baseUrl, key, locationId, legacyIds) {
  const rows = await listAll(baseUrl, key, `shifts?location_id=eq.${encodeURIComponent(locationId)}&source=eq.snapshot-bridge&select=id,legacy_id`);
  const stale = rows.filter((row) => row?.legacy_id && !legacyIds.has(String(row.legacy_id)));
  for (const row of stale) {
    await request(baseUrl, key, `shifts?id=eq.${encodeURIComponent(row.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  }
  return stale.length;
}

async function removeStaleTemplateShifts(baseUrl, key, templateIdsByLegacyId, sourceTemplates) {
  const templateIds = [...templateIdsByLegacyId.values()].filter(Boolean);
  if (!templateIds.length) return 0;
  const rows = await listAll(baseUrl, key, `template_shifts?template_id=in.(${templateIds.join(",")})&select=id,template_id,legacy_id`);
  const expected = new Set();
  for (const template of sourceTemplates) {
    const templateId = templateIdsByLegacyId.get(String(template.id));
    for (const shift of values(template.shifts)) expected.add(`${templateId}:${String(shift.id)}`);
  }
  const stale = rows.filter((row) => row?.legacy_id && !expected.has(`${row.template_id}:${String(row.legacy_id)}`));
  for (const row of stale) {
    await request(baseUrl, key, `template_shifts?id=eq.${encodeURIComponent(row.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  }
  return stale.length;
}

async function main() {
  loadEnvFile(ROOT);
  const args = process.argv.slice(2);
  const writing = args.includes("--write");
  const confirmed = args.includes("--confirm-sandbox");
  const liveConfirmed = args.includes("--confirm-live");
  const locationIndex = args.indexOf("--location");
  const locationId = locationIndex >= 0 ? args[locationIndex + 1] || "" : SANDBOX_LOCATION_ID;
  const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const documentKey = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";
  if (!baseUrl || !key) throw new Error("Missing Supabase credentials in .env.");
  const configuredLocation = String(process.env.SHIFT_BAY_LOCATION_ID || "");
  const isSandbox = locationId === SANDBOX_LOCATION_ID;
  const isConfirmedLive = liveConfirmed && locationId === configuredLocation && locationId !== SANDBOX_LOCATION_ID;
  if (!isSandbox && !isConfirmedLive) throw new Error("Refusing this location. Use Sandbox or pass --confirm-live for the configured live location.");
  if (writing && !confirmed && !isConfirmedLive) throw new Error("Refusing to write until --confirm-sandbox or --confirm-live is supplied.");

  const snapshot = await snapshotForLocation(baseUrl, key, locationId, documentKey);
  const state = snapshot.state;
  const assigned = values(state.shifts);
  const open = values(state.unassignedShifts);
  const requests = values(state.timeOffRequests).filter((item) => !isScheduleBlock(item));
  const blocks = values(state.timeOffRequests).filter(isScheduleBlock);
  const templates = values(state.templates);
  const plan = {
    mode: writing ? "write" : "dry-run",
    locationId,
    snapshotSavedAt: snapshot.saved_at || snapshot.updated_at || null,
    assignedShifts: assigned.length,
    openShifts: open.length,
    requestOffs: requests.length,
    scheduleBlocks: blocks.length,
    templates: templates.length,
    templateShifts: templates.reduce((count, template) => count + values(template.shifts).length, 0)
  };
  if (!writing) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupDirectory = path.join(ROOT, "data", "backups", "cloud-baselines");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupPrefix = locationId === SANDBOX_LOCATION_ID ? "sandbox-before-normalized-schedule" : "live-before-normalized-schedule";
  const backupPath = path.join(backupDirectory, `${backupPrefix}-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2), "utf8");

  const maps = await normalizedMaps(baseUrl, key, locationId);
  const weekStartDay = Number(state.settings?.weekStart || 0);
  const weekIds = new Map();
  for (const date of [...assigned, ...open].map((shift) => String(shift.date || "")).filter(Boolean)) {
    const weekStart = weekStartFor(date, weekStartDay);
    if (weekIds.has(weekStart)) continue;
    const existing = await request(baseUrl, key, `schedule_weeks?location_id=eq.${encodeURIComponent(locationId)}&week_start=eq.${weekStart}&select=id`);
    const existingWeek = values(existing)[0];
    const savedWeek = existingWeek || values(await request(baseUrl, key, "schedule_weeks", { method: "POST", body: JSON.stringify([{ location_id: locationId, week_start: weekStart, status: "draft" }]) }))[0];
    if (!savedWeek?.id) throw new Error(`Could not create or find schedule week ${weekStart}.`);
    weekIds.set(weekStart, savedWeek.id);
  }

  for (const shift of assigned) {
    const weekId = weekIds.get(weekStartFor(shift.date, weekStartDay));
    await upsertByLegacy(baseUrl, key, "shifts", locationId, String(shift.id), shiftPayload(shift, locationId, maps, weekId, false));
  }
  for (const shift of open) {
    const weekId = weekIds.get(weekStartFor(shift.date, weekStartDay));
    await upsertByLegacy(baseUrl, key, "shifts", locationId, String(shift.id), shiftPayload(shift, locationId, maps, weekId, true));
  }
  const sourceShiftIds = new Set([...assigned, ...open].map((shift) => String(shift.id || "")).filter(Boolean));
  const removedStaleShifts = await removeStaleSnapshotShifts(baseUrl, key, locationId, sourceShiftIds);
  for (const item of requests) {
    const employee = maps.employeesByLegacyId.get(String(item.employeeId || ""));
    if (!employee?.id) throw new Error(`Request off ${item.id || "(unknown)"} references an unknown employee.`);
    await upsertByLegacy(baseUrl, key, "request_offs", locationId, String(item.id), requestPayload(item, locationId, employee.id));
  }
  for (const item of blocks) {
    const employee = maps.employeesByLegacyId.get(String(item.employeeId || ""));
    if (!employee?.id) throw new Error(`Schedule block ${item.id || "(unknown)"} references an unknown employee.`);
    await upsertByLegacy(baseUrl, key, "schedule_blocks", locationId, String(item.id), blockPayload(item, locationId, employee.id));
  }
  const templateIdsByLegacyId = new Map();
  for (const template of templates) {
    const savedTemplate = await upsertByLegacy(baseUrl, key, "templates", locationId, String(template.id), templatePayload(template, locationId));
    if (!savedTemplate?.id) throw new Error(`Could not save template ${template.name || template.id}.`);
    templateIdsByLegacyId.set(String(template.id), savedTemplate.id);
    for (const [sortOrder, shift] of values(template.shifts).entries()) {
      await upsertTemplateShift(baseUrl, key, savedTemplate.id, String(shift.id), templateShiftPayload(shift, savedTemplate.id, maps, sortOrder));
    }
  }
  const removedStaleTemplateShifts = await removeStaleTemplateShifts(baseUrl, key, templateIdsByLegacyId, templates);
  console.log(JSON.stringify({ ...plan, backupPath, normalizedScheduleWeeks: weekIds.size, removedStaleShifts, removedStaleTemplateShifts }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { blockPayload, isScheduleBlock, normalizedTime, requestPayload, shiftPayload, templatePayload, templateShiftPayload, weekStartFor };
