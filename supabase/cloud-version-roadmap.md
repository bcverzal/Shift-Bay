# Cloud Version Roadmap

This roadmap keeps the Supabase migration small enough to finish while protecting the restaurant-use scheduler.

## Version 0: Current Local Active App

Location:

```text
restaurant-scheduler
```

Branch:

```text
local-active
```

Purpose:

- Write real schedules
- Print compact grids and floor plans
- Keep making practical workflow improvements

## Version 1: Supabase State Document

Location:

```text
restaurant-scheduler-supabase
```

Branch:

```text
supabase-migration
```

Goal:

- Manager login
- One restaurant/location
- Office PC and laptop load the same schedule state from Supabase
- Office PC can print directly
- Conservative conflict warning when another machine saved newer data

Important decision:

The browser app still works with one state object. The server stores that object in Supabase's `scheduler_state_documents` table. This is intentionally a bridge.

What this gives us:

- Faster cloud sharing
- Less risk to current UI
- A clear path to normalized tables later

What it does not give us yet:

- True simultaneous multi-user editing
- Employee portal
- Shift trades
- Mobile request-off workflow
- Sales intelligence

## Version 2: Manager Login And Permissions

Add:

- login screen
- logout
- visible current user
- `owner`, `manager`, and `viewer` roles
- route/API protection
- "last saved by / last saved at"

Keep it manager-only.

## Version 3: Normalized Employees And Roles

Move these out of the state document first:

- employees
- roles
- employee role capabilities
- pay rates
- weekly/default availability

Reason:

These are shared reference records and change less often than shifts. They are easier to migrate first.

## Version 4: Normalized Schedules

Move:

- assigned shifts
- open Shift Bay shifts
- request offs
- schedule blocks
- training links
- coverage requirements

Reason:

This is where conflict handling matters most, so it should come after login and basic cloud state are proven.

## Version 5: Employee Portal

Later:

- employees log in
- view shifts
- request off
- submit availability
- maybe shift trades
- no schedule-writing access

## Practical Rule

If a local-active feature changes saved data shape, update:

```text
SUPABASE_MIGRATION_NOTES.md
supabase/state-to-tables-map.md
```

That keeps the two branches mergeable.
