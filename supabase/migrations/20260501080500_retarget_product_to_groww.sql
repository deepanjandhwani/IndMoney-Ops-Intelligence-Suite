begin;

alter table public.review_pulse
  drop constraint if exists review_pulse_product_check;

update public.review_pulse
set product = 'Groww'
where product <> 'Groww';

alter table public.review_pulse
  alter column product set default 'Groww',
  add constraint review_pulse_product_check check (product = 'Groww');

alter table public.bookings
  drop constraint if exists bookings_product_check;

update public.bookings
set product = 'Groww'
where product <> 'Groww';

alter table public.bookings
  alter column product set default 'Groww',
  add constraint bookings_product_check check (product = 'Groww');

commit;
