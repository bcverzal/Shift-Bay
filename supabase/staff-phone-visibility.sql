-- Staff privacy setting for phone numbers.
-- Run once in the Supabase SQL editor after staff_accounts already exists.

alter table if exists public.staff_accounts
  add column if not exists phone_visibility text not null default 'managers_only';

update public.staff_accounts
set phone_visibility = 'managers_only'
where phone_visibility is null
   or phone_visibility not in ('managers_only', 'all_staff');

alter table public.staff_accounts
  drop constraint if exists staff_accounts_phone_visibility_check;

alter table public.staff_accounts
  add constraint staff_accounts_phone_visibility_check
  check (phone_visibility in ('managers_only', 'all_staff'));
