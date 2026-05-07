begin;

create table public.assistant_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id_hash text not null,
  label text,
  lane_summary jsonb not null default '{"assistant": 0, "rag": 0, "scheduler": 0}'::jsonb
    check (jsonb_typeof(lane_summary) = 'object'),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create table public.assistant_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.assistant_sessions (id) on delete cascade,
  seq integer not null,
  role text not null check (role in ('user', 'assistant')),
  lane text not null check (lane in ('assistant', 'rag', 'scheduler')),
  kind text not null,
  content text not null,
  pii_masked boolean not null default false,
  pii_findings jsonb not null default '[]'::jsonb check (jsonb_typeof(pii_findings) = 'array'),
  citations jsonb,
  status text,
  scheduler_state text,
  booking_code text,
  available_funds jsonb,
  slots jsonb check (slots is null or jsonb_typeof(slots) = 'array'),
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

create index assistant_sessions_device_last_activity_idx
  on public.assistant_sessions (device_id_hash, last_activity_at desc);

create index assistant_session_events_session_seq_idx
  on public.assistant_session_events (session_id, seq);

alter table public.assistant_sessions enable row level security;
alter table public.assistant_session_events enable row level security;

create policy "deny anon authenticated access"
  on public.assistant_sessions
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny anon authenticated access"
  on public.assistant_session_events
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

commit;
