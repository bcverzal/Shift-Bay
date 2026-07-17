-- Staff portal account bridge for the current JSON scheduler state.
-- Run before enabling real staff invites.

create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid,
  legacy_employee_id text not null default '',
  display_name text not null default '',
  status text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  password_change_required boolean not null default false,
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_accounts_location_user_idx
  on public.staff_accounts (location_id, user_id);

create unique index if not exists staff_accounts_location_legacy_employee_idx
  on public.staff_accounts (location_id, legacy_employee_id)
  where legacy_employee_id <> '';

create index if not exists staff_accounts_location_status_idx
  on public.staff_accounts (location_id, status, display_name);
