create table if not exists public.cinedanal_rating_cache (
  cache_key text primary key,
  media_type text not null check (media_type in ('movie','tv')),
  tmdb_id bigint not null,
  imdb_id text,
  imdb_rating numeric(3,1),
  metascore smallint check (metascore between 0 and 100),
  fetched_at timestamptz not null default now(),
  unique (media_type, tmdb_id)
);

alter table public.cinedanal_rating_cache enable row level security;
revoke all on table public.cinedanal_rating_cache from anon, authenticated;

create index if not exists cinedanal_rating_cache_fetched_at_idx
  on public.cinedanal_rating_cache (fetched_at);