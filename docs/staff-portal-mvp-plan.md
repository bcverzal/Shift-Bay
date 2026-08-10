# Shift Bay Staff Portal MVP Plan

## Goal

Build the smallest staff-facing product that makes Shift Bay marketable outside one restaurant:

- Staff can log in.
- Staff can see their own schedule.
- Staff can submit request-offs.
- Staff can submit availability changes.
- Staff can release a shift or request a swap.
- Managers approve or deny requests.
- Approved changes update the manager schedule workflow without bypassing manager control.

This should start as a mobile-friendly web portal, not a native app. A native app can come later if adoption proves the need.

## Product Boundary

The staff portal should be separate from the manager scheduler UI. Staff should never see the full manager grid, all employee notes, pay rates, staffing warnings, or private manager data.

Staff should see:

- Their upcoming shifts.
- Their own availability.
- Their own request-off history.
- Shifts they are allowed to release, swap, or pick up.
- Request status: pending, approved, denied, cancelled.
- Basic location information if they work at more than one location.

Managers should see:

- Approval queue.
- Request details.
- Conflicts created by approving the request.
- Suggested replacement options.
- Audit trail of who approved/denied each request.

## MVP Screens

### Staff

Foundation route:

- `/staff.html` is the first staff-facing entry point.
- Staff authentication must not require manager access.
- A staff login links to an employee through `staff_accounts`.
- During the JSON-state transition, `staff_accounts.legacy_employee_id` points to the employee id stored inside the scheduler state document.
- Later, once employees are normalized into tables, `staff_accounts.employee_id` can become the primary link.

1. Login
2. My Schedule
3. Request Off
4. My Availability
5. Shift Trade / Release
6. Available Pickup Shifts
7. Request History

### Manager

1. Staff Requests Queue
2. Request Detail / Approval
3. Open Coverage Queue
4. Staff Account Linker
5. Notification Settings

## Request Types

### Request Off

Staff submits:

- Date or date range
- All day or time range
- Reason/note
- Optional urgency/category later

Manager approves/denies. Approved request creates or updates the manager-facing RO record.

### Availability Change

Staff submits:

- Effective week/date
- Weekly recurring availability or one-week override
- Saved weekly availability patterns
- Repeating availability rotations every X weeks
- Week-to-week availability mode for staff whose availability changes constantly
- Notes

Manager approves/denies. Approved request updates employee availability rules or weekly overrides.

### Availability Patterns And Rotation

Staff should be able to save reusable availability patterns rather than rebuilding the same week repeatedly.

Examples:

- "School Week"
- "Summer Week"
- "Every Other Weekend"
- "Open AM / Closed PM"
- "Can Work PM Only"
- "Week A" and "Week B" rotation

Each pattern should store seven days of availability windows, including multiple availability windows per day. A staff member can then assign a pattern to a specific schedule week.

Supported modes:

- Standard recurring weekly availability.
- Specific saved pattern assigned to one week.
- Repeating rotation every X weeks.
- Week-to-week submission required.

Repeating rotations should allow:

- Rotation name
- Start week
- Repeat interval, such as every 2 weeks or every 3 weeks
- Pattern sequence, such as Week A, Week B, then repeat
- End date optional

The manager scheduling view should always resolve these into the actual availability for the selected week, so the manager does not need to understand the staff member's underlying rotation setup while building a schedule.

### Week-To-Week Availability Mode

Some staff do not have stable recurring availability. These employees should be able to choose, or managers should be able to mark them as, "submits availability weekly."

In this mode:

- The employee is treated as unavailable by default for any week they have not submitted.
- The employee receives reminders to submit availability for the target schedule week.
- Once submitted, reminders stop for that week.
- Managers can still manually enter availability on behalf of the employee if needed.
- The staff portal should clearly show which weeks still need availability.

This replaces the current manual "call weekly for availability" workflow over time.

### Availability Reminder Workflow

Staff should choose preferred notification channels:

- In-app
- Email
- SMS later

For week-to-week staff, Shift Bay should send up to three reminders per target schedule week:

1. First reminder when the manager opens or starts planning the target week, based on location settings.
2. Second reminder if no availability is submitted after a configured delay.
3. Final reminder before the manager's schedule-building deadline.

Reminders stop immediately once the employee submits availability for that week.

Managers also need an early-schedule override. If a manager is writing a schedule earlier than normal because of vacation, holidays, or operational needs, they should be able to trigger an early availability request for a specific week. That message should tell staff the exact week needed and the earlier deadline.

Manager controls needed:

- Default weekly availability deadline.
- Reminder timing.
- Maximum reminders, capped at 3 for now.
- Message preview.
- Manual send early availability request for selected week.
- Dashboard showing who has not submitted yet.

Auditability matters. Shift Bay should record:

- When reminders were sent.
- Which channel was used.
- Whether delivery failed when known.
- When the employee submitted availability.
- Whether a manager manually entered it instead.

This helps protect managers from "I forgot" or "I didn't know" conversations by showing that the system asked for the information.

### Shift Release

Staff asks to give up a scheduled shift.

Possible statuses:

- Pending manager review
- Approved for pickup board
- Claimed by another employee
- Manager approved claim
- Completed
- Cancelled

Manager should control whether a released shift becomes visible to other staff.

### Shift Swap

Staff proposes a specific swap with another employee.

MVP can delay true two-person swaps if needed. A simpler first version is:

1. Employee releases shift.
2. Other eligible staff request pickup.
3. Manager approves pickup.

This avoids complicated simultaneous swap consent.

### Pickup Open Shift

Staff can request an open shift if:

- It belongs to their location or an allowed cross-location pool.
- They are trained/eligible for the role.
- It does not violate hard rules.
- Manager approval is still required.

## Approval Rules

Manager approval should be required for every schedule-changing action in the MVP.

Approving a request should:

- Run the same warning engine the manager grid uses.
- Show warnings before approval.
- Record who approved it.
- Record the timestamp.
- Add an audit event.
- Update the schedule document/state.

Denied requests should remain visible in request history.

## Notifications

MVP notification order:

1. In-app notification/queue only.
2. Email notification.
3. SMS or push notification later.

Do not start with push notifications. They increase complexity and may require app-store/native-app decisions.

## Permissions

Suggested access roles:

- Owner: all locations and manager controls.
- Manager: manager controls for assigned locations.
- Viewer: view/print only.
- Staff: staff portal only.

Staff accounts should map to employee profiles.

Important: a staff login should not automatically grant manager app access.

## Database Concepts

The current app still stores the working scheduler data in `scheduler_state_documents`. Staff portal records can be normalized earlier because requests need auditability and workflow status.

Core future tables:

- staff_accounts
- staff_location_access
- staff_availability_patterns
- staff_availability_pattern_days
- staff_availability_week_assignments
- staff_availability_reminders
- staff_request_off_requests
- staff_availability_requests
- staff_shift_release_requests
- staff_shift_pickup_requests
- staff_request_events
- staff_notifications

The manager scheduler can continue using the JSON schedule document at first, while staff requests live in structured tables and are applied into the schedule after manager approval.

## Data Flow

### Request Off

1. Staff submits RO request.
2. Request is stored as pending.
3. Manager sees it in approval queue.
4. Manager approves.
5. Shift Bay creates the RO in schedule state.
6. Audit event is written.
7. Staff sees approved status.

### Shift Release

1. Staff selects one of their shifts and requests release.
2. Manager approves release to pickup board.
3. Eligible staff see it as available.
4. Staff requests pickup.
5. Manager approves pickup.
6. Shift employee assignment changes.
7. Audit event is written.

## UX Principles

- Staff portal must be phone-first.
- The manager remains in control.
- Staff should never need to understand the full Shift Bay scheduler.
- Every request needs a clear status.
- Every manager action needs a clear audit trail.
- The system should reduce texts/calls, not create a second confusing inbox.

## Build Sequence

### Step 1: Staff Account Foundation

- Add staff role type.
- Link Supabase auth users to employee records.
- [x] Add staff-only login flow or portal route.
- [x] Ensure staff cannot access manager scheduler.

### Step 2: My Schedule

- [x] Show the selected schedule week for a linked employee.
- [x] Include role, date, and start/end time without exposing manager-only notes.
- [ ] Include a location label in the staff header.

### Step 3: Request Off Submission

- Add staff RO form.
- Store pending requests.
- Add manager approval queue.
- Approved request creates an RO in the scheduler.

### Step 4: Availability Submission

- Add staff availability request form.
- Add manager approval.
- Approved request updates employee availability.

### Step 5: Shift Release And Pickup

- Allow staff to request release.
- Allow manager-approved releases to appear on pickup board.
- Allow eligible staff pickup request.
- Add manager final approval.

### Step 6: Notifications

- In-app status first.
- Email later.
- Push/SMS later.

## Questions To Answer Before Building UI

- Should staff accounts be invited by email from the employee profile?
- Can staff edit phone/email themselves?
- Should managers approve every availability change, or only changes inside a locked/posting window?
- Should request-offs have a cutoff date?
- Should staff see open Shift Bay shifts before the manager releases them?
- Should pickup requests be first come first served or manager-selected?
- How should cross-location pickup work when the employee's home manager and borrowing manager both need approval?

## Marketability

This is the line that turns Shift Bay from an internal scheduling builder into a sellable restaurant product. A manager-only scheduler can be useful, but restaurants expect staff-facing request-off and shift-trade workflows from modern scheduling software.

The MVP does not need every advanced staff feature. It needs enough that a restaurant can stop relying on texts, handwritten notes, and side conversations for request-offs and shift coverage.
