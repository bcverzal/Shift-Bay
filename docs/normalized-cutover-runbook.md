# Normalized Data Cutover Runbook

Use this runbook only when Machine Shed schedule work is quiet. It is a
verification process, not a migration command list: the current app keeps the
legacy snapshot as a compatibility and rollback source while changed records
are mirrored into normalized tables.

## What Is Safe During Normal Scheduling

- Use the normal hosted Shift Bay URL.
- Do not use `legacySnapshot=1`, migration commands, or Supabase schema edits
  while actively creating a schedule.
- Do not edit the same shift simultaneously from two devices.
- The normal app reads normalized schedule and availability data when enabled;
  `?legacySnapshot=1` is the immediate compatibility fallback.

## Final Hybrid Verification

1. Wait until no one is making schedule changes.
2. Capture a fresh Machine Shed baseline:

```powershell
& "C:\Users\bcver\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools\capture_supabase_baseline.js
```

3. Run read-only parity checks. The `--confirm-live` flag now selects the
   configured live location from `.env`; each must report its respective
   `readyForNormalized...: true` field:

```powershell
& "C:\Users\bcver\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools\compare_normalized_employee_baseline.js --confirm-live
& "C:\Users\bcver\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools\compare_normalized_schedule_baseline.js --confirm-live
& "C:\Users\bcver\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools\compare_normalized_availability_baseline.js --confirm-live
```

4. In the normal app, make one reversible smoke-test change, verify it saves,
   then verify the same data with `?legacySnapshot=1`. Revert the test change.
5. Record the baseline filename and the three passing reports before beginning
   the observation period.

## Observation Period

Continue using the hybrid app for at least one real schedule cycle. Capture a
fresh baseline and rerun the three parity checks after material scheduling
work. If a mismatch appears, use the legacy snapshot fallback and diagnose the
bridge before making further migration changes.

## Sandbox Direct-Write Canary

This is the first direct normalized-write proof. It is available only to the
hosted Sandbox and does not change the Machine Shed snapshot or production
write path.

1. Deploy the current Edge Function and frontend only after the full test
   suite passes.
2. Switch Shift Bay to the Sandbox location, then open:

```text
https://shift-bay.com/?normalizedSchedule=direct-sandbox
```

3. Create one disposable open shift, edit its time, then delete it. After each
   action, the status detail should say it saved directly to normalized Sandbox
   schedule records.
4. Refresh the same URL and verify each create, edit, and delete persisted.
5. Run the Sandbox schedule comparison. It will intentionally show a
   difference while the direct-write changes exist because the legacy snapshot
   has not been changed. That distinction is the point of this canary.
6. Confirm `?legacySnapshot=1` does not show the disposable direct-write
   change. Return to the direct-write URL and delete the test record.

The direct canary rejects every non-Sandbox location on the server, including
Machine Shed. Do not relax that guard until a separate production-write design,
rollback, and concurrency pass is complete.

## Direct-Write Prerequisite

Before any location can use direct normalized schedule writes, run
`supabase/normalized-schedule-revisions.sql`. It adds a server-owned revision
lock, so a manager with an old schedule copy receives a conflict instead of
silently replacing another manager's newer work. Creating this table does not
change reads or writes by itself.

After the migration is applied, use the separate revision-lock Sandbox test:

```text
https://shift-bay.com/?normalizedSchedule=direct-sandbox-revision
```

Open that URL in two Sandbox browser windows. Save a disposable change in the
first window, then attempt a different save from the untouched second window.
The second save must initially be rejected and must not overwrite the first
window's saved data. After refresh, Shift Bay restores the rejected local
change on top of the newest shared version; confirm both changes persist.

## Durable Snapshot History

Before a production direct-write canary, run
`supabase/scheduler-state-history.sql`. It archives the previous complete
compatibility snapshot whenever the normal whole-schedule bridge updates it.
This is additive: it neither changes application reads nor enables direct
writes. It creates durable rollback points while the hybrid bridge remains in
use.

## Atomic Normalized Write Prerequisite

`supabase/normalized-schedule-atomic-write.sql` is the next Sandbox-only
prerequisite. It adds a service-only PostgreSQL procedure that accepts the
complete compatibility schedule state, validates it, replaces its
snapshot-backed normalized schedule rows, and advances the normalized revision
in one transaction. A failure rolls back every row and the revision together.

Running this migration is still inert: the API does not call the procedure
until a separate Sandbox canary is added and tested. Do not apply it to
Machine Shed during active scheduling.

## Atomic Write Sandbox Canary

After the procedure has been applied and the corresponding Edge Function and
frontend are deployed, the hosted Sandbox-only canary is:

```text
https://shift-bay.com/?normalizedSchedule=atomic-sandbox-revision
```

1. Confirm the account is switched to the Sandbox location.
2. Create a disposable open shift, edit it, then delete it. Refresh after each
   step and confirm the normalized schedule retains the result.
3. Repeat the two-window stale-write check from the revision canary. The older
   window must receive a conflict before it overwrites anything; after refresh,
   its preserved local change can be restored against the latest revision.
4. Verify the legacy snapshot URL does not contain the disposable shift. This
   is expected: the canary proves normalized-only writes while the production
   path remains snapshot-first.

The server refuses this save mode for every non-Sandbox location. Do not add a
production equivalent until the canary, rollback, and history checks have all
passed.

## Not Yet Part Of The Cutover

Machine Shed direct normalized writes are intentionally deferred. Today,
snapshot-first writes provide the compatibility bridge, with normalized records
updated after each save. The Sandbox canary above is the final prerequisite for
a later project that makes normalized tables authoritative for production
writes and retains the snapshot only for export and rollback.
