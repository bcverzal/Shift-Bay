const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase", "scheduler-state-history.sql"), "utf8");

assert.match(sql, /create table if not exists public\.scheduler_state_document_history/i);
assert.match(sql, /create trigger archive_scheduler_state_document_before_update/i);
assert.match(sql, /before update of state on public\.scheduler_state_documents/i);
assert.match(sql, /if old\.state is distinct from new\.state/i);
assert.match(sql, /enable row level security/i);

console.log("scheduler state history migration tests passed");
