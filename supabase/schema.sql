-- Polla Familia Mima 2026 - Supabase schema
-- Pegar primero en Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists participants (
  id serial primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists match_results (
  id serial primary key,
  match_id text not null unique,
  home_team text,
  away_team text,
  home_goals int,
  away_goals int,
  stage text not null check (stage in ('group','r32','r16','qf','sf','third','final')),
  status text not null default 'scheduled',
  match_date timestamptz,
  last_updated timestamptz not null default now(),
  manual_override boolean not null default false,
  locked boolean not null default false,
  source text,
  confirmed_at timestamptz,
  raw_payload jsonb,
  qualified_team text,
  decided_by_penalties boolean not null default false
);

alter table match_results add column if not exists manual_override boolean not null default false;
alter table match_results add column if not exists locked boolean not null default false;
alter table match_results add column if not exists source text;
alter table match_results add column if not exists confirmed_at timestamptz;
alter table match_results add column if not exists raw_payload jsonb;
alter table match_results add column if not exists qualified_team text;
alter table match_results add column if not exists decided_by_penalties boolean not null default false;
alter table match_results add column if not exists api_fixture_id bigint;
alter table match_results add column if not exists api_status text;
alter table match_results add column if not exists api_elapsed int;
alter table match_results add column if not exists live_home_goals int;
alter table match_results add column if not exists live_away_goals int;
alter table match_results add column if not exists priority text not null default 'P3';
alter table match_results add column if not exists priority_override text;
alter table match_results add column if not exists featured boolean not null default false;
alter table match_results add column if not exists last_synced_at timestamptz;
alter table match_results add column if not exists next_sync_at timestamptz;
alter table match_results add column if not exists api_final_at timestamptz;
alter table match_results add column if not exists final_confirmation_count int not null default 0;
alter table match_results add column if not exists sync_error text;
alter table match_results add column if not exists espn_event_id text;
alter table match_results add column if not exists espn_status text;
alter table match_results add column if not exists espn_last_synced_at timestamptz;
alter table match_results add column if not exists espn_next_sync_at timestamptz;
alter table match_results add column if not exists live_source text;
alter table match_results add column if not exists home_penalties int;
alter table match_results add column if not exists away_penalties int;

create table if not exists predictions (
  id serial primary key,
  participant_id int not null references participants(id) on delete cascade,
  match_id text not null,
  predicted_home_goals int,
  predicted_away_goals int,
  predicted_home_team text,
  predicted_away_team text,
  stage text not null check (stage in ('group','r32','r16','qf','sf','third','final')),
  unique (participant_id, match_id)
);

create table if not exists group_predictions (
  id serial primary key,
  participant_id int not null references participants(id) on delete cascade,
  group_code text not null,
  team_code text not null,
  predicted_position int not null,
  unique (participant_id, group_code, predicted_position)
);

create table if not exists individual_predictions (
  id serial primary key,
  participant_id int not null references participants(id) on delete cascade,
  top_scorer text,
  best_player text,
  best_goalkeeper text,
  unique (participant_id)
);

create table if not exists top_scorers_cache (
  id serial primary key,
  player_name text not null,
  team text,
  goals int not null default 0,
  last_updated timestamptz not null default now(),
  unique (player_name)
);

create table if not exists group_final_standings (
  id serial primary key,
  group_code text not null,
  team_code text not null,
  final_position int not null check (final_position between 1 and 4),
  source text not null default 'manual',
  updated_at timestamptz not null default now(),
  unique (group_code, final_position),
  unique (group_code, team_code)
);

create table if not exists best_thirds_final (
  id serial primary key,
  team_code text not null unique,
  group_code text,
  source text not null default 'manual',
  updated_at timestamptz not null default now()
);

create table if not exists award_results (
  key text primary key,
  winner_name text,
  points numeric not null,
  is_confirmed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists award_name_aliases (
  id serial primary key,
  alias text not null unique,
  canonical_name text not null,
  updated_at timestamptz not null default now()
);

create table if not exists scores_cache (
  participant_id int primary key references participants(id) on delete cascade,
  total_points numeric not null default 0,
  last_calculated timestamptz not null default now()
);

-- Auxiliares de la app: logs de admin y password admin editable.
create table if not exists sync_logs (
  id serial primary key,
  source text not null,
  status text not null,
  message text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

create table if not exists football_sync_config (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  daily_soft_limit int not null default 90 check (daily_soft_limit between 1 and 100),
  emergency_reserve int not null default 10 check (emergency_reserve between 0 and 99),
  colombia_team_name text not null default 'Colombia',
  popular_teams jsonb not null default '["Brazil","Argentina","Mexico","United States","France","Spain","England","Germany","Portugal","Netherlands","Italy"]'::jsonb,
  favorite_teams jsonb not null default '[]'::jsonb,
  manual_featured_fixture_ids jsonb not null default '[]'::jsonb,
  league_id int not null default 1,
  season int not null default 2026,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

create table if not exists football_api_usage (
  id bigserial primary key,
  request_date date not null default (now() at time zone 'utc')::date,
  requested_at timestamptz not null default now(),
  endpoint text not null,
  fixture_ids bigint[] not null default '{}',
  priority text,
  trigger text not null default 'scheduler',
  response_status int,
  success boolean not null default false,
  error text,
  response_count int not null default 0,
  payload jsonb
);

create table if not exists match_result_audit (
  id bigserial primary key,
  match_id text not null,
  actor text not null,
  source text not null,
  reason text,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create table if not exists football_provider_state (
  provider text primary key check (provider in ('api-football', 'espn')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures int not null default 0,
  backoff_until timestamptz,
  access_checked_at timestamptz,
  access_available boolean,
  access_reason text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_predictions_participant on predictions(participant_id);
create index if not exists idx_predictions_match on predictions(match_id);
create index if not exists idx_predictions_stage on predictions(stage);
create index if not exists idx_match_results_stage on match_results(stage, status);
create index if not exists idx_match_results_override_flags on match_results(manual_override, locked);
create index if not exists idx_group_final_standings_group on group_final_standings(group_code, final_position);
create index if not exists idx_best_thirds_final_group on best_thirds_final(group_code);
create index if not exists idx_award_results_confirmed on award_results(is_confirmed);
create index if not exists idx_scores_total on scores_cache(total_points desc);
create index if not exists idx_sync_logs_created_at on sync_logs(created_at desc);
create unique index if not exists idx_match_results_api_fixture on match_results(api_fixture_id) where api_fixture_id is not null;
create index if not exists idx_match_results_next_sync on match_results(next_sync_at) where api_fixture_id is not null;
create index if not exists idx_match_results_api_status on match_results(api_status, stage);
create index if not exists idx_match_results_espn_status on match_results(espn_status, stage);
create index if not exists idx_football_api_usage_date on football_api_usage(request_date, requested_at desc);
create index if not exists idx_match_result_audit_match on match_result_audit(match_id, created_at desc);

insert into football_sync_config (id) values (1) on conflict (id) do nothing;
insert into football_provider_state (provider) values ('api-football'), ('espn') on conflict (provider) do nothing;

insert into award_results (key, winner_name, points, is_confirmed)
values
  ('top_scorer', null, 5, false),
  ('best_player', null, 5, false),
  ('best_goalkeeper', null, 6, false)
on conflict (key) do nothing;

insert into award_name_aliases (alias, canonical_name)
values
  ('lamine yamal', 'Yamal'),
  ('l yamal', 'Yamal'),
  ('l. yamal', 'Yamal'),
  ('yamal', 'Yamal'),
  ('mbappe', 'Mbappe'),
  ('mbappé', 'Mbappe'),
  ('kylian mbappe', 'Mbappe'),
  ('kylian mbappé', 'Mbappe'),
  ('dibu martinez', 'Dibu Martinez'),
  ('dibu martínez', 'Dibu Martinez'),
  ('emiliano martinez', 'Dibu Martinez'),
  ('emiliano martínez', 'Dibu Martinez'),
  ('diogo costa', 'Diogo Costa'),
  ('vitinha', 'Vitinha')
on conflict (alias) do update
set canonical_name = excluded.canonical_name,
    updated_at = now();

-- El backend usa SUPABASE_SERVICE_KEY, que bypasses RLS.
-- Como esta app no expone la anon key al navegador, se mantienen tablas sin politicas publicas.
