# Manager Access Workflow

Shift Bay should keep manager access simple at first:

1. Owner enters a manager email and role.
2. Server-side code sends the Supabase invite.
3. The invite is recorded as pending.
4. When the manager accepts and signs in, the owner/server links that Supabase user to `location_users`.
5. All saves and important actions write audit events.

Supabase's official admin API includes `inviteUserByEmail`, which sends an invite link to an email address. That call must stay server-side because it requires privileged auth.

## Roles

- `owner`: manage managers, settings, imports, restores, and schedules.
- `manager`: edit schedules, employees, templates, request offs, floor plans, and printing.
- `viewer`: view and print only.

## First Implementation Target

Use this before adding employee accounts:

- Account menu shows current user and recent activity.
- Owner-only manager page or modal can invite managers.
- Invites are tracked in `location_invites`.
- Accepted users are linked in `location_users`.
- Saves write `scheduler_state_saved` audit events.
- Later high-value actions can write richer events, such as `shift_created`, `shift_deleted`, `template_applied`, and `request_off_imported`.

## Fallback Rule

The office-PC local bridge stays available until the hosted browser version has been smoke-tested from:

- Brian's laptop
- the office PC
- at least one ordinary browser window that did not install the app locally

Do not remove the local bridge scripts until that is true.
