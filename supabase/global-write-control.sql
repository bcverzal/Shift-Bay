-- Draft only: review and run during the migration window.
-- This creates a single owner-controlled write pause for all Shift Bay tabs.
-- The matching Edge Function/frontend checks are now in source, but this SQL
-- must be run before the control becomes active in the hosted app.

create table if not exists public.shift_bay_write_control (
  singleton boolean primary key default true check (singleton),
  write_epoch bigint not null default 1,
  writes_paused boolean not null default false,
  message text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.shift_bay_write_control (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.shift_bay_write_control enable row level security;

revoke all on public.shift_bay_write_control from anon, authenticated;

create or replace function public.get_shift_bay_write_control()
returns table (
  write_epoch bigint,
  writes_paused boolean,
  message text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select c.write_epoch, c.writes_paused, c.message, c.updated_at
  from public.shift_bay_write_control c
  where c.singleton = true;
$$;

create or replace function public.set_shift_bay_write_control(
  p_writes_paused boolean,
  p_message text default null
)
returns public.shift_bay_write_control
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_control public.shift_bay_write_control;
begin
  update public.shift_bay_write_control
  set writes_paused = p_writes_paused,
      message = nullif(trim(p_message), ''),
      write_epoch = write_epoch + 1,
      updated_at = now(),
      updated_by = auth.uid()
  where singleton = true
  returning * into updated_control;

  return updated_control;
end;
$$;

revoke all on function public.get_shift_bay_write_control() from public, anon, authenticated;
revoke all on function public.set_shift_bay_write_control(boolean, text) from public, anon, authenticated;
grant execute on function public.get_shift_bay_write_control() to service_role;
grant execute on function public.set_shift_bay_write_control(boolean, text) to service_role;
