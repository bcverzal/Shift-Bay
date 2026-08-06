-- Bring the live staff availability workflow constraint in line with the
-- portal and review API. Run once after staff-workflow-mvp.sql.
alter table if exists public.staff_availability_submissions
  drop constraint if exists staff_availability_submissions_status_check;

alter table if exists public.staff_availability_submissions
  add constraint staff_availability_submissions_status_check
  check (status in ('submitted', 'pending', 'approved', 'denied', 'cancelled', 'reviewed'));
