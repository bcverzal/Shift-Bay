-- Shift Bay staff portal schema plan.
-- Draft only. Do not run against production until reviewed.
--
-- Purpose:
-- Add structured staff request/approval data while the manager scheduler can
-- continue using scheduler_state_documents during the transition.

create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  legacy_employee_id text not null default '',
  display_name text not null default '',
  status text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_accounts_location_user_idx
  on public.staff_accounts (location_id, user_id);

create unique index if not exists staff_accounts_location_employee_idx
  on public.staff_accounts (location_id, employee_id)
  where employee_id is not null;

create unique index if not exists staff_accounts_location_legacy_employee_idx
  on public.staff_accounts (location_id, legacy_employee_id)
  where legacy_employee_id <> '';

create table if not exists public.staff_requests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  legacy_employee_id text not null default '',
  request_type text not null check (request_type in ('request_off', 'availability', 'shift_release', 'shift_pickup', 'shift_swap')),
  status text not null default 'pending' check (status in ('draft', 'pending', 'approved', 'denied', 'cancelled', 'expired')),
  source_shift_id text,
  target_shift_id text,
  request_date date,
  start_time time,
  end_time time,
  all_day boolean not null default true,
  note text not null default '',
  payload jsonb not null default '{}'::jsonb,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_requests_location_status_idx
  on public.staff_requests (location_id, status, request_type);

create index if not exists staff_requests_employee_idx
  on public.staff_requests (employee_id, submitted_at desc);

create table if not exists public.staff_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.staff_requests(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_request_events_request_idx
  on public.staff_request_events (request_id, created_at asc);

create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  request_id uuid references public.staff_requests(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists staff_notifications_user_read_idx
  on public.staff_notifications (user_id, read_at, created_at desc);

-- Saved staff availability patterns.
-- These let employees save "Week A", "Week B", "School Week", etc. and assign
-- them to specific schedule weeks or repeating rotations.
create table if not exists public.staff_availability_patterns (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  name text not null,
  mode text not null default 'saved' check (mode in ('saved', 'recurring', 'rotation')),
  repeat_interval_weeks integer not null default 1 check (repeat_interval_weeks between 1 and 12),
  rotation_position integer not null default 1 check (rotation_position between 1 and 12),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, name)
);

create table if not exists public.staff_availability_pattern_windows (
  id uuid primary key default gen_random_uuid(),
  pattern_id uuid not null references public.staff_availability_patterns(id) on delete cascade,
  day_index integer not null check (day_index between 0 and 6),
  start_time time,
  end_time time,
  available boolean not null default true,
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists staff_availability_pattern_windows_pattern_idx
  on public.staff_availability_pattern_windows (pattern_id, day_index, sort_order);

-- Resolved assignment for a particular week. This keeps the manager schedule
-- fast to read even if the employee uses rotating patterns.
create table if not exists public.staff_availability_week_assignments (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  week_start date not null,
  pattern_id uuid references public.staff_availability_patterns(id) on delete set null,
  submission_mode text not null default 'pattern' check (submission_mode in ('pattern', 'manual', 'week_to_week', 'manager_entered')),
  status text not null default 'pending' check (status in ('pending', 'submitted', 'approved', 'rejected', 'manager_entered')),
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, week_start)
);

create index if not exists staff_availability_week_assignments_location_week_idx
  on public.staff_availability_week_assignments (location_id, week_start, status);

-- Employees who submit availability week-to-week need a reminder trail.
create table if not exists public.staff_availability_reminders (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  week_start date not null,
  reminder_number integer not null check (reminder_number between 1 and 3),
  channel text not null check (channel in ('in_app', 'email', 'sms')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'cancelled')),
  message text not null default '',
  sent_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(employee_id, week_start, reminder_number, channel)
);

create index if not exists staff_availability_reminders_location_week_idx
  on public.staff_availability_reminders (location_id, week_start, status);

-- Future cross-location staffing:
-- This records which locations an employee may work at and how they are allowed
-- to appear in pickup/coverage workflows.
create table if not exists public.employee_location_eligibility (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'inactive', 'pending')),
  home_location boolean not null default false,
  requires_home_manager_approval boolean not null default true,
  requires_borrowing_manager_approval boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, location_id)
);
