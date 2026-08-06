const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile } = require("../config/load-env");
const { analyzeState } = require("./audit_normalized_migration");

const ROOT = path.join(__dirname, "..");

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function stateSummary(state = {}) {
  const count = (key) => Array.isArray(state[key]) ? state[key].length : 0;
  return {
    employees: count("employees"),
    roles: count("roles"),
    shifts: count("shifts"),
    openShifts: count("unassignedShifts"),
    templates: count("templates"),
    requestOffs: count("timeOffRequests"),
    scheduleBlocks: count("scheduleBlocks")
  };
}

async function main() {
  loadEnvFile(ROOT);
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const locationId = process.env.SHIFT_BAY_LOCATION_ID || "";
  const documentKey = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";
  if (!supabaseUrl || !serviceRoleKey || !locationId) {
    throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SHIFT_BAY_LOCATION_ID in .env.");
  }

  const query = new URLSearchParams({
    location_id: `eq.${locationId}`,
    document_key: `eq.${documentKey}`,
    select: "id,location_id,document_key,schema_version,state,saved_by,saved_by_device_id,saved_at,created_at,updated_at"
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/scheduler_state_documents?${query}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });
  const rows = await response.json();
  if (!response.ok) throw new Error(rows?.message || `Supabase request failed with ${response.status}.`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.state) throw new Error("No scheduler state document was found for the configured location.");

  const capturedAt = new Date().toISOString();
  const stamp = capturedAt.replace(/[-:TZ.]/g, "").slice(0, 14);
  const outputDirectory = path.join(ROOT, "data", "backups", "cloud-baselines");
  fs.mkdirSync(outputDirectory, { recursive: true });

  const snapshot = {
    app: "shift-bay-cloud-baseline",
    capturedAt,
    source: "supabase.scheduler_state_documents",
    document: row,
    summary: stateSummary(row.state),
    migrationAudit: analyzeState(row.state),
    localArtifacts: {
      schemaSha256: hashFile(path.join(ROOT, "supabase", "schema.sql")),
      edgeFunctionSha256: hashFile(path.join(ROOT, "supabase", "functions", "shift-bay-api", "index.ts")),
      employeeNormalizationSha256: hashFile(path.join(ROOT, "supabase", "employee-normalization-migration.sql"))
    }
  };
  const snapshotPath = path.join(outputDirectory, `production-baseline-${stamp}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");

  const reportPath = path.join(outputDirectory, `production-baseline-${stamp}-report.md`);
  const warnings = snapshot.migrationAudit.warnings;
  const report = [
    "# Shift Bay Production Baseline",
    "",
    `Captured: ${capturedAt}`,
    `Location: ${row.location_id}`,
    `Document key: ${row.document_key}`,
    `Document schema version: ${row.schema_version}`,
    `Document saved at: ${row.saved_at || "unknown"}`,
    `Document updated at: ${row.updated_at || "unknown"}`,
    "",
    "## Snapshot Counts",
    "",
    ...Object.entries(snapshot.summary).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Migration Audit",
    "",
    `- Availability windows: ${snapshot.migrationAudit.availability.totalWindows}`,
    `- Unknown references: ${Object.values(snapshot.migrationAudit.references).reduce((total, ids) => total + ids.length, 0)}`,
    ...(warnings.length ? warnings.map((warning) => `- Warning: ${warning}`) : ["- No migration warnings found."]),
    "",
    "## Local Artifact Hashes",
    "",
    ...Object.entries(snapshot.localArtifacts).map(([key, value]) => `- ${key}: ${value}`),
    ""
  ].join("\n");
  fs.writeFileSync(reportPath, report, "utf8");

  console.log(JSON.stringify({ snapshotPath, reportPath, summary: snapshot.summary, warnings }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
