# First Login Screen Plan

The first login version should feel simple and manager-focused. It should not expose employee features yet.

## First Screen

If no valid session exists:

- Show Shift Bay logo/title.
- Show email field.
- Show password field.
- Show `Sign In`.
- Show a small storage/status message only if there is a connection problem.

No marketing copy. No employee portal links yet.

## After Login

1. Browser signs in with Supabase Auth.
2. App asks the local Node server for `/api/status`.
3. Server verifies Supabase storage configuration.
4. App loads `/api/state`.
5. App shows current schedule.

## User Context

Once logged in, the app should know:

- Supabase user id
- email
- current location id
- user role: owner, manager, or viewer

## First Permission Behavior

Owner:

- all features

Manager:

- schedule, employees, templates, request offs, printing, floor plans

Viewer:

- view and print only

## Visual Placement

The logged-in user should show near the storage status area:

```text
Saved | Brian | Owner
```

or, if space is tight:

```text
Saved | Brian
```

The detailed role can be in the rollover.

## Important UX Rules

- Login should not feel like a separate product.
- If the session expires, save local browser backup before forcing sign-in.
- If Supabase is unreachable, explain that the local browser backup is still protected.
- Do not show scary technical errors to managers; put details in a hidden diagnostics area.
