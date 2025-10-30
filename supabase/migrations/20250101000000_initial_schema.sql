-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Asset table
create table public.asset (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  mime text not null,
  size int not null,
  storage_path text not null unique,
  sha256 text,
  status text not null check (status in ('draft','uploading','ready','corrupt')) default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Asset sharing table
create table public.asset_share (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.asset(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  can_download boolean not null default true,
  created_at timestamptz not null default now(),
  unique(asset_id, to_user)
);

-- Upload ticket table
create table public.upload_ticket (
  asset_id uuid primary key references public.asset(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nonce text not null unique,
  mime text not null,
  size int not null,
  storage_path text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

-- Download audit log
create table public.download_audit (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.asset(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);

-- Enable RLS
alter table public.asset enable row level security;
alter table public.asset_share enable row level security;
alter table public.upload_ticket enable row level security;
alter table public.download_audit enable row level security;

-- RLS Policies for asset
create policy "owner_full_access_asset"
on public.asset
for all
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "shared_users_read_asset"
on public.asset
for select
to authenticated
using (
  exists(
    select 1 from public.asset_share s
    where s.asset_id = asset.id and s.to_user = auth.uid() and s.can_download = true
  )
);

-- RLS Policies for asset_share
create policy "owner_manages_shares"
on public.asset_share
for all
to authenticated
using (
  exists(
    select 1 from public.asset a 
    where a.id = asset_share.asset_id and a.owner_id = auth.uid()
  )
)
with check (
  exists(
    select 1 from public.asset a 
    where a.id = asset_share.asset_id and a.owner_id = auth.uid()
  )
);

-- RLS Policies for upload_ticket
create policy "owner_manages_ticket"
on public.upload_ticket
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- RLS Policy for download_audit
create policy "users_can_insert_own_audit"
on public.download_audit
for insert
to authenticated
with check (user_id = auth.uid());

-- Indexes
create index idx_asset_owner on public.asset(owner_id);
create index idx_asset_status on public.asset(status);
create index idx_asset_share_asset on public.asset_share(asset_id);
create index idx_asset_share_user on public.asset_share(to_user);
create index idx_upload_ticket_nonce on public.upload_ticket(nonce);
create index idx_download_audit_asset on public.download_audit(asset_id);

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger asset_updated_at
before update on public.asset
for each row
execute function update_updated_at();