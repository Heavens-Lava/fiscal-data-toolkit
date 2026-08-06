// social-posts.mjs — shared helpers for reading generated social/ posts:
// caption extraction and a readiness-scored listing used by both the CLI
// tools (facebook-post.mjs, make-video.mjs) and the dashboard server.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { scorePostQuality } from "./post-quality.mjs";

// Many "watch" scripts write a raw stat-dump followed by a "Facebook post"
// section (divided by a "-----" rule) holding the actual polished caption.
// Use only that section when one is present; otherwise use the whole file.
export function extractCaption(raw) {
  const m = raw.match(/^Facebook post\r?\n-{3,}\r?\n/m);
  return m ? raw.slice(m.index + m[0].length).trim() : (raw || "").trim();
}

const SOURCE_WEBSITES = [
  [/consumer financial protection bureau|consumer complaint database/i, "https://www.consumerfinance.gov/data-research/consumer-complaints/"],
  [/bureau of reclamation|\brise api\b/i, "https://data.usbr.gov/rise/"],
  [/national database of childcare prices/i, "https://www.dol.gov/agencies/wb/topics/childcare/price-by-age-care-setting"],
  [/rental housing finance survey/i, "https://www.huduser.gov/portal/datasets/rhfs.html"],
  [/occupational employment and wage statistics|\boews\b/i, "https://www.bls.gov/oes/"],
  [/american time use survey/i, "https://www.bls.gov/tus/"],
  [/local area unemployment statistics/i, "https://www.bls.gov/lau/"],
  [/bureau of labor statistics|\bbls\b/i, "https://www.bls.gov/developers/"],
  [/regional price parit|regional economic accounts|bea regional|bureau of economic analysis|bea national income/i, "https://apps.bea.gov/api/signup/"],
  [/business formation statistics/i, "https://www.census.gov/econ/bfs/"],
  [/county business patterns/i, "https://www.census.gov/programs-surveys/cbp.html"],
  [/american community survey|\bacs\b|census bureau|census median/i, "https://www.census.gov/data/developers/data-sets.html"],
  [/office of personnel management|federal workforce data|\bfedscope\b/i, "https://www.fedscope.opm.gov/"],
  [/cdc\/nchs|cdc wonder|underlying cause of death/i, "https://wonder.cdc.gov/"],
  [/food enforcement reports|openfda|\bfda\b/i, "https://open.fda.gov/apis/food/enforcement/"],
  [/nhtsa|office of defects investigation/i, "https://www.nhtsa.gov/nhtsa-datasets-and-apis"],
  [/openfema|fema disaster/i, "https://www.fema.gov/about/openfema/api"],
  [/social security administration baby-name/i, "https://www.ssa.gov/oact/babynames/"],
  [/ssa office of the chief actuary|trustees report/i, "https://www.ssa.gov/OACT/TR/"],
  [/food and nutrition service|\bsnap\b/i, "https://www.fns.usda.gov/pd/supplemental-nutrition-assistance-program-snap"],
  [/irs statistics of income|\birs soi\b/i, "https://www.irs.gov/statistics/soi-tax-stats-individual-income-tax-statistics-zip-code-data-soi"],
  [/usgs earthquake|earthquake hazards/i, "https://earthquake.usgs.gov/fdsnws/event/1/"],
  [/nasa astronomy|neows|\bnasa\b/i, "https://api.nasa.gov/"],
  [/openstreetmap|nominatim|overpass/i, "https://wiki.openstreetmap.org/wiki/API"],
  [/open-meteo/i, "https://open-meteo.com/en/docs"],
  [/coingecko/i, "https://www.coingecko.com/en/api"],
  [/world bank/i, "https://datahelpdesk.worldbank.org/knowledgebase/topics/125589-developer-information"],
  [/federal reserve distributional|federal reserve financial accounts/i, "https://www.federalreserve.gov/releases/z1/dataviz/dfa/"],
  [/federal reserve|\bfred\b|freddie mac/i, "https://fred.stlouisfed.org/"],
  [/fdic bankfind|failed bank list|\bfdic\b/i, "https://banks.data.fdic.gov/docs/"],
  [/fec candidate|federal election commission/i, "https://api.open.fec.gov/developers/"],
  [/fbi crime data explorer/i, "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/docApi"],
  [/treasury fiscal data|fiscaldata|debt to the penny|monthly treasury statement|\btic system\b|us treasury/i, "https://fiscaldata.treasury.gov/api-documentation/"],
  [/usaspending/i, "https://api.usaspending.gov/"],
  [/energy information administration|\beia\b/i, "https://www.eia.gov/opendata/"],
  [/college scorecard|dept\. of education/i, "https://collegescorecard.ed.gov/data/api/"],
  [/hud point-in-time/i, "https://www.huduser.gov/portal/datasets/ahar.html"],
  [/cbp nationwide encounters/i, "https://www.cbp.gov/document/stats/nationwide-encounters"],
  [/yahoo finance/i, "https://finance.yahoo.com/"],
  [/gold-api\.com/i, "https://gold-api.com/"],
];

export function sourceWebsiteFor(raw) {
  const text = String(raw || "");
  const match = SOURCE_WEBSITES.find(([pattern]) => pattern.test(text));
  if (match) return match[1];
  const urls = text.match(/https?:\/\/[^\s<>]+/g) || [];
  return urls.map((url) => url.replace(/[),.;\]]+$/, "")).find((url) => !/facebook\.com/i.test(url)) || "https://data.gov/";
}

export function prepareFacebookCaption(raw) {
  let caption = extractCaption(raw);
  const footer = [];
  if (!/Source website:\s*https?:\/\//i.test(caption)) footer.push(`Source website: ${sourceWebsiteFor(raw)}`);
  if (!/\b(?:retrieved|processed) programmatically\b/i.test(caption)
      && !/\b(?:manually transcribed|figures transcribed|data transcribed)\b/i.test(raw)) {
    footer.push("Information retrieved programmatically via API.");
  }
  if (!/\b(?:graphs? (?:made|created) by|charts? by) Jeffrey Macy\b/i.test(caption)) footer.push("Graphs made by Jeffrey Macy.");
  if (footer.length) caption = `${caption}\n\n${footer.join("\n")}`;
  return caption.trim();
}

const REQUIRED = ["txt", "csv"];

// Scan social/ (top-level files only) for `<topic>-YYYY-MM-DD.<ext>` groups
// and score each for post-readiness, similar to post-readiness-check.mjs but
// also aware of generated .mp4 videos (counts as the visual, same as .png).
export function listSocialPosts(socialDir) {
  let names;
  try { names = readdirSync(socialDir); } catch { return []; }

  const parsed = names
    .map((name) => ({ name, m: name.match(/^(.+)-(\d{4}-\d{2}-\d{2})\.(png|html|csv|txt|mp4)$/) }))
    .filter((x) => x.m)
    .map((x) => ({ name: x.name, topic: x.m[1], date: x.m[2], ext: x.m[3] }));

  const byKey = new Map();
  for (const p of parsed) {
    const key = `${p.topic}|${p.date}`;
    if (!byKey.has(key)) byKey.set(key, { topic: p.topic, date: p.date, files: {} });
    byKey.get(key).files[p.ext] = p.name;
  }

  for (const name of names) {
    const match = name.match(/^(.+)-(\d{4}-\d{2}-\d{2})\.portrait\.png$/);
    if (!match) continue;
    const key = `${match[1]}|${match[2]}`;
    if (byKey.has(key)) byKey.get(key).files.portrait = name;
  }

  return [...byKey.values()]
    .map((post) => {
      const exts = new Set(Object.keys(post.files));
      const txtPath = post.files.txt ? path.join(socialDir, post.files.txt) : null;
      const raw = txtPath && existsSync(txtPath) ? readFileSync(txtPath, "utf8") : "";
      const caption = prepareFacebookCaption(raw);

      const problems = [];
      for (const ext of REQUIRED) if (!exts.has(ext)) problems.push(`missing .${ext}`);
      if (!exts.has("png") && !exts.has("mp4")) problems.push("no image or video");
      if (!caption.trim()) problems.push("caption/post text is empty");

      const warnings = [];
      if (!exts.has("html")) warnings.push("no .html");
      if (!exts.has("mp4")) warnings.push("no video (image-only post)");

      const readinessScore = Math.max(0, 100 - problems.length * 25 - warnings.length * 8);
      const status = problems.length ? "needs work" : warnings.length ? "ready with notes" : "ready";
      const quality = scorePostQuality({ caption, files: post.files, socialDir });

      return {
        ...post,
        hasImage: exts.has("png"),
        hasPortrait: Boolean(post.files.portrait),
        hasVideo: exts.has("mp4"),
        hasHtml: exts.has("html"),
        hasCsv: exts.has("csv"),
        caption,
        score: quality.score,
        qualityScore: quality.score,
        quality,
        readinessScore,
        status,
        problems,
        warnings,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.score - a.score || a.topic.localeCompare(b.topic));
}
