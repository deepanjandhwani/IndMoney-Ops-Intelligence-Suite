begin;

create policy "deny anon authenticated access"
  on public.ingestion_runs
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny anon authenticated access"
  on public.reviews
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny anon authenticated access"
  on public.review_pulse
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny anon authenticated access"
  on public.theme_snapshots
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny anon authenticated access"
  on public.review_embeddings
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny anon authenticated access"
  on public.bookings
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny anon authenticated access"
  on public.hitl_actions
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny anon authenticated access"
  on public.secure_details_submissions
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

commit;
