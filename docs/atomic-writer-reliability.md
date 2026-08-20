# Atomic Writer Reliability Runbook

## What failed

The atomic writer was receiving more requests than intended. `renderAll()` is used for normal screen redraws, selection, navigation, and layout changes, but it also called `saveState()`. Before the client mutation fingerprint guard, those redraws could become repeated full schedule writes.

The atomic procedure correctly rejected stale revisions such as `expected 45, found 46`. The problem was that an old tab could keep sending the same stale revision while it was waiting for a refresh. Each request still entered the database function, which amplified the normal optimistic-concurrency conflict into high Postgres CPU, 40001 log volume, and occasional 504 timeouts.

Other observed failures had separate causes:

- `42501`: the Edge Function service role did not have `EXECUTE` on the security-definer RPC.
- `Unexpected token 'u'`: an upstream plain-text error was being parsed as JSON, hiding the original error.
- `504`: the database transaction or lock wait exceeded the Edge Function/database timeout while contention was high.

## Current safeguards

- The browser fingerprints schedule state without volatile metadata and coalesces duplicate redraw writes.
- A successful response records the exact snapshot that was sent, so a later redraw does not resend it.
- A stale browser is blocked after the first conflict and its edits are preserved for recovery.
- The Edge Function remembers a known atomic revision conflict for 30 seconds and rejects the same stale revision before entering the RPC again.
- The atomic RPC returns expected lock contention (`55P03`) and stale revision
  conflicts (`40001`) as structured JSON instead of raising database errors;
  the Edge Function translates those results into the same clean `409`
  responses. These expected conflicts should not create a Postgres error
  storm.
- The RPC keeps the advisory lock, `3s` lock timeout, `20s` statement timeout, and one-transaction rollback behavior.
- Production remains on the compatibility snapshot. Atomic writes remain Sandbox-only and opt-in.

## Wednesday validation sequence

1. Deploy the updated frontend and `shift-bay-api` Edge Function after Netlify credits reset.
2. Confirm the normal hosted scheduler remains on the compatibility snapshot and loads the posted schedule.
3. Open one Atomic Sandbox tab. Create one shift, wait for one successful save, refresh, and confirm the shift and incremented revision remain.
4. Open two Atomic Sandbox tabs from the same revision. Save in tab A, then attempt one edit in tab B. Tab B should show one clear 409/refresh message; Supabase should not show a repeated conflict storm.
5. Leave tab B stale for at least 30 seconds and verify that redraws do not create repeated RPC calls.
6. Test one ordinary schedule edit, one delete, one open shift, and one request-off/block change. Confirm each successful save increments the normalized revision exactly once.
7. Check Supabase logs and infrastructure after each test. A single clean
   `409` conflict is expected during the two-window test; new `504`, `42501`,
   connection-closed errors, or sustained Postgres `40001`/`5xx` volume is a
   stop condition.

Do not enable normalized reads or atomic writes for the live restaurant until this sequence passes and the baseline comparison is clean.
