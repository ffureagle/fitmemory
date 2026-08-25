-- Paste this entire file in Supabase Dashboard → SQL Editor → Run.
-- Project: https://wouetdktjqvusvsxgsyk.supabase.co

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id text primary key,
  email text not null,
  display_name text not null,
  password_hash text,
  age integer,
  height_cm numeric(6,2),
  weight_kg numeric(6,2),
  shoulder_width_cm numeric(6,2),
  chest_circumference_cm numeric(6,2),
  waist_circumference_cm numeric(6,2),
  foot_length_cm numeric(6,2),
  usual_shoe_size_eu numeric(6,2),
  fit_preference text not null default 'TrueToSize',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_idx
  on public.profiles (lower(email));

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  user_id text not null references public.profiles(user_id) on delete cascade,
  brand text not null,
  product_name text not null,
  category text not null,
  purchased_size text not null,
  outcome text not null default 'PurchasedUnknownFit',
  return_confirmed_by_user boolean not null default false,
  fit_notes text,
  user_fit_notes text,
  chest_width_cm numeric(6,2),
  shoulder_width_cm numeric(6,2),
  waist_width_cm numeric(6,2),
  length_cm numeric(6,2),
  sleeve_length_cm numeric(6,2),
  inseam_cm numeric(6,2),
  product_url text,
  image_url text,
  product_family_key text,
  research_source_url text,
  fit_label text,
  size_evidence text,
  material_summary text,
  material_evidence text,
  research_confidence integer not null default 0,
  fit_score integer,
  fit_assessment text,
  fit_assessment_confidence integer not null default 0,
  import_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_user_idx on public.orders (user_id, updated_at desc);

create table if not exists public.recommendations (
  id bigint generated always as identity primary key,
  user_id text not null references public.profiles(user_id) on delete cascade,
  product_url text not null,
  brand text,
  product_name text,
  recommended_size text not null,
  confidence integer not null,
  verdict text not null,
  explanation text not null,
  evidence_summary text,
  data_source text,
  comparisons_json jsonb not null default '[]'::jsonb,
  fit_notes_json jsonb not null default '[]'::jsonb,
  style_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.style_board_items (
  id bigint generated always as identity primary key,
  user_id text not null references public.profiles(user_id) on delete cascade,
  product_url text not null,
  brand text not null default '',
  product_name text not null default '',
  category text not null default '',
  price text not null default '',
  image_url text not null default '',
  product_reference text not null default '',
  fit_label text not null default '',
  fit_evidence text not null default '',
  description text not null default '',
  material_summary text not null default '',
  material_evidence text not null default '',
  recommended_size text not null default '',
  recommendation_confidence integer not null default 0,
  is_selected boolean not null default false,
  is_in_studio boolean not null default false,
  is_saved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_url)
);

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.recommendations enable row level security;
alter table public.style_board_items enable row level security;

drop policy if exists profiles_self on public.profiles;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select using (user_id = coalesce(auth.uid()::text, ''));
create policy profiles_insert on public.profiles for insert with check (user_id = coalesce(auth.uid()::text, ''));
create policy profiles_update on public.profiles for update using (user_id = coalesce(auth.uid()::text, ''));

drop policy if exists orders_self on public.orders;
drop policy if exists orders_all on public.orders;
create policy orders_all on public.orders
  using (user_id = coalesce(auth.uid()::text, ''))
  with check (user_id = coalesce(auth.uid()::text, ''));

drop policy if exists recommendations_self on public.recommendations;
drop policy if exists recommendations_all on public.recommendations;
create policy recommendations_all on public.recommendations
  using (user_id = coalesce(auth.uid()::text, ''))
  with check (user_id = coalesce(auth.uid()::text, ''));

drop policy if exists style_board_self on public.style_board_items;
drop policy if exists style_board_all on public.style_board_items;
create policy style_board_all on public.style_board_items
  using (user_id = coalesce(auth.uid()::text, ''))
  with check (user_id = coalesce(auth.uid()::text, ''));

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, display_name, password_hash, created_at, updated_at)
  values (
    new.id::text,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'displayName', split_part(coalesce(new.email, 'user'), '@', 1)),
    '',
    now(),
    now()
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
