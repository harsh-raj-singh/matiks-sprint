create extension if not exists pgcrypto with schema extensions;

create table if not exists public.sprint_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  player_name text not null default 'Guest' check (
    char_length(player_name) between 2 and 40
  ),
  score integer not null check (score >= 0 and score <= 100000),
  correct_count integer not null check (
    correct_count >= 0 and correct_count <= 240
  ),
  attempted_count integer not null check (
    attempted_count >= 0 and attempted_count <= 240
  ),
  duration_seconds integer not null default 60 check (duration_seconds = 60),
  max_streak integer not null default 0 check (
    max_streak >= 0 and max_streak <= 240
  ),
  average_ms_per_question integer check (
    average_ms_per_question is null
    or (
      average_ms_per_question >= 0
      and average_ms_per_question <= 60000
    )
  ),
  accuracy_percent numeric(5, 2) generated always as (
    case
      when attempted_count = 0 then 0
      else round((correct_count::numeric / attempted_count::numeric) * 100, 2)
    end
  ) stored,
  mode text not null default 'sixty_second_sprint' check (
    mode = 'sixty_second_sprint'
  ),
  client_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(client_metadata) = 'object'
  ),
  constraint sprint_attempt_counts_valid check (correct_count <= attempted_count),
  constraint sprint_attempt_streak_valid check (max_streak <= correct_count)
);

create index if not exists sprint_attempts_score_idx
  on public.sprint_attempts (score desc, created_at asc);

create index if not exists sprint_attempts_created_at_idx
  on public.sprint_attempts (created_at desc);

alter table public.sprint_attempts enable row level security;

grant usage on schema public to anon, authenticated;
grant insert, select on table public.sprint_attempts to anon, authenticated;

drop policy if exists "Public attempts are readable" on public.sprint_attempts;
create policy "Public attempts are readable"
  on public.sprint_attempts
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Public clients can submit bounded sprint attempts"
  on public.sprint_attempts;
create policy "Public clients can submit bounded sprint attempts"
  on public.sprint_attempts
  for insert
  to anon, authenticated
  with check (
    mode = 'sixty_second_sprint'
    and duration_seconds = 60
    and correct_count <= attempted_count
    and max_streak <= correct_count
    and jsonb_typeof(client_metadata) = 'object'
  );
