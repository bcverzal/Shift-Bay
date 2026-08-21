-- Production atomic schedule cutover wrapper (inactive until explicitly routed).
--
-- The existing write_normalized_schedule_atomically function owns the
-- revision lock and writes all normalized schedule rows in one transaction.
-- This wrapper adds the compatibility scheduler document to that same
-- transaction. It is intentionally separate from the Sandbox canary so the
-- normal snapshot-first production route remains unchanged until cutover.

create or replace function public.write_production_schedule_atomically_with_snapshot(
  p_location_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_user_id uuid default null,
  p_document_key text default 'primary',
  p_schema_version integer default 1,
  p_saved_by_device_id text default null,
  p_saved_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized_result jsonb;
  v_saved_at timestamptz := coalesce(p_saved_at, now());
  v_document_key text := coalesce(nullif(trim(p_document_key), ''), 'primary');
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'Production atomic schedule write requires a scheduler state object';
  end if;

  -- This function acquires the location revision lock. A false result is a
  -- structured concurrency rejection, so do not mutate the snapshot either.
  v_normalized_result := public.write_normalized_schedule_atomically(
    p_location_id,
    p_expected_revision,
    p_state,
    p_user_id
  );
  if coalesce((v_normalized_result ->> 'ok')::boolean, false) is not true then
    return v_normalized_result;
  end if;

  -- Updating this row fires the existing history trigger before the commit.
  -- If this upsert fails, PostgreSQL rolls back the normalized writes too.
  insert into public.scheduler_state_documents (
    location_id,
    document_key,
    schema_version,
    state,
    saved_by,
    saved_by_device_id,
    saved_at,
    updated_at
  ) values (
    p_location_id,
    v_document_key,
    greatest(coalesce(p_schema_version, 1), 1),
    p_state,
    p_user_id,
    p_saved_by_device_id,
    v_saved_at,
    v_saved_at
  )
  on conflict (location_id, document_key) do update
    set schema_version = excluded.schema_version,
        state = excluded.state,
        saved_by = excluded.saved_by,
        saved_by_device_id = excluded.saved_by_device_id,
        saved_at = excluded.saved_at,
        updated_at = excluded.updated_at;

  return v_normalized_result || jsonb_build_object(
    'snapshotSavedAt', v_saved_at,
    'documentKey', v_document_key,
    'snapshotUpdated', true
  );
end;
$$;

revoke all on function public.write_production_schedule_atomically_with_snapshot(
  uuid, bigint, jsonb, uuid, text, integer, text, timestamptz
) from public;

grant execute on function public.write_production_schedule_atomically_with_snapshot(
  uuid, bigint, jsonb, uuid, text, integer, text, timestamptz
) to service_role;
