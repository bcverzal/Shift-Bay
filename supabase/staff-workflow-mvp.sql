-- Staff request-off and availability submissions.
-- Run after staff-accounts-mvp.sql and staff-profile-mvp.sql.

create table if not exists public.staff_request_offs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  staff_account_id uuid not null references public.staff_accounts(id) on delete cascade,
  legacy_employee_id text not null default '',
  start_date date not null,
  end_date date not null,
  start_time text not null default '',
  end_time text not null default '',
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists staff_request_offs_location_status_idx
  on public.staff_request_offs (location_id, status, start_date);

create table if not exists public.staff_availability_submissions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  staff_account_id uuid not null references public.staff_accounts(id) on delete cascade,
  legacy_employee_id text not null default '',
  week_start date not null,
  availability jsonb not null default '{}'::jsonb,
  note text not null default '',
  status text not null default 'submitted' check (status in ('submitted', 'pending', 'approved', 'denied', 'cancelled', 'reviewed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, staff_account_id, week_start)
);

create index if not exists staff_availability_location_week_idx
  on public.staff_availability_submissions (location_id, week_start);
