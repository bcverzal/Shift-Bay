const { loadEnvFile } = require("../config/load-env");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const LOCATION_ID = process.argv[2];
const WEEK_START = process.argv[3] || "2026-08-25";

function rows(value) { return Array.isArray(value) ? value : []; }
async function request(baseUrl, key, resource) {
  const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || body?.hint || `Request failed with ${response.status}`);
  return body;
}

async function main() {
  loadEnvFile(ROOT);
  const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!LOCATION_ID || !baseUrl || !key) throw new Error("Usage: node tools/inspect_normalized_week.js <locationId> [weekStart]");
  const encodedLocation = encodeURIComponent(LOCATION_ID);
  const [weeks, shifts, allShifts] = await Promise.all([
    request(baseUrl, key, `schedule_weeks?location_id=eq.${encodedLocation}&week_start=eq.${encodeURIComponent(WEEK_START)}&select=id,week_start,status`),
    request(baseUrl, key, `shifts?location_id=eq.${encodedLocation}&shift_date=gte.${encodeURIComponent(WEEK_START)}&shift_date=lte.${encodeURIComponent("2026-08-31")}&select=legacy_id,schedule_week_id,shift_date,start_time,end_time,employee_id,role_id,is_open_bay&order=shift_date.asc,start_time.asc`),
    request(baseUrl, key, `shifts?location_id=eq.${encodedLocation}&select=legacy_id,shift_date,is_open_bay&order=shift_date.asc`)
  ]);
  const shiftRows = rows(shifts);
  const allShiftRows = rows(allShifts);
  const byWeek = new Map();
  for (const shift of shiftRows) {
    const key = String(shift.schedule_week_id || "<null>");
    const bucket = byWeek.get(key) || { count: 0, minDate: "", maxDate: "", openBay: 0, assigned: 0 };
    bucket.count += 1;
    bucket.minDate = !bucket.minDate || String(shift.shift_date) < bucket.minDate ? String(shift.shift_date) : bucket.minDate;
    bucket.maxDate = !bucket.maxDate || String(shift.shift_date) > bucket.maxDate ? String(shift.shift_date) : bucket.maxDate;
    if (shift.is_open_bay) bucket.openBay += 1;
    else bucket.assigned += 1;
    byWeek.set(key, bucket);
  }
  console.log(JSON.stringify({
    locationId: LOCATION_ID,
    weekStart: WEEK_START,
    scheduleWeeks: rows(weeks),
    shiftCount: shiftRows.length,
    allShiftCount: allShiftRows.length,
    allShiftDateRange: {
      min: allShiftRows[0]?.shift_date || null,
      max: allShiftRows[allShiftRows.length - 1]?.shift_date || null
    },
    allShiftWeekCount: allShiftRows.filter((shift) => String(shift.shift_date || "").startsWith(WEEK_START.slice(0, 7))).length,
    byScheduleWeek: Object.fromEntries(byWeek),
    nullScheduleWeekCount: shiftRows.filter((shift) => !shift.schedule_week_id).length,
    assignedCount: shiftRows.filter((shift) => !shift.is_open_bay).length,
    openBayCount: shiftRows.filter((shift) => Boolean(shift.is_open_bay)).length,
    sample: shiftRows.slice(0, 12)
  }, null, 2));
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
