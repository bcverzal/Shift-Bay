const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase", "normalized-schedule-atomic-write.sql"), "utf8");
const edge = fs.readFileSync(path.join(root, "supabase", "functions", "shift-bay-api", "index.ts"), "utf8");

assert.match(sql, /create or replace function public\.write_normalized_schedule_atomically/i);
assert.match(sql, /security definer/i);
assert.match(sql, /for update/i);
assert.match(sql, /Normalized schedule revision conflict/i);
assert.match(sql, /insert into public\.shifts/i);
assert.match(sql, /insert into public\.request_offs/i);
assert.match(sql, /insert into public\.schedule_blocks/i);
assert.match(sql, /insert into public\.templates/i);
assert.match(sql, /insert into public\.template_shifts/i);
assert.match(sql, /delete from public\.shifts existing/i);
assert.match(sql, /revoke all on function public\.write_normalized_schedule_atomically/i);
assert.match(sql, /grant execute on function public\.write_normalized_schedule_atomically[\s\S]*service_role/i);
assert.match(edge, /async function writeNormalizedScheduleAtomically/);
assert.match(edge, /\/rpc\/write_normalized_schedule_atomically/);
assert.match(edge, /saveMode === "normalized-sandbox-atomic-revision"/);
assert.match(edge, /Atomic normalized schedule writes are limited to the Sandbox location/);
assert.doesNotMatch(edge, /normalized-production-direct/);

console.log("normalized schedule atomic write migration tests passed");
