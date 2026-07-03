# Shift Bay Cloud Readiness Checklist

Use this before the Supabase-backed version is trusted for real restaurant scheduling.

## Project Setup

- [ ] Supabase project exists.
- [ ] `schema.sql` has been run successfully.
- [ ] First location row exists.
- [ ] At least one manager user exists.
- [ ] Manager user is linked in `location_users`.
- [ ] `.env` exists locally and is not committed.
- [ ] `/api/status` shows `mode: "supabase"`.

## Data Migration

- [ ] Current local Shift Bay data has been backed up.
- [ ] A copy of that backup has been prepared with `prepare_supabase_state_document.js`.
- [ ] Copied data loads in the Supabase branch.
- [ ] Employees, roles, templates, request offs, schedule blocks, and shifts appear correct.
- [ ] Shift Bay open shifts still appear in the Shift Bay.
- [ ] The active week is correct after reload.

## Save/Load

- [ ] Saving from laptop persists after refresh.
- [ ] Office PC can load the same data.
- [ ] Saving from office PC persists after refresh.
- [ ] Laptop can reload office PC changes.
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

## Rollback Plan

- [ ] Local active version still works.
- [ ] Latest local backup can be restored.
- [ ] Stable branch/tag is available.
- [ ] Office PC can return to local/shared-file mode if Supabase testing fails.

## Do Not Treat Cloud Version As Ready If

- [ ] Any print mode is broken.
- [ ] Saves fail silently.
- [ ] Two devices can overwrite each other without warning.
- [ ] Real employee data is exposed without login protection.
- [ ] You cannot restore from backup quickly.
