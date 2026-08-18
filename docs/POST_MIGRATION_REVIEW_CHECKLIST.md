# Shift Bay Post-Migration and Repeatable Review Checklist

Use this document in two ways:

1. Run the **first-pass review** once the normalized data migration is complete.
2. Use the **repeatable review** before and after important releases, schema changes, or Edge Function changes.

The review is complete only when the evidence is recorded and every stop/go gate is passed. A green deploy alone is not proof that the application is safe.

## Review Record

- Review date:
- Reviewer:
- Commit/deploy:
- Edge Function deploy:
- Supabase migration(s):
- Location tested:
- Baseline or backup used:
- Result: `GO` / `GO WITH FOLLOW-UP` / `STOP`
- Follow-up issues:

## Part A: First-Pass Review After Migration

Run this when the normalized tables are ready to become the primary source for a location. Do it while schedule work is quiet.

### 1. Freeze and protect

- [ ] Tell all users not to edit the location during the review.
- [ ] Confirm no local Shift Bay server is running as a second cloud writer.
- [ ] Close extra Shift Bay browser tabs and stop any local test server that is not needed.
- [ ] Capture a fresh production baseline and archive the file path.
- [ ] Confirm a rollback URL or switch is available: `?legacySnapshot=1`.
- [ ] Confirm the current Edge Function, frontend commit, and SQL migration names are recorded.

**Stop if:** the baseline cannot be captured, the rollback source cannot be loaded, or another writer may still be active.

### 2. Database and migration integrity

- [ ] Confirm every migrated row has the correct `location_id`.
- [ ] Confirm legacy IDs are preserved for bridged records.
- [ ] Confirm counts for employees, roles, role capabilities, availability, templates, shifts, open shifts, request-offs, blocks, settings, and audit rows.
- [ ] Confirm there are no duplicate IDs or duplicate location-scoped identities.
- [ ] Confirm there are no broken employee, role, template, or schedule references.
- [ ] Confirm time zones, dates, start times, end times, meal periods, and full-day request-offs survived unchanged.
- [ ] Confirm deleted records are absent where expected and historical records remain where required.
- [ ] Run the normalized employee, availability, and schedule comparison reports.
- [ ] Save the reports and verify each required `readyForNormalized...: true` result.

**Stop if:** any required comparison report has missing records, unexplained mismatches, or an unresolved revision conflict.

### 3. Read-source parity

- [ ] Open the normal hosted URL and confirm the normalized-read badge/source marker.
- [ ] Compare the active week, employees, roles, shifts, open Shift Bay shifts, ROs, blocks, templates, and availability against the approved baseline.
- [ ] Open `?legacySnapshot=1` and confirm the compatibility view still loads.
- [ ] Compare the normal view and legacy view for the same location and week.
- [ ] Confirm switching between weeks does not briefly show stale data from another week.
- [ ] Confirm the last-viewed week behavior is intentional and does not override a deliberately selected week.

**Stop if:** either source loses records, flashes data from the wrong week, or the normal view cannot be rolled back cleanly.

### 4. Write and recovery proof

Use disposable Sandbox records first. For the real location, use one harmless, reversible change only.

- [ ] Create one disposable open shift and confirm it saves.
- [ ] Edit its time and confirm the edit persists after refresh.
- [ ] Delete it and confirm it is gone after refresh.
- [ ] Change one employee profile field in Sandbox and confirm it saves and reloads.
- [ ] Save one availability profile and confirm it appears in the correct saved list.
- [ ] Test one future-dated availability without changing the current live availability.
- [ ] Open two browser windows and verify an old revision is rejected rather than silently overwriting newer work.
- [ ] Confirm rejected or stale edits are preserved for review or restoration.
- [ ] Confirm a reconnect/refresh does not duplicate records or replay an old browser copy unexpectedly.
- [ ] Confirm the atomic writer either commits the complete write or leaves the prior state intact.

**Stop if:** a save can silently overwrite another user's work, a failed write partially changes data, or a refresh loses an intentional edit without a recovery copy.

### 5. Access and privacy matrix

Test with separate Sandbox accounts, not the real restaurant location.

- [ ] Owner can manage locations, managers, employees, settings, approvals, and recovery tools.
- [ ] Manager can perform the actions allowed by the access matrix and cannot use owner-only controls.
- [ ] Viewer can inspect permitted data but cannot create, edit, delete, approve, or publish changes.
- [ ] Staff can see only their linked location and permitted profile, schedule, directory, availability, and request-off data.
- [ ] Staff cannot see manager-only notes, protected fields, other locations, or another employee's private information.
- [ ] Phone privacy rules work for managers-only and all-staff settings.
- [ ] Temporary-password users are forced through permanent password setup.
- [ ] Removing a login removes access without deleting the employee profile.
- [ ] Sandbox/demo switching never exposes live location data.

**Stop if:** any role can write outside its permission, staff can see another employee's private data, or a location boundary can be bypassed.

### 6. Core workflow review

- [ ] Build a schedule from a template and add a missing shift.
- [ ] Assign, unassign, skip, copy, drag, and delete shifts.
- [ ] Confirm Flex Double uses the restaurant's configured end time in both the shift and template editors.
- [ ] Import ROs and review accepted, duplicate, skipped, unmatched, and rejected rows.
- [ ] Verify imported ROs are full-day unless the source contains a specific time range.
- [ ] Confirm assigned employees remain visible even when a later availability change makes them unavailable.
- [ ] Confirm archived/inactive employees are excluded from future compact output unless intentionally scheduled.
- [ ] Confirm draft versus published schedule behavior is clear in manager and staff views.
- [ ] Confirm future availability, rotations, replacements, and approvals affect the correct dates.

### 7. Printing and narrow-screen review

- [ ] Print compact weekly schedule.
- [ ] Print the selected day view.
- [ ] Print floor plans and verify notes, training, flex, closer, BQT, and BAR output.
- [ ] Confirm no rails, tabs, controls, or modal remnants appear in printed output.
- [ ] Confirm compact output has binder/punch margin and excludes archived employees.
- [ ] Confirm the selected print option, rather than the currently visible tab, controls the output.
- [ ] Review the schedule at a narrow desktop width and on a phone-sized viewport.
- [ ] Confirm the staff portal remains readable and usable on small screens.
- [ ] Confirm horizontal and vertical scrolling work without requiring the user to target a scrollbar.

### 8. First-pass signoff

- [ ] All comparison reports passed.
- [ ] All access levels passed.
- [ ] Sandbox write/recovery tests passed.
- [ ] One reversible production smoke write passed and was reverted.
- [ ] Print review passed.
- [ ] No unresolved `500`, `504`, permission, revision-conflict, or unknown-route errors remain.
- [ ] Observation period has started for at least one real schedule cycle.
- [ ] Rollback owner and rollback steps are known.

Only then mark the location as migrated and move the legacy snapshot to compatibility/rollback status.

## Part B: Repeatable Review Before Every Important Release

Use this for a frontend push, Edge Function deploy, SQL migration, normalized-read change, or major workflow change.

### Before changing anything

- [ ] Identify the exact user-visible behavior being changed.
- [ ] Identify whether the change affects frontend code, local bridge, Edge Function, SQL, permissions, stored data, or printing.
- [ ] Decide whether Sandbox testing is sufficient or whether a production read-only check is needed.
- [ ] Capture a backup before destructive or schema-related work.
- [ ] Check `git status --short` and preserve unrelated work.
- [ ] Batch small frontend fixes when practical to reduce unnecessary deploys.

### Automated checks

Run the repository's baseline suite with the bundled Node runtime:

```powershell
npm test
npm run test:storage
npm run test:contracts
npm run test:print
npm run test:security
npm run test:server
```

For changes involving users, access, or saved employee data, also run:

```powershell
node tools/test_access_matrix.js
node tools/test_employee_profile_persistence.js
```

For migration or normalized-data changes, also run the relevant audit and comparison tools. Review the actual output; a process that exits successfully is not enough if the report contains mismatches.

- [ ] JavaScript/TypeScript syntax passes.
- [ ] Contract tests pass.
- [ ] Storage and persistence tests pass.
- [ ] Print tests pass.
- [ ] Security/source scan passes with no tracked secrets.
- [ ] Migration comparison reports pass when applicable.
- [ ] `git diff --check` passes.

### Manual Sandbox smoke test

- [ ] Sign in using the affected access level.
- [ ] Confirm the correct location and week.
- [ ] Exercise the changed workflow once.
- [ ] Refresh and confirm persistence.
- [ ] Open a second browser window and confirm the saved result is visible.
- [ ] Test the error path intentionally once if the change involves validation, stale state, permissions, or recovery.
- [ ] Confirm the error explains what happened and what the user should do next.
- [ ] Confirm no duplicate record, stale browser copy, or wrong-week data appears.

### Manual print and layout check

- [ ] Check the affected desktop view.
- [ ] Check a narrow desktop view.
- [ ] Check the staff portal at phone width when relevant.
- [ ] Print the affected report when relevant.
- [ ] Confirm overlays, rails, tooltips, scrollbars, and controls do not cover content.
- [ ] Confirm the primary action is obvious and secondary actions are not competing with it.

### Deploy and observe

- [ ] Commit only the reviewed batch.
- [ ] Push/deploy the frontend if frontend files changed.
- [ ] Deploy the Edge Function if route or server behavior changed.
- [ ] Run SQL only when the migration has been reviewed and backed up.
- [ ] Open the hosted URL after deploy.
- [ ] Confirm `Cloud saved` and the expected normalized/compatibility source badge.
- [ ] Repeat one harmless save and refresh.
- [ ] Review Supabase logs for new `4xx`, `5xx`, timeout, permission, revision-conflict, or connection errors.
- [ ] Watch the first real use of the affected workflow.

### Release decision

**GO** when the automated checks, Sandbox smoke test, hosted smoke test, and relevant print/access checks pass.

**GO WITH FOLLOW-UP** only when the issue is cosmetic or documented, does not risk data loss, permissions, printing accuracy, or schedule correctness, and has an owner and target date.

**STOP** when there is data loss, unexplained stale-state behavior, wrong-location data, permission leakage, partial writes, repeated timeouts, or a failed rollback path.

## Part C: Review Evidence to Keep

For every first-pass review and every significant release, retain:

- commit and deploy identifiers;
- SQL migration name and execution date, if applicable;
- baseline/backup path;
- comparison report output;
- access-level accounts tested, without storing passwords;
- screenshots or print previews for layout-sensitive changes;
- Supabase error/log summary;
- known follow-up issues and their priority.

This creates a small, repeatable audit trail without attempting to record every hover or click.
