# Shift Bay Cloud Readiness Checklist

Use this before the Supabase-backed version is trusted for real restaurant scheduling.

## Project Setup

- [x] Supabase project exists.
- [x] `schema.sql` has been run successfully.
- [x] First location row exists.
- [x] At least one manager user exists.
- [x] Manager user is linked in `location_users`.
- [x] `.env` exists locally and is not committed.
- [x] `/api/status` shows `mode: "supabase"`.

## Data Migration

- [x] Current local Shift Bay data has been backed up.
- [x] A copy of that backup has been prepared with `prepare_supabase_state_document.js`.
- [x] Copied data loads in the Supabase branch.
- [x] Employees, roles, templates, request offs, schedule blocks, and shifts appear correct.
- [x] Shift Bay open shifts still appear in the Shift Bay.
- [ ] The active week is correct after reload.

## Save/Load

- [x] Saving from laptop persists after refresh.
- [x] Office PC can load the same data.
- [x] Saving from office PC persists after refresh.
- [x] Laptop can reload office PC changes.
- [ ] A stale save warning appears instead of silently overwriting newer data.
- [ ] Browser local backup still exists as a fallback.

## Print Outputs

- [ ] Compact grid print works.
- [ ] Compact by employee print works.
- [ ] Ctuit entry list print works.
- [ ] Floor plans render correctly.
- [ ] Floor plans print landscape when needed.
- [ ] Office PC can print to the office printer.

## Manager Use

- [ ] Other managers can open Shift Bay without seeing unfinished setup details.
- [ ] Dangerous bulk actions are hidden, moved, or clearly protected.
- [ ] In-development areas are labeled inside their tabs.
- [ ] Save status is visible and understandable.
- [ ] Last saved time/device/user is visible or planned before wider use.
- [ ] Recent activity works after server restart and Edge Function deployment.
- [ ] Manager invite workflow is implemented and tested.
- [ ] Non-owner managers cannot invite or remove other managers.
- [ ] Viewer role can view/print but cannot save schedule changes.

## Hosted Browser

- [ ] Supabase Edge Function `shift-bay-api` is deployed.
- [ ] Edge Function secrets are set.
- [ ] Hosted static site opens from a normal web address.
- [ ] Hosted site shows `Cloud saved`, not `LOCAL MODE`.
- [ ] Hosted site passes the smoke checklist in `HOSTED_BROWSER_DEPLOY.md`.
- [ ] Office-PC local bridge remains available as fallback until hosted site is trusted.

## Rollback Plan

- [x] Local active version still works.
- [ ] Latest local backup can be restored.
- [ ] Stable branch/tag is available.
- [ ] Office PC can return to local/shared-file mode if Supabase testing fails.

## Do Not Treat Cloud Version As Ready If

- [ ] Any print mode is broken.
- [ ] Saves fail silently.
- [ ] Two devices can overwrite each other without warning.
- [ ] Real employee data is exposed without login protection.
- [ ] You cannot restore from backup quickly.
