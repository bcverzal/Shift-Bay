# Shift Bay Branch Workflow

Shift Bay now has three working lanes so the restaurant can keep using the app while the cloud/database version is built safely.

## Branches

### main

Stable baseline.

- Use for known-good releases and emergency fallback.
- Do not make experimental changes directly here.
- Promote changes here only after they have been tested in `local-active`.

### local-active

Brian's day-to-day restaurant-use version.

- Use for schedule-writing fixes, print polish, template usability, drag/drop fixes, and small workflow improvements.
- Keep this branch operable at all times.
- If a requested change affects the shape of saved data, table-like structures, sync behavior, permissions, accounts, or multi-device behavior, note it as a database-impacting change before implementing.

### supabase-migration

Cloud/database/login construction branch.

- Use for Supabase schema, authentication, shared data, migration tools, and multi-device behavior.
- This branch may be broken while major storage work is underway.
- Pull useful UI/workflow fixes from `local-active` intentionally, not casually.

## Change Triage

Before implementing a change, decide which lane it belongs in:

- Local workflow only: `local-active`
- Stable emergency fix: `local-active` first, then promote to `main`
- Database/account/sync/storage change: `supabase-migration`
- A feature that changes data shape and is needed locally: implement carefully in `local-active`, then immediately record the Supabase schema implication

## Database-Impact Checklist

Flag a change if it adds or changes:

- employee fields
- role/training/availability rules
- shift fields
- template fields
- request-off or block behavior
- coverage requirements
- floor-plan settings
- print settings that need to persist
- user permissions or account behavior
- multi-computer conflict behavior

When flagged, add a note to the Supabase migration plan before or during implementation.

## GitHub Rule

Do not push changes to GitHub unless Brian explicitly asks for a push.
