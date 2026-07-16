-- Require new manager logins to replace their temporary password on first use.
-- Run before deploying the matching API/UI changes.

alter table public.location_users
  add column if not exists password_change_required boolean not null default false;

create index if not exists location_users_password_change_required_idx
  on public.location_users (location_id, password_change_required)
  where password_change_required = true;
