# Global Write Pause

## Purpose

During a migration, deployment, or emergency recovery, an owner should be able
to stop every open Shift Bay tab from writing without contacting every user.
The browser tabs cannot be forcibly closed by a website, but they can be made
read-only and required to refresh before they can continue.

## Behavior

1. Supabase stores one global write-control row with a monotonically increasing
   `write_epoch`.
2. The Edge Function exposes the current control state through its status/read
   response and checks it before every mutating operation.
3. When `writes_paused` is true, mutating requests return a clear `423 Locked`
   response. Reads remain available so users can finish viewing or printing.
4. When the epoch changes, the frontend marks the tab as stale, stops its save
   queue, and shows one modal: **Shift Bay needs to refresh before editing.**
5. After refresh, the tab loads the current state and resumes normally when the
   owner reopens writes.
6. The existing revision-conflict recovery remains in place. This control is a
   global migration brake, not a replacement for record-level concurrency.

## Prepared artifact

The reviewed SQL draft is:

`supabase/global-write-control.sql`

It is intentionally not applied yet. The Edge Function and frontend guards are
now in source, but the hosted app will continue to work without the control
until this SQL is run and both deployments are published.

## Cutover implementation order

1. Capture a fresh baseline and confirm the rollback URL.
2. Run the SQL draft in Supabase.
3. Deploy the Edge Function version that reads the control row before writes.
4. Deploy the frontend version that polls the control epoch and blocks stale
   tabs.
5. Test with two Sandbox tabs: pause writes, confirm both tabs stop accepting
   saves, reopen writes, refresh both, and confirm both can save again.
6. Use the pause during the real migration window, then reopen writes only
   after the normalized parity and rollback checks pass.

## Safety rules

- Keep reads available during the pause unless an emergency requires a full
  maintenance page.
- Do not invalidate authentication sessions for an ordinary migration pause.
- Never rely on a green deployment alone; verify the pause and resume behavior
  from separate accounts and browsers.
- Keep a manual SQL/Edge Function fallback available in case the owner UI is
  unavailable.
