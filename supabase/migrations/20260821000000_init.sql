-- trip-note 初期スキーマ
-- データモデル: trips / location_points / media(Phase 4 用に先行作成)
-- id はクライアント(iOS)が発行した UUID をそのまま使い、upsert で冪等に同期する

create table public.trips (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trips_user_started_idx on public.trips (user_id, started_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trips_set_updated_at
  before update on public.trips
  for each row
  execute function public.set_updated_at();

create table public.location_points (
  id uuid primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  altitude double precision,
  accuracy double precision,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index location_points_trip_recorded_idx on public.location_points (trip_id, recorded_at);

create type public.media_type as enum ('photo', 'video');

create table public.media (
  id uuid primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  location_point_id uuid references public.location_points (id) on delete set null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type public.media_type not null,
  storage_path text not null,
  taken_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index media_trip_taken_idx on public.media (trip_id, taken_at);

-- RLS: すべてのテーブルで「自分の行だけ」読み書きできる
alter table public.trips enable row level security;
alter table public.location_points enable row level security;
alter table public.media enable row level security;

create policy "trips_select_own" on public.trips
  for select using (user_id = auth.uid());
create policy "trips_insert_own" on public.trips
  for insert with check (user_id = auth.uid());
create policy "trips_update_own" on public.trips
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "trips_delete_own" on public.trips
  for delete using (user_id = auth.uid());

create policy "location_points_select_own" on public.location_points
  for select using (user_id = auth.uid());
create policy "location_points_insert_own" on public.location_points
  for insert with check (user_id = auth.uid());
create policy "location_points_update_own" on public.location_points
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "location_points_delete_own" on public.location_points
  for delete using (user_id = auth.uid());

create policy "media_select_own" on public.media
  for select using (user_id = auth.uid());
create policy "media_insert_own" on public.media
  for insert with check (user_id = auth.uid());
create policy "media_update_own" on public.media
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "media_delete_own" on public.media
  for delete using (user_id = auth.uid());
