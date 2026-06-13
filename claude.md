# Tobago Property Finder — Project Guide for Claude Code

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
├── .github/workflows/refresh-listings.yml  ← twice-daily schedule (groups A/B)
└── data/repo.json                      ← crawler output; app fetches this
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
5. **Design system is fixed** — see below. Match it exactly; never introduce
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
| `anthropic_key` | the agent's API key (never leaves device) |

---

## Design system (DO NOT DRIFT)

- **Fonts:** Playfair Display (headings) + DM Sans (body). Google Fonts.
- **Palette:** forest greens `#0D3D28` / `#165C3E` / `#1E7A52`; gold `#C49A3C`;
  cream/sand neutrals; ink `#141414` / `#4A4A4A`.
- **Dark mode:** via `body.dark` class. Never pure white; surfaces
  `#1E1E1E` / `#2A2A2A`; gold brightened.
- **Radius scale:** 6 / 10 / 14 / 20 / 28px.
- **Cards:** white bg, 1px border, soft shadow. Real-estate cards show price as
  large serif on a green image header, spec strip, hover lift.
- **Buttons:** gradient forest green. WhatsApp buttons `#25D366`.
- **Motion:** fadeSlideIn, staggered card entrance, 0.15–0.2s transitions; use
  `transform` not layout props; respect `prefers-reduced-motion`.
- **Mobile-first**, 44×44px min touch targets, 13px min body font, safe-area insets.
- **Accessibility:** WCAG AA contrast.

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
- **Tools** — mortgage, rental-income estimator, ROI, currency converter.
- **Shortlist** — general + per-client shortlists, WhatsApp share.
- **Co-Broker** — request tracker, status workflow, commission calculator,
  WhatsApp/email send.
- **Contacts** — client contacts + WhatsApp contact-picker modal.
- **Settings** — agent profile, PIN change, usage tracker, Shared Repo URL.
- **Shared repo sync** — fetches data/repo.json on load; Verify button does a
  ~TT$0.05 live re-check of a single listing; "possibly sold" badge for stale.
- **Diagnostic** — "Test sites" button reports per-site listing counts.
- Dark mode, offline detection, top toolbar nav, agent dropdown, watermark.

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
| realestatetobago.com | CRAWL (via Sucuri solver) | Behind **Sucuri CloudProxy** (`Server: Sucuri/Cloudproxy`) — every fetch gets a JS challenge. `fetchPage` solves it in-process: the challenge is a deterministic obfuscated script (NOT a CAPTCHA) that sets a `sucuri_cloudproxy_uuid_*` cookie; `solveSucuri()` evals it in a `vm` sandbox to recover the cookie, caches it per host, and retries. Indexes: `/property-type/houses-for-sale/` + `/property-type/land-for-sale/` (9/page, paginated), detail `/property/[slug]/` with real prices. Two anti-inflation guards: tight listingHint (`/property/[slug]/$`) AND `noSitemap: true` — its `/property-sitemap.xml` dumps ALL 141 property pages (rentals + sold + every category), so we skip the sitemap and rely on the for-sale category indexes + pagination (~64 clean for-sale URLs). Has some Trinidad listings (caught by TRINIDAD_RE). If the solver ever breaks, Sucuri changed its challenge format. |
| pin.tt | SEARCH only | richest search source (~17–26) but JS-rendered index defeats crawl; covers ALL of T&T so filter to Tobago areas |
| terracaribbean.com | SEARCH | weak (1–6); JS-rendered |
| caribbeanrealestatemls.com | SEARCH | listings at `/real-estate/tobago/[id]`; weak via search; JS-rendered index |

### refresh.js architecture
- **CRAWL_SITES**: pin (search-only in practice), charb, rain, keys, seajade
  (seajaderealty.com), ralestate (realestatetobago.com) — each with `seeds[]`
  and a `listingHint` regex; optional `mustMatch` (pin.tt uses it to keep only
  Tobago URLs) and optional `idPattern`/`idBase` (seajade uses it to extract
  listing IDs embedded in the index HTML).
- **Sucuri WAF solver** (`solveSucuri` + `fetchPage`): realestatetobago.com
  serves a deterministic JS cookie-challenge; fetchPage solves it in a `vm`
  sandbox and caches the cookie per host. No browser/dep needed.
- **Data hygiene**: this is a Tobago FOR-SALE repo. `RENTAL_RE` + `TRINIDAD_RE`
  (top of refresh.js) reject rentals and non-Tobago (Trinidad) listings both at
  the URL stage and post-extraction, and purge any already in the repo. National
  agencies (mybunchofkeys, pin.tt) leak Trinidad listings; rain leaks rentals.
- **SEARCH_GROUPS A/B**: search batches split into two groups, alternated by
  `RUN_GROUP` env var across two daily runs so each gets fresh search quota.
  A = caribbeanMLS, terracaribbean. B = pin.tt houses, pin.tt land.
- **Sitemap discovery** (`fetchSitemapUrls`) tries sitemap.xml variants to
  bypass JS index pages (helps some sites, not all).
- **Budgets**: MAX_PAGES_PER_SITE=8, MAX_LISTINGS_PER_SITE=50,
  MAX_EXTRACT_CALLS=40 (global ceiling), MAX_EXTRACT_CALLS_PER_SITE=8,
  EXTRACT_BATCH=4. The per-site cap exists because the budget is a single
  greedy counter consumed in crawl order — without it, the first sites
  (charb, keys) ate all 30 calls and starved trailing sites (seajade) to 0.
- **Merge logic**: listings accumulate across runs (keyed title|site). Unseen
  14+ days → status 'stale' (shows "possibly sold"); unseen 30+ days → dropped.
- **JSON truncation recovery**: when a Claude response is cut off by max_tokens
  (no closing `]`), slice from first `[` to end and recover complete objects up
  to the last `}`. This bug silently discarded whole batches before it was
  fixed — preserve it in all 4 app extraction points + the crawler.

### Known cleanup task
The app's built-in live-search site list (index.html) and the crawler's tuned
crawl/search split (refresh.js) are NOT perfectly in sync — the app still lists
all 9 sites for live search while the crawler has moved most to crawl. Since the
app primarily reads the shared repo now, this is low-priority, but worth
reconciling so live search reflects what actually works.

---

## Deploy
- Repo: `github.com/roryrag/Property-Finder`
- Host: **Cloudflare Pages** (free, no credit limits), connected to the repo;
  every push auto-deploys. (Was on Netlify — hit credit limits. Avoid.)
- The GitHub Actions secret `ANTHROPIC_API_KEY` powers the crawler.
- Workflow runs twice daily (groups A then B) and `workflow_dispatch` allows a
  manual run with a group dropdown (A / B / all).

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
