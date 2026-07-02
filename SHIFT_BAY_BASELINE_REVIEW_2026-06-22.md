# Shift Bay Baseline Review - 2026-06-22

## Current Operability Check

- Server status endpoint responded successfully at `http://localhost:8787/api/status`.
- `app.js` passed JavaScript syntax check.
- `server.js` passed JavaScript syntax check.
- Current browser cache tags were bumped for both `app.js` and `styles.css`, so a normal refresh should load the latest front-end changes.
- A smoke screenshot rendered successfully at `C:\Users\bcver\Desktop\Monthly Group Calendar\restaurant-scheduler\baseline-candidate-smoke.png`.
- A fresh data backup was created at `C:\Users\bcver\Desktop\Monthly Group Calendar\restaurant-scheduler\data\backups\restaurant-scheduler-data-baseline-candidate-2026-06-22T12-50-30.json`.
- Saved data audit: 74 employees, 124 assigned shifts, 379 Shift Bay shifts, 115 RO blocks, 0 duplicate RO groups, and 0 RO blocks pointing to missing employees.
- Current saved local preference includes both `2026-07-07` and older `2026-06-23` active-week entries from different device/session IDs, so confirm the active week after refresh.

## Changes Made In This Work Pass

- Weekly templates now check the current week before adding shifts to the Shift Bay.
- If matching shifts already exist, Shift Bay asks whether to add missing shifts only, add all anyway, or cancel.
- Matching is count-based, so duplicate template shifts are handled correctly.
- The duplicate check compares against both assigned grid shifts and open Shift Bay shifts.
- Saved weekly templates now collapse and expand in the Templates tab.
- Opening or selecting a saved template expands it automatically.
- Template expansion state is remembered on this laptop.
- The Request Off import button now clears the previous file selection before opening the file picker, so choosing the same report again should still trigger an import.
- Employee tab layout was tightened so role training controls should not spill into the availability area.
- The template duplicate message now says shifts are already represented on the week, instead of implying they are only in the bay.

## Baseline Readiness

Status: Baseline candidate, not frozen baseline yet.

Shift Bay is close enough to keep using for real scheduling work, but it should not become the permanent stable baseline until the items below are reviewed. The app is usable, but several trust points need direct confirmation.

## Review Checklist For Brian

- Refresh Shift Bay and confirm the app opens normally at `http://localhost:8787`.
- Confirm the active week comes back to the week you were working on.
- Go to Templates and confirm saved templates appear collapsed, expand cleanly, and still load/edit shifts.
- Add a weekly template when some matching shifts already exist and confirm the Add Missing Only choice behaves correctly.
- Confirm Add All Anyway still adds the full template when intentionally chosen.
- Confirm Add Missing Only does not remove or alter existing assigned shifts.
- Try importing the same RO file twice and confirm the app gives a clear confirmation and does not duplicate the same RO blocks.
- Check the Employees tab and confirm Role Training no longer overlaps Availability.
- Open compact print preview and confirm role sections render correctly across more than one page.
- Open floor plan print preview and confirm names/times still land where expected.
- Delete or unassign a shift and confirm the grid does not unexpectedly jump.
- Drag one Shift Bay card into the grid and one grid card to another person to confirm drag behavior still feels usable.

## Items To Work On Together Next

- RO import accuracy: confirm the exact Ctuit export format to standardize on, then make the importer trustworthy enough for weekly use.
- Baseline data safety: add a visible manual backup/export button and a visible last-saved status if either is not clear enough.
- Print reliability: confirm compact schedules and floor plans across both browser preview and real printer/PDF output.
- Template editor polish: make deleting/editing individual template shifts more obvious and reduce scrolling further.
- Warning notification behavior: confirm arrows, Show, dismissal, and restore-dismissed behavior all work exactly as expected.
- Floor-plan notes: review double, banquet, bar, trainer, and trainee notes with real examples to keep them short and readable.
- Shift detail redesign: continue making it shorter, wider, cleaner, and less error-prone.
- Stable baseline versioning: once the checklist passes, copy the project into a named baseline folder before starting experimental updates.

## Avoid Until Baseline Is Frozen

- Large layout rewrites.
- New automation/scheduling intelligence.
- Major data model migrations.
- Any feature that changes existing schedule data without an obvious preview and backup.
