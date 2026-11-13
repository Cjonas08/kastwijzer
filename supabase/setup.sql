-- Kastwijzer: plak dit volledig in Supabase → SQL Editor → Run.
-- Maakt de tabel voor je kleerkast, de foto-opslag en de beveiliging (enkel jij ziet je eigen data).

-- 1. Tabel: één rij per artikel, outfit of aanpassing.
create table if not exists public.records (
  user_id        uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  store          text        not null check (store in ('items', 'outfits', 'overrides', 'extras')),
  id             text        not null,
  data           jsonb,
  updated_at     bigint      not null,              -- tijdstip van de wijziging op het toestel (ms)
  deleted        boolean     not null default false,
  server_updated timestamptz not null default now(), -- wanneer de server de wijziging kreeg
  primary key (user_id, store, id)
);
create index if not exists records_user_server_updated on public.records (user_id, server_updated);

create or replace function public.records_touch() returns trigger language plpgsql as $$
begin
  new.server_updated := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- 2. Beveiliging: elke gebruiker ziet en wijzigt enkel zijn eigen rijen.
alter table public.records enable row level security;
drop policy if exists "eigen records" on public.records;
create policy "eigen records" on public.records for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. Foto-opslag (privé): elke gebruiker heeft een eigen map.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "eigen fotos lezen" on storage.objects;
drop policy if exists "eigen fotos toevoegen" on storage.objects;
drop policy if exists "eigen fotos wijzigen" on storage.objects;
drop policy if exists "eigen fotos verwijderen" on storage.objects;
create policy "eigen fotos lezen" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "eigen fotos toevoegen" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "eigen fotos wijzigen" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "eigen fotos verwijderen" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);


-- Bestaande installatie bijwerken: ook 'extras' toelaten (pasfoto, gepaste beelden, weekplanning).
alter table public.records drop constraint if exists records_store_check;
alter table public.records add constraint records_store_check check (store in ('items', 'outfits', 'overrides', 'extras'));

-- Teller voor de betalende pasbeurt (functie try-on): hoeveel beelden per dag per gebruiker.
-- Geen policies: enkel de functie zelf (service role) kan hier lezen en schrijven.
create table if not exists public.tryon_usage (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null,
  count   int  not null default 0,
  primary key (user_id, day)
);
alter table public.tryon_usage enable row level security;
