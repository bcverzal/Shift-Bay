# Shift Bay To-Do

## Current Priority

- [ ] Make RO import trustworthy for weekly use: accurate parsing, duplicate prevention, clear import confirmation, and an import summary.
- [ ] Confirm imported ROs now default to full-day unless the report includes a specific time range.
- [ ] Verify compact schedules, floor plans, print completed week, and grid print output against real PDF/printer previews.
- [ ] Polish the template workflow so templates are easy to scan, edit, delete from, and add missing shifts from without confusion.
- [ ] Confirm weekly template "Add to Bay" behavior only adds missing/unrepresented shifts so the bay reflects remaining schedule work.
- [ ] Continue refining single-day view until it is genuinely useful for building one day at a time.
- [ ] Confirm single-day view should keep Start Time as the default sort, with A-Z available as an alternate mode.
- [ ] Refine single-day Shift Bay date switching: when a selected bay shift is for another day, jump to that day first without expanding the bay or selecting/highlighting the shift until the user clicks it again.
- [ ] Confirm drag/drop, copy/paste, shift-drag copy, and bay-to-grid assignment all behave predictably.
- [ ] Add a responsive access mode for phones and narrow windows: keep schedule creation desktop-focused, but provide a coherent read-only schedule/shift/floor-plan experience and usable staff-portal actions on smaller screens. Add an explicit larger-screen message for manager scheduling rather than forcing the full grid onto a phone. Priority: after scheduling and Staff Portal essentials, before deeper automation and analytics.
- [ ] After multi-location is stable, begin Staff Portal MVP: staff login, my schedule, request-offs, availability changes, shift release/pickup, and manager approval queue.

## Core Workflow Polish

- [ ] Run a dedicated UI/UX simplification pass using Design Parser/Mobbin/Emil-style principles: reduce competing colors, reduce simultaneous information density, respect Miller's Law, make one primary action obvious per surface, and treat animation as functional feedback rather than decoration.
- [ ] Revisit top-level navigation: evaluate whether Templates and Roles should remain permanent tabs or move into an onboarding/setup area or Settings after initial configuration, while keeping occasional maintenance easy to find.
- [ ] Make warning notifications fully reliable: next/previous arrows, Show, dismiss, restore dismissed warnings, and shortcut-to-fix.
- [ ] Continue redesigning Shift Detail so it is shorter, wider, easier to scan, and less error-prone.
- [ ] Add a Metadata tab to Shift Detail showing when the shift/open shift was created, last edited, how it was created (manual, template, coverage, copied, imported), and who created/edited it once shift-level audit fields are consistently stored.
- [ ] Decide whether the shift name field is useful enough to keep or should be removed entirely.
- [ ] Ensure deleting/unassigning shifts never causes the grid to jump unexpectedly.
- [ ] Extend copy/stretch interactions to RO and Block cards: Shift+drag should stretch/copy them across days like normal shift cards, ROs should support the same behavior if they do not already, and both RO and Block cards should support copy/paste.
- [ ] Add a quick shortcut in single-day view to unassign a selected shift back to the Shift Bay without opening the full Shift Detail dialog.
- [ ] Improve Shift Bay usability when there are many shifts: filtering, sorting, selection, and template-add flows.
- [ ] Add "Add to Template" from the Shift Detail box: open a small template picker, then add a generic version of that shift to the chosen template using the shift's day of week, role, start time, and end time.
- [ ] Rework the Shift Bay jump-to-role toolbar when sorting by role so it fits cleanly without scrollbars or crowding the bay controls; the first CSS pass did not fully fix it.
- [ ] Add an emergency-only visibility mode for selected Shift Bay shifts: keep emergency-only people out of the main bay recommendation panel, but allow a deliberate filter/toggle that highlights emergency-only options in the grid and single-day view, likely using a red treatment similar to the green clean-fit highlight.
- [ ] Rework the grid jump-to-role rail expansion so it does not cover the employee header/role section content and feels intentionally placed.
- [ ] Fine tune the single-day view rails and open-shift expand/collapse buttons for spacing, alignment, hover behavior, and visual polish.
- [x] In single-day view, when suggested staff chips for an unassigned Shift Bay row wrap to a second line, expand that specific shift row so all suggested staff remain visible instead of rendering behind the row below.
- [x] In single-day view, add app-styled rollovers on suggested employee chips showing that employee's scheduled shift count for the week, role breakdown, and number of closing shifts so managers can balance assignments without jumping back to weekly view.
- [ ] Add a subtle completion/progress celebration for the Shift Bay: when a large batch of shifts is added and the week is close to covered, animate a gold left-to-right highlight across the bay.
- [ ] Create a hotkey/help menu and review the full scheduling workflow for useful keyboard shortcuts.
- [ ] Redesign employee profiles into clear tabs/sections so availability, training, roles, pay, notes, history, and future added data stay easy to find.
- [ ] Revisit the first-pass employee profile tabs later when employee self-service profiles become part of the product.
- [ ] Fix employee profile selection/dirty-state behavior: the first employee should not always appear selected, selected/focused roster cards should update consistently, and switching employees after merely opening the tab should not trigger an unsaved-changes warning.
- [ ] Rework the overall Employees page layout later: reconsider the long side roster, improve search/selection flow, and design the profile area so employee details are easier to scan without wasted space.
- [ ] Create a stable baseline copy/version once the current workflow passes review.
- [ ] Revisit faint grid cell divider lines: decide whether to keep them, soften them, remove them for single-entry cells, or show them only on hover/active rows.
- [x] Temporarily remove shift labels from the main weekly grid: hide them on shift cards and in the far-left employee column, then revisit later if labels can be redesigned to add clear value.

## Scheduling Logic

- [ ] Add emergency-only role eligibility for employees who can fill a role but should not be recommended for it.
- [ ] Support role training by meal period, not just broad role-wide training.
- [ ] Refine lunch closer logic and warnings.
- [ ] Refine flex-shift behavior: if a flex shift is later shortened or changed so it no longer behaves like a flex, automatically clear the flex flag or ask the user whether to remove it so floor plans do not print incorrect flex markers.
- [ ] Improve clopen detection and eventually suggest rearrangements to avoid clopens.
- [ ] Rebuild Quick Training as a guided workflow that creates or links actual training shifts without marking employees fully trained too early.
- [ ] Rebuild employee suggestion scoring later using seniority, sales data, shift performance, doubles, closing ability, and learned scheduling patterns.

## Printing And Floor Plans

- [ ] Build a floor-plan designer inside Shift Bay so users can create their own floor plans instead of relying on a prebuilt hardcoded image.
- [ ] Add floor-plan section assignment tools: split sections based on the number of servers, allow quick manual adjustments, and support giving stronger servers larger or more valuable sections.
- [ ] Review floor-plan notes with real examples for double, BQT, BAR, trainer, trainee, flex, closer, and lunch closer shifts.
- [ ] Add a checkbox next to shift notes so the user can choose whether that note should print on the floor chart/floor plan.
- [ ] Keep floor-plan notes short enough to print clearly without overlap.
- [ ] Add print role order controls for compact print views.
- [ ] Confirm floor plans print in correct orientation when mixed with compact schedule pages.
- [ ] Confirm compact employee-by-role and compact employee-all-roles reports do not split employee rows across pages.
- [x] Fix Print Week so the day/week switcher rail/widget does not appear on the first printed page.
- [ ] Investigate whether Shift Bay can control or suggest default PDF filenames from print flows, such as compact schedule, print week, completed week, Ctuit entry list, and floor plans.

## Ctuit Entry Assistant

- [ ] Perfect a concise Ctuit entry list sorted in the fastest manual-entry order.
- [ ] Standardize employee names, role names, and shift times so they match Ctuit.
- [ ] Add a guided Ctuit entry mode that works shift-by-shift without posting.
- [ ] Explore browser automation for repeatable Ctuit entry steps.
- [ ] Add verification comparing Shift Bay expectations against Ctuit before anything is posted.

## Data Safety And Multi-Computer Use

- [ ] Add multi-location support starting with a fake/demo sandbox location so reviewers can test Shift Bay without touching the real restaurant schedule.
- [ ] Replace the single fixed `SHIFT_BAY_LOCATION_ID` assumption with a location list and selected-location workflow after login.
- [ ] Add a location switcher near the account menu, with clear sandbox/demo labeling when applicable.
- [ ] Scope manager access controls to the selected location so users can be owners/managers/viewers in different restaurants.
- [ ] Plan multi-unit labor sharing: allow managers in an organization to view limited staffing availability/coverage signals across locations without exposing unnecessary private data.
- [ ] Add cross-location coverage request workflow: one location can request help from another location, the other manager can approve/decline, and approved requests can be offered to eligible staff.
- [ ] Support employees trained at multiple locations, including cross-location role eligibility, availability, released shifts, open Shift Bay shifts, and approval rules.
- [ ] Add owner-only demo data tools for sandbox locations: reset demo data, generate fake schedules, and clone templates/settings safely.
- [ ] Make backup/export and last-saved status extremely visible and reassuring.
- [ ] Add account/session security behavior so closing the browser window logs the user out, or provide a clear setting for shared-office PCs where sessions should not remain signed in after close.
- [ ] Confirm shared server storage behavior across laptop and office PC.
- [ ] Plan baseline/update version folders so experimental work does not disrupt the usable scheduler.
- [ ] Eventually prepare for packaged desktop app or more formal server setup.

## Long-Term Collaboration And Concurrency

- [ ] **Priority 1: Add conflict-aware state merging.** Allow simultaneous users to save non-overlapping changes safely, while stopping and explaining conflicts when both users changed the same shift or record. Preserve the rejected browser version for recovery and require an intentional choice before replacing either version.
- [ ] **Priority 2: Move toward shift-level versioning.** Replace whole-schedule optimistic locking with per-shift revisions/history so independent edits do not conflict unnecessarily and same-shift conflicts can show who changed what. This should support future audit history, undo/review, and multi-manager collaboration.
- [ ] **Priority 3: Add owner-only reversible audit snapshots.** Let an owner review a lower-level user's change and undo that change without rolling back unrelated work.
- [ ] Treat shift-level versioning as the longer-term foundation; implement conflict-aware merging first because it fits the current schedule document architecture and provides immediate multi-user value.

## Staff Portal MVP

- [ ] Fix the false `Invalid URL` banner in the Staff Portal: authenticated staff data can load correctly while the portal still shows this error.
- [ ] Create staff account invitation/linking flow from employee profiles.
- [ ] Add staff-only portal route/UI separate from the manager scheduler.
- [ ] Build "My Schedule" for staff with upcoming shifts and location context.
- [ ] Build staff request-off submission and manager approval queue.
- [ ] Build staff availability-change submission and manager approval queue.
- [ ] Keep manager employee-profile availability and staff-portal availability feature-parity: effective dates, split windows, saved patterns, rotations, week assignments, and week-to-week mode must use the same underlying model.
- [ ] Add effective-dated availability versions to the staff portal so a future change can be submitted without changing the current scheduling week.
- [ ] Add saved staff availability patterns that can be assigned to specific schedule weeks.
- [ ] Add rotating availability patterns that repeat every X weeks, such as Week A/Week B rotations.
- [ ] Add week-to-week availability mode for staff who do not have stable recurring availability; treat them as unavailable until the target week is submitted.
- [ ] Add automated availability reminders with employee-selected channels, up to three reminders per target week, stopping once availability is submitted.
- [ ] Add manager early-schedule trigger so managers can request availability earlier than normal for a specific week.
- [ ] Build shift release and pickup workflow with manager approval before schedule changes are applied.
- [ ] Add staff shift release requests: one active request per shift, manager approval before the shift enters pickup.
- [ ] Add eligible pickup requests with hard-rule checks for training, availability, overlaps, clopens, overtime, and no-doubles.
- [ ] Add manager approval that applies an approved pickup through a server-side schedule mutation and preserves the full request history.
- [ ] Add staff request audit trail and request history.
- [ ] Add basic in-app notifications before email/SMS/push.
- [ ] Add a staff notification/inbox surface for request decisions and pickup status.
- [ ] Add location-scoped direct and manager-created group messaging shared by desktop and mobile portal clients.
- [ ] Add messaging permissions: membership checks, manager moderation, archive behavior, unread counts, and retention policy.
- [ ] Defer staff-created groups, attachments, reactions, typing indicators, presence, and push notifications until the basic messaging workflow is reliable.
- [ ] Design cross-location staff pickup rules after the single-location staff portal works.
- [ ] Replace raw availability text fields with compact start/end time controls, one visible window per day plus an add-window action. Keep day grouping obvious and allow added windows to be removed.
- [ ] Finish named availability patterns and week assignment controls using the planned pattern/assignment tables: save up to four named patterns, assign a pattern to a specific week, and configure non-overlapping weekly/biweekly/rotation schedules.
- [ ] Add schedule posting workflow: distinguish manager draft shifts from published staff-visible shifts, add a deliberate Publish Week action, preserve the published snapshot, and show staff only the latest published schedule.

## Longer-Term Product Direction

- [ ] Build an in-app tutorial for users explaining Shift Bay, templates, availability, warnings, printing, employee setup, imports, backups, and shortcuts.
- [ ] Connect event/banquet labor needs with configurable server-per-guest and bartender rules.
- [ ] Add sales projection and sales performance intelligence directly into scheduling decisions.
- [ ] Explore employee-facing mobile/browser tools for ROs, availability, shift viewing, shift trades, and coverage requests.
- [ ] Build a plan for an earned-tip/earned-wage access module: research payroll integrations, tip reporting, compliance, funding model, employee fees, employer controls, and whether to partner with an existing earned wage access provider instead of processing funds directly.
