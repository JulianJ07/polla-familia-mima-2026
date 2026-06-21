-- API-Football smart sync. Additive and idempotent.

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

create unique index if not exists idx_match_results_api_fixture
  on match_results(api_fixture_id)
  where api_fixture_id is not null;
create index if not exists idx_match_results_next_sync
  on match_results(next_sync_at)
  where api_fixture_id is not null;
create index if not exists idx_match_results_api_status
  on match_results(api_status, stage);

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

insert into football_sync_config (id) values (1)
on conflict (id) do nothing;

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

create index if not exists idx_football_api_usage_date
  on football_api_usage(request_date, requested_at desc);

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

create index if not exists idx_match_result_audit_match
  on match_result_audit(match_id, created_at desc);
