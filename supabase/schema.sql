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
  raw_payload jsonb
);

alter table match_results add column if not exists manual_override boolean not null default false;
alter table match_results add column if not exists locked boolean not null default false;
alter table match_results add column if not exists source text;
alter table match_results add column if not exists confirmed_at timestamptz;
alter table match_results add column if not exists raw_payload jsonb;

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

create table if not exists scores_cache (
  participant_id int primary key references participants(id) on delete cascade,
  total_points numeric not null default 0,
  last_calculated timestamptz not null default now()
);

-- Auxiliares de la app: logs de sincronizacion y password admin editable.
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

create index if not exists idx_predictions_participant on predictions(participant_id);
create index if not exists idx_predictions_match on predictions(match_id);
create index if not exists idx_predictions_stage on predictions(stage);
create index if not exists idx_match_results_stage on match_results(stage, status);
create index if not exists idx_match_results_override_flags on match_results(manual_override, locked);
create index if not exists idx_scores_total on scores_cache(total_points desc);
create index if not exists idx_sync_logs_created_at on sync_logs(created_at desc);

-- El backend usa SUPABASE_SERVICE_KEY, que bypasses RLS.
-- Como esta app no expone la anon key al navegador, se mantienen tablas sin politicas publicas.
