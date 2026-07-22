// meme-kit.mjs — resolve a "meme cutaway" for a video beat: pick an
// intentional reaction (keyword-matched or explicit override), search Giphy
// (licensed for embedding GIFs/clips in third-party content — the safe
// alternative to scraping arbitrary internet images), and cache the clip's
// MP4 rendition locally so repeat renders don't re-hit the API.
//
// Mirrors chart-kit.mjs's flagDataUri() pattern (fetch-once-then-reuse,
// silent failure so a missing key/result never breaks a whole render) but
// caches to the persistent, gitignored .cache/ dir instead of os.tmpdir(),
// since these clips are worth keeping across runs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE_DIR = path.join(ROOT, ".cache", "memes");

function getGiphyKey() {
  if (process.env.GIPHY_API_KEY) return process.env.GIPHY_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^GIPHY_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

// keyword → Giphy search query. First match wins; keep entries broad enough
// to catch this toolkit's usual beats (crashes, records, surprising stats,
// debt/spending) without being so broad they misfire on unrelated text.
export const MEME_MOODS = [
  { re: /\b(crash(ed)?|plunge[ds]?|collapse[ds]?|crisis|decline[ds]?|down\s*\d)\b/i, query: "this is fine fire" },
  { re: /\b(record|surge[ds]?|booming|all-time high|soar(ed|ing)?)\b/i, query: "success kid" },
  { re: /\b(shocking|surprising|wait what|whoa|unbelievable)\b/i, query: "shocked pikachu" },
  { re: /\b(debt|deficit|spending|printer|inflation)\b/i, query: "money printer go brrr" },
  { re: /\b(expensive|cost|price[ds]?|can't afford)\b/i, query: "empty pockets meme" },
  { re: /\b(scandal|corrupt(ion)?|fraud)\b/i, query: "side eye meme" },
];

// Generic fallback rotation — deterministic (seeded from the beat text, no
// Math.random()) so a re-render of the same storyboard is reproducible.
const GENERIC_QUERIES = ["reaction meme", "confused math lady", "mind blown meme", "eye roll meme"];
function seededPick(list, seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

export function pickMemeQuery(beatText, override) {
  if (override) return override;
  const hit = MEME_MOODS.find((m) => m.re.test(beatText));
  if (hit) return hit.query;
  return seededPick(GENERIC_QUERIES, beatText || "meme");
}

// rating "g" (not "pg-13") — Giphy's rating is a self-reported tag by the
// uploader, not a reliable content filter (a "pg-13" search here returned an
// unrelated adult-humor gag clip for "wallet empty meme"), so this is a
// mitigation, not a guarantee. ALWAYS spot-check a newly resolved clip before
// publishing a video that uses an auto-picked or new query — this project has
// no automated moderation step between Giphy's search results and the render.
export async function giphySearch(query) {
  const key = getGiphyKey();
  if (!key) return null;
  const qs = new URLSearchParams({ api_key: key, q: query, limit: "8", rating: "g" });
  const res = await fetch(`https://api.giphy.com/v1/gifs/search?${qs}`);
  if (!res.ok) return null;
  const json = await res.json();
  const candidates = (json.data || []).filter((g) => g?.images?.original_mp4?.mp4);
  if (!candidates.length) return null;
  const pick = seededPick(candidates, query);
  return { id: pick.id, title: pick.title || query, mp4Url: pick.images.original_mp4.mp4 };
}

export async function cacheMemeClip(giphyId, mp4Url) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `${giphyId}.mp4`);
  if (!existsSync(cachePath)) {
    const res = await fetch(mp4Url);
    if (!res.ok) return null;
    writeFileSync(cachePath, Buffer.from(await res.arrayBuffer()));
  }
  return cachePath;
}

// Combines the above into one call for make-video.mjs: returns
// { src: <absolute local mp4 path>, credit: "GIPHY" } or null on any
// failure (missing key, no search results, download error) — callers should
// degrade gracefully (drop the meme beat) rather than fail the whole render.
export async function resolveMemeForBeat(beatText, override) {
  try {
    const query = pickMemeQuery(beatText, override);
    const found = await giphySearch(query);
    if (!found) return null;
    const src = await cacheMemeClip(found.id, found.mp4Url);
    if (!src) return null;
    return { src, credit: "GIPHY" };
  } catch {
    return null;
  }
}
