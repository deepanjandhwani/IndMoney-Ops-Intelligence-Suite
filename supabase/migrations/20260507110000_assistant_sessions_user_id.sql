begin;

alter table public.assistant_sessions
  add column user_id uuid references auth.users (id) on delete set null;

create index assistant_sessions_user_id_last_activity_idx
  on public.assistant_sessions (user_id, last_activity_at desc)
  where user_id is not null;

commit;
