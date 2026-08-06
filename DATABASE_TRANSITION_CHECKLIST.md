# Shift Bay Database Transition Checklist

This checklist is the working plan for moving Shift Bay from one JSON scheduler document to location-scoped Supabase records without interrupting restaurant scheduling.

## Current Baseline

- The hosted scheduler still reads and writes `scheduler_state_documents` as the compatibility source of truth.
- The normalized schema in `supabase/schema.sql` is now populated for the live Machine Shed location, but the normal scheduling screens still read the compatibility snapshot by default.
- Employee profile saves have a transition bridge: they write `employee_profile_overrides` and best-effort mirror the employee into `employees` and `availability_rules`.
- Audit events currently describe saves at a broad level. Detailed per-record history is not complete until records move into normalized tables.
- The local app remains a separate operating mode. It should not be used as a second cloud writer during migration testing.

## Verified So Far

- Migration audit detects duplicate IDs, missing IDs, unknown employee/role references, and availability windows.
- Storage adapter tests cover local JSON round trips, Supabase document round trips, stale-save rejection, and local backup creation.
- Employee normalization includes stable `(location_id, legacy_id)` identity and ordered split-availability windows.
- Core normalized tables are location-scoped, including roles, employees, shifts, templates, request-offs, blocks, settings, and audit events.

## Not Yet Migrated

- Roles, employees, employee-role capabilities, availability profiles/windows/assignments, templates, template shifts, shifts, open Shift Bay shifts, request-offs, and schedule blocks are mirrored for the live Machine Shed location.
- Training links, coverage, floor-plan settings, and some metadata still need normalized destinations or field-level verification.
- Normalized schedule and availability reads are the default manager path for approved locations. The snapshot remains available through the immediate `?legacySnapshot=1` compatibility override.
- Record-level optimistic concurrency and record-level undo are not implemented.

## Transition Rules

1. Keep the snapshot as the compatibility read source until a feature has both normalized writes and normalized reads.
2. Every normalized row must retain the legacy ID during the bridge period.
3. Every write must include `location_id`; never infer a location from browser state alone.
4. A normalized write must be idempotent and safe to retry.
5. A failed normalized mirror must not silently make the snapshot appear saved when the normalized record is required for that workflow.
6. Do not migrate a feature without a rollback path and a comparison audit against the snapshot.
7. Do not put service-role credentials in browser code or committed files.

## Phased Work

### Phase 0: Baseline and Backup

- [x] Keep the current snapshot-backed scheduler operational.
- [x] Keep local JSON backups available.
- [x] Add migration audit tooling.
- [x] Export and archive an initial production snapshot: `data/backups/cloud-baselines/production-baseline-20260803185136.json`.
- [x] Record the initial snapshot schema plus local schema/Edge Function artifact hashes in the paired baseline report.
- [x] Export and archive a new production snapshot before the live normalized mirror.
- [x] Archive per-phase live migration backups for people, availability, and schedule records.

### Phase 1: Employees, Roles, and Availability

- [x] Add normalized employee identity bridge.
- [x] Mirror default weekly availability windows.
- [x] Prepare a guarded role/employee/availability migration with dry-run coverage.
- [x] Run `supabase/role-normalization-migration.sql` in Supabase before the sandbox write.
- [x] Run the additive employee scheduling-preference schema in Supabase.
- [x] Mirror roles and employee-role capabilities into Sandbox and live Machine Shed.
- [x] Mirror live saved availability definitions, windows, assignments, and approval state represented in the snapshot bridge.
- [ ] Run the saved availability schema in Sandbox and verify it remains the one canonical model for staff and manager availability.
- [x] Add a comparison report that checks snapshot employees, roles, availability, and role capabilities against normalized records.
- [x] Add a field-level coverage audit and migration manifest before writing additional employee data.
- [x] Define additive normalized destinations for employee scheduling preferences and weekly work rules.
- [x] Build a read-only normalized employee shadow endpoint with manager/owner access control.
- [x] Deploy and exercise the normalized employee shadow endpoint against Sandbox.
- [x] Add normalized reads behind an explicit feature flag for Sandbox and the configured live location.
- [ ] Verify owner, manager, and staff access separately before expanding the read path.

### Phase 2: Requests and Approvals

- [x] Normalize request-offs and schedule blocks with source fingerprints in Sandbox and live Machine Shed.
- [ ] Preserve import history for both accepted and rejected/unmatched RO rows.
- [ ] Normalize availability approvals and manager overrides.
- [ ] Add approval audit events with actor, target employee, effective date, and prior/new state.

### Phase 3: Schedules and Templates

- [x] Prepare the additive schedule identity and metadata bridge SQL for review.
- [x] Add a read-only schedule comparison audit before schedule records are copied.
- [x] Normalize schedule weeks and draft state in Sandbox and live Machine Shed.
- [x] Normalize assigned and open-bay shifts in Sandbox and live Machine Shed, preserving duplicate template rows.
- [ ] Normalize training links and shift metadata.
- [x] Normalize templates and template shifts in Sandbox and live Machine Shed.
- [ ] Add record-level conflict checks before replacing a shift.
- [x] Compare normalized Sandbox schedule output to the snapshot before enabling normalized reads.
- [x] Keep the normalized Sandbox schedule mirror synchronized after snapshot saves, including deletes.
- [x] Build a delta-based mirror that can safely synchronize live schedule edits without rewriting every historical shift.
- [x] Deploy and verify live schedule dual-write with one reversible canary edit, then rerun the live schedule comparison.

### Phase 4: Settings, Audit, and Cutover

- [ ] Normalize location settings, meal periods, coverage, and floor-plan rules.
- [ ] Expand audit events from save summaries to entity-level changes.
- [ ] Add a recovery view that can restore a prior entity version.
- [x] Deploy the live-canary Edge Function update and confirm explicit normalized schedule and availability reads.
- [x] Define the rollback switch back to snapshot reads with `?legacySnapshot=1`.
- [x] Cut over Sandbox and the verified Machine Shed location to default normalized schedule and availability reads, pending final local and production smoke checks.

## Recommended Next Concrete Step

Run the final **reversible default-read smoke check** before deploying the frontend:

1. Open the local app normally, with no query parameters, and confirm the normalized schedule and availability match the approved canary.
2. Open the same page with `?legacySnapshot=1` and confirm the compatibility snapshot still loads cleanly.
3. Return to the normal URL and confirm the normalized-read badge and expected schedule data return.
4. After those checks, deploy the frontend. No additional Edge Function deployment is required for this default-read switch.

The legacy snapshot remains intact throughout this phase, so the compatibility URL is an immediate rollback path rather than a data recovery operation.

## Supabase Work Needed Later

The production Supabase work will require SQL/function deployment and verification. Nothing in this checklist authorizes changing production data automatically. Each migration should be run deliberately, backed up, and tested in the sandbox first.
