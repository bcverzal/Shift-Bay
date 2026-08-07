-- Employee/profile migration bridge.
-- Run after supabase/schema.sql and before deploying the matching Edge Function.
-- This is additive and safe to run more than once.

-- The profile save bridge upserts by the legacy employee id while the app is
-- still using the existing JSON document as its compatibility read source.
create unique index if not exists employees_location_legacy_unique
  on public.employees (location_id, legacy_id);

-- Availability windows are ordered within a day when an employee has a split
-- availability (for example, 7 AM-3 PM and 5 PM-midnight).
alter table public.availability_rules
  add column if not exists sort_order integer not null default 0;

create index if not exists availability_rules_employee_day_idx
  on public.availability_rules (employee_id, day_index, sort_order);

-- Keep this new table protected like the other normalized tables. The service
-- role used by shift-bay-api bypasses RLS; client access remains restricted.
alter table public.employee_profile_overrides enable row level security;

