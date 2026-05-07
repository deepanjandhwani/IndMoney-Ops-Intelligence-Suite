begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "users_read_own_profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Bookings: add customer_id for linking bookings to authenticated users
alter table public.bookings add column if not exists customer_id uuid references auth.users(id);
create index if not exists bookings_customer_id_idx on public.bookings (customer_id);

-- Customers can read their own bookings (RLS)
create policy "customers_read_own_bookings"
  on public.bookings for select
  using (auth.uid() = customer_id);

-- Bookings: add customer email draft columns
alter table public.bookings add column if not exists customer_email_draft_id text;
alter table public.bookings add column if not exists customer_email_draft_status text not null default 'pending'
  check (customer_email_draft_status in ('pending', 'created', 'updated', 'sent', 'failed'));

commit;
