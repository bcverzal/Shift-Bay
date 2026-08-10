-- Optional manager invite tracking table for the hosted Shift Bay version.
-- Run after schema.sql when we are ready to build the manager-invite UI.

create table if not exists public.location_invites (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'manager', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(location_id, email)
);

create index if not exists location_invites_location_status_idx
  on public.location_invites (location_id, status);

alter table public.location_invites enable row level security;
