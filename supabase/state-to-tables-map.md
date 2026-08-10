# Current State To Supabase Table Map

This map keeps the migration honest. The first Supabase pass can store the full app state in `scheduler_state_documents`, but these are the target normalized homes for each part of the current JSON state.

## Top-Level State

| Current state field | Target table(s) | Notes |
| --- | --- | --- |
| `meta` | `scheduler_state_documents`, `audit_events` | Keep schema/document/device timestamps during transition. |
| `settings` | `app_settings`, specialized settings tables | Some settings should later become user preferences instead of location settings. |
| `roles` | `roles` | Preserve current `id` in `legacy_id` during migration. |
| `employees` | `employees`, `employee_roles`, `employee_pay_rates`, `availability_rules` | Employee profile is the biggest table split. |
| `templates` | `templates`, `template_shifts` | Weekly templates and saved shifts normalize cleanly. |
| `shifts` | `schedule_weeks`, `shifts`, `shift_training_links` | Assigned shifts need `schedule_week_id` plus `employee_id`. |
| `unassignedShifts` | `shifts` with `is_open_bay = true` | Open Shift Bay shifts are still shifts; they just have no employee. |
| `salesProjections` | `sales_projections` | Keyed by date and meal name. |
| `timeOffRequests` | `request_offs` | Include source fingerprint to prevent duplicate imports. |
| `scheduleBlocks` | `schedule_blocks` | Blocks are RO-like schedule constraints for events/training/off-site work. |
| `coverageRequirements` | `coverage_requirements` | Some rows will be default/day-index, some date-specific. |
| `scheduleHistory` | future `historical_shifts` or import tables | Keep out of first cloud pass unless needed. |
| `localPreferences` | browser local storage or user settings | Many of these should not be shared between machines. |

## Employee Object

| Current employee field | Target | Notes |
| --- | --- | --- |
| `id` | `employees.legacy_id` | Supabase `id` should be UUID. |
| `firstName`, `lastName`, `nickname` | `employees` | Nickname replaces first name only in display logic. |
| `phone` | `employees.phone` | Sensitive enough to require real auth before cloud use. |
| `birthday` | `employees.birthday` | Needed for minor labor rules. |
| `departments` | `employees.departments` | Array is acceptable for now. |
| `roles` / role capability data | `employee_roles` | Include trained/training/emergency-only and meal-specific qualifications. |
| `availability` | `availability_rules` | Weekly pattern availability. |
| `weeklyAvailability` | `weekly_availability_overrides` | Specific week overrides for call-weekly employees. |
| pay rates | `employee_pay_rates` | Manual override per employee/role. |
| `active`, `archived` | `employees` | New employees should default active. |
| `callWeeklyAvailability` | `employees.call_weekly_availability` | Later useful for manager task list. |
| closer/lunch closer flags | `employees.trained_closer`, `employees.lunch_closer` | Lunch closer is availability/workflow, not training. |

## Shift Object

| Current shift field | Target | Notes |
| --- | --- | --- |
| `id` | `shifts.legacy_id` | Supabase `id` should be UUID. |
| `employeeId` | `shifts.employee_id` | Null for open bay shifts. |
| `date` | `shifts.shift_date`, `schedule_weeks.week_start` | Week can be derived but should be stored for querying. |
| `department` | `shifts.department` | Keep check constraint. |
| `roleId` | `shifts.role_id` | Map legacy role ID to UUID. |
| `name` / `shiftName` | `shifts.shift_name` | We still need a product decision on this field. |
| `start`, `end` | `shifts.start_time`, `shifts.end_time` | Use null when all-day block has no time. |
| `untilVolume` | `shifts.until_volume` | Currently mostly hidden, but still supported. |
| `isCloser` | `shifts.is_closer` | End-time defaults depend on meal periods/settings. |
| `isLunchCloser` | `shifts.is_lunch_closer` | Must print end time on floor plans. |
| `isFlexDouble` | `shifts.is_flex_double` | Must print on PM floor plans and affect coverage. |
| `training` | `shift_training_links` | Trainer/trainee pair plus optional segment times. |
| `notes` | `shifts.notes` | Print rules decide whether notes fit. |
| color | `shifts.color` | Role color fallback remains in UI. |

## Template Shift Object

Template shifts mirror shift fields except they use:

- `template_id`
- `day_index`
- no employee
- no concrete date

Duplicate template shifts are valid. Deduping must count matching rows rather than eliminating all identical rows.

## Settings Split

Shared location settings:

- week start
- meal periods
- default coverage
- closer requirements
- floor plan print rules
- floor plan role-note toggles
- role order defaults
- print role order
- template definitions

User/local preferences:

- active week last viewed
- collapsed/expanded panels
- zoom
- hidden unavailable panel
- dismissed warning notifications

The migration should avoid syncing purely personal screen-layout state unless we intentionally decide otherwise.
