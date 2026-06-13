/* ═══════════════════════════════════════════════════════
   TOBAGO PROPERTY FINDER — Hybrid Crawler Refresh v2
   Runs daily via GitHub Actions (server-side, no CORS).

   Strategy per site:
   1. CRAWL  — fetch listing index pages directly, follow
               pagination, collect ALL listing URLs,
               fetch each listing page.
               Extraction order (cheapest first):
                 a) JSON-LD structured data  (free)
                 b) Claude HTML extraction   (cheap, no search tool)
   2. SEARCH — fallback for JS-rendered sites, same
               web-search method as before.

   Output: data/repo.json  (same shape — app unchanged)
═══════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }

const DATA_FILE = path.join(__dirname, 'data', 'repo.json');
const SOLD_FILE = path.join(__dirname, 'data', 'sold.json');
const MODEL = 'claude-haiku-4-5-20251001';
const DAY = 24 * 60 * 60 * 1000;

/* ── Budgets (tune to control cost & runtime) ── */
const MAX_PAGES_PER_SITE    = 8;    // pagination depth
const MAX_LISTINGS_PER_SITE = 50;   // listing pages fetched per site
const MAX_EXTRACT_CALLS     = 30;   // Claude HTML-extraction calls (total)
const EXTRACT_BATCH         = 4;    // listings per extraction call
const FETCH_DELAY_MS        = 400;  // politeness delay between fetches
const FETCH_TIMEOUT_MS      = 15000;

/* ══════════════════════════════════════════
   SITE CONFIG
══════════════════════════════════════════ */
const CRAWL_SITES = [
  {
    id: 'pin', name: 'pin.tt',
    seeds: ['https://pin.tt/realestate/tobago/'],
    listingHint: /pin\.tt\/(realestate\/|property|listing|ad\/)/i,
    // pin.tt covers all of T&T — keep only Tobago-area URLs
    mustMatch: /(tobago|crown-point|scarborough|bon-accord|buccoo|plymouth|charlotteville|speyside|signal-hill|lambeau|canaan|carnbee|mt-irvine|black-rock|grafton|castara|roxborough|mason-hall|lowlands|bacolet|patience-hill|les-coteaux)/i
  },
  {
    id: 'charb', name: 'charbonnerealty.com',
    seeds: ['https://charbonnerealty.com/properties/', 'https://charbonnerealty.com/'],
    listingHint: /charbonnerealty\.com\/.*(propert|listing|estate|land|villa|house)/i
  },
  {
    id: 'rain', name: 'rain-properties-tobago.com',
    seeds: ['https://www.rain-properties-tobago.com/villatobuy.html',
            'https://www.rain-properties-tobago.com/property-sales'],
    listingHint: /rain-properties-tobago\.com\/(?!index|contact|about)/i
  },
  {
    id: 'keys', name: 'mybunchofkeys.com',
    seeds: ['https://mybunchofkeys.com/properties/', 'https://mybunchofkeys.com/'],
    listingHint: /mybunchofkeys\.com\/.*(propert|listing|land|villa|house)/i
  },
  {
    id: 'ralestate', name: 'realestatetobago.com',
    seeds: ['https://realestatetobago.com/property-type/houses-for-sale/',
            'https://realestatetobago.com/property-type/land-for-sale/'],
    listingHint: /realestatetobago\.com\/.*(propert|listing|land|villa|house|apartment)/i
  },
  {
    id: 'seajade', name: 'seajadeinvestments.com',
    seeds: ['https://seajadeinvestments.com/tobago-real-estate-listings',
            'https://seajadeinvestments.com/tobago-land-for-sale',
            'https://seajadeinvestments.com/tobago-homes-for-sale'],
    listingHint: /seajadeinvestments\.com\/tobago-real-estate-listings\/property\//i
  }
];

/* Search-fallback sites (JS-rendered — direct fetch usually fails) */
/* Search work is split into two GROUPS that alternate across runs,
   so each batch gets fresh search quota instead of starving at the
   back of one giant queue. Controlled by the RUN_GROUP env var
   (set by the workflow): 'A', 'B', or 'all' (default, runs everything). */
const SEARCH_GROUPS = {
  A: [
    { label: 'caribbeanMLS', query: 'site:caribbeanrealestatemls.com/real-estate/tobago for sale', twoStage: true },
    { label: 'villas',       query: 'site:villasoftobago.com villa for sale', twoStage: true }
  ],
  B: [
    { label: 'pin.tt houses',  query: 'site:pin.tt/realestate/tobago house for sale', twoStage: false },
    { label: 'pin.tt land',    query: 'site:pin.tt/realestate/tobago land for sale', twoStage: false },
    { label: 'terracaribbean', query: 'site:terracaribbean.com Tobago for sale', twoStage: true }
  ]
};

const RUN_GROUP = (process.env.RUN_GROUP || 'all').trim();
let SEARCH_BATCHES;
if (RUN_GROUP === 'A')      SEARCH_BATCHES = SEARCH_GROUPS.A;
else if (RUN_GROUP === 'B') SEARCH_BATCHES = SEARCH_GROUPS.B;
else                        SEARCH_BATCHES = [...SEARCH_GROUPS.A, ...SEARCH_GROUPS.B];
console.log('Run group: ' + RUN_GROUP + ' (' + SEARCH_BATCHES.length + ' search batches)');

/* ══════════════════════════════════════════
   HELPERS
══════════════════════════════════════════ */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TobagoPropertyFinder/1.0)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const type = resp.headers.get('content-type') || '';
    if (!type.includes('html') && !type.includes('json') && !type.includes('xml')) return null;
    return await resp.text();
  } catch (e) { clearTimeout(t); return null; }
}

function absolutize(href, baseUrl) {
  try { return new URL(href, baseUrl).href.split('#')[0]; } catch (e) { return null; }
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const abs = absolutize(m[1], baseUrl);
    if (abs && abs.startsWith('http')) links.add(abs);
  }
  return [...links];
}

/* Sitemap discovery — most sites publish every page URL here.
   Bypasses JS-rendered index pages entirely. */
async function fetchSitemapUrls(site) {
  const found = new Set();
  const hosts = ['https://' + site.name, 'https://www.' + site.name];
  const paths = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap-1.xml'];
  for (const host of hosts) {
    for (const p of paths) {
      const xml = await fetchPage(host + p);
      await sleep(FETCH_DELAY_MS);
      if (!xml || xml.indexOf('<') === -1) continue;
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
      if (!locs.length) continue;
      const pageUrls  = locs.filter(u => !u.endsWith('.xml'));
      const childMaps = locs.filter(u => u.endsWith('.xml')).slice(0, 6);
      pageUrls.forEach(u => found.add(u));
      for (const cm of childMaps) {
        const cxml = await fetchPage(cm);
        await sleep(FETCH_DELAY_MS);
        if (!cxml) continue;
        [...cxml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
          .map(m => m[1]).filter(u => !u.endsWith('.xml'))
          .forEach(u => found.add(u));
      }
      if (found.size) return [...found];
    }
    if (found.size) break;
  }
  return [...found];
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* JSON-LD structured data — free extraction when present */
function extractJsonLd(html, url, siteName) {
  const out = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      let data = JSON.parse(m[1].trim());
      const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const item of items) {
        const type = String(item['@type'] || '');
        if (!/RealEstate|Product|Residence|House|Apartment|Place|Offer|Accommodation/i.test(type)) continue;
        const offers = item.offers || {};
        const price = Number(offers.price || item.price || 0) || 0;
        const cur = (offers.priceCurrency || '').toUpperCase();
        out.push({
          title: item.name || '',
          price: cur === 'USD' ? Math.round(price * 6.8) : price,
          beds: Number(item.numberOfRooms || item.numberOfBedrooms || 0) || 0,
          baths: Number(item.numberOfBathroomsTotal || 0) || 0,
          type: /land/i.test(item.name || '') ? 'land' : 'house',
          size: item.floorSize && item.floorSize.value ? item.floorSize.value + ' sq ft' : '',
          location: (item.address && (item.address.addressLocality || item.address.streetAddress)) || '',
          pool: false,
          description: (item.description || '').slice(0, 140),
          features: [],
          agent_name: '', agent_phone: '',
          url: url, site: siteName,
          _method: 'jsonld'
        });
      }
    } catch (e) { /* malformed ld+json — skip */ }
  }
  return out.filter(l => l.title);
}

/* Robust JSON array extraction from Claude responses */
function extractJSONArr(text) {
  if (!text) return [];
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = text.indexOf('[');
  if (s === -1) return [];
  const e = text.lastIndexOf(']');
  // No closing ] (response truncated by max_tokens) -> take to end, recover below
  const str = (e > s) ? text.slice(s, e + 1) : text.slice(s);
  try { const p = JSON.parse(str); return Array.isArray(p) ? p : []; }
  catch (err) {
    try {
      // Cut at the last complete object and close the array
      const lastObj = str.lastIndexOf('}');
      if (lastObj > 0) {
        const p2 = JSON.parse(str.slice(0, lastObj + 1) + ']');
        return Array.isArray(p2) ? p2 : [];
      }
    } catch (e2) {}
    return [];
  }
}

async function claudeCall(body) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

/* Claude HTML extraction — NO web_search tool = much cheaper */
let extractCallsUsed = 0;
async function claudeExtractBatch(pages, siteName) {
  if (extractCallsUsed >= MAX_EXTRACT_CALLS) return [];
  extractCallsUsed++;
  const blocks = pages.map((p, i) =>
    `--- PAGE ${i + 1} (URL: ${p.url}) ---\n${p.text.slice(0, 3500)}`
  ).join('\n\n');
  const prompt =
    'Below are text extracts from ' + pages.length + ' Tobago property listing pages on ' + siteName + '.\n\n' +
    blocks + '\n\n' +
    'Extract ONE listing object per page. Fields:\n' +
    'title, price (number TT$; if price shown in USD multiply by 6.8; 0 if none), beds (0 if n/a), baths (0 if n/a), ' +
    'type (house/villa/apartment/land/commercial), size (string e.g. "5000 sq ft" or ""), location (Tobago area), ' +
    'pool (true/false), description (one sentence), features (array max 3), agent_name, agent_phone, ' +
    'url (use the URL shown for that page), site ("' + siteName + '").\n' +
    'Skip pages that are clearly not property listings.\n' +
    'Return ONLY a JSON array. No markdown.';
  try {
    const text = await claudeCall({
      model: MODEL, max_tokens: 1800,
      messages: [{ role: 'user', content: prompt }]
    });
    return extractJSONArr(text).map(l => Object.assign(l, { _method: 'claude' }));
  } catch (e) {
    console.error(`    extraction error: ${e.message}`);
    return [];
  }
}

/* ══════════════════════════════════════════
   CRAWL ONE SITE
══════════════════════════════════════════ */
async function crawlSite(site) {
  const report = { method: 'crawl', indexPages: 0, urlsFound: 0, fetched: 0, jsonld: 0, claude: 0, listings: [] };
  console.log(`\n━━ CRAWL ${site.name} ━━`);

  /* 1. Crawl index pages + pagination */
  const indexQueue = [...site.seeds];
  const indexSeen = new Set(indexQueue);
  const listingUrls = new Set();

  while (indexQueue.length && report.indexPages < MAX_PAGES_PER_SITE) {
    const pageUrl = indexQueue.shift();
    const html = await fetchPage(pageUrl);
    await sleep(FETCH_DELAY_MS);
    if (!html) { console.log(`  index FAIL: ${pageUrl}`); continue; }
    report.indexPages++;

    const links = extractLinks(html, pageUrl);
    for (const link of links) {
      if (!link.includes(site.name.replace('www.', ''))) continue;
      // pagination links → queue as index pages
      if (/[?&](page|paged|p|start)=\d+|\/page\/\d+/i.test(link)) {
        if (!indexSeen.has(link) && indexSeen.size < MAX_PAGES_PER_SITE * 2) {
          indexSeen.add(link); indexQueue.push(link);
        }
        continue;
      }
      // listing detail links
      if (site.listingHint.test(link) && !site.seeds.includes(link)) {
        // filter out obvious non-listing paths
        if (/\/(tag|category|author|wp-|feed|login|contact|about|blog)\//i.test(link)) continue;
        if (site.mustMatch && !site.mustMatch.test(link)) continue;
        listingUrls.add(link);
      }
    }
    console.log(`  index OK: ${pageUrl} (links so far: ${listingUrls.size})`);
  }
  /* 1b. Sitemap discovery — often the complete catalog */
  const smUrls = await fetchSitemapUrls(site);
  let smMatched = 0;
  for (const u of smUrls) {
    if (!site.listingHint.test(u)) continue;
    if (/\/(tag|category|author|wp-|feed|login|contact|about|blog)\//i.test(u)) continue;
    if (site.mustMatch && !site.mustMatch.test(u)) continue;
    if (!listingUrls.has(u)) { listingUrls.add(u); smMatched++; }
  }
  report.sitemap = smMatched;
  console.log(`  sitemap: ${smUrls.length} urls found, ${smMatched} new listing urls matched`);
  report.urlsFound = listingUrls.size;

  /* 2. Fetch listing pages */
  const urls = [...listingUrls].slice(0, MAX_LISTINGS_PER_SITE);
  const pendingForClaude = [];

  for (const url of urls) {
    const html = await fetchPage(url);
    await sleep(FETCH_DELAY_MS);
    if (!html) continue;
    report.fetched++;

    /* 2a. Try free JSON-LD first */
    const ld = extractJsonLd(html, url, site.name);
    if (ld.length) {
      report.jsonld += ld.length;
      report.listings.push(...ld);
      continue;
    }
    /* 2b. Queue text for batched Claude extraction */
    const text = htmlToText(html);
    if (text.length > 200) pendingForClaude.push({ url, text });
  }

  /* 3. Batched Claude extraction for the rest */
  for (let i = 0; i < pendingForClaude.length; i += EXTRACT_BATCH) {
    const batch = pendingForClaude.slice(i, i + EXTRACT_BATCH);
    const extracted = await claudeExtractBatch(batch, site.name);
    report.claude += extracted.length;
    report.listings.push(...extracted);
    await sleep(800);
  }

  console.log(`  RESULT: ${report.listings.length} listings ` +
    `(index pages: ${report.indexPages}, urls: ${report.urlsFound}, ` +
    `fetched: ${report.fetched}, jsonld: ${report.jsonld}, claude: ${report.claude})`);
  return report;
}

/* ══════════════════════════════════════════
   SEARCH FALLBACK (JS-rendered sites)
══════════════════════════════════════════ */
function buildSearchPrompt(batch) {
  return 'You are a Tobago real estate data assistant.\n\n' +
    `Run this web search EXACTLY: "${batch.query}"\n\n` +
    (batch.twoStage ? 'PRICE EXTRACTION: prices are missing from snippets on this site. VISIT the top 3-4 individual listing pages and read the real asking price off each page.\n\n' : '') +
    'Extract every property listing. Fields per listing:\n' +
    'title, price (TT$ number, USD x 6.8, 0 unknown), beds, baths, type, size, location, pool, ' +
    'description (1 sentence), features (max 3), agent_name, agent_phone, url (direct listing URL), site (domain).\n\n' +
    'Return ONLY a JSON array. No markdown. [] if nothing.';
}

async function searchBatch(batch) {
  console.log(`\n━━ SEARCH ${batch.label} ━━`);
  try {
    const text = await claudeCall({
      model: MODEL, max_tokens: 5000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: buildSearchPrompt(batch) }]
    });
    const listings = extractJSONArr(text).map(l => Object.assign(l, { _method: 'search' }));
    console.log(`  RESULT: ${listings.length} listings (${listings.filter(l => l.price > 0).length} priced)`);
    return listings;
  } catch (e) {
    console.error(`  ERROR: ${e.message}`);
    return [];
  }
}

/* ══════════════════════════════════════════
   MERGE + FRESHNESS
══════════════════════════════════════════ */
function listingKey(p) {
  return ((p.title || '') + '|' + (p.site || '')).toLowerCase().replace(/\s+/g, ' ').trim();
}

/* Parse a free-text size string ("5000 sq ft") to a numeric sqft value */
function parseSizeSqft(sizeStr) {
  if (!sizeStr) return 0;
  const m = String(sizeStr).replace(/,/g, '').match(/([0-9.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

(async function main() {
  let repo = { meta: {}, listings: [] };
  try {
    repo = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(repo.listings)) repo.listings = [];
  } catch (e) { console.log('No existing repo.json — starting fresh.'); }

  const now = Date.now();
  const existing = new Map(repo.listings.map(p => [listingKey(p), p]));
  console.log(`Existing listings: ${existing.size}`);

  const siteReports = {};
  let allFound = [];

  /* Phase 1 — crawl the direct-fetch sites */
  for (const site of CRAWL_SITES) {
    const rep = await crawlSite(site);
    siteReports[site.name] = {
      method: 'crawl', listings: rep.listings.length,
      urlsFound: rep.urlsFound, jsonld: rep.jsonld, claude: rep.claude
    };
    allFound.push(...rep.listings);
  }

  /* Phase 2 — search fallback for JS sites */
  for (const batch of SEARCH_BATCHES) {
    const listings = await searchBatch(batch);
    const siteName = listings[0] ? listings[0].site : batch.label;
    siteReports[siteName || batch.label] = { method: 'search', listings: listings.length };
    allFound.push(...listings);
    await sleep(5000);
  }

  /* Merge */
  let newCount = 0, updatedCount = 0;
  for (const p of allFound) {
    if (!p.title) continue;
    delete p._method;
    const key = listingKey(p);
    const prev = existing.get(key);
    if (prev) {
      prev.lastSeen = now; prev.status = 'active';
      if (p.price > 0) prev.price = p.price;
      if (p.url && !prev.url) prev.url = p.url;
      if (p.beds > 0) prev.beds = p.beds;
      if (p.baths > 0) prev.baths = p.baths;
      if (p.size && !prev.size) prev.size = p.size;
      if (p.description && !prev.description) prev.description = p.description;
      updatedCount++;
    } else {
      existing.set(key, Object.assign({}, p, { firstSeen: now, lastSeen: now, status: 'active' }));
      newCount++;
    }
  }

  /* Freshness pass — listings unseen >30 days are dropped from the
     for-sale repo. If they had a price, they become "candidate sold"
     comparables: the listing disappeared (sold, withdrawn, or
     re-listed elsewhere), so the last known price is a useful but
     UNVERIFIED data point for the valuator until an agent confirms it. */
  let staleCount = 0, droppedCount = 0;
  const merged = [];
  const candidates = [];
  for (const [key, p] of existing) {
    const unseenDays = (now - (p.lastSeen || now)) / DAY;
    if (unseenDays > 30) {
      droppedCount++;
      if (p.price > 0) {
        candidates.push({
          id: 'cand_' + key.replace(/[^a-z0-9]+/g, '_'),
          loc: p.location || '',
          size: parseSizeSqft(p.size),
          price: p.price,
          psf: parseSizeSqft(p.size) > 0 ? Math.round(p.price / parseSizeSqft(p.size)) : 0,
          tenure: 'freehold',
          date: new Date(p.lastSeen || now).toISOString().slice(0, 10),
          notes: (p.title || '') + ' — delisted from ' + (p.site || 'source site') + ', possibly sold',
          source: 'candidate',
          status: 'candidate',
          title: p.title || '',
          site: p.site || '',
          url: p.url || ''
        });
      }
      continue;
    }
    if (unseenDays > 14) { p.status = 'stale'; staleCount++; }
    merged.push(p);
  }

  /* Merge candidates into sold.json (dedup by id, don't touch agent entries) */
  let sold = { meta: {}, listings: [] };
  try {
    sold = JSON.parse(fs.readFileSync(SOLD_FILE, 'utf8'));
    if (!Array.isArray(sold.listings)) sold.listings = [];
  } catch (e) { /* no existing sold.json — start fresh */ }

  const soldIds = new Set(sold.listings.map(c => c.id));
  let newCandidates = 0;
  for (const c of candidates) {
    if (!soldIds.has(c.id)) { sold.listings.push(c); soldIds.add(c.id); newCandidates++; }
  }
  sold.meta = {
    lastRefresh: new Date(now).toISOString(),
    totalComps: sold.listings.length,
    agentCount: sold.listings.filter(c => c.source !== 'candidate').length,
    candidateCount: sold.listings.filter(c => c.source === 'candidate').length,
    newCandidatesThisRun: newCandidates
  };
  fs.writeFileSync(SOLD_FILE, JSON.stringify(sold, null, 1));

  const sources = {};
  merged.forEach(p => { const s = p.site || 'unknown'; sources[s] = (sources[s] || 0) + 1; });

  const out = {
    meta: {
      lastRefresh: new Date(now).toISOString(),
      totalListings: merged.length,
      activeCount: merged.filter(p => p.status === 'active').length,
      staleCount, withPrice: merged.filter(p => p.price > 0).length,
      newThisRun: newCount, updatedThisRun: updatedCount, droppedThisRun: droppedCount,
      extractCallsUsed,
      sources, siteReports
    },
    listings: merged
  };

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 1));

  console.log('\n════════ REFRESH COMPLETE ════════');
  console.log(`Total in repo  : ${merged.length}`);
  console.log(`Active         : ${out.meta.activeCount}`);
  console.log(`With price     : ${out.meta.withPrice}`);
  console.log(`New this run   : ${newCount}`);
  console.log(`Stale (>14d)   : ${staleCount}`);
  console.log(`Dropped (>30d) : ${droppedCount}`);
  console.log(`Sold candidates: ${sold.listings.length} total (${newCandidates} new this run)`);
  console.log(`Claude extract calls used: ${extractCallsUsed}/${MAX_EXTRACT_CALLS}`);
  console.log('\nPer-site:');
  Object.entries(siteReports).forEach(([s, r]) =>
    console.log(`  ${s.padEnd(32)} ${String(r.listings).padStart(3)} listings  (${r.method}${r.jsonld ? ', ' + r.jsonld + ' via jsonld' : ''}${r.claude ? ', ' + r.claude + ' via claude' : ''})`));
})();
