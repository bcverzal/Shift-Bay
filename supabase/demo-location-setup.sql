-- Shift Bay demo/sandbox location setup.
--
-- Replace OWNER_USER_ID with the Supabase Auth user ID for the account that
-- should own the demo location, then run this in the Supabase SQL editor.
-- This script is safe to run more than once: it reuses the demo location
-- if it already exists and updates the owner membership instead of duplicating it.
--
-- The app will show a location switcher after that account belongs to more
-- than one location.

with existing_location as (
  select id
  from public.locations
  where name = 'Shift Bay Demo Restaurant'
  order by created_at asc
  limit 1
),
inserted_location as (
  insert into public.locations (name, timezone)
  select 'Shift Bay Demo Restaurant', 'America/Chicago'
  where not exists (select 1 from existing_location)
  returning id
),
demo_location as (
  select id from existing_location
  union all
  select id from inserted_location
)
insert into public.location_users (location_id, user_id, role)
select id, 'OWNER_USER_ID'::uuid, 'owner'
from demo_location
on conflict (location_id, user_id) do update
  set role = excluded.role;

-- Optional: after switching to the demo location in Shift Bay, make any small
-- change and save. The app will create the demo scheduler document on first save.
