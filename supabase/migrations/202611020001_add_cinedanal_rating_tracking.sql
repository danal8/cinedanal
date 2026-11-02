alter table public.cinedanal_rating_cache
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists cinedanal_rating_cache_last_seen_at_idx
  on public.cinedanal_rating_cache (last_seen_at);

