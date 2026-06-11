-- Migration segura para bases ya creadas.
-- Pegar en Supabase SQL Editor una sola vez antes de usar correcciones manuales.

alter table match_results add column if not exists manual_override boolean not null default false;
alter table match_results add column if not exists locked boolean not null default false;
alter table match_results add column if not exists source text;
alter table match_results add column if not exists confirmed_at timestamptz;
alter table match_results add column if not exists raw_payload jsonb;

create index if not exists idx_match_results_override_flags on match_results(manual_override, locked);
