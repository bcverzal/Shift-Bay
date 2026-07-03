# Auth And Permissions Plan

The first Supabase version should keep permissions simple enough to ship, but structured enough that employee access can be added later.

## Version One Roles

### Owner

- Manage restaurant/location settings
- Manage users
- Full schedule/template/employee access
- Restore/import data

### Manager

- Edit schedules
- Edit employees
- Edit templates
- Print schedules and floor plans
- Import request offs

### Viewer

- View schedules
- Print schedules and floor plans
- No edits

## Not Yet

Employee accounts are not part of the first cloud pass. When employee access is added later, employees should only see their own shifts, availability, request offs, and approved trade/request workflows.

## First Login Flow

1. Manager opens Shift Bay.
2. If no session exists, show a login screen.
3. After login, server validates that the Supabase user is listed in `location_users`.
4. App loads the `scheduler_state_documents` row for that location.
5. Saves include device ID and user identity where available.

## Security Notes

- Browser code should use the public anon key only.
- The Node server can use the service-role key, but only from `.env`.
- Do not commit `.env`.
- Row level security should be enabled before real cloud data is used.
- Office PC and laptop should use individual user accounts if more than one manager will make edits.

## Conflict Policy For First Cloud Version

Keep it conservative:

- If another device saved newer data, warn before overwriting.
- Add a visible "last saved by / last saved at" indicator.
- Avoid live simultaneous editing until the record-level migration is complete.
- Keep manual backup/export available even after Supabase is added.
