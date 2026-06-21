-- Provider resilience, source hierarchy, and separate penalty metadata.

alter table match_results add column if not exists espn_event_id text;
alter table match_results add column if not exists espn_status text;
alter table match_results add column if not exists espn_last_synced_at timestamptz;
alter table match_results add column if not exists espn_next_sync_at timestamptz;
alter table match_results add column if not exists live_source text;
alter table match_results add column if not exists home_penalties int;
alter table match_results add column if not exists away_penalties int;

create index if not exists idx_match_results_espn_status
  on match_results(espn_status, stage);

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

insert into football_provider_state (provider) values ('api-football'), ('espn')
on conflict (provider) do nothing;
