-- Replace the name if needed, then run this after schema.sql.
insert into public.locations (name, timezone)
values ('Machine Shed Pewaukee', 'America/Chicago')
returning id;
