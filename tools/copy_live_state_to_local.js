const fs = require("fs");
const path = require("path");

function loadEnv(filePath) {
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0 || line.trimStart().startsWith("#")) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['\"]|['\"]$/g, "");
  }
  return values;
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const env = loadEnv(path.join(root, ".env"));
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SHIFT_BAY_LOCATION_ID"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing ${missing.join(", ")} in .env.`);

  const documentKey = env.SHIFT_BAY_DOCUMENT_KEY || "primary";
  const endpoint = `${env.SUPABASE_URL}/rest/v1/scheduler_state_documents?location_id=eq.${encodeURIComponent(env.SHIFT_BAY_LOCATION_ID)}&document_key=eq.${encodeURIComponent(documentKey)}&select=state,schema_version,saved_at,updated_at`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) throw new Error(`Could not read the live schedule: ${await response.text()}`);
  const rows = await response.json();
  const row = rows[0];
  if (!row?.state || typeof row.state !== "object") throw new Error("The live schedule did not return a usable state snapshot.");

  const state = row.state;
  const count = (key) => Array.isArray(state[key]) ? state[key].length : 0;
  if (count("employees") < 1) throw new Error("Safety stop: the live schedule returned no employees, so no local copy was created.");

  const dataDir = path.join(root, "data");
  const backupDir = path.join(dataDir, "backups");
  const destination = path.join(dataDir, "restaurant-scheduler-data.json");
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(destination)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(destination, path.join(backupDir, `local-copy-before-refresh-${timestamp}.json`));
  }

  const payload = {
    app: "restaurant-scheduler",
    schemaVersion: Number(row.schema_version || state?.meta?.schemaVersion || 2),
    savedAt: new Date().toISOString(),
    localCopySource: "live-schedule-read-only",
    localCopySourceSavedAt: row.saved_at || row.updated_at || null,
    data: state
  };
  const tempFile = `${destination}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tempFile, destination);
  console.log(JSON.stringify({
    copied: true,
    employees: count("employees"),
    shifts: count("shifts"),
    openShifts: count("unassignedShifts"),
    timeOffRequests: count("timeOffRequests")
  }));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
