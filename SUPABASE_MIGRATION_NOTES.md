# Supabase Migration Notes

Use this file to keep local app changes aligned with the upcoming Supabase version.

## Current Goal

Build a cloud-backed Shift Bay version with manager login, shared schedule data, and safe multi-computer access while keeping the local scheduling prototype usable.

## First Supabase Scope

- Manager/admin login only
- One restaurant/location first
- Shared employees, roles, templates, shifts, request offs, blocks, coverage, settings, and floor-plan configuration
- Basic conflict warnings when another device has changed data
- Migration from current local JSON data to Supabase tables

## Not In First Supabase Scope

- Employee mobile portal
- Shift trades
- Chat
- Full multi-location rollout
- Live simultaneous editing
- Sales-performance scheduling intelligence

## Database-Impact Log

Add entries here when a local-active change affects saved data or future table structure.

| Date | Local Change | Supabase Impact |
| --- | --- | --- |
| 2026-07-03 | Branch workflow created | Establish separate migration lane before schema work begins. |
| 2026-07-03 | Server storage adapter scaffold | Keep `/api/state` stable while swapping local JSON storage for Supabase document storage first. |

## Likely Core Tables

- locations
- users
- employees
- roles
- employee_roles
- availability_rules
- weekly_availability_overrides
- shifts
- open_shifts
- schedule_blocks
- request_offs
- templates
- template_shifts
- coverage_requirements
- meal_periods
- floor_plan_settings
- app_settings
- audit_events

## Open Design Decisions

- How strict should simultaneous editing be in version one?
- Should settings be per restaurant, per user, or both?
- How should local backups work once Supabase is primary?
- Which actions need an audit trail before other managers use the app?

## Migration Strategy

The first Supabase pass should not rewrite every scheduling screen at once.

1. Keep the browser app talking to `/api/state`.
2. Let the Node server choose a storage provider.
3. Default to local JSON so the branch can run without credentials.
4. Add Supabase as a server-side storage provider for the whole scheduler state document.
5. Once shared cloud state works, gradually move heavily-used records into normalized tables.

This creates a safer bridge:

- current app behavior stays familiar
- laptop and office PC can share a cloud-backed document earlier
- normalized tables can be introduced without blocking the first cloud test
- the long-term schema still exists as the target

## Storage Modes

Local JSON mode:

```text
SHIFT_BAY_STORAGE_MODE=local-json
```

Supabase state-document mode:

```text
SHIFT_BAY_STORAGE_MODE=supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SHIFT_BAY_LOCATION_ID=...
SHIFT_BAY_DOCUMENT_KEY=primary
```

The service-role key is server-side only. Do not put it in browser code or commit it to Git.
