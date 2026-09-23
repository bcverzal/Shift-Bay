# Shift Bay Project Handoff

## Purpose And Current State

Shift Bay is a restaurant scheduling application for building weekly FOH schedules, managing employee availability and requests off, planning training, printing schedules/floor plans, and identifying staffing coverage gaps. Production is hosted at `https://shift-bay.com`.

This checkout is the last active feature worktree:

- Branch: `feature/training-print-roster`
- Commit: `828c412` (`Show menu tests on floor plans`)
- Status at handoff: clean; no uncommitted files and no commits ahead of its upstream (`origin/supabase-migration`).

The application is working in production, but the highest priority is reliability and workflow simplification before adding significant automation.

## Local Run

### Hosted development mode

1. Install Node.js 18+.
2. Copy `.env.example` to `.env` and obtain the real values from the existing secure Supabase/Netlify configuration. Do not commit `.env`.
3. Set `SHIFT_BAY_STORAGE_MODE=supabase` in `.env`.
4. Run `node server.js`, then open the reported localhost URL; or use `./Launch Shift Bay Cloud.ps1`.

The checked-in `shift-bay-config.js` contains public browser configuration only. Real Supabase service-role and Resend values belong in `.env` for local development and in Supabase Edge Function secrets for production.

### Tests

```text
npm test
npm run test:storage
npm run test:contracts
npm run test:print
npm run test:security
npm run test:server
```

See `TESTING.md` for manual production smoke checks.

## Deployment

- Static site: Netlify, auto-deployed from GitHub branch `supabase-migration`.
- Shared data and authentication: Supabase project.
- Server-side API: Supabase Edge Function `shift-bay-api` in `supabase/functions/shift-bay-api`.
- PDF request-off parsing: Netlify function in `netlify/functions/`.

Before any deployment: run the test suite, review `git status`, check that no secrets are tracked, and use `RELEASE_CHECKLIST.md`. Then merge or push approved work to `supabase-migration`; Netlify deploys it automatically. Do not deploy just to test a local code change.

## Architecture And Data

- `index.html`, `app.js`, and `styles.css`: manager scheduling UI and core business logic.
- `staff.html`, `staff.js`, and `staff.css`: staff-facing portal groundwork.
- `server.js` and `storage/`: local server and storage adapters. Local JSON is a fallback; production uses Supabase.
- `supabase/functions/shift-bay-api/`: authenticated cloud API. Keep service-role access here, never in browser code.
- `supabase/*.sql`: schema, migration, access-control, history, and normalization work.
- `netlify/functions/`: hosted browser helpers, including request-off PDF handling.
- `data/`: local-only fallback schedule data and backups. It is not the production source of truth.

The current live location is held in Supabase as a shared schedule document, with snapshot and normalized-table migration/atomic-write work already present. Protect cloud save, stale-tab recovery, backups, and multi-window behavior before altering the data model.

## Known Issues / Risks

- Warning and coverage acknowledgement behavior needs an end-to-end redesign; the current system is still evolving.
- Shared-state concurrency is document-level and can preserve/reject stale browser changes; record-level merging and audit history are future work.
- Normalized schedule storage has a rollback/snapshot path and needs continued production verification.
- RO import reporting and duplicate detection have improved but require real-PDF verification each week.
- Staff portal, publishing, staff availability approvals, and pick-up/release workflows are incomplete.
- Ctuit transfer is not a production integration. Treat it as a manual/assisted workflow only; do not post or automate live Ctuit changes without an explicit review step.

## UX Simplification Priorities

1. Define the manager's schedule-building workflow, then remove, relocate, or simplify anything that does not help it.
2. Make warnings actionable, rare, and easy to understand; distinguish blocking conflicts from acknowledged coverage gaps.
3. Keep the single-day view fast for assigning open shifts: only clean-fit candidates should be prominent, with explanations available on demand.
4. Continue making templates, Shift Bay controls, employee profiles, and shift detail shorter and easier to scan.
5. Keep manager scheduling desktop-first; offer a coherent read-only/mobile experience rather than compressing the full grid onto a phone.

## Next Development Tasks

1. Complete the reliability gate: verify cloud saves, stale/rejected-change recovery, refresh behavior, and two-session use without false alarms.
2. Overhaul warnings and coverage acknowledgement around the actual scheduling and publishing workflow.
3. Finish RO import reliability and auditing against real Ctuit PDFs.
4. Add publish/unpublish safeguards, a published revision, and manager/staff visibility boundaries.
5. Consolidate hard scheduling rules and soft preferences before expanding recommendation scoring or automation.

Capture later ideas such as anchor shifts, sick-call tracking, and manager end-of-shift surveys in `SHIFT_BAY_TODO.md` with dependencies rather than building them ahead of the reliability work.

## Critical Rules That Must Not Regress

- Request-offs and availability are hard scheduling conflicts. Candidates with conflicts must not appear as normal eligible recommendations.
- Recommended historical matches show green; workable clean-fit alternatives show blue. Conflicted candidates are hidden unless there are no clean options and the UI makes the risk explicit.
- Training shifts need the configured minimum duration (currently three hours by default), real trainee/trainer overlap, and meal-period compatibility. Prefer normal dinner shifts over flex shifts for dinner training where possible.
- A trainee becomes schedulable for a meal after completing that meal's training; completing dinner is enough to unlock dinner scheduling. Do not require a menu test first.
- A menu test happens once, on the first regular scheduled shift after training completion, and prints on the floor plan as `Menu Test`.
- The first training shift starts the trainee 30 minutes before the trainer for paperwork/system setup.
- Training plans can cover multiple selected meals against one availability schedule, and must preserve trainer, trainee, meal, and completion information.
- Floor-plan and print views must carry training information without obscuring names, start times, or layout controls. Print output must not include app navigation/rails.
- Shift Bay recommendations, day view, templates, open shifts, floor plans, and printed schedules must all use the same underlying schedule state.
- Never expose Supabase service-role keys, Resend keys, staff credentials, backups containing private data, or production data in Git or browser JavaScript.

## Safest Machine Transition

1. On the new desktop, clone `https://github.com/bcverzal/Shift-Bay.git` and check out `feature/training-print-roster` at commit `828c412` to reproduce this exact handoff state.
2. Obtain a secure copy of the local `.env` values from the existing owner-managed secret store or recreate them from the Supabase/Netlify dashboards. Do not copy secrets through Git, chat, or this document.
3. Confirm the desktop can run the app locally in Supabase mode and sign in without editing production data.
4. Run the automated tests and the non-destructive hosted smoke checks from `TESTING.md`.
5. Keep this laptop checkout intact until the desktop has loaded the real shared schedule, refreshed successfully, and completed a harmless two-browser save/refresh check.
6. Only then make new development changes on a new branch or worktree. Do not use the old local JSON data as a production restore source unless it is intentionally verified first.
