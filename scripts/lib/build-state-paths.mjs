// ONE-TIME / OFFLINE regeneration script for scripts/lib/us-state-paths.mjs.
//
// This is NOT part of the toolkit's normal runtime (nothing else imports this
// file, and no post-generating script needs it) — it exists only so the
// static state-shape data can be reproduced or refreshed later without
// re-deriving the projection math by hand.
//
// It needs two npm packages that are deliberately NOT repo dependencies
// (the toolkit runs on zero external deps): d3-geo and topojson-client.
// To run it:
//   cd scripts/lib
//   npm install d3-geo topojson-client --no-save
//   node build-state-paths.mjs
//   npm uninstall d3-geo topojson-client   (or just delete the node_modules
//     folder it creates — nothing else in the repo should depend on it)
//
// Data source: us-atlas's states-10m.json (ISC license), a pre-built
// TopoJSON export of US Census Bureau cartographic boundary files (US
// government work, public domain). Fetched fresh each run from unpkg so the
// script has no other input file to keep in sync.
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import { writeFileSync } from "node:fs";

const TOPOJSON_URL = "https://unpkg.com/us-atlas@3/states-10m.json";
const LABEL_AREA_MIN = 1500; // px^2 in native 960x600 projection space

// FIPS state code -> USPS postal abbreviation (skips PR/VI/GU/AS/MP territories).
const FIPS_TO_USPS = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE",
  "11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA",
  "20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN",
  "28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM",
  "36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI",
  "45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA",
  "54":"WV","55":"WI","56":"WY",
};

async function main() {
  const res = await fetch(TOPOJSON_URL);
  if (!res.ok) throw new Error(`fetch ${TOPOJSON_URL}: ${res.status}`);
  const topo = await res.json();
  const geo = feature(topo, topo.objects.states);

  // d3's built-in geoAlbersUsa at its documented default scale/translate —
  // fits a conventional 960x600 canvas (continental US + AK/HI insets).
  const projection = geoAlbersUsa().scale(1070).translate([480, 250]);
  const path = geoPath(projection).digits(1);

  const paths = {}, centroids = {}, areas = {};
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of geo.features) {
    const usps = FIPS_TO_USPS[f.id];
    if (!usps) continue;
    const d = path(f);
    if (!d) { console.error("no path for", usps); continue; }
    paths[usps] = d;
    centroids[usps] = path.centroid(f);
    areas[usps] = path.area(f);
    const b = path.bounds(f);
    if (b && isFinite(b[0][0])) {
      x0 = Math.min(x0, b[0][0]); y0 = Math.min(y0, b[0][1]);
      x1 = Math.max(x1, b[1][0]); y1 = Math.max(y1, b[1][1]);
    }
  }

  // DC has no visible shape at this resolution — project its real coordinate
  // (National Mall, 38.9072N/77.0369W) through the same pipeline for a marker.
  const dcPoint = projection([-77.0369, 38.9072]);

  const abbrs = Object.keys(paths).sort();
  const pathsLines = abbrs.map((a) => `  ${a}: ${JSON.stringify(paths[a])},`).join("\n");
  const centroidLines = abbrs.map((a) => `  ${a}: [${centroids[a][0].toFixed(1)}, ${centroids[a][1].toFixed(1)}],`).join("\n");
  const labelable = abbrs.filter((a) => areas[a] >= LABEL_AREA_MIN);

  const out = `// Real US state border shapes for stateOutlineMap() in chart-kit.mjs, baked
// in as static data so rendering never depends on a network fetch.
//
// Source: the "us-atlas" npm package (states-10m.json, ISC license — a
// pre-built TopoJSON export of US Census Bureau cartographic boundary files,
// which are themselves US-government public domain), fetched once from
// https://unpkg.com/us-atlas@3/states-10m.json and processed offline (see
// scripts/lib/build-state-paths.mjs) through d3-geo's geoAlbersUsa()
// projection (default scale 1070, translate [480,250] — the standard 960x600
// "Albers USA" composite: continental US + Alaska and Hawaii insets, both
// scaled/repositioned the same way the well-known d3/news-graphic US maps
// lay them out) to produce plain SVG path "d" strings.
//
// Coordinates below are in that native 960x600 projection space, NOT in the
// chart-kit 1104x400 viewBox — stateOutlineMap() wraps them in a single
// <g transform="translate(...) scale(...)"> computed from STATE_PATHS_BBOX
// to fit them into its plot area, so nothing here needs to be re-projected
// or hand-edited to reuse this data elsewhere.
//
// DC has no visible shape at this scale (US Census cartographic boundary
// files omit/degenerate it below 10m resolution) — DC_POINT is its real
// National Mall coordinate (38.9072N, 77.0369W) run through the same
// projection, for drawing a small marker instead of a filled shape.
//
// STATE_LABEL_ABBRS lists states whose on-screen shape is large enough (by
// projected area, threshold ${LABEL_AREA_MIN}) to carry an abbreviation label
// without the text overflowing the shape — small states (RI, DE, CT, NJ, MA,
// NH, VT, MD, HI, DC) are excluded.

export const STATE_PATHS = {
${pathsLines}
};

// [x0, y0, x1, y1] bounding box of every path above, in native projection space.
export const STATE_PATHS_BBOX = [${[x0, y0, x1, y1].map((n) => n.toFixed(2)).join(", ")}];

// Path centroid per state, in native projection space — label anchor points.
export const STATE_CENTROIDS = {
${centroidLines}
};

export const STATE_LABEL_ABBRS = ${JSON.stringify(labelable)};

// DC marker location, in native projection space.
export const DC_POINT = [${dcPoint[0].toFixed(2)}, ${dcPoint[1].toFixed(2)}];
`;

  writeFileSync(new URL("./us-state-paths.mjs", import.meta.url), out);
  console.log(`wrote us-state-paths.mjs — ${abbrs.length} states, ${out.length} bytes`);
}

main();
