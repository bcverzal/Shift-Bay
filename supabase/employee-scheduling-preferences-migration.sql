-- Additive employee preference and work-rule schema.
-- Run only after schema.sql and employee-normalization-migration.sql.
-- This is safe to prepare now; do not run it in production before Sandbox
-- comparison and application read/write support are in place.

alter table public.employees
  add column if not exists no_doubles boolean not null default false,
  add column if not exists always_print_floor_end_time boolean not null default false;

create table if not exists public.employee_meal_qualifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  meal_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, meal_name)
);

create table if not exists public.employee_work_rules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  legacy_rule_index integer not null default 0,
  applies_to_days integer[] not null default '{}',
  max_worked_days integer not null default 0 check (max_worked_days >= 0 and max_worked_days <= 7),
  note text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, legacy_rule_index),
  check (coalesce(array_length(applies_to_days, 1), 0) <= 7),
  check (applies_to_days <@ array[0, 1, 2, 3, 4, 5, 6])
);

create index if not exists employee_work_rules_employee_idx
  on public.employee_work_rules (employee_id, active);
