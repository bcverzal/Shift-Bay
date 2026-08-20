# Cutover Failure Modes and Preventive Checks

This checklist records problems encountered during the previous migration
attempt and turns each one into a preflight or stop condition.

## 1. Hidden writers

An open browser tab is not the only possible writer. A PowerShell-launched local
server, an unattended Node process, another computer, or another account can
continue sending saves after the visible browser is closed.

Before the cutover:

- Close all local Shift Bay browser tabs.
- Stop the local bridge/server and confirm its terminal has exited.
- Check for the specific local Node process or listening port before starting
  the migration. Do not kill unrelated Node processes blindly.
- Enable the global write pause before changing production data.
- Record the accounts and devices intentionally allowed to remain connected.

## 2. Atomic conflict storms and CPU exhaustion

The previous atomic writer repeatedly received the same stale revision and
amplified normal `40001` conflicts into high CPU, `500`/`504` timeouts, and
large Postgres error volumes.

Required safeguards:

- The first stale conflict blocks that tab's schedule writes.
- The Edge Function rejects a repeated known stale revision before calling the
  RPC again.
- The frontend stops its save queue while stale or paused.
- There is no automatic retry loop for a revision conflict, timeout, or
  connection-closed error.
- Watch CPU and Postgres error volume during the Sandbox canary and for a quiet
  observation period afterward.

Stop immediately for sustained CPU exhaustion, repeated `40001`, `500`, `504`,
or connection-closed errors.

## 3. SQL, Edge Function, and frontend version skew

The application has failed in the past when only one layer was updated. A
frontend can call a route or RPC that the deployed Edge Function or database
does not yet provide.

Record these three versions together:

- SQL migration name and execution result;
- Edge Function deploy timestamp and source commit;
- Netlify/frontend commit and published deploy.

Do not test a frontend feature until all three layers are known to match.

## 4. Permission and RPC grant failures

The atomic RPC previously produced `42501 permission denied` even though the
function existed. “Function exists” is not enough.

Before testing a write, verify:

- the RPC exists with the expected argument types;
- the Edge Function's service role can execute it;
- RLS and function grants are correct;
- the result is tested through the actual Edge Function, not only from SQL
  Editor.

## 5. Wrong location or wrong source comparison

The schedule and availability comparison tools previously defaulted to Sandbox
even when the operator intended a live check. That can produce convincing but
meaningless mismatch reports.

- Use `--confirm-live` for the configured live location.
- Record the returned `locationId` and compare it to the intended location.
- Confirm the report's baseline timestamp is the fresh baseline being used.
- Do not treat counts or a green process exit as proof of parity; inspect the
  mismatch arrays and each `readyForNormalized...` field.

## 6. Snapshot flash and stale cached state

During earlier tests, a new or deleted record briefly appeared from the wrong
source before the normalized read settled.

- Test normal, atomic Sandbox, and legacy snapshot URLs separately.
- Confirm the source badge before judging the data.
- Test a clean browser session after deployment, not only an old tab.
- Confirm the active week is the requested week and does not revert to a stale
  remembered week.
- Keep `?legacySnapshot=1` available and verify it before cutover.

## 7. Recovery and preserved edits

Stale tabs can contain valuable edits. Refreshing without checking the recovery
notice can make it unclear what was actually accepted.

- Confirm the rejected/preserved change list is visible before dismissing it.
- Never continue editing a tab after a blocking stale alert.
- Test that a refresh restores preserved edits exactly once, without duplicate
  records or replaying an old browser copy over newer data.
- Keep the local recovery export until the post-refresh save is confirmed.

## 8. Availability and people gaps

New employees, empty/unavailable profiles, future-dated replacements, and
availability assignments were added after earlier migration snapshots.

- Capture the baseline immediately before cutover.
- Rerun employee and availability comparisons after every mirror repair.
- Include employees with zero available days.
- Include future effective dates and replacement/approval state.
- Verify that a saved availability is not confused with the live availability.
- Do not enable normalized availability reads while profiles or windows are
  missing.

## 9. Deployment and source-control hazards

Earlier work encountered missing dependency lockfiles, branch merge conflicts,
and uncertainty about which branch Netlify was publishing.

- Confirm the publishing branch before pushing.
- Run the local test suite before merging.
- Resolve conflicts deliberately and inspect `app.js` after resolution.
- Confirm the published commit hash in Netlify after deployment.
- Do not spend a migration window debugging a frontend merge that was not part
  of the migration batch.

## 10. Final rollback proof

Before declaring `GO`:

- Load the normal normalized-read URL.
- Load the legacy snapshot URL for the same location and week.
- Confirm both show the expected data.
- Perform one reversible, harmless write only after all previous checks pass.
- Confirm save, refresh, second-window visibility, and rollback behavior.
- Reopen global writes only after the rollback path is verified.

Any unexplained data loss, wrong-location data, permission leak, partial write,
or repeated timeout is an immediate `STOP`, not a “follow up later” item.
