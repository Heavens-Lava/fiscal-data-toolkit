# fiscal-data-toolkit

Scripts that pull live data from official/audited government and public APIs and turn it into charts + Facebook captions for the "America by the Numbers" page. Full command reference: `COMMANDS.md`.

## Data standards

- Official/audited sources only (Census, BEA, BLS, Treasury, USPTO, Congress.gov, Voteview, etc.) — no scraped/unverified/contested datasets.
- Keyless APIs preferred; when a key is required, document how to get one in `COMMANDS.md`.
- Verify before posting: cross-check numbers against a second source or the raw API response before writing them into a caption, especially historical facts, capacities, or legal entity names that aren't in the API response itself (see `reservoir-watch.mjs`'s hardcoded reservoir capacities and `patents-by-company.mjs`'s verified assignee names for the pattern — confirm via the live API/a reliable source, don't recall from memory).

## Chart quality gate — every new or redesigned chart

This project has the `dataviz` skill available. Use it, don't skip it:

1. **Before writing chart code**, invoke/consult the `dataviz` skill — it has a form heuristic (`references/choosing-a-form.md`), a color-assignment formula, mark specs, and — critically — `references/anti-patterns.md`, the catalog of what goes wrong.
2. **Any new custom color** (not already one of `chart-kit.mjs`'s `C.*` palette values) gets run through `scripts/validate_palette.js` before shipping. A WARN isn't dismissable — it requires the mitigation the skill specifies (usually: always direct-label that color's values).
3. **After generating the PNG, render and look at it** (Read the image) before presenting it to the user or scheduling it — check for label collisions/clipping, geometry, overflow, and whether the hero number is self-explanatory without reading the subtitle. This is the step that catches what a human would catch on first glance; do it before the user has to.
4. **Reuse `chart-kit.mjs` primitives** (`cardHTML`, `horizontalBarChart`, `lineChart`, `donutChart`, etc.) by default. Only build a bespoke HTML template (see `congress-votes.mjs`'s `buildBillSocial`/`buildNoVoteTreatyCard`, or `corporate-profits-vs-wages-watch.mjs`'s 3-panel layout) when the shared templates genuinely can't express the layout — and still pull colors/spacing from the shared `C` palette and follow the same anti-patterns check.

## Facebook scheduling

- Facebook rejects `scheduled_publish_time` more than ~27 days out. The approval queue can hold more than that window has slots for — run `npm run promote-queue` (or the installed daily task, `install-promote-queue-schedule.ps1`) to drain it into open slots as they free up. Don't just error out when the window is full; that's expected, not a bug.
- `SOCIAL_SCHEDULE_SLOTS` in `.env` controls posts/day — check its current value before assuming the default 2/day.
