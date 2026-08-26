create extension if not exists pgcrypto;

create table if not exists public.app_records (
  kind text not null,
  id text not null,
  company_id text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);

create index if not exists app_records_kind_company_idx
  on public.app_records (kind, company_id, updated_at desc);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_created_at_idx
  on public.audit_events (created_at desc);

alter table public.app_records enable row level security;
alter table public.audit_events enable row level security;

-- No browser-facing policies are intentionally created. The Express API is the
-- authorization boundary and accesses these tables with the server-only service role.
revoke all on public.app_records from anon, authenticated;
revoke all on public.audit_events from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proposal-files',
  'proposal-files',
  false,
  52428800,
  array['application/pdf', 'text/plain', 'application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
