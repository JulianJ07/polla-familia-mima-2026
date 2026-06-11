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
