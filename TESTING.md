# Shift Bay Testing

Run the local baseline with the bundled Node runtime or any Node 18+ installation:

```text
npm test
```

The baseline currently covers:

- Storage adapter behavior and local/cloud mode boundaries.
- Required app contracts for day focus, floor-plan handoff, Shift Bay, and historical recommendations.
- Print-mode contracts for compact, CTuit entry, and floor-plan output.
- A source scan that rejects accidentally tracked Supabase secrets.
- Server contracts for `/api/status`, configurable host/port, and server startup wiring.

Additional focused commands:

```text
npm run test:storage
npm run test:contracts
npm run test:print
npm run test:security
npm run test:server
node tools/test_access_matrix.js
node tools/test_employee_profile_persistence.js
node tools/test_migration_audit.js
```

## Migration audit

Run the read-only audit against a scheduler backup before moving data into normalized tables:

```text
node tools/audit_normalized_migration.js path\to\backup.json
node tools/audit_normalized_migration.js path\to\backup.json --normalized path\to\normalized-export.json --json
```

It reports missing or duplicate ids, broken employee/role references, availability-window counts, and normalized counts that are lower than the source. It does not modify either file.

## Manual Hosted Smoke Pass

The automated suite cannot use the signed-in browser session or safely mutate a live Supabase location. Before a production deploy, verify these flows manually in the hosted app:

1. Sign in, confirm the location and active week, then refresh.
2. Edit one harmless demo/sandbox record, confirm cloud saved, refresh, and confirm it persists.
3. Open a day view, switch to Floor Plans, and confirm the focused date carries over.
4. Add a known request-off PDF and review the imported, skipped, duplicate, and unmatched lists.
5. Open Shift Bay, select a shift, assign it, unassign it, skip it, and confirm focus moves to the next item.
6. Print one compact schedule, one CTuit entry list, and one floor-plan week; confirm rails and controls are absent from print output.
7. Test a manager invite and a staff invite in sandbox only; confirm first-login password setup and removal.

Do not use the live restaurant location for destructive tests. Keep the recommendation work and staff-feedback work out of production until their behavior has been reviewed separately.
## Automatic checks

The repository includes a GitHub Actions workflow at `.github/workflows/tests.yml`.
It runs the safe baseline suite on pushes to `main` and `supabase-migration`, on pull requests, and when manually started from GitHub Actions.

The workflow checks JavaScript syntax, whitespace, storage behavior, UI contracts, print contracts, source security, server contracts, and the access-matrix permission contract. It does not use production credentials or mutate Supabase data.

The live owner/manager/viewer/staff HTTP checks are opt-in through the environment variables documented in `supabase/access-matrix.md`; those should only be used with sandbox accounts and a sandbox location.
