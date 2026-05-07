begin;

drop policy if exists "deny anon authenticated access" on public.bookings;

create policy "deny_anon_bookings"
  on public.bookings
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

create policy "authenticated_read_own_bookings"
  on public.bookings
  as restrictive
  for select
  to authenticated
  using (auth.uid() = customer_id);

create policy "deny_authenticated_insert_bookings"
  on public.bookings
  as restrictive
  for insert
  to authenticated
  with check (false);

create policy "deny_authenticated_update_bookings"
  on public.bookings
  as restrictive
  for update
  to authenticated
  using (false)
  with check (false);

create policy "deny_authenticated_delete_bookings"
  on public.bookings
  as restrictive
  for delete
  to authenticated
  using (false);

commit;
