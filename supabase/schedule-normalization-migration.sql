-- Shift Bay schedule normalization bridge.
--
-- Sandbox-first and additive. This does not move any records or switch any
-- reads. It creates stable legacy identity and a metadata bridge so schedule
-- records can be copied, compared, and rolled back without losing details the
-- current scheduler snapshot still owns.

alter table public.shifts
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists legacy_created_at timestamptz,
  add column if not exists legacy_updated_at timestamptz;

create unique index if not exists shifts_location_legacy_unique
  on public.shifts (location_id, legacy_id)
  where legacy_id is not null and legacy_id <> '';

alter table public.request_offs
  add column if not exists legacy_id text,
  add column if not exists kind text not null default 'ro',
  add column if not exists daypart text not null default '',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists request_offs_location_legacy_unique
  on public.request_offs (location_id, legacy_id)
  where legacy_id is not null and legacy_id <> '';

alter table public.schedule_blocks
  add column if not exists legacy_id text,
  add column if not exists source text not null default 'manual',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists schedule_blocks_location_legacy_unique
  on public.schedule_blocks (location_id, legacy_id)
  where legacy_id is not null and legacy_id <> '';

alter table public.templates
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists legacy_created_at timestamptz,
  add column if not exists legacy_updated_at timestamptz;

create unique index if not exists templates_location_legacy_unique
  on public.templates (location_id, legacy_id)
  where legacy_id is not null and legacy_id <> '';

alter table public.template_shifts
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists legacy_created_at timestamptz,
  add column if not exists legacy_updated_at timestamptz;

create unique index if not exists template_shifts_template_legacy_unique
  on public.template_shifts (template_id, legacy_id)
  where legacy_id is not null and legacy_id <> '';
