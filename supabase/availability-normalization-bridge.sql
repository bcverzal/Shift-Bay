-- Availability normalization bridge.
--
-- Run in the Supabase SQL editor after staff-portal-schema-plan.sql and
-- staff-workflow-mvp.sql. This is additive: the current JSON scheduler
-- snapshot and compatibility submissions remain usable until verified reads
-- are deliberately enabled.
--
-- Canonical model after this migration:
--   staff_availability_patterns          saved named availability profiles
--   staff_availability_pattern_windows   time windows inside a profile
--   staff_availability_week_assignments  effective date, repeat, approval
--
-- Existing pattern repeat/active columns are retained for compatibility only.
-- New bridge writes do not use them as the source of truth.

alter table public.staff_availability_patterns
  add column if not exists legacy_id text,
  add column if not exists source text not null default 'staff_portal',
  add column if not exists archived boolean not null default false,
  add column if not exists deleted_at timestamptz;

create unique index if not exists staff_availability_patterns_location_legacy_idx
  on public.staff_availability_patterns (location_id, legacy_id)
  where legacy_id is not null and legacy_id <> '';

create index if not exists staff_availability_patterns_employee_active_idx
  on public.staff_availability_patterns (employee_id, archived, updated_at desc);

alter table public.staff_availability_week_assignments
  add column if not exists legacy_id text,
  add column if not exists effective_date date,
  add column if not exists repeat_interval_weeks integer,
  add column if not exists source text not null default 'staff_portal',
  add column if not exists cancelled_at timestamptz,
  add column if not exists legacy_submission_id uuid references public.staff_availability_submissions(id) on delete set null;

-- A recurring rotation can intentionally have multiple assignments beginning
-- on the same week, so the original one-assignment-per-week constraint is too
-- restrictive for the canonical assignment model.
alter table public.staff_availability_week_assignments
  drop constraint if exists staff_availability_week_assignments_employee_id_week_start_key;

update public.staff_availability_week_assignments
set effective_date = coalesce(effective_date, week_start),
    repeat_interval_weeks = coalesce(repeat_interval_weeks, 1)
where effective_date is null or repeat_interval_weeks is null;

alter table public.staff_availability_week_assignments
  alter column effective_date set not null,
  alter column repeat_interval_weeks set not null;

alter table public.staff_availability_week_assignments
  drop constraint if exists staff_availability_week_assignments_repeat_interval_weeks_check;

alter table public.staff_availability_week_assignments
  add constraint staff_availability_week_assignments_repeat_interval_weeks_check
  check (repeat_interval_weeks between 1 and 4);

alter table public.staff_availability_week_assignments
  drop constraint if exists staff_availability_week_assignments_status_check;

alter table public.staff_availability_week_assignments
  add constraint staff_availability_week_assignments_status_check
  check (status in ('draft', 'submitted', 'pending', 'approved', 'active', 'rejected', 'denied', 'cancelled', 'manager_entered', 'superseded'));

create unique index if not exists staff_availability_assignments_location_legacy_idx
  on public.staff_availability_week_assignments (location_id, legacy_id)
  where legacy_id is not null and legacy_id <> '';

create unique index if not exists staff_availability_assignments_submission_idx
  on public.staff_availability_week_assignments (legacy_submission_id)
  where legacy_submission_id is not null;

create index if not exists staff_availability_assignments_employee_effective_idx
  on public.staff_availability_week_assignments (employee_id, effective_date, status);

create index if not exists staff_availability_assignments_location_status_idx
  on public.staff_availability_week_assignments (location_id, status, effective_date);

comment on column public.staff_availability_patterns.repeat_interval_weeks is
  'Legacy compatibility only. New availability repeat behavior belongs to staff_availability_week_assignments.';
comment on column public.staff_availability_patterns.active is
  'Legacy compatibility only. New scheduling state belongs to staff_availability_week_assignments.';
comment on column public.staff_availability_week_assignments.week_start is
  'Compatibility alias for the assignment effective schedule week. New code should read effective_date.';
