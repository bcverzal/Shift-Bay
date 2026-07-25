# Staff Portal Next Phase

This document defines the next additive layer for the staff portal. It is intentionally separate from the current request-off and availability MVP so the live workflow stays stable while the release, pickup, and messaging features are reviewed.

## Current Foundation

- Staff-only authentication and employee linking are in place.
- Staff can view their schedule, submit request-offs, submit weekly availability, update visible contact information, and choose phone visibility.
- Managers can review request-offs and availability submissions.
- Structured request and audit tables are drafted in `supabase/staff-portal-schema-plan.sql`.

## Phase 1: Release And Pickup

The first release should be a manager-controlled handoff, not an automatic schedule edit.

1. A staff member selects one of their assigned shifts and submits a release request.
2. The manager reviews the request and approves or denies publishing it.
3. If approved, the shift appears on a location-scoped pickup board without changing its assigned employee yet.
4. Eligible staff request pickup. Eligibility is checked against role training, availability, request-offs, overlapping work, clopen rules, overtime, and no-doubles settings.
5. The manager chooses a pickup request and approves it.
6. The schedule state changes once, in a server-side transaction-like operation, and the original assignment, release, claim, and approval remain in the event history.

### Guardrails

- Never allow more than one active release request for the same shift.
- Never allow a pickup request after a manager has closed or cancelled the release.
- Do not expose manager notes, pay data, or other staff members' private information on the pickup board.
- Keep the original employee visible in audit history even after a pickup is approved.
- Defer true two-person swaps until release/pickup is stable. A direct swap adds simultaneous approval and rollback complexity.

## Phase 2: In-App Messaging

Messaging should use the same backend for desktop and mobile. Mobile is a responsive client, not a separate messaging system.

### Initial scope

- Direct message between staff and a manager.
- Location-scoped group chats.
- Manager-created operational groups, such as `Servers`, `Bar`, or `Weekend Leads`.
- Staff can create a group only if the location setting allows it; otherwise they can request one from a manager.
- Members can read and send messages only while they are members of that location-scoped group.
- Managers can archive a group and moderate messages; archived groups remain readable for audit purposes.
- Unread counts and read timestamps are enough for the first pass. Presence, typing indicators, reactions, attachments, and push notifications can wait.

### Privacy and permissions

- Every group and message is keyed to a location.
- A staff member can only discover groups they belong to.
- Managers can see groups in their assigned locations, subject to the final permission model.
- Owners can manage group membership and retention settings.
- Do not use the messaging tables as a substitute for audit events. Schedule-changing actions still write request events and audit records.

### Suggested build order

1. Add a read-only notification/inbox surface to the staff portal.
2. Add direct manager-to-staff messages for request status and pickup decisions.
3. Add manager-created group chats.
4. Add staff-created groups behind a location setting.
5. Add email/push notifications only after in-app delivery and read state are reliable.

## Data Boundary

The draft migration in `supabase/staff-portal-social-and-shift-workflow-plan.sql` is not applied. It is a review artifact. The existing scheduler document remains the source of truth for shifts until a server-side release/pickup operation is implemented and tested.

## Open Decisions

- Should a released shift stay on the manager's pickup board until the manager closes it, or expire automatically at a configured cutoff?
- Should managers choose a pickup request, or should the first eligible request win after approval?
- Can staff message one another directly, or only through manager-created groups at first?
- What message retention period is appropriate for a restaurant location?
- Should a location allow staff-created groups at all?
