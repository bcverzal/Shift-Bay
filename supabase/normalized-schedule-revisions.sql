-- Direct normalized schedule-write concurrency foundation.
--
-- This migration is additive and inactive until the application explicitly
-- requests a direct normalized write. A location has one monotonically
-- increasing revision, which lets the API reject a stale full-schedule write
-- before it can overwrite a newer manager edit.

create table if not exists public.normalized_schedule_revisions (
  location_id uuid primary key references public.locations(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.normalized_schedule_revisions enable row level security;

create or replace function public.claim_normalized_schedule_revision(
  p_location_id uuid,
  p_expected_revision bigint,
  p_user_id uuid default null
)
returns table(revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.normalized_schedule_revisions (location_id, revision, updated_by)
  values (p_location_id, 0, p_user_id)
  on conflict (location_id) do nothing;

  return query
  update public.normalized_schedule_revisions
     set revision = normalized_schedule_revisions.revision + 1,
         updated_by = p_user_id,
         updated_at = now()
   where normalized_schedule_revisions.location_id = p_location_id
     and normalized_schedule_revisions.revision = p_expected_revision
  returning normalized_schedule_revisions.revision,
            normalized_schedule_revisions.updated_at;
end;
$$;

revoke all on function public.claim_normalized_schedule_revision(uuid, bigint, uuid) from public;
grant execute on function public.claim_normalized_schedule_revision(uuid, bigint, uuid) to service_role;
