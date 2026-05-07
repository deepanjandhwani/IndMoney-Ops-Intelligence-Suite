begin;

create extension if not exists pgcrypto with schema extensions;

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  run_time timestamptz not null default now(),
  status text not null check (status in ('success', 'partial_success', 'failed')),
  reviews_fetched integer not null default 0 check (reviews_fetched >= 0),
  reviews_stored integer not null default 0 check (reviews_stored >= 0),
  reviews_skipped integer not null default 0 check (reviews_skipped >= 0),
  reviews_failed integer not null default 0 check (reviews_failed >= 0),
  error_message text,
  review_window_start date,
  review_window_end date,
  next_scheduled_run timestamptz,
  created_at timestamptz not null default now(),
  check (
    review_window_start is null
    or review_window_end is null
    or review_window_start <= review_window_end
  )
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  review_id text not null unique,
  review_text text not null,
  rating smallint not null check (rating between 1 and 5),
  review_date timestamptz not null,
  source text not null default 'google_play' check (source = 'google_play'),
  ingestion_run_id uuid references public.ingestion_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.review_pulse (
  id uuid primary key default gen_random_uuid(),
  product text not null default 'Groww' check (product = 'Groww'),
  period text not null,
  total_reviews_analyzed integer not null check (total_reviews_analyzed >= 0),
  average_rating numeric(3, 2) check (average_rating is null or average_rating between 1 and 5),
  top_themes jsonb not null default '[]'::jsonb,
  weekly_summary text not null,
  action_ideas jsonb not null default '[]'::jsonb,
  top_customer_themes jsonb not null default '[]'::jsonb,
  source text not null default 'Google Play Store Reviews' check (source = 'Google Play Store Reviews'),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(top_themes) = 'array'),
  check (jsonb_typeof(action_ideas) = 'array'),
  check (jsonb_typeof(top_customer_themes) = 'array')
);

create table public.theme_snapshots (
  id uuid primary key default gen_random_uuid(),
  pulse_id uuid not null references public.review_pulse(id) on delete cascade,
  theme_name text not null,
  theme_type text not null check (theme_type in ('predefined', 'emergent')),
  review_count integer not null check (review_count >= 0),
  theme_share_percent numeric(5, 2) not null check (theme_share_percent between 0 and 100),
  keywords jsonb not null default '[]'::jsonb check (jsonb_typeof(keywords) = 'array'),
  trend_status text not null check (trend_status in ('worsening', 'improving', 'stable', 'emerging')),
  wow_change_percent numeric(6, 2),
  week_start date not null,
  week_end date not null,
  created_at timestamptz not null default now(),
  check (week_start <= week_end),
  check (
    (trend_status = 'emerging' and wow_change_percent is null)
    or trend_status <> 'emerging'
  )
);

create table public.review_embeddings (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references public.reviews(id) on delete cascade,
  embedding jsonb not null check (jsonb_typeof(embedding) = 'array'),
  model text not null default 'gemini-embedding-001' check (model = 'gemini-embedding-001'),
  created_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_code text not null unique check (booking_code ~ '^[A-Z]{2}-[A-Z][0-9]{3}$'),
  product text not null default 'Groww' check (product = 'Groww'),
  topic text not null,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  status text not null default 'pending_admin_confirmation' check (
    status in (
      'pending_admin_confirmation',
      'confirmed',
      'reschedule_requested',
      'rescheduled',
      'cancel_requested',
      'cancelled',
      'rejected'
    )
  ),
  input_mode text not null check (input_mode in ('chat', 'voice')),
  secure_link_submitted boolean not null default false,
  secure_details_token_hash text unique,
  secure_link_expires_at timestamptz,
  calendar_event_id text,
  sheet_row_id text,
  email_draft_id text,
  calendar_status text not null default 'pending' check (calendar_status in ('pending', 'created', 'updated', 'cancelled', 'failed')),
  sheet_status text not null default 'pending' check (sheet_status in ('pending', 'created', 'updated', 'cancelled', 'failed')),
  email_draft_status text not null default 'pending' check (email_draft_status in ('pending', 'created', 'updated', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slot_start < slot_end),
  check (
    (secure_details_token_hash is null and secure_link_expires_at is null)
    or (secure_details_token_hash is not null and secure_link_expires_at is not null)
  )
);

create table public.hitl_actions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  booking_code text not null,
  action_type text not null check (action_type in ('confirm', 'reschedule', 'cancel', 'reject')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed', 'failed')),
  target_booking_status text not null check (
    target_booking_status in (
      'pending_admin_confirmation',
      'confirmed',
      'reschedule_requested',
      'rescheduled',
      'cancel_requested',
      'cancelled',
      'rejected'
    )
  ),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  source_module text not null default 'advisor_scheduler' check (source_module = 'advisor_scheduler'),
  admin_notes text,
  calendar_status text not null default 'pending' check (calendar_status in ('pending', 'created', 'updated', 'cancelled', 'failed')),
  sheet_status text not null default 'pending' check (sheet_status in ('pending', 'created', 'updated', 'cancelled', 'failed')),
  email_draft_status text not null default 'pending' check (email_draft_status in ('pending', 'created', 'updated', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.secure_details_submissions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  booking_code text not null,
  token_hash text not null unique,
  details_ciphertext text not null,
  details_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(details_metadata) = 'object'),
  expires_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index reviews_review_date_idx on public.reviews (review_date desc);
create index reviews_ingestion_run_id_idx on public.reviews (ingestion_run_id);
create index review_pulse_created_at_idx on public.review_pulse (created_at desc);
create index theme_snapshots_week_idx on public.theme_snapshots (week_start, week_end);
create index theme_snapshots_pulse_id_idx on public.theme_snapshots (pulse_id);
create index bookings_status_idx on public.bookings (status);
create index bookings_slot_start_idx on public.bookings (slot_start);
create index hitl_actions_booking_id_idx on public.hitl_actions (booking_id);
create index hitl_actions_status_idx on public.hitl_actions (status);
create index secure_details_booking_code_idx on public.secure_details_submissions (booking_code);

alter table public.ingestion_runs enable row level security;
alter table public.reviews enable row level security;
alter table public.review_pulse enable row level security;
alter table public.theme_snapshots enable row level security;
alter table public.review_embeddings enable row level security;
alter table public.bookings enable row level security;
alter table public.hitl_actions enable row level security;
alter table public.secure_details_submissions enable row level security;

comment on table public.secure_details_submissions is
  'Stores encrypted secure-details payloads outside AI chat/voice transcripts. Raw PAN, Aadhaar, OTP, phone, email, account number, full name, and address must not be stored in plain text.';

commit;
