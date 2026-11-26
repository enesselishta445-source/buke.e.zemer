create extension if not exists pgcrypto;

create table if not exists public.restaurant_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'owner',
  created_at timestamptz not null default now()
);

alter table public.restaurant_admins
  add column if not exists email text,
  add column if not exists role text not null default 'owner';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.restaurant_admins'::regclass
      and conname = 'restaurant_admins_role_check'
  ) then
    alter table public.restaurant_admins
      add constraint restaurant_admins_role_check check (role in ('owner', 'staff'));
  end if;
end;
$$;

update public.restaurant_admins as admin
set email = lower(auth_user.email)
from auth.users as auth_user
where admin.user_id = auth_user.id
  and auth_user.email is not null;

create unique index if not exists restaurant_admins_email_unique
  on public.restaurant_admins (lower(email))
  where email is not null;

alter table public.restaurant_admins enable row level security;
revoke all on public.restaurant_admins from anon, authenticated;

create or replace function public.is_restaurant_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.restaurant_admins
    where user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

revoke all on function public.is_restaurant_owner() from public;
grant execute on function public.is_restaurant_owner() to authenticated;

create or replace function public.is_restaurant_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.restaurant_admins
    where user_id = (select auth.uid())
      and role in ('owner', 'staff')
  );
$$;

revoke all on function public.is_restaurant_staff() from public;
grant execute on function public.is_restaurant_staff() to authenticated;

create or replace function public.grant_restaurant_staff(staff_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
  target_email text;
begin
  if not public.is_restaurant_owner() then
    raise exception 'Only the restaurant owner can authorize staff.';
  end if;

  select id, email
  into target_user_id, target_email
  from auth.users
  where lower(email) = lower(btrim(staff_email))
  limit 1;

  if target_user_id is null then
    raise exception 'Create or invite this user in Supabase Auth before granting access.';
  end if;

  if exists (
    select 1
    from public.restaurant_admins
    where user_id = target_user_id
      and role = 'owner'
  ) then
    raise exception 'An owner account cannot be changed to staff.';
  end if;

  insert into public.restaurant_admins (user_id, email, role)
  values (target_user_id, lower(target_email), 'staff')
  on conflict (user_id) do update
    set email = excluded.email,
        role = 'staff'
    where public.restaurant_admins.role = 'staff';
end;
$$;

revoke all on function public.grant_restaurant_staff(text) from public;
grant execute on function public.grant_restaurant_staff(text) to authenticated;

create or replace function public.revoke_restaurant_staff(staff_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_restaurant_owner() then
    raise exception 'Only the restaurant owner can revoke staff access.';
  end if;

  delete from public.restaurant_admins
  where user_id = staff_user_id
    and role = 'staff';

  if not found then
    raise exception 'The selected staff account was not found.';
  end if;
end;
$$;

revoke all on function public.revoke_restaurant_staff(uuid) from public;
grant execute on function public.revoke_restaurant_staff(uuid) to authenticated;

grant select, insert, delete on public.restaurant_admins to authenticated;
drop policy if exists "Owner can manage admin accounts" on public.restaurant_admins;
create policy "Owner can manage admin accounts"
  on public.restaurant_admins for all to authenticated
  using (public.is_restaurant_owner())
  with check (public.is_restaurant_owner());

create table if not exists public.restaurant_content (
  id text primary key check (id = 'main'),
  content jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.restaurant_content (id, content)
values (
  'main',
  '{
    "address": "333 Nazim Gafurri",
    "city": "Prishtinë",
    "postal_code": "10000",
    "country": "Kosovo",
    "phone": "+383 44 424 424",
    "hours": {
      "sq": "Hapur nga ora 07:00",
      "it": "Aperti dalle 07:00",
      "en": "Open from 07:00"
    }
  }'::jsonb
)
on conflict (id) do nothing;

alter table public.restaurant_content enable row level security;
drop policy if exists "Public can read restaurant content" on public.restaurant_content;
create policy "Public can read restaurant content"
  on public.restaurant_content for select to anon, authenticated using (true);
drop policy if exists "Owner can manage restaurant content" on public.restaurant_content;
create policy "Owner can manage restaurant content"
  on public.restaurant_content for all to authenticated
  using (public.is_restaurant_owner())
  with check (public.is_restaurant_owner());

grant select on public.restaurant_content to anon, authenticated;
grant insert, update, delete on public.restaurant_content to authenticated;

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  category jsonb not null,
  price numeric(8, 2) not null check (price >= 0),
  image_url text not null default '',
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.menu_items enable row level security;
drop policy if exists "Public can read available menu items" on public.menu_items;
create policy "Public can read available menu items"
  on public.menu_items for select to anon, authenticated using (is_available);
drop policy if exists "Owner can manage menu items" on public.menu_items;
create policy "Owner can manage menu items"
  on public.menu_items for all to authenticated
  using (public.is_restaurant_owner())
  with check (public.is_restaurant_owner());

grant select on public.menu_items to anon, authenticated;
grant insert, update, delete on public.menu_items to authenticated;

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 120),
  phone text not null check (char_length(btrim(phone)) between 3 and 40),
  reservation_date date not null check (reservation_date >= current_date),
  reservation_time time not null,
  guests smallint not null check (guests between 1 and 30),
  message text not null default '' check (char_length(message) <= 1500),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table public.reservations enable row level security;
drop policy if exists "Visitors can submit reservation requests" on public.reservations;
create policy "Visitors can submit reservation requests"
  on public.reservations for insert to anon
  with check (status = 'pending');
drop policy if exists "Owner can manage reservations" on public.reservations;
create policy "Owner can manage reservations"
  on public.reservations for all to authenticated
  using (public.is_restaurant_owner())
  with check (public.is_restaurant_owner());
drop policy if exists "Authorized staff can read reservations" on public.reservations;
create policy "Authorized staff can read reservations"
  on public.reservations for select to authenticated
  using (public.is_restaurant_staff());
drop policy if exists "Authorized staff can update reservation status" on public.reservations;
create policy "Authorized staff can update reservation status"
  on public.reservations for update to authenticated
  using (public.is_restaurant_staff())
  with check (public.is_restaurant_staff());

grant insert on public.reservations to anon;
revoke insert on public.reservations from authenticated;
grant select, delete on public.reservations to authenticated;
revoke update on public.reservations from authenticated;
grant update (status) on public.reservations to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-images',
  'restaurant-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view restaurant images" on storage.objects;
create policy "Public can view restaurant images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'restaurant-images');
drop policy if exists "Owner can upload restaurant images" on storage.objects;
create policy "Owner can upload restaurant images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'restaurant-images'
    and public.is_restaurant_owner()
  );
drop policy if exists "Owner can update restaurant images" on storage.objects;
create policy "Owner can update restaurant images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'restaurant-images'
    and public.is_restaurant_owner()
  )
  with check (
    bucket_id = 'restaurant-images'
    and public.is_restaurant_owner()
  );
drop policy if exists "Owner can delete restaurant images" on storage.objects;
create policy "Owner can delete restaurant images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'restaurant-images'
    and public.is_restaurant_owner()
  );
