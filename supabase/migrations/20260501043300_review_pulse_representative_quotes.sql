begin;

alter table public.review_pulse
  add column if not exists representative_quotes jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'review_pulse_representative_quotes_array'
  ) then
    alter table public.review_pulse
      add constraint review_pulse_representative_quotes_array
      check (jsonb_typeof(representative_quotes) = 'array');
  end if;
end
$$;

comment on column public.review_pulse.representative_quotes is
  'Exactly 3 overall representative customer quotes for the pulse; not stored per theme.';

commit;
