-- Staff-owned profile fields for the staff portal.
-- Run after staff-accounts-mvp.sql.

alter table public.staff_accounts
  add column if not exists preferred_name text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists contact_preference text not null default 'in_app'
    check (contact_preference in ('sms', 'email', 'in_app'));
