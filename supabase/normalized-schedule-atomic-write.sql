-- Atomic normalized schedule writer.
--
-- This stays inactive until the API explicitly calls it. It accepts the
-- compatibility snapshot shape, replaces only snapshot-backed normalized
-- schedule rows for one location, and advances the location revision in the
-- same PostgreSQL transaction. Any validation or write failure rolls back the
-- entire request, including the revision claim.

-- Keep the canary's location/legacy joins and cleanup passes bounded even when
-- a location has accumulated several schedule versions.
create index if not exists shifts_location_schedule_week_idx
  on public.shifts (location_id, schedule_week_id);

create index if not exists template_shifts_template_idx
  on public.template_shifts (template_id);

create index if not exists roles_location_legacy_lookup_idx
  on public.roles (location_id, legacy_id)
  where legacy_id is not null and legacy_id <> '';

create index if not exists employees_location_legacy_lookup_idx
  on public.employees (location_id, legacy_id)
  where legacy_id is not null and legacy_id <> '';

create or replace function public.write_normalized_schedule_atomically(
  p_location_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_revision bigint;
  v_next_revision bigint;
  v_week_start_day integer := coalesce(nullif(p_state #>> '{settings,weekStart}', '')::integer, 0);
  v_shift_count integer := 0;
  v_open_shift_count integer := 0;
  v_request_off_count integer := 0;
  v_block_count integer := 0;
  v_template_count integer := 0;
begin
  -- A client timeout must not leave a database transaction working
  -- indefinitely after the Edge Function has already returned. The short
  -- lock timeout turns a queued table/revision lock into a retryable response
  -- instead of another long 504.
  set local lock_timeout = '3s';
  set local statement_timeout = '20s';

  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'Normalized schedule write requires a scheduler state object';
  end if;

  if v_week_start_day not between 0 and 6 then
    raise exception 'Invalid week start day: %', v_week_start_day;
  end if;

  -- Do not let a second Atomic Sandbox tab queue behind a long write. The
  -- caller can retry after the first writer finishes, while the normal
  -- scheduler path remains completely unaffected.
  if not pg_try_advisory_xact_lock(
    hashtextextended('shift-bay:normalized-schedule:' || p_location_id::text, 0)
  ) then
    raise exception using
      errcode = '55P03',
      message = 'Another normalized atomic write is already in progress for this location';
  end if;

  insert into public.normalized_schedule_revisions (location_id, revision, updated_by)
  values (p_location_id, 0, p_user_id)
  on conflict (location_id) do nothing;

  select revision
    into v_current_revision
    from public.normalized_schedule_revisions
   where location_id = p_location_id
   for update;

  if v_current_revision is distinct from p_expected_revision then
    raise exception using
      errcode = '40001',
      message = format(
        'Normalized schedule revision conflict: expected %s, found %s',
        coalesce(p_expected_revision::text, 'null'),
        coalesce(v_current_revision::text, 'null')
      );
  end if;

  create temporary table if not exists _shift_bay_atomic_shift_input (
    legacy_id text primary key,
    employee_legacy_id text,
    role_legacy_id text,
    department text,
    shift_date date,
    shift_name text,
    start_time time,
    end_time time,
    until_volume boolean,
    is_closer boolean,
    is_lunch_closer boolean,
    is_flex_double boolean,
    is_open_bay boolean,
    color text,
    notes text,
    metadata jsonb,
    legacy_created_at timestamptz,
    legacy_updated_at timestamptz
  ) on commit drop;
  truncate _shift_bay_atomic_shift_input;

  insert into _shift_bay_atomic_shift_input (
    legacy_id, employee_legacy_id, role_legacy_id, department, shift_date,
    shift_name, start_time, end_time, until_volume, is_closer,
    is_lunch_closer, is_flex_double, is_open_bay, color, notes, metadata,
    legacy_created_at, legacy_updated_at
  )
  select
    nullif(trim(item.value->>'id'), ''),
    nullif(trim(item.value->>'employeeId'), ''),
    nullif(trim(item.value->>'roleId'), ''),
    coalesce(nullif(trim(item.value->>'department'), ''), 'FOH'),
    nullif(trim(item.value->>'date'), '')::date,
    coalesce(item.value->>'shiftLabel', ''),
    nullif(trim(item.value->>'start'), '')::time,
    nullif(trim(item.value->>'end'), '')::time,
    coalesce((item.value->>'untilVolume')::boolean, false),
    coalesce((item.value->>'isCloser')::boolean, false),
    coalesce((item.value->>'isLunchCloser')::boolean, false),
    coalesce((item.value->>'isFlexDouble')::boolean, false),
    is_open_bay,
    nullif(item.value->>'color', ''),
    coalesce(item.value->>'notes', ''),
    jsonb_build_object(
      'meals', coalesce(item.value->'meals', '[]'::jsonb),
      'training', coalesce(item.value->'training', '{}'::jsonb),
      'legacy', jsonb_build_object(
        'shiftLabel', coalesce(item.value->>'shiftLabel', ''),
        'createdAt', coalesce(item.value->>'createdAt', ''),
        'updatedAt', coalesce(item.value->>'updatedAt', '')
      )
    ),
    nullif(trim(item.value->>'createdAt'), '')::timestamptz,
    nullif(trim(item.value->>'updatedAt'), '')::timestamptz
  from (
    select value as item, false as is_open_bay
      from jsonb_array_elements(coalesce(p_state->'shifts', '[]'::jsonb))
    union all
    select value as item, true as is_open_bay
      from jsonb_array_elements(coalesce(p_state->'unassignedShifts', '[]'::jsonb))
  ) entries(item, is_open_bay)
  cross join lateral (select entries.item as value) item;

  -- Temporary tables do not have planner statistics until they are analyzed.
  -- Without this, a full schedule save can choose an unnecessarily expensive
  -- join plan even when the normalized input is small.
  analyze _shift_bay_atomic_shift_input;

  if exists (
    select 1 from _shift_bay_atomic_shift_input
     where legacy_id is null or role_legacy_id is null or shift_date is null
  ) then
    raise exception 'Normalized schedule write contains a shift without an id, role, or date';
  end if;

  if exists (
    select 1
      from _shift_bay_atomic_shift_input input
      left join public.roles role_row
        on role_row.location_id = p_location_id
       and role_row.legacy_id = input.role_legacy_id
     where role_row.id is null
  ) then
    raise exception 'Normalized schedule write references a role that is not mapped for this location';
  end if;

  if exists (
    select 1
      from _shift_bay_atomic_shift_input input
      left join public.employees employee_row
        on employee_row.location_id = p_location_id
       and employee_row.legacy_id = input.employee_legacy_id
     where not input.is_open_bay
       and input.employee_legacy_id is not null
       and employee_row.id is null
  ) then
    raise exception 'Normalized schedule write references an employee that is not mapped for this location';
  end if;

  insert into public.schedule_weeks (location_id, week_start, status)
  select distinct
    p_location_id,
    input.shift_date - ((extract(dow from input.shift_date)::integer - v_week_start_day + 7) % 7),
    'draft'
  from _shift_bay_atomic_shift_input input
  on conflict (location_id, week_start) do nothing;

  insert into public.shifts (
    location_id, schedule_week_id, legacy_id, employee_id, role_id, department,
    shift_date, shift_name, start_time, end_time, until_volume, is_closer,
    is_lunch_closer, is_flex_double, is_open_bay, color, notes, source,
    metadata, legacy_created_at, legacy_updated_at
  )
  select
    p_location_id,
    week_row.id,
    input.legacy_id,
    employee_row.id,
    role_row.id,
    input.department,
    input.shift_date,
    input.shift_name,
    input.start_time,
    input.end_time,
    input.until_volume,
    input.is_closer,
    input.is_lunch_closer,
    input.is_flex_double,
    input.is_open_bay,
    input.color,
    input.notes,
    'normalized-atomic',
    input.metadata,
    input.legacy_created_at,
    input.legacy_updated_at
  from _shift_bay_atomic_shift_input input
  join public.schedule_weeks week_row
    on week_row.location_id = p_location_id
   and week_row.week_start = input.shift_date - ((extract(dow from input.shift_date)::integer - v_week_start_day + 7) % 7)
  join public.roles role_row
    on role_row.location_id = p_location_id
   and role_row.legacy_id = input.role_legacy_id
  left join public.employees employee_row
    on employee_row.location_id = p_location_id
   and employee_row.legacy_id = input.employee_legacy_id
  on conflict (location_id, legacy_id) where legacy_id is not null and legacy_id <> '' do update
    set schedule_week_id = excluded.schedule_week_id,
        employee_id = excluded.employee_id,
        role_id = excluded.role_id,
        department = excluded.department,
        shift_date = excluded.shift_date,
        shift_name = excluded.shift_name,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        until_volume = excluded.until_volume,
        is_closer = excluded.is_closer,
        is_lunch_closer = excluded.is_lunch_closer,
        is_flex_double = excluded.is_flex_double,
        is_open_bay = excluded.is_open_bay,
        color = excluded.color,
        notes = excluded.notes,
        source = excluded.source,
        metadata = excluded.metadata,
        legacy_created_at = excluded.legacy_created_at,
        legacy_updated_at = excluded.legacy_updated_at,
        updated_at = now()
    where (public.shifts.schedule_week_id, public.shifts.employee_id, public.shifts.role_id,
           public.shifts.department, public.shifts.shift_date, public.shifts.shift_name,
           public.shifts.start_time, public.shifts.end_time, public.shifts.until_volume,
           public.shifts.is_closer, public.shifts.is_lunch_closer, public.shifts.is_flex_double,
           public.shifts.is_open_bay, public.shifts.color, public.shifts.notes, public.shifts.source,
           public.shifts.metadata, public.shifts.legacy_created_at, public.shifts.legacy_updated_at)
      is distinct from
          (excluded.schedule_week_id, excluded.employee_id, excluded.role_id,
           excluded.department, excluded.shift_date, excluded.shift_name,
           excluded.start_time, excluded.end_time, excluded.until_volume,
           excluded.is_closer, excluded.is_lunch_closer, excluded.is_flex_double,
           excluded.is_open_bay, excluded.color, excluded.notes, excluded.source,
           excluded.metadata, excluded.legacy_created_at, excluded.legacy_updated_at);

  delete from public.shifts existing
   where existing.location_id = p_location_id
     and existing.legacy_id is not null
     and existing.legacy_id <> ''
     and not exists (
       select 1 from _shift_bay_atomic_shift_input input
        where input.legacy_id = existing.legacy_id
     );

  create temporary table if not exists _shift_bay_atomic_time_off_input (
    legacy_id text primary key,
    employee_legacy_id text,
    item_date date,
    start_time time,
    end_time time,
    all_day boolean,
    reason text,
    source text,
    kind text,
    daypart text,
    block_type text,
    note text,
    metadata jsonb,
    updated_at timestamptz,
    is_block boolean
  ) on commit drop;
  truncate _shift_bay_atomic_time_off_input;

  insert into _shift_bay_atomic_time_off_input (
    legacy_id, employee_legacy_id, item_date, start_time, end_time, all_day,
    reason, source, kind, daypart, block_type, note, metadata, updated_at,
    is_block
  )
  select
    nullif(trim(item.value->>'id'), ''),
    nullif(trim(item.value->>'employeeId'), ''),
    nullif(trim(item.value->>'date'), '')::date,
    nullif(trim(item.value->>'start'), '')::time,
    nullif(trim(item.value->>'end'), '')::time,
    coalesce((item.value->>'allDay')::boolean, true),
    coalesce(item.value->>'reason', item.value->>'note', ''),
    coalesce(nullif(item.value->>'source', ''), 'normalized-atomic'),
    coalesce(nullif(item.value->>'kind', ''), 'ro'),
    coalesce(item.value->>'daypart', ''),
    coalesce(nullif(item.value->>'blockType', ''), 'event'),
    coalesce(item.value->>'note', item.value->>'reason', ''),
    jsonb_build_object(
      'note', coalesce(item.value->>'note', ''),
      'createdAt', coalesce(item.value->>'createdAt', ''),
      'updatedAt', coalesce(item.value->>'updatedAt', '')
    ),
    coalesce(nullif(trim(item.value->>'updatedAt'), '')::timestamptz, now()),
    lower(coalesce(item.value->>'kind', '')) = 'block' or coalesce(item.value->>'blockType', '') <> ''
  from jsonb_array_elements(coalesce(p_state->'timeOffRequests', '[]'::jsonb)) as item(value);

  analyze _shift_bay_atomic_time_off_input;

  if exists (
    select 1 from _shift_bay_atomic_time_off_input
     where legacy_id is null or employee_legacy_id is null or item_date is null
  ) then
    raise exception 'Normalized schedule write contains a request off or block without an id, employee, or date';
  end if;

  if exists (
    select 1
      from _shift_bay_atomic_time_off_input input
      left join public.employees employee_row
        on employee_row.location_id = p_location_id
       and employee_row.legacy_id = input.employee_legacy_id
     where employee_row.id is null
  ) then
    raise exception 'Normalized schedule write references a request-off employee that is not mapped for this location';
  end if;

  insert into public.request_offs (
    location_id, legacy_id, employee_id, request_date, start_time, end_time,
    all_day, reason, source, source_fingerprint, kind, daypart, metadata,
    updated_at
  )
  select
    p_location_id, input.legacy_id, employee_row.id, input.item_date,
    input.start_time, input.end_time, input.all_day, input.reason,
    input.source, 'legacy:' || input.legacy_id, input.kind, input.daypart,
    input.metadata, input.updated_at
  from _shift_bay_atomic_time_off_input input
  join public.employees employee_row
    on employee_row.location_id = p_location_id
   and employee_row.legacy_id = input.employee_legacy_id
  where not input.is_block
  on conflict (location_id, legacy_id) where legacy_id is not null and legacy_id <> '' do update
    set employee_id = excluded.employee_id,
        request_date = excluded.request_date,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        all_day = excluded.all_day,
        reason = excluded.reason,
        source = excluded.source,
        source_fingerprint = excluded.source_fingerprint,
        kind = excluded.kind,
        daypart = excluded.daypart,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    where (public.request_offs.employee_id, public.request_offs.request_date,
           public.request_offs.start_time, public.request_offs.end_time,
           public.request_offs.all_day, public.request_offs.reason,
           public.request_offs.source, public.request_offs.source_fingerprint,
           public.request_offs.kind, public.request_offs.daypart,
           public.request_offs.metadata, public.request_offs.updated_at)
      is distinct from
          (excluded.employee_id, excluded.request_date, excluded.start_time,
           excluded.end_time, excluded.all_day, excluded.reason, excluded.source,
           excluded.source_fingerprint, excluded.kind, excluded.daypart,
           excluded.metadata, excluded.updated_at);

  insert into public.schedule_blocks (
    location_id, legacy_id, employee_id, block_date, block_type, start_time,
    end_time, all_day, note, source, metadata, updated_at
  )
  select
    p_location_id, input.legacy_id, employee_row.id, input.item_date,
    input.block_type, input.start_time, input.end_time, input.all_day,
    input.note, input.source, input.metadata, input.updated_at
  from _shift_bay_atomic_time_off_input input
  join public.employees employee_row
    on employee_row.location_id = p_location_id
   and employee_row.legacy_id = input.employee_legacy_id
  where input.is_block
  on conflict (location_id, legacy_id) where legacy_id is not null and legacy_id <> '' do update
    set employee_id = excluded.employee_id,
        block_date = excluded.block_date,
        block_type = excluded.block_type,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        all_day = excluded.all_day,
        note = excluded.note,
        source = excluded.source,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    where (public.schedule_blocks.employee_id, public.schedule_blocks.block_date,
           public.schedule_blocks.block_type, public.schedule_blocks.start_time,
           public.schedule_blocks.end_time, public.schedule_blocks.all_day,
           public.schedule_blocks.note, public.schedule_blocks.source,
           public.schedule_blocks.metadata, public.schedule_blocks.updated_at)
      is distinct from
          (excluded.employee_id, excluded.block_date, excluded.block_type,
           excluded.start_time, excluded.end_time, excluded.all_day, excluded.note,
           excluded.source, excluded.metadata, excluded.updated_at);

  delete from public.request_offs existing
   where existing.location_id = p_location_id
     and existing.legacy_id is not null
     and existing.legacy_id <> ''
     and not exists (
       select 1 from _shift_bay_atomic_time_off_input input
        where not input.is_block and input.legacy_id = existing.legacy_id
     );

  delete from public.schedule_blocks existing
   where existing.location_id = p_location_id
     and existing.legacy_id is not null
     and existing.legacy_id <> ''
     and not exists (
       select 1 from _shift_bay_atomic_time_off_input input
        where input.is_block and input.legacy_id = existing.legacy_id
     );

  create temporary table if not exists _shift_bay_atomic_template_input (
    legacy_id text primary key,
    name text,
    active boolean,
    metadata jsonb,
    legacy_created_at timestamptz,
    legacy_updated_at timestamptz,
    item jsonb
  ) on commit drop;
  truncate _shift_bay_atomic_template_input;

  insert into _shift_bay_atomic_template_input (
    legacy_id, name, active, metadata, legacy_created_at, legacy_updated_at, item
  )
  select
    nullif(trim(item.value->>'id'), ''),
    coalesce(nullif(trim(item.value->>'name'), ''), 'Untitled template'),
    coalesce((item.value->>'active')::boolean, true),
    jsonb_build_object('legacy', item.value - 'shifts'),
    nullif(trim(item.value->>'createdAt'), '')::timestamptz,
    nullif(trim(item.value->>'updatedAt'), '')::timestamptz,
    item.value
  from jsonb_array_elements(coalesce(p_state->'templates', '[]'::jsonb)) as item(value);

  analyze _shift_bay_atomic_template_input;

  if exists (select 1 from _shift_bay_atomic_template_input where legacy_id is null) then
    raise exception 'Normalized schedule write contains a template without an id';
  end if;

  insert into public.templates (
    location_id, legacy_id, name, active, metadata, legacy_created_at, legacy_updated_at
  )
  select p_location_id, legacy_id, name, active, metadata, legacy_created_at, legacy_updated_at
    from _shift_bay_atomic_template_input
  on conflict (location_id, legacy_id) where legacy_id is not null and legacy_id <> '' do update
    set name = excluded.name,
        active = excluded.active,
        metadata = excluded.metadata,
        legacy_created_at = excluded.legacy_created_at,
        legacy_updated_at = excluded.legacy_updated_at,
        updated_at = now()
    where (public.templates.name, public.templates.active, public.templates.metadata,
           public.templates.legacy_created_at, public.templates.legacy_updated_at)
      is distinct from
          (excluded.name, excluded.active, excluded.metadata,
           excluded.legacy_created_at, excluded.legacy_updated_at);

  if exists (
    select 1
      from _shift_bay_atomic_template_input template_input
      cross join lateral jsonb_array_elements(coalesce(template_input.item->'shifts', '[]'::jsonb)) as shift_item(value)
      left join public.roles role_row
        on role_row.location_id = p_location_id
       and role_row.legacy_id = nullif(trim(shift_item.value->>'roleId'), '')
     where nullif(trim(shift_item.value->>'id'), '') is null or role_row.id is null
  ) then
    raise exception 'Normalized schedule write contains a template shift without an id or mapped role';
  end if;

  insert into public.template_shifts (
    template_id, legacy_id, day_index, role_id, department, shift_name,
    start_time, end_time, until_volume, is_closer, is_lunch_closer,
    is_flex_double, color, notes, sort_order, metadata,
    legacy_created_at, legacy_updated_at
  )
  select
    template_row.id,
    nullif(trim(shift_item->>'id'), ''),
    coalesce((shift_item->>'dayIndex')::integer, 0),
    role_row.id,
    coalesce(nullif(trim(shift_item->>'department'), ''), 'FOH'),
    coalesce(shift_item->>'shiftLabel', ''),
    nullif(trim(shift_item->>'start'), '')::time,
    nullif(trim(shift_item->>'end'), '')::time,
    coalesce((shift_item->>'untilVolume')::boolean, false),
    coalesce((shift_item->>'isCloser')::boolean, false),
    coalesce((shift_item->>'isLunchCloser')::boolean, false),
    coalesce((shift_item->>'isFlexDouble')::boolean, false),
    nullif(shift_item->>'color', ''),
    coalesce(shift_item->>'notes', ''),
    ordinal - 1,
    jsonb_build_object(
      'meals', coalesce(shift_item->'meals', '[]'::jsonb),
      'training', coalesce(shift_item->'training', '{}'::jsonb)
    ),
    nullif(trim(shift_item->>'createdAt'), '')::timestamptz,
    nullif(trim(shift_item->>'updatedAt'), '')::timestamptz
  from _shift_bay_atomic_template_input template_input
  join public.templates template_row
    on template_row.location_id = p_location_id
   and template_row.legacy_id = template_input.legacy_id
  cross join lateral jsonb_array_elements(coalesce(template_input.item->'shifts', '[]'::jsonb)) with ordinality as shifts(shift_item, ordinal)
  join public.roles role_row
    on role_row.location_id = p_location_id
   and role_row.legacy_id = nullif(trim(shift_item->>'roleId'), '')
  on conflict (template_id, legacy_id) where legacy_id is not null and legacy_id <> '' do update
    set day_index = excluded.day_index,
        role_id = excluded.role_id,
        department = excluded.department,
        shift_name = excluded.shift_name,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        until_volume = excluded.until_volume,
        is_closer = excluded.is_closer,
        is_lunch_closer = excluded.is_lunch_closer,
        is_flex_double = excluded.is_flex_double,
        color = excluded.color,
        notes = excluded.notes,
        sort_order = excluded.sort_order,
        metadata = excluded.metadata,
        legacy_created_at = excluded.legacy_created_at,
        legacy_updated_at = excluded.legacy_updated_at
    where (public.template_shifts.day_index, public.template_shifts.role_id,
           public.template_shifts.department, public.template_shifts.shift_name,
           public.template_shifts.start_time, public.template_shifts.end_time,
           public.template_shifts.until_volume, public.template_shifts.is_closer,
           public.template_shifts.is_lunch_closer, public.template_shifts.is_flex_double,
           public.template_shifts.color, public.template_shifts.notes,
           public.template_shifts.sort_order, public.template_shifts.metadata,
           public.template_shifts.legacy_created_at, public.template_shifts.legacy_updated_at)
      is distinct from
          (excluded.day_index, excluded.role_id, excluded.department,
           excluded.shift_name, excluded.start_time, excluded.end_time,
           excluded.until_volume, excluded.is_closer, excluded.is_lunch_closer,
           excluded.is_flex_double, excluded.color, excluded.notes,
           excluded.sort_order, excluded.metadata, excluded.legacy_created_at,
           excluded.legacy_updated_at);

  delete from public.template_shifts existing
  using public.templates template_row
   where existing.template_id = template_row.id
     and template_row.location_id = p_location_id
     and template_row.legacy_id is not null
     and template_row.legacy_id <> ''
     and existing.legacy_id is not null
     and existing.legacy_id <> ''
     and not exists (
       select 1
         from _shift_bay_atomic_template_input template_input
         cross join lateral jsonb_array_elements(coalesce(template_input.item->'shifts', '[]'::jsonb)) as shift_item(value)
        where template_input.legacy_id = template_row.legacy_id
          and nullif(trim(shift_item.value->>'id'), '') = existing.legacy_id
     );

  delete from public.templates existing
   where existing.location_id = p_location_id
     and existing.legacy_id is not null
     and existing.legacy_id <> ''
     and not exists (
       select 1 from _shift_bay_atomic_template_input input
        where input.legacy_id = existing.legacy_id
     );

  update public.normalized_schedule_revisions
     set revision = revision + 1,
         updated_by = p_user_id,
         updated_at = now()
   where location_id = p_location_id
   returning revision into v_next_revision;

  select count(*) filter (where not is_open_bay), count(*) filter (where is_open_bay)
    into v_shift_count, v_open_shift_count
    from _shift_bay_atomic_shift_input;
  select count(*) filter (where not is_block), count(*) filter (where is_block)
    into v_request_off_count, v_block_count
    from _shift_bay_atomic_time_off_input;
  select count(*) into v_template_count from _shift_bay_atomic_template_input;

  return jsonb_build_object(
    'ok', true,
    'revision', v_next_revision,
    'assignedShifts', v_shift_count,
    'openShifts', v_open_shift_count,
    'requestOffs', v_request_off_count,
    'scheduleBlocks', v_block_count,
    'templates', v_template_count
  );
end;
$$;

revoke all on function public.write_normalized_schedule_atomically(uuid, bigint, jsonb, uuid) from public;
grant execute on function public.write_normalized_schedule_atomically(uuid, bigint, jsonb, uuid) to service_role;
