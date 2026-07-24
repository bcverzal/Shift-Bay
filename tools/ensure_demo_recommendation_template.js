const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile } = require("../config/load-env");

const ROOT = path.resolve(__dirname, "..");
const DEMO_LOCATION_ID = "78de461d-1f9e-4e66-83a8-a590359400aa";
const DOCUMENT_KEY = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";
loadEnvFile(ROOT);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function nowIso() { return new Date().toISOString(); }
function id(value) { return `template_demo_recommendation_${value}`; }

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || body?.hint || body?.details || `Supabase request failed with ${response.status}.`);
  return body;
}

function role(state, name) {
  const result = (state.roles || []).find((item) => item.name === name);
  if (!result) throw new Error(`Demo role not found: ${name}`);
  return result;
}

function templateShift(state, dayIndex, roleName, start, end, flags = {}) {
  const selectedRole = role(state, roleName);
  return {
    id: id(`${dayIndex}_${roleName.replace(/[^a-z0-9]+/gi, "_")}_${start.replace(/[^a-z0-9]+/gi, "_")}`),
    dayIndex,
    department: selectedRole.department,
    roleId: selectedRole.id,
    start,
    end,
    untilVolume: false,
    isCloser: Boolean(flags.isCloser),
    isFlexDouble: false,
    isLunchCloser: false,
    color: selectedRole.color,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
  const rows = await request(`${supabaseUrl}/rest/v1/scheduler_state_documents?location_id=eq.${DEMO_LOCATION_ID}&document_key=eq.${encodeURIComponent(DOCUMENT_KEY)}&select=*`, { headers });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.state) throw new Error("The demo scheduler document was not found.");
  const state = row.state;
  const backupPath = path.join(ROOT, "data", "backups", `demo-recommendation-template-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(state, null, 2), "utf8");

  const template = {
    id: id("weekly"),
    name: "Recommendation Test Template",
    shifts: [
      templateShift(state, 2, "Server", "6:30 AM", "11:00 AM"),
      templateShift(state, 3, "Server", "11:00 AM", "3:00 PM"),
      templateShift(state, 5, "Bartender", "5:00 PM", "11:00 PM", { isCloser: true }),
      templateShift(state, 0, "Host", "9:00 AM", "2:00 PM")
    ],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.templates = [
    ...(state.templates || []).filter((item) => item.name !== template.name),
    template
  ];
  const savedAt = nowIso();
  await request(`${supabaseUrl}/rest/v1/scheduler_state_documents?on_conflict=location_id,document_key`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      location_id: DEMO_LOCATION_ID,
      document_key: DOCUMENT_KEY,
      schema_version: Number(row.schema_version || 2),
      state,
      saved_by: null,
      saved_by_device_id: "demo-recommendation-template",
      saved_at: savedAt,
      updated_at: savedAt
    }])
  });
  console.log(JSON.stringify({
    backupPath,
    template: template.name,
    shifts: template.shifts.map((shift) => `${shift.dayIndex}:${shift.start}-${shift.end}`)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
