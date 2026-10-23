create table if not exists public.cinedanal_episode_rating_cache (
  series_imdb_id text not null,
  season_number integer not null check (season_number > 0),
  episodes jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  primary key (series_imdb_id, season_number)
);

alter table public.cinedanal_episode_rating_cache enable row level security;
revoke all on table public.cinedanal_episode_rating_cache from anon, authenticated;
