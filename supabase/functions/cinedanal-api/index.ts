import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const TMDB_KEY = Deno.env.get("TMDB_API_KEY")!;
const OMDB_KEYS = (Deno.env.get("OMDB_API_KEYS") || "").split(",").map(v => v.trim()).filter(Boolean);
const CACHE_OK_MS = 90 * 24 * 60 * 60 * 1000;
const CACHE_MISS_MS = 1 * 24 * 60 * 60 * 1000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const allowedPath = /^\/(trending\/(movie|tv)\/week|search\/(movie|tv|person)|discover\/(movie|tv)|genre\/(movie|tv)\/list|movie\/\d+(\/release_dates)?|tv\/\d+(\/season\/\d+)?|tv\/on_the_air|person\/\d+)$/;
const allowedParams = new Set([
  "query","page","language","sort_by","vote_count.gte","with_genres","with_original_language",
  "primary_release_date.gte","primary_release_date.lte","first_air_date.gte","first_air_date.lte",
  "certification_country","certification.lte","append_to_response",
]);

async function tmdb(path: string, params: Record<string, unknown> = {}) {
  if (!allowedPath.test(path)) throw new Error("TMDB_PATH_NOT_ALLOWED");
  const url = new URL("https://api.themoviedb.org/3" + path);
  url.searchParams.set("api_key", TMDB_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (!allowedParams.has(key) || value === "" || value == null) continue;
    url.searchParams.set(key, String(value));
  }
  if (!url.searchParams.has("language")) url.searchParams.set("language", "el-GR");
  const response = await fetch(url);
  if (!response.ok) throw new Error("TMDB_" + response.status);
  return response.json();
}

async function omdb(imdbId: string) {
  for (const key of OMDB_KEYS) {
    try {
      const response = await fetch(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${key}`);
      if (!response.ok) continue;
      const data = await response.json();
      if (data.Response === "False" && /limit/i.test(data.Error || "")) continue;
      if (data.Response === "False") return { imdbRating: null, metascore: null };
      return {
        imdbRating: data.imdbRating && data.imdbRating !== "N/A" ? Number(data.imdbRating) : null,
        metascore: data.Metascore && data.Metascore !== "N/A" ? Number(data.Metascore) : null,
      };
    } catch (_) {}
  }
  throw new Error("OMDB_LIMIT");
}

async function omdbSeason(imdbId: string, seasonNumber: number) {
  for (const key of OMDB_KEYS) {
    try {
      const url = new URL("https://www.omdbapi.com/");
      url.searchParams.set("i", imdbId);
      url.searchParams.set("Season", String(seasonNumber));
      url.searchParams.set("apikey", key);
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      if (data.Response === "False" && /limit/i.test(data.Error || "")) continue;
      if (data.Response === "False") return [];
      return (data.Episodes || []).map((episode: any) => ({
        episodeNumber: Number(episode.Episode),
        imdbId: episode.imdbID || null,
        imdbRating: episode.imdbRating && episode.imdbRating !== "N/A" ? Number(episode.imdbRating) : null,
        title: episode.Title || "",
      })).filter((episode: any) => Number.isInteger(episode.episodeNumber));
    } catch (_) {}
  }
  throw new Error("OMDB_LIMIT");
}

async function episodeRatings(imdbId: string, seasonNumber: number) {
  if (!/^tt\d+$/.test(imdbId) || !Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 100) {
    throw new Error("INVALID_SEASON_REQUEST");
  }
  const { data: cached, error } = await supabase
    .from("cinedanal_episode_rating_cache")
    .select("episodes,fetched_at")
    .eq("series_imdb_id", imdbId)
    .eq("season_number", seasonNumber)
    .maybeSingle();
  if (error) throw error;
  const ttl = cached && Array.isArray(cached.episodes) && cached.episodes.some((episode: any) => episode.imdbRating != null)
    ? CACHE_OK_MS : CACHE_MISS_MS;
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < ttl) {
    return { episodes: cached.episodes || [], cached: true };
  }
  const episodes = await omdbSeason(imdbId, seasonNumber);
  const { error: upsertError } = await supabase.from("cinedanal_episode_rating_cache").upsert({
    series_imdb_id: imdbId,
    season_number: seasonNumber,
    episodes,
    fetched_at: new Date().toISOString(),
  }, { onConflict: "series_imdb_id,season_number" });
  if (upsertError) console.error("episode cache upsert", upsertError.message);
  return { episodes, cached: false };
}

type RatingItem = { tmdbId: number; mediaType: "movie" | "tv"; imdbId?: string | null };

async function resolveRating(item: RatingItem) {
  let imdbId = item.imdbId || null;
  if (!imdbId) {
    const external = await tmdb(`/${item.mediaType}/${item.tmdbId}`, {
      language: "en-US",
      append_to_response: "external_ids",
    });
    imdbId = external.external_ids?.imdb_id || external.imdb_id || null;
  }
  let rating = { imdbRating: null as number | null, metascore: null as number | null };
  if (imdbId) rating = await omdb(imdbId);
  return { ...item, imdbId, ...rating };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function ratings(items: RatingItem[]) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 60) throw new Error("RATINGS_BATCH_1_TO_60");
  const clean = items.map(item => ({
    tmdbId: Number(item.tmdbId),
    mediaType: item.mediaType,
    imdbId: item.imdbId || null,
    cacheKey: `${item.mediaType}:${Number(item.tmdbId)}`,
  })).filter(item => Number.isInteger(item.tmdbId) && item.tmdbId > 0 && (item.mediaType === "movie" || item.mediaType === "tv"));
  const keys = [...new Set(clean.map(item => item.cacheKey))];
  const { data: cached, error } = await supabase
    .from("cinedanal_rating_cache")
    .select("cache_key,media_type,tmdb_id,imdb_id,imdb_rating,metascore,fetched_at")
    .in("cache_key", keys);
  if (error) throw error;
  const cachedMap = new Map((cached || []).map(row => [row.cache_key, row]));
  const resultMap = new Map<string, any>();
  const missing: typeof clean = [];
  const now = Date.now();

  for (const item of clean) {
    const row = cachedMap.get(item.cacheKey);
    const ttl = row && row.imdb_rating != null ? CACHE_OK_MS : CACHE_MISS_MS;
    if (row && now - new Date(row.fetched_at).getTime() < ttl) {
      resultMap.set(item.cacheKey, {
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        imdbId: row.imdb_id,
        imdbRating: row.imdb_rating == null ? null : Number(row.imdb_rating),
        metascore: row.metascore == null ? null : Number(row.metascore),
        cached: true,
      });
    } else missing.push(item);
  }

  const fetched = await mapLimit(missing, 5, async item => {
    try {
      const value = await resolveRating(item);
      return { ...value, cacheKey: item.cacheKey, cached: false };
    } catch (error) {
      return { ...item, imdbRating: null, metascore: null, cacheKey: item.cacheKey, cached: false, error: String(error) };
    }
  });

  if (fetched.length) {
    const rows = fetched.map(item => ({
      cache_key: item.cacheKey,
      media_type: item.mediaType,
      tmdb_id: item.tmdbId,
      imdb_id: item.imdbId || null,
      imdb_rating: item.imdbRating,
      metascore: item.metascore,
      fetched_at: new Date().toISOString(),
    }));
    const { error: upsertError } = await supabase.from("cinedanal_rating_cache").upsert(rows, { onConflict: "cache_key" });
    if (upsertError) console.error("cache upsert", upsertError.message);
    fetched.forEach(item => resultMap.set(item.cacheKey, {
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      imdbId: item.imdbId || null,
      imdbRating: item.imdbRating,
      metascore: item.metascore,
      cached: false,
    }));
  }
  return clean.map(item => resultMap.get(item.cacheKey));
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const body = await req.json();
    if (body.action === "tmdb") return json(await tmdb(String(body.path || ""), body.params || {}));
    if (body.action === "ratings") return json({ results: await ratings(body.items || []) });
    if (body.action === "episodeRatings") return json(await episodeRatings(String(body.imdbId || ""), Number(body.seasonNumber)));
    return json({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return json({ error: message }, message.includes("NOT_ALLOWED") ? 403 : 502);
  }
});
