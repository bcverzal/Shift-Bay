# Employee Data Coverage Plan

This is the field-level bridge plan for moving employee information out of the scheduler snapshot while preserving the existing live scheduling workflow.

## Audit Basis

- Source baseline: `data/backups/cloud-baselines/production-baseline-20260803185136.json`
- Employees audited: 77
- Snapshot remains the production compatibility source until a normalized read path is verified in Sandbox.

## Ready To Mirror

The Sandbox migration helper already covers these fields:

- Employee identity, contact data, active/archived status, departments, closer flags, weekly-call flag, and manager note.
- Roles plus per-role training, trainer capability, emergency-only status, and meal qualifications.
- Default weekly availability windows.

## Explicit Follow-Up Mappings

| Snapshot data | Normalized destination | Transition decision |
| --- | --- | --- |
| `payRates` | `employee_pay_rates` | Add to the employee mirror after roles are populated. |
| `noDoubles` | `employees.no_doubles` | Additive employee preference column. |
| `alwaysPrintFloorEndTime` | `employees.always_print_floor_end_time` | Additive employee preference column. |
| `mealTraining` | `employee_meal_qualifications` | Preserve general meal qualification separately from role-specific meal qualifications. |
| `weeklyRules` | `employee_work_rules` | One row per rule, retaining weekday selection, maximum days, note, and sort order. |
| `weeklyAvailability` | `weekly_availability_overrides` | Mirror once employee identity migration is proven. |
| `availabilityPatterns` | `staff_availability_patterns` and windows | Saved, inactive employee availability definitions. |
| `availabilitySchedule` | `staff_availability_week_assignments` | Effective dated repeating or one-week availability selections. |
| `availabilitySubmissions` | approval request/event bridge | Keep staff submission history and manager approval state. |

## Availability Canonical Model

The correct future model has three separate concerns:

1. A saved availability is just a named set of day/time windows.
2. An assignment says which saved availability applies starting a particular work week, with a repeat interval.
3. A submission/approval record explains who proposed or approved that assignment.

`staff-portal-schema-plan.sql` contains the saved-pattern and week-assignment tables. The older `staff-workflow-mvp.sql` submission table should be treated as a compatibility/audit bridge rather than a second source of truth for live availability.

## Intentionally Snapshot-Only For Now

- `localPreferences` is device-specific UI state and should not become shared location data.
- `priority` has no current user-facing scheduling behavior. Preserve it in the snapshot until the future recommendation-priority feature has a defined product rule.
- `requestOffImportLog` will move with the request-off import audit work in Phase 2.

## Before Any Sandbox Write

1. Run the required additive schema migrations in the manifest order.
2. Export a fresh Sandbox snapshot.
3. Run the normalized employee migration helper in dry-run mode.
4. Run it only with its explicit Sandbox confirmation flag.
5. Compare snapshot counts and window counts after writing.
6. Do not enable normalized reads until the comparison is clean for owner, manager, and staff access.
