-- Draft only. Do not run in Supabase yet.
--
-- This migration is the reviewable foundation for staff shift release/pickup
-- and location-scoped in-app messaging. The current scheduler stores shifts in
-- scheduler_state_documents, so source_shift_id remains text until a safe,
-- server-side schedule mutation is ready.

create table if not exists public.staff_shift_release_requests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  source_shift_id text not null,
  releasing_staff_account_id uuid not null references public.staff_accounts(id) on delete cascade,
  status text not null default 'pending_manager_review'
    check (status in ('pending_manager_review', 'approved_for_pickup', 'claimed', 'approved_pickup', 'denied', 'cancelled', 'expired', 'completed')),
  note text not null default '',
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '',
  expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_shift_release_active_idx
  on public.staff_shift_release_requests (location_id, source_shift_id)
  where status in ('pending_manager_review', 'approved_for_pickup', 'claimed', 'approved_pickup');

create index if not exists staff_shift_release_location_status_idx
  on public.staff_shift_release_requests (location_id, status, requested_at desc);

create table if not exists public.staff_shift_pickup_requests (
  id uuid primary key default gen_random_uuid(),
  release_request_id uuid not null references public.staff_shift_release_requests(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  requesting_staff_account_id uuid not null references public.staff_accounts(id) on delete cascade,
  status text not null default 'pending_manager_review'
    check (status in ('pending_manager_review', 'approved', 'denied', 'withdrawn', 'expired')),
  note text not null default '',
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_shift_pickup_one_request_idx
  on public.staff_shift_pickup_requests (release_request_id, requesting_staff_account_id)
  where status in ('pending_manager_review', 'approved');

create index if not exists staff_shift_pickup_location_status_idx
  on public.staff_shift_pickup_requests (location_id, status, requested_at desc);

create table if not exists public.staff_chat_groups (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  description text not null default '',
  group_type text not null default 'manager_created'
    check (group_type in ('direct', 'manager_created', 'staff_created')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_chat_groups_location_status_idx
  on public.staff_chat_groups (location_id, status, created_at desc);

create table if not exists public.staff_chat_group_members (
  group_id uuid not null references public.staff_chat_groups(id) on delete cascade,
  staff_account_id uuid not null references public.staff_accounts(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('member', 'moderator')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (group_id, staff_account_id)
);

create index if not exists staff_chat_group_members_staff_idx
  on public.staff_chat_group_members (staff_account_id, left_at);

create table if not exists public.staff_chat_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.staff_chat_groups(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  author_staff_account_id uuid references public.staff_accounts(id) on delete set null,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists staff_chat_messages_group_created_idx
  on public.staff_chat_messages (group_id, created_at desc);

create table if not exists public.staff_chat_message_reads (
  message_id uuid not null references public.staff_chat_messages(id) on delete cascade,
  staff_account_id uuid not null references public.staff_accounts(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, staff_account_id)
);

-- RLS policies should be added with the final auth/manager-role model. Until
-- then, access must go through the service-backed edge function and these
-- tables must not be exposed directly to browser clients.
