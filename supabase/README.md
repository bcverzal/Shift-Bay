# Shift Bay Supabase Plan

This folder contains the first database blueprint for moving Shift Bay from local/shared-file storage to Supabase.

## Files

- `schema.sql`: draft normalized schema plus a transition table for storing the current full scheduler state document.

## First Implementation Path

The first cloud version should use `scheduler_state_documents` as the bridge.

That means the app can keep saving one scheduler state object while the server stores it in Supabase instead of `data/restaurant-scheduler-data.json`.

After that works reliably, individual feature areas can move into normalized tables:

1. employees and roles
2. shifts and open bay shifts
3. request offs and schedule blocks
4. templates and template shifts
5. settings, coverage, meal periods, and floor-plan rules
6. audit events and permissions

## Security Notes

- Use Supabase Auth for manager logins.
- Keep service-role keys on the Node server only.
- Enable row level security before any employee-facing portal exists.
- Start with one restaurant/location, but keep `location_id` on tables so multi-location support is not boxed out.
