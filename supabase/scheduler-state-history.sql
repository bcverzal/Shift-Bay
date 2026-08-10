-- Immutable rollback history for the compatibility scheduler document.
--
-- The normalized cutover keeps scheduler_state_documents available as a
-- fallback. This trigger archives the prior document state on every real
-- whole-schedule update, so rollback does not depend on a single mutable row.

create table if not exists public.scheduler_state_document_history (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  document_key text not null,
  schema_version integer not null,
  state jsonb not null,
  saved_by uuid references auth.users(id),
  saved_by_device_id text,
  saved_at timestamptz not null,
  archived_at timestamptz not null default now()
);

create index if not exists scheduler_state_document_history_lookup_idx
  on public.scheduler_state_document_history (location_id, document_key, archived_at desc);

alter table public.scheduler_state_document_history enable row level security;

create or replace function public.archive_scheduler_state_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.state is distinct from new.state then
    insert into public.scheduler_state_document_history (
      location_id,
      document_key,
      schema_version,
      state,
      saved_by,
      saved_by_device_id,
      saved_at
    ) values (
      old.location_id,
      old.document_key,
      old.schema_version,
      old.state,
      old.saved_by,
      old.saved_by_device_id,
      old.saved_at
    );
  end if;
  return new;
end;
$$;

revoke all on function public.archive_scheduler_state_document() from public;

drop trigger if exists archive_scheduler_state_document_before_update
  on public.scheduler_state_documents;

create trigger archive_scheduler_state_document_before_update
before update of state on public.scheduler_state_documents
for each row
execute function public.archive_scheduler_state_document();
