# BrokerBuddy — Project Guide for Claude Code

(Formerly "Tobago Property Finder" — rebranded to **BrokerBuddy** 2026-06.)

A single-file, vanilla-JS web app for Tobago real estate agents. No framework,
no build step. All client persistence is browser localStorage. A separate
Node.js crawler (refresh.js) runs in GitHub Actions to build a shared listings
repository that the app reads for free.

---

## Repository layout

```
Property-Finder/
├── index.html                          ← the entire app (~227KB, HTML+CSS+JS inline)
├── refresh.js                          ← shared-repo crawler (Node, runs in CI)
├── watchlist-notify.js                 ← Watch List WhatsApp alerts (Node, runs in CI after refresh)
├── .github/workflows/refresh-listings.yml  ← weekly schedule (Monday, RUN_GROUP=all)
├── data/repo.json                      ← crawler output; app fetches this
└── data/watchlist.json                 ← per-client alert criteria, published from the app
```

## Login
Any name + PIN `1234`. PIN stored in localStorage key `tpf_pin`, fallback
hardcoded `APP_PIN = '1234'`.

---

## CRITICAL CONVENTIONS — follow these on every edit

1. **Vanilla JS only.** No frameworks, no bundler, no npm packages in the app.
   Everything inline in index.html. The ONLY external script is SheetJS (CDN)
   for Excel import in the valuator.
2. **After ANY change to index.html JS**, extract the script and run
   `node --check` on it before considering the task done. The file is large and
   string edits are easy to break. Never ship without a clean syntax check.
3. **Edits should be surgical.** Locate the exact function, edit in place.
   Don't reformat or "tidy" surrounding code.
4. **All persistence is localStorage**, keys prefixed `tpf_` (see below).
5. **Match the design system** — see below (Midnight Estate). Match it
   exactly; it's CSS-variable driven, so re-theme at the token blocks. Never introduce
   default browser styling.

## localStorage keys
| Key | Holds |
|-----|-------|
| `tpf_repo` | cached listings (the searchable repository) |
| `tpf_repo_date` | repository timestamp |
| `tpf_shared_repo_url` | URL of the shared GitHub repo.json |
| `tpf_pin` | agent PIN |
| `tpf_profile` | agent name, agency, phone, email, license |
| `tpf_contacts` | client contacts |
| `tpf_client_shortlists` | per-client property lists |
| `tpf_cb` | co-broker requests |
| `tpf_sold_comps` | agent-entered sold comparables (valuator) |
| `tpf_val_cal` | per-area valuation calibration % |
| `tpf_usage` | weekly API-call usage tracker |
| `tpf_watchlist` | per-client Watch List criteria (+ dirty/publishedAt sync state) |
| `tpf_watch_seen` | timestamp of last Watch List tab visit (drives the nav badge) |
| `tpf_gh_token` | fine-grained GitHub PAT for publishing the watch list (excluded from backup export) |
| `anthropic_key` | the agent's API key (never leaves device) |

---

## Design system — "Midnight Estate" (current direction)

The app was redesigned (2026-06) into a dark-luxury **Midnight Estate** theme
with a **dashboard layout**. Everything is driven by CSS variables in `:root`
(light theme) and `body.dark` (Midnight). **Midnight is the default** — the app
boots with `body class="dark"`; the ☀/☽ toggle switches to the light theme.
Change tokens at the variable blocks, not per-component.

- **Default = dark/Midnight:** near-black canvas `--bg:#0B0F0D`, panel surfaces
  `--white:#141A15`, gold hairline borders `rgba(201,162,75,.16)`, cream text
  `--ink:#F3EEE3`. Light theme preserved as the toggle-off option.
- **Fonts:** Playfair Display (headings, big numbers, prices) + DM Sans (UI/body).
- **Palette:** forest greens `#0E2E1F`/`#15492F`/`#2F9D67`; gold `#C9A24B` /
  `#E2C079`; deal badges green=below-avg, gold=above-avg.
- **Layout:** LEFT SIDEBAR nav (`.app-sidebar` = logo + vertical `.sidebar-nav`)
  + `.app-main` (slim forest header with page title left, agent pill right, +
  scroll). `#appScreen.active` is a CSS grid `236px 1fr`; collapses to
  icon-only under 820px. Tab panels use `.tab-inner` (max 1120px); the
  **Dashboard** is the landing screen (`#panel-dashboard`).
- **Cards:** `--white` bg, gold hairline border, soft shadow, gold hover glow +
  lift. Results render as a responsive grid (`#cardList`). Data-rich: stats
  strip, deal badges (price vs type avg), $/sqft, sort + "deals only".
- **Radius scale:** 6 / 10 / 14 / 20 / 28px.
- **Buttons:** gradient forest green. WhatsApp buttons `#25D366`.
- **Brand:** name **BrokerBuddy**; logo = gold house-key on a forest crest
  (inline SVG, ids `bbSide`/`bbLogin`; also the favicon data-URI in `<head>`).
- **Login:** island scene (sun glow, palm silhouettes, layered sea) over forest.
- **Motion:** fadeSlideIn, staggered card entrance, 0.15–0.2s; `transform` not
  layout; respect `prefers-reduced-motion`. Mobile-first, WCAG AA contrast.

---

## App features (all built, working)

- **Search** — reads from `tpf_repo` (free) if present; else live API search
  across sites, throttled 2-at-a-time / 3s gap, relevance scored 0–10, streams
  cards in. Keyword + must-include filters, search history, similar-property.
- **Land Valuator** — micro-locations, size-based PSF sliding scale, 6
  adjustment toggles (flat/frontage/seaview/utilities/fenced/corner), leasehold
  −35%, confidence dots, agent sold-comps DB, Excel import (SheetJS),
  per-area calibration slider, live-comps lookup. Data sources ranked:
  agent sold comps > repo-derived PSF > static research data (widened ±25%).
- **Comparables (CMA)** — `panel-comps`. Exposes the *evidence* behind a
  valuation: pick a subject (from repo or manual entry), get a ranked comp set
  split into 🟢 SOLD vs 🟡 ASKING with a per-comp **match %**, plus a suggested
  Low/Likely/High range + confidence. Engine = `findComparables(subject)`, which
  reuses the same scoring philosophy as `knnPSF` (location/size/recency/source
  weighting, ~8% asking→sold haircut). For LAND the headline range is taken
  straight from `knnPSF` so it always matches the Valuator; for RESIDENTIAL
  (repo lacks clean building sqft) it falls back to a similarity-weighted price
  band keyed on area+beds. "⚖ Comparables" button on every search card jumps in
  with that listing as subject; "🏷️ Sold?" on an asking comp feeds the sold DB.
  Two client-ready exports: **Share via WhatsApp** (`shareCmaWhatsApp` → contact
  picker) and **Print / Save PDF** (`printCMA` opens a branded one-page document
  in a new window with its own print CSS — saves as PDF via the browser dialog).
- **Watch List** — `panel-watchlist`. Per-client search criteria (types, areas,
  price range, min beds) with two match surfaces: (1) in-app — matches from the
  last 14 days of repo additions, nav badge for ones newer than the last tab
  visit, one-tap WhatsApp forward to the client (auto-links the contact by
  name); (2) phone alerts — "Publish watches" writes the criteria to
  `data/watchlist.json` via the GitHub contents API (fine-grained PAT stored in
  Settings → `tpf_gh_token`), and the weekly Action runs `watchlist-notify.js`
  after refresh.js: it matches THIS RUN's new listings (firstSeen ≥
  meta.lastRefresh − 10 min) and WhatsApps the agent one digest via **CallMeBot**
  (free personal gateway; secrets `CALLMEBOT_PHONE` + `CALLMEBOT_APIKEY`;
  fail-soft — never blocks the data commit). The matching function exists in
  BOTH index.html (`watchMatches`) and watchlist-notify.js (`matches`) — keep
  them in sync. Unpriced listings pass the price filter by design.
- **Shortlist** — general + per-client shortlists, WhatsApp share.
- **Co-Broker** — request tracker, status workflow, commission calculator,
  WhatsApp/email send.
- **Contacts** — client contacts + WhatsApp contact-picker modal.
- **Settings** — agent profile, PIN change, usage tracker, Shared Repo URL.
- **Shared repo sync** — fetches data/repo.json on load; Verify button does a
  ~TT$0.05 live re-check of a single listing; "possibly sold" badge for stale.
- **Diagnostic** — "Test sites" button reports per-site listing counts.
- **Dashboard landing** — KPIs, market-by-type, most-active-areas, latest
  listings (badged), best-value finds, pipeline counts, possibly-sold alerts,
  repository panel; all computed live from `tpf_repo` + localStorage.
- Light/dark toggle (Midnight default), offline detection, left sidebar nav,
  agent dropdown, watermark.

---

## THE SEARCH/CRAWL STORY (hard-won — read before touching data sources)

The core challenge: getting the most accurate, complete listing data possible.
Long investigation produced these findings. **Do not relitigate these from
scratch — they were established empirically over many runs.**

### Two ways to get data
1. **CRAWL (reliable, free of search quota)** — refresh.js fetches a site's
   index pages directly (server-side, no CORS), follows pagination, collects
   listing URLs, fetches each page, extracts via (a) free JSON-LD structured
   data, then (b) cheap batched Claude HTML extraction (NO web_search tool).
   This is the dependable backbone.
2. **SEARCH (unreliable)** — Claude `web_search` tool with `site:` queries.
   Returns ~10 results/query and is INCONSISTENT: the same site returns 17 one
   run and 0 the next. Running many in parallel causes rate-limit starvation
   (sites at the back of the queue return 0). Not fixable by tuning — it's the
   nature of the tool.

### Per-site verdicts (as of last tuning)
| Site | Method | Notes |
|------|--------|-------|
| charbonnerealty.com | CRAWL | reliable 19–34 listings |
| mybunchofkeys.com | CRAWL | reliable 16–26 |
| rain-properties-tobago.com | CRAWL | use `/villatobuy.html` + `/property-sales`; 12–19; prices on sub-pages |
| seajaderealty.com | CRAWL | **REBRANDED from seajadeinvestments.com (old domain 404s).** Index `/properties` is JS-rendered, but detail pages `/properties/rsNNN` (residential) and `/properties/tlNNN` (land) are fully server-rendered WITH prices. Listing IDs are embedded in the index HTML (not all as `<a href>`), so refresh.js extracts them via `idPattern`/`idBase`. ~33 listings (14 res + 19 land). |
| villasoftobago.com | CRAWL | detail pages `/[name]-property-page.html`; MOSTLY RENTALS with "Enquire for price" — few prices |
| islreal.com | CRAWL | Island Investments (Tobago-only). WordPress "Directorist" plugin: index pages `/properties-for-sale/` + `/?directory_type=land` server-render all detail links (27 sale + 68 land, single page, no pagination); detail pages `/directory/{sale,land}/[slug]/` server-render the TT$ price. listingHint limited to `sale\|land` so `/directory/rental/` is excluded at the URL stage. |
| royaltytobago.com | CRAWL | Royalty Tobago. WordPress real-estate theme: index pages `/status/for-sale/` + `/property-type/land/` server-render `/property/<slug>/` detail links (~17 for-sale + ~19 land); detail pages server-render the price (`<span class="price-prefix">TTD </span>$…`). |
| realestatetobago.com | CRAWL (via Sucuri solver) | Behind **Sucuri CloudProxy** (`Server: Sucuri/Cloudproxy`) — every fetch gets a JS challenge. `fetchPage` solves it in-process: the challenge is a deterministic obfuscated script (NOT a CAPTCHA) that sets a `sucuri_cloudproxy_uuid_*` cookie; `solveSucuri()` evals it in a `vm` sandbox to recover the cookie, caches it per host, and retries. Indexes: `/property-type/houses-for-sale/` + `/property-type/land-for-sale/` (9/page, paginated), detail `/property/[slug]/` with real prices. Two anti-inflation guards: tight listingHint (`/property/[slug]/$`) AND `noSitemap: true` — its `/property-sitemap.xml` dumps ALL 141 property pages (rentals + sold + every category), so we skip the sitemap and rely on the for-sale category indexes + pagination (~64 clean for-sale URLs). Has some Trinidad listings (caught by TRINIDAD_RE). If the solver ever breaks, Sucuri changed its challenge format. |
| pin.tt | **REMOVED (2026-07-09, owner decision)** | was the richest search source (~17–26) but JS-rendered index defeats crawl AND search results arrived without URLs — unverifiable, undedupable, no click-through. Its 45 repo entries were purged; refresh.js also purges any straggler (`p.site === 'pin.tt'`) so they can't become fake sold candidates. Do NOT re-add without solving the URL problem. |
| terracaribbean.com | SEARCH | weak (1–6); JS-rendered |
| caribbeanrealestatemls.com | SEARCH | listings at `/real-estate/tobago/[id]`; weak via search; JS-rendered index |

### refresh.js architecture
- **CRAWL_SITES**: charb, rain, keys, ralestate (realestatetobago.com),
  seajade (seajaderealty.com), islreal, royalty — each with `seeds[]` and a
  `listingHint` regex; optional `mustMatch`, `noSitemap` (ralestate + royalty:
  their sitemaps dump rentals/sold pages), and `idPattern`/`idBase` (seajade
  extracts listing IDs embedded in the index HTML).
- **Sucuri WAF solver** (`solveSucuri` + `fetchPage`): realestatetobago.com
  serves a deterministic JS cookie-challenge; fetchPage solves it in a `vm`
  sandbox and caches the cookie per host. No browser/dep needed.
- **Data hygiene**: this is a Tobago FOR-SALE repo. `RENTAL_RE` + `TRINIDAD_RE`
  (top of refresh.js) reject rentals and non-Tobago (Trinidad) listings both at
  the URL stage and post-extraction, and purge any already in the repo. National
  agencies (mybunchofkeys) leak Trinidad listings; rain/charbonne leak rentals.
  Extra guards (2026-07-09): `isSuspectRental` price floor — a non-land listing
  priced under TT$150k is a disguised rental rate (monthly/nightly), reject +
  purge; types are CANONICALIZED at merge ("residential land"/"agricultural
  land"/etc → `land`, `townhouse` → `house`, original kept in `subtype`)
  because the app compares types with exact equality everywhere (valuator land
  PSF pool, watch list, dashboard averages).
- **SEARCH_GROUPS A/B**: search batches split into two groups via `RUN_GROUP`.
  The weekly scheduled run uses `RUN_GROUP=all` (both groups in one pass);
  `workflow_dispatch` can still run A or B alone. (Was alternated across two
  daily runs so each got fresh quota; now one weekly all-in-one run.)
  A = caribbeanMLS, villas. B = terracaribbean. (pin.tt batches removed
  2026-07-09 with the source.)
- **Sitemap discovery** (`fetchSitemapUrls`) tries sitemap.xml variants to
  bypass JS index pages (helps some sites, not all).
- **Budgets**: MAX_PAGES_PER_SITE=8, MAX_LISTINGS_PER_SITE=50,
  MAX_EXTRACT_CALLS=64 (global ceiling = 8 crawl sites × the per-site cap),
  MAX_EXTRACT_CALLS_PER_SITE=8, EXTRACT_BATCH=4. The budget is a single
  greedy counter consumed in crawl order, so the global ceiling MUST stay
  ≥ sites × per-site cap — at 40, trailing sites (islreal, royalty) were
  starved to 0 listings for weeks. Keep this invariant when adding sites.
- **Merge logic**: listings accumulate across runs, keyed on the normalised
  listing URL (`normUrl`); title|site is the fallback only for URL-less
  search results (pin.tt). It was keyed title|site until 2026-07, but Claude
  re-phrases titles slightly on every extraction run, so the same property
  piled up as duplicates (seajade hit 120 entries over 30 URLs — a one-time
  cleanup collapsed 105 dupes). Freshness thresholds are calibrated to the
  WEEKLY cadence: unseen 16+ days (missed 2+ runs) → status 'stale' (shows
  "possibly sold"); unseen 35+ days (missed ~5) → dropped. One missed crawl
  must never flag "possibly sold".
- **JSON truncation recovery**: when a Claude response is cut off by max_tokens
  (no closing `]`), slice from first `[` to end and recover complete objects up
  to the last `}`. This bug silently discarded whole batches before it was
  fixed. In the app this now lives in ONE helper, `parseClaudeJsonArray(text)`
  (used by every array-extraction call site) — keep it the single source. The
  crawler (separate Node process) has its own equivalent copy; preserve it.

### Known cleanup task
(Resolved 2026-07-09: pin.tt removed from the app's SITES list and the dead
seajadeinvestments.com domain updated to seajaderealty.com. The remaining
SITES entries still don't mirror the crawler's crawl/search split exactly,
but the app primarily reads the shared repo, so this stays low-priority.)

---

## Deploy
- Repo: `github.com/roryrag/Property-Finder`
- Host: **GitHub Pages** (free), served at
  `https://roryrag.github.io/Property-Finder/`, connected to the repo; every push
  to `main` auto-deploys via the `github-pages` environment. Note: GitHub's
  deployment-status API can sit on `in_progress` for a couple of minutes after
  the CDN is already serving the new content — verify by fetching the live URL,
  not by the reported status. (Previously on Cloudflare Pages, and Netlify before
  that — Netlify hit credit limits, avoid.)
- The GitHub Actions secret `ANTHROPIC_API_KEY` powers the crawler; optional
  `CALLMEBOT_PHONE` + `CALLMEBOT_APIKEY` enable Watch List WhatsApp alerts.
- Workflow runs weekly (Monday 10:00 UTC, `RUN_GROUP=all`) and
  `workflow_dispatch` allows a manual run with a group dropdown (A / B / all).

## Valuation data caveat (state honestly to the user)
There is NO public sold-price source in Trinidad & Tobago (PIMS Land Registry
requires a paid subscription). ALL listing data is ASKING price. Valuations
cannot be "true" without agent-entered sold comparables. More data points make
search richer but do NOT by themselves make valuations accurate. Asking prices
typically run ~5–15% above sold prices. USD→TTD rate used throughout: 6.80.

## Owner
Rory (roryrag@gmail.com), real estate agent in Tobago with an IT/QA background.
Prefers visually rich, interactive tools; vanilla single-file builds; near-zero
ongoing cost. Comfortable in a terminal.

---

# Padner + Vault (memory pointer) — added 2026-07-27

Your identity, rules, and long-term memory now live in the AI Memory Vault, alongside (not replacing) the project-specific guidance above.

**Boot:** read `C:\Users\roryr\CLAUDE.md` (the Padner boot config) and `C:\Users\roryr\Brain\VAULT-INDEX.md` at session start. You are **Padner** — bottom-line-first, honest, fun-but-straight.

**This project's living memory is in the vault:**
- `04 - Property Finder\Watch List Alerts — Live State.md` — the alert loop's live/configured state and where to start when debugging a missed alert.
- `04 - Property Finder\Property Finder.md` — the folder index.

**Do not write project memory to `~/.claude/.../memory` anymore** — that layer now redirects to the vault. Persist anything worth keeping to the vault note above, plus today's daily note and `Active Priorities.md` where relevant.
