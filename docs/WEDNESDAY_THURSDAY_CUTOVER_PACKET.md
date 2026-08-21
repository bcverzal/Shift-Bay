# Wednesday/Thursday Cutover Packet

This is the short execution plan for finishing the normalized-data migration,
proving the atomic writer, and deciding whether the verified location can move
forward. It is intentionally operational: every step produces evidence or a
clear stop.

## Current Checkpoint: 2026-08-21

- Fresh Machine Shed baseline captured at:
  `data/backups/cloud-baselines/production-baseline-20260821002739.json`
- Baseline summary: 79 employees, 8 roles, 942 assigned shifts, 367 open
  shifts, 383 time-off records (359 request-offs plus 24 schedule blocks), 1
  template, and 115 template shifts.
- Local baseline suite: all 15 modules passed.
- Live parity is now **ready for the controlled cutover gate**. The final
  `--confirm-live` reports pass for people, availability, and schedule data.
- The migration preflight now explicitly selects the newest scheduler snapshot
  document, preventing historical rows from producing a false readiness result.
- The schedule migration removed 48 stale `snapshot-bridge` rows that were not
  present in the current baseline. No legacy snapshot rows were deleted.
- No production read switch should be attempted until the write-pause,
  rollback, access, and normal-versus-legacy smoke checks below are completed.

## Today: Prepare Without Touching Production Data

- [ ] Finish or intentionally set aside the current frontend batch. Record the
      exact commit, branch, and deploy currently serving the hosted site.
- [x] Run the local baseline suite with the bundled Node runtime. All 15
      modules must pass; the access-matrix runtime portion may remain skipped
      when its live credentials are not configured.
- [x] Confirm `git status --short` and preserve unrelated work. Do not mix a
      migration fix with an unrelated visual change during cutover.
- [x] Capture a fresh Machine Shed baseline and record its backup path.
- [ ] Write down the disposable Sandbox test records to use: one open shift,
      one time edit, one delete, and one two-window stale-write test.
- [ ] Confirm the rollback URL remains available:
      `https://shift-bay.com/?legacySnapshot=1`
- [ ] Confirm no local bridge/server is running as an unattended cloud writer
      and close extra Shift Bay tabs before testing.
- [ ] If other account holders may still have Shift Bay open, enable the global
      write pause first. See `docs/GLOBAL_WRITE_PAUSE.md`.
- [ ] Review `docs/CUTOVER_FAILURE_MODES.md` and explicitly check each previous
      failure mode before beginning the canary.

## Wednesday: Prove the Atomic Writer in Sandbox

Do this while no one is actively editing the real Machine Shed schedule.

1. Apply only the reviewed SQL migration, if the current Supabase project does
   not already contain the current atomic procedure and its service-role grant.
2. Deploy the matching `shift-bay-api` Edge Function and record the deploy time.
3. Open the hosted Sandbox atomic URL:
   `https://shift-bay.com/?normalizedSchedule=atomic-sandbox-revision`
4. Create one disposable open shift. Refresh and confirm it remains.
5. Edit its time. Refresh and confirm the edit remains.
6. Delete it. Refresh and confirm it is gone.
7. Open two atomic Sandbox windows. Save from window A, then save a different
   change from untouched window B. Window B must receive a revision conflict,
   not overwrite A. Refresh B and confirm its preserved change can be restored.
8. Verify the legacy snapshot URL does not contain the disposable atomic-only
   record. That difference is expected and proves the canary is isolated.
9. Watch Supabase logs and infrastructure for at least 10 quiet minutes.

### Wednesday stop conditions

Stop immediately for any `42501` permission error, `40001` conflict that does
not resolve after refresh, `500`, `504`, connection-closed error, partial
write, sustained CPU exhaustion, or a canary record appearing in the legacy
snapshot. Do not proceed to Machine Shed writes until the cause is resolved
and the complete canary is repeated.

## Thursday: Verify Parity and Decide the Cutover

1. Freeze Machine Shed edits and capture a new production baseline.
2. Run the live employee, schedule, and availability comparison tools. Each
   report must explicitly say its corresponding `readyForNormalized...: true`.
3. Investigate every mismatch. Counts matching is not enough; time ranges,
   roles, employees, ROs, blocks, templates, flags, and future AV dates must
   match.
4. Open the normal hosted URL and verify the normalized-read badge, current
   week, employees, schedule, availability, templates, and ROs.
5. Open `?legacySnapshot=1` for the same location and week. Confirm it still
   loads and remains a usable rollback view.
6. Compare normal and legacy views for the same week. Confirm there is no
   wrong-week flash, missing employee, missing shift, or future-AV regression.
7. Perform one harmless, reversible Machine Shed smoke edit only if all prior
   checks are green. Verify save, refresh, second-window visibility, then
   revert it.
8. Review Supabase logs after the smoke edit. There must be no new permission,
   timeout, connection, revision, or partial-write errors.
9. Record the decision as `GO`, `GO WITH FOLLOW-UP`, or `STOP` before enabling
   any broader production write behavior.

## Go/No-Go Rule

The cutover is **GO** only when the Sandbox atomic canary, live parity reports,
normal/legacy read comparison, access checks, rollback check, and one reversible
production smoke edit all pass. A green Netlify or Supabase deploy by itself
is not evidence that the migration is safe.

Use **STOP** for data loss, unexplained stale state, wrong-location data,
permission leakage, partial writes, repeated timeouts, CPU exhaustion, or a
failed rollback path. The fallback is the compatibility snapshot, not a blind
retry loop.

## Evidence to Save

Keep the baseline filename, comparison outputs, commit/deploy IDs, SQL names,
test record IDs, screenshots of the normalized badge and rollback view, and a
short Supabase error summary. Do not save passwords or service-role keys.
