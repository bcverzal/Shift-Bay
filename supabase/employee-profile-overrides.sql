-- Dedicated, lightweight persistence for employee profile edits.
-- Run this once in the Supabase SQL Editor before deploying the matching
-- shift-bay-api Edge Function update.

create table if not exists public.employee_profile_overrides (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  employee_id text not null,
  profile jsonb not null,
  saved_by uuid references auth.users(id),
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id, employee_id)
);

create index if not exists employee_profile_overrides_location_idx
  on public.employee_profile_overrides(location_id);
