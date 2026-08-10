# Multi-Location And Sandbox Plan

Shift Bay should support more than one restaurant/location under the same hosted app. The immediate reason is practical: create a safe fake/demo location where outside reviewers can explore Shift Bay without touching the real restaurant schedule.

## Goal

- Keep the real restaurant schedule protected.
- Let Brian and invited reviewers use a fake/sandbox location with realistic demo data.
- Avoid relying on local test copies for feature testing.
- Prepare the app for future real multi-location use without creating separate apps.

## Current State

The Supabase schema already supports multi-location records:

- `locations`
- `location_users`
- `scheduler_state_documents`
- future normalized tables all include `location_id`

The current hosted API still uses one configured location:

```text
SHIFT_BAY_LOCATION_ID
```

That makes the current app effectively single-location even though the database structure is ready for more.

## Phase 1: Sandbox Location

Create a second location record, for example:

```text
Shift Bay Demo Restaurant
```

Current demo location:

```text
78de461d-1f9e-4e66-83a8-a590359400aa
```

Status:

- Created in Supabase.
- Brian's owner account is linked to the demo location.
- Frontend/API location switching code is prepared locally, but still needs deployment before the hosted app can switch between real and demo data.

Then:

- Create a separate `scheduler_state_documents` row for that location.
- Seed it with fake employees, roles, templates, schedules, ROs, blocks, and coverage examples.
- Add Brian as `owner` in `location_users` for the demo location.
- Invite outside reviewers as `viewer` or `manager` only on the demo location.

This gives us a live test environment with no risk to the real schedule.

## Phase 2: Location-Aware API

Replace the single fixed `SHIFT_BAY_LOCATION_ID` assumption with user-accessible locations:

1. On login, list every location linked to the user in `location_users`.
2. Store the selected location in browser preference.
3. Send the selected location ID with state/load/save/manager requests.
4. Server verifies that the logged-in user belongs to that selected location before loading or saving.
5. If the user has only one location, open it automatically.

The server must never trust a browser-supplied location ID without checking `location_users`.

## Phase 3: Location Switcher UI

Add a location switcher near the account menu.

Expected behavior:

- Show current location name.
- If the user has multiple locations, allow switching.
- Switching locations reloads that location's scheduler state.
- Warn before switching if current changes are not cloud-saved.
- Viewer/manager/owner role may differ by location.

## Phase 4: Manager Access Per Location

Manager access should be scoped to the selected location.

Examples:

- Brian: owner at real location and demo location.
- Outside reviewer: viewer or manager at demo location only.
- Future company manager: owner/manager across multiple locations.

The manager access modal should clearly show which location is being managed.

## Phase 5: Demo Data Tools

Add owner-only controls for sandbox/demo locations:

- Reset demo data.
- Copy current real templates into demo without real employee names.
- Generate fake employees/shifts for training and tutorials.
- Mark a location as demo/sandbox so risky experimental features can be tested there first.

## Open Decisions

- Should demo locations have a visible "Sandbox" badge in the header?
- Should demo locations block exporting/printing with real-looking branding?
- Should owners be able to clone settings/templates from one location to another?
- Should the app allow a user to be owner in one location and viewer in another?

## Safety Rule

The real restaurant schedule should never be used as the playground. Any feature that might rewrite schedules, generate auto-assignments, or test imports should be tested in a sandbox location first.
