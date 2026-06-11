-- Manual scoring controls for World Cup pool rules.

alter table match_results add column if not exists qualified_team text;
alter table match_results add column if not exists decided_by_penalties boolean not null default false;

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

create index if not exists idx_group_final_standings_group on group_final_standings(group_code, final_position);
create index if not exists idx_best_thirds_final_group on best_thirds_final(group_code);
create index if not exists idx_award_results_confirmed on award_results(is_confirmed);

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
