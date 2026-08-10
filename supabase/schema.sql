-- Shift Bay Supabase schema draft
-- Version: 2026-07-03
--
-- This schema is intentionally normalized around the app concepts while still
-- allowing the current JSON state document to be stored during the transition.

create extension if not exists "pgcrypto";

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.location_users (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'viewer')),
  created_at timestamptz not null default now(),
  unique(location_id, user_id)
);

-- Transition table. This lets Shift Bay move to shared cloud storage before
-- every individual screen has been fully rewritten around normalized tables.
create table if not exists public.scheduler_state_documents (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  document_key text not null default 'primary',
  schema_version integer not null default 1,
  state jsonb not null,
  saved_by uuid references auth.users(id),
  saved_by_device_id text,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id, document_key)
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  legacy_id text,
  name text not null,
  department text not null check (department in ('FOH', 'BOH', 'Exec')),
  color text not null default '#64748b',
  default_rate numeric(8,2) not null default 0,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id, name)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  legacy_id text,
  first_name text not null,
  last_name text not null default '',
  nickname text not null default '',
  phone text not null default '',
  birthday date,
  departments text[] not null default array['FOH']::text[],
  active boolean not null default true,
  archived boolean not null default false,
  call_weekly_availability boolean not null default false,
  trained_closer boolean not null default false,
  lunch_closer boolean not null default false,
  scheduling_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_roles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  trained boolean not null default false,
  training boolean not null default false,
  emergency_only boolean not null default false,
  meal_names text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, role_id)
);

create table if not exists public.employee_pay_rates (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  use_manual_rate boolean not null default false,
  hourly_rate numeric(8,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, role_id)
);

create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  day_index integer not null check (day_index between 0 and 6),
  start_time time,
  end_time time,
  available boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.weekly_availability_overrides (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  week_start date not null,
  day_index integer not null check (day_index between 0 and 6),
  start_time time,
  end_time time,
  available boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_weeks (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  week_start date not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'posted', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id, week_start)
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  schedule_week_id uuid references public.schedule_weeks(id) on delete cascade,
  legacy_id text,
  employee_id uuid references public.employees(id) on delete set null,
  role_id uuid references public.roles(id) on delete restrict,
  department text not null check (department in ('FOH', 'BOH', 'Exec')),
  shift_date date not null,
  shift_name text not null default '',
  start_time time,
  end_time time,
  until_volume boolean not null default false,
  is_closer boolean not null default false,
  is_lunch_closer boolean not null default false,
  is_flex_double boolean not null default false,
  is_open_bay boolean not null default false,
  color text,
  notes text not null default '',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shift_training_links (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  trainee_employee_id uuid references public.employees(id) on delete set null,
  trainer_employee_id uuid references public.employees(id) on delete set null,
  training_role_id uuid references public.roles(id) on delete set null,
  segment_start_time time,
  segment_end_time time,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.request_offs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  request_date date not null,
  start_time time,
  end_time time,
  all_day boolean not null default true,
  reason text not null default '',
  source text not null default 'manual',
  source_fingerprint text,
  created_at timestamptz not null default now(),
  unique(employee_id, request_date, start_time, end_time, source_fingerprint)
);

create table if not exists public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  block_date date not null,
  block_type text not null default 'event',
  start_time time,
  end_time time,
  all_day boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  legacy_id text,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id, name)
);

create table if not exists public.template_shifts (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates(id) on delete cascade,
  legacy_id text,
  day_index integer not null check (day_index between 0 and 6),
  role_id uuid references public.roles(id) on delete restrict,
  department text not null check (department in ('FOH', 'BOH', 'Exec')),
  shift_name text not null default '',
  start_time time,
  end_time time,
  until_volume boolean not null default false,
  is_closer boolean not null default false,
  is_lunch_closer boolean not null default false,
  is_flex_double boolean not null default false,
  color text,
  notes text not null default '',
  sort_order integer not null default 0
);

create table if not exists public.meal_periods (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  day_index integer not null check (day_index between 0 and 6),
  name text not null,
  start_time time not null,
  end_time time not null,
  sort_order integer not null default 0
);

create table if not exists public.coverage_requirements (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  coverage_date date,
  day_index integer check (day_index between 0 and 6),
  meal_name text not null,
  role_id uuid not null references public.roles(id) on delete cascade,
  required_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_projections (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  projection_date date not null,
  meal_name text not null,
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id, projection_date, meal_name)
);

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  setting_key text not null,
  setting_value jsonb not null,
  updated_at timestamptz not null default now(),
  unique(location_id, setting_key)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null default '',
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.locations enable row level security;
alter table public.location_users enable row level security;
alter table public.scheduler_state_documents enable row level security;
alter table public.roles enable row level security;
alter table public.employees enable row level security;
alter table public.employee_roles enable row level security;
alter table public.employee_pay_rates enable row level security;
alter table public.availability_rules enable row level security;
alter table public.weekly_availability_overrides enable row level security;
alter table public.schedule_weeks enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_training_links enable row level security;
alter table public.request_offs enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.templates enable row level security;
alter table public.template_shifts enable row level security;
alter table public.meal_periods enable row level security;
alter table public.coverage_requirements enable row level security;
alter table public.sales_projections enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_events enable row level security;

-- RLS policies will be tightened before production. During the first manager-only
-- prototype, access should be restricted to rows where the authenticated user is
-- listed in location_users for that location.
