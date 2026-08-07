-- Role and capability migration bridge.
-- Run after schema.sql and employee-normalization-migration.sql.
-- This is additive and safe to run more than once.

-- The snapshot keeps stable string IDs while normalized rows use UUID keys.
-- This index lets migration tools safely identify an existing role by its
-- snapshot identity without depending on its display name.
create unique index if not exists roles_location_legacy_unique
  on public.roles (location_id, legacy_id);

-- A trainer qualification is different from being trained for a role or being
-- actively in training. Preserve it explicitly before role capabilities move
-- off the scheduler snapshot.
alter table public.employee_roles
  add column if not exists can_train boolean not null default false;
