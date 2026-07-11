# Shift Bay To-Do

## Current Priority

- [ ] Make RO import trustworthy for weekly use: accurate parsing, duplicate prevention, clear import confirmation, and an import summary.
- [ ] Verify compact schedules, floor plans, print completed week, and grid print output against real PDF/printer previews.
- [ ] Polish the template workflow so templates are easy to scan, edit, delete from, and add missing shifts from without confusion.
- [ ] Continue refining single-day view until it is genuinely useful for building one day at a time.
- [ ] Refine single-day Shift Bay date switching: when a selected bay shift is for another day, jump to that day first without expanding the bay or selecting/highlighting the shift until the user clicks it again.
- [ ] Confirm drag/drop, copy/paste, shift-drag copy, and bay-to-grid assignment all behave predictably.

## Core Workflow Polish

- [ ] Make warning notifications fully reliable: next/previous arrows, Show, dismiss, restore dismissed warnings, and shortcut-to-fix.
- [ ] Continue redesigning Shift Detail so it is shorter, wider, easier to scan, and less error-prone.
- [ ] Decide whether the shift name field is useful enough to keep or should be removed entirely.
- [ ] Ensure deleting/unassigning shifts never causes the grid to jump unexpectedly.
- [ ] Extend copy/stretch interactions to RO and Block cards: Shift+drag should stretch/copy them across days like normal shift cards, ROs should support the same behavior if they do not already, and both RO and Block cards should support copy/paste.
- [ ] Improve Shift Bay usability when there are many shifts: filtering, sorting, selection, and template-add flows.
- [ ] Rework the Shift Bay jump-to-role toolbar when sorting by role so it fits cleanly without scrollbars or crowding the bay controls; the first CSS pass did not fully fix it.
- [ ] Add an emergency-only visibility mode for selected Shift Bay shifts: keep emergency-only people out of the main bay recommendation panel, but allow a deliberate filter/toggle that highlights emergency-only options in the grid and single-day view, likely using a red treatment similar to the green clean-fit highlight.
- [ ] Rework the grid jump-to-role rail expansion so it does not cover the employee header/role section content and feels intentionally placed.
- [ ] Add a subtle completion/progress celebration for the Shift Bay: when a large batch of shifts is added and the week is close to covered, animate a gold left-to-right highlight across the bay.
- [ ] Create a hotkey/help menu and review the full scheduling workflow for useful keyboard shortcuts.
- [ ] Redesign employee profiles into clear tabs/sections so availability, training, roles, pay, notes, history, and future added data stay easy to find.
- [ ] Rework the overall Employees page layout later: reconsider the long side roster, improve search/selection flow, and design the profile area so employee details are easier to scan without wasted space.
- [ ] Create a stable baseline copy/version once the current workflow passes review.
- [ ] Revisit faint grid cell divider lines: decide whether to keep them, soften them, remove them for single-entry cells, or show them only on hover/active rows.

## Scheduling Logic

- [ ] Add emergency-only role eligibility for employees who can fill a role but should not be recommended for it.
- [ ] Support role training by meal period, not just broad role-wide training.
- [ ] Refine lunch closer logic and warnings.
- [ ] Improve clopen detection and eventually suggest rearrangements to avoid clopens.
- [ ] Rebuild Quick Training as a guided workflow that creates or links actual training shifts without marking employees fully trained too early.
- [ ] Rebuild employee suggestion scoring later using seniority, sales data, shift performance, doubles, closing ability, and learned scheduling patterns.

## Printing And Floor Plans

- [ ] Review floor-plan notes with real examples for double, BQT, BAR, trainer, trainee, flex, closer, and lunch closer shifts.
- [ ] Keep floor-plan notes short enough to print clearly without overlap.
- [ ] Add print role order controls for compact print views.
- [ ] Confirm floor plans print in correct orientation when mixed with compact schedule pages.
- [ ] Confirm compact employee-by-role and compact employee-all-roles reports do not split employee rows across pages.

## Ctuit Entry Assistant

- [ ] Perfect a concise Ctuit entry list sorted in the fastest manual-entry order.
- [ ] Standardize employee names, role names, and shift times so they match Ctuit.
- [ ] Add a guided Ctuit entry mode that works shift-by-shift without posting.
- [ ] Explore browser automation for repeatable Ctuit entry steps.
- [ ] Add verification comparing Shift Bay expectations against Ctuit before anything is posted.

## Data Safety And Multi-Computer Use

- [ ] Make backup/export and last-saved status extremely visible and reassuring.
- [ ] Confirm shared server storage behavior across laptop and office PC.
- [ ] Plan baseline/update version folders so experimental work does not disrupt the usable scheduler.
- [ ] Eventually prepare for packaged desktop app or more formal server setup.

## Longer-Term Product Direction

- [ ] Build an in-app tutorial for users explaining Shift Bay, templates, availability, warnings, printing, employee setup, imports, backups, and shortcuts.
- [ ] Connect event/banquet labor needs with configurable server-per-guest and bartender rules.
- [ ] Add sales projection and sales performance intelligence directly into scheduling decisions.
- [ ] Explore employee-facing mobile/browser tools for ROs, availability, shift viewing, shift trades, and coverage requests.
