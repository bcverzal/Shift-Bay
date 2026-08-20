# Shift Bay Design Parser First Pass

Date: 2026-08-17

This is a read-only design audit. It does not change runtime code, Supabase,
Edge Functions, Netlify, or the migration plan.

## Executive Summary

Shift Bay already has useful foundations: shared color tokens, consistent focus
states, a recognizable blue primary action, clear role colors, and deliberate
desktop/narrow-view rules. The main design risk is not lack of polish. It is
that too many controls, statuses, rails, cards, and instructional elements are
competing for attention at the same time.

The first design pass should reduce decision load before introducing more
features. The schedule grid and availability editor should be treated as the
two primary workflows. Secondary tools should progressively disclose instead of
occupying the first viewport.

## Priority 0: Protect the Migration Window

These are design observations only for now. Do not make visual changes during
the Wednesday/Thursday migration work unless a change is required to keep the
application usable. The cutover packet remains the source of truth for that
work.

## Priority 1: Reduce Decision Load

### Hick's Law and Miller's Law

The schedule view can expose sorting, templates, auto-assign, missing coverage,
clear bay, printing, focus filters, role jumping, day/week controls, issue
notifications, and multiple shift actions in the same viewport. Each control is
reasonable by itself, but together they make the next action harder to identify.

Recommended direction:

- Keep only the current workflow's primary action visible.
- Group setup and maintenance actions under one clearly labeled secondary menu.
- Keep schedule navigation, shift creation, and save state visible.
- Move diagnostics, migration badges, and advanced filters into an expandable
  status/tools area.
- Use one consistent segmented control for mutually exclusive view modes.

### Chunking and Proximity

The user often has to look across the page to connect a shift-bay card, the
single-day row, and the employee assignment controls. The availability editor
has the same issue: editing controls, saved availability cards, and activation
controls can appear in separate visual regions even though they form one
workflow.

Recommended direction:

- Put actions directly beside the object they change.
- Use a compact workflow header: `Draft`, `Save`, `Schedule`, `Review`.
- Make selected, saved, pending approval, live, and inactive states visually
  distinct before adding more explanatory text.
- Prefer one selected detail area over repeating full details in every card.

## Priority 2: Color and Contrast

### Greyscale First and Color Scale

The interface is strongly blue-heavy, while role colors, warning colors,
normalized badges, sandbox badges, and active states add many competing accents.
Blue currently communicates brand, selection, primary actions, and sometimes
status. That weakens meaning.

Recommended direction:

- Reserve blue for selection and primary actions.
- Use green only for confirmed/live/saved states.
- Use amber for pending or needs review.
- Use red for blocked, destructive, or failed states.
- Keep role colors as secondary markers, never the only source of meaning.
- Audit light text on pale blue cards and inactive availability cards with a
  contrast checker before any redesign is released.

### Color Blindness and Color Naming

Role dots and availability states should always have a text, shape, or pattern
cue. A tooltip is helpful, but the state should remain understandable in a
static screenshot or printout.

## Priority 2: Typography and Hierarchy

The codebase uses many bold weights and all-caps labels for headings, roles,
badges, and controls. This gives the product energy, but reduces hierarchy:
important warnings and ordinary labels can look equally urgent.

Recommended direction:

- Establish three levels: page heading, workflow heading, supporting label.
- Keep all-caps for short status labels only.
- Use weight before color for hierarchy; use color for state.
- Give compact cards a minimum readable text size rather than shrinking text to
  force long availability times into a single line.
- Keep time values readable and allow controlled wrapping on narrow cards.

## Priority 2: Layout, Spacing, and Rails

The schedule is a dense, fixed-format tool, so stable dimensions matter more
than decorative flexibility. Previous rail and shift-bay changes showed that
layout movement is costly: when a control moves, the user can lose the object
they were trying to edit.

Recommended direction:

- Treat the left rail as a fixed coordinate system with reserved space.
- Do not move the grid or shift bay when a card is selected.
- Use a consistent spacing scale based on 4px/8px increments.
- Reserve a stable header band for the shift bay and workflow status.
- In narrow view, prioritize the schedule rows and allow intentional horizontal
  scrolling rather than squeezing every desktop control into the viewport.
- Keep availability day cards in an even visual structure; do not let the odd
  number of days create a large empty region.

## Priority 2: Buttons and Interaction

The global button treatment is consistently pill-shaped, which creates a
problem: navigation, filters, destructive actions, saved-state actions, and
primary commands can look interchangeable.

Recommended direction:

- Primary action: filled button, one per workflow region.
- Secondary action: quiet outlined button.
- Destructive action: text or outlined red button with confirmation.
- View/filter mode: segmented control.
- Icon-only action: familiar icon plus tooltip and accessible label.
- Keep button labels short; put explanation in tooltips or nearby supporting
  text.
- Keep touch targets at least 40px where practical, including narrow view.

## Priority 3: Tooltips and Feedback

The current grid tooltips can be clipped or overlap neighboring content because
they are tied to dense rows and local positioning. This has already affected
eligible-staff explanations and employee hover cards.

Recommended direction:

- Render important tooltips in a fixed overlay layer near the viewport edge.
- Clamp tooltip position so it never leaves the window or covers the control
  that triggered it.
- Keep tooltip copy to one fact: role, status, or consequence.
- Use persistent inline feedback for save, stale, pending approval, and
  rejected states; do not rely on hover for critical information.

## Priority 3: Motion and State Changes

Animated movement of the shift bay, rail widgets, or selected shifts can make
an item appear to disappear even when it merely moved. For scheduling software,
spatial stability is more valuable than decorative motion.

Recommended direction:

- Animate opacity or a small highlight, not the position of the working grid.
- Keep selection in place when possible.
- If a view must reposition to an item, show a brief anchored explanation and
  preserve a visible return path.
- Respect reduced-motion preferences.

## Priority 3: Print and Static Output

Printouts should contain schedule content only. UI rails, view switchers, badges,
and browser-only controls must remain excluded. Compact schedules and floor
plans need independent print contracts for margins, clipping, contrast, and
three-hole-punch space.

## Recommended Order After Cutover

1. Contrast and semantic color pass.
2. Schedule command grouping and stable rail layout.
3. Availability editor hierarchy and state labeling.
4. Tooltip overlay and hover-card collision handling.
5. Narrow-view interaction model.
6. Typography and spacing refinement.
7. Print regression pass.

## Repeatable Review Questions

- Can a first-time user identify the next action within five seconds?
- Does every color-coded state have a non-color cue?
- Does selecting or saving an item move unrelated content?
- Can the user tell whether an action is draft, saved, pending, live, or failed?
- Do tooltips remain readable at the edge of the viewport and on two-line rows?
- Does narrow view preserve the primary task without pretending to be a full
  mobile authoring experience?
- Does printing exclude every on-screen control and preserve required margins?

