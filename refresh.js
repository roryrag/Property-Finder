/* ═══════════════════════════════════════════════
   TOBAGO PROPERTY FINDER — Shared Repo Refresher
   Runs daily via GitHub Actions.
   Searches 9 sites, merges with existing data,
   tracks listing freshness, writes data/repo.json
═══════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }

const DATA_FILE = path.join(__dirname, 'data', 'repo.json');
const MODEL = 'claude-haiku-4-5-20251001';
const DAY = 24 * 60 * 60 * 1000;

// Same tuned batches as the app
const BATCHES = [
  { label: 'pin.tt houses',  query: 'site:pin.tt/realestate/tobago house for sale', twoStage: false },
  { label: 'pin.tt land',    query: 'site:pin.tt/realestate/tobago land for sale',  twoStage: false },
  { label: 'terracaribbean', query: 'site:terracaribbean.com Tobago for sale', twoStage: true },
  { label: 'charbonnerealty', query: 'property for sale Tobago site:charbonnerealty.com', twoStage: false },
  { label: 'mybunchofkeys',   query: 'property for sale Tobago site:mybunchofkeys.com', twoStage: false },
  { label: 'caribbeanMLS', query: 'site:caribbeanrealestatemls.com/real-estate/tobago for sale', twoStage: true },
  { label: 'seajade (deep)', query: 'site:seajadeinvestments.com property for sale', twoStage: true },
  { label: 'villas (deep)',  query: 'site:villasoftobago.com villa for sale', twoStage: true },
  { label: 'realestatetobago (deep)', query: 'property land villa for sale site:realestatetobago.com', twoStage: true },
  { label: 'rain-properties (deep)',  query: 'Tobago property for sale rain-properties-tobago.com/villatobuy.html', twoStage: true,
    fetchUrl: 'https://www.rain-properties-tobago.com/villatobuy.html' }
];

function buildPrompt(batch) {
  const src = batch.fetchUrl
    ? `Fetch and read this exact page: ${batch.fetchUrl}\nAlso run this web search: "${batch.query}"\nVisit individual listing pages to get full details including prices.\n\n`
    : `Run this web search EXACTLY: "${batch.query}"\n\n` +
      (batch.twoStage ? 'PRICE EXTRACTION: prices are missing from snippets on this site. VISIT the top 3-4 individual listing pages from the results and read the real asking price off each page. Prioritize accurate prices over quantity.\n\n' : '');
  return 'You are a Tobago real estate data assistant.\n\n' + src +
    'From the results, extract every property listing you can find.\n\n' +
    'For EACH listing extract:\n' +
    '- title\n- price (number in TT$, multiply USD by 6.8, 0 if unknown)\n' +
    '- beds (number, 0 if unknown)\n- baths (number, 0 if unknown)\n' +
    '- type (house/villa/apartment/land/commercial)\n' +
    '- size (string e.g. "5000 sq ft", empty if unknown)\n' +
    '- location (area in Tobago)\n- pool (true/false)\n' +
    '- description (one sentence max)\n- features (array of up to 3 strings)\n' +
    '- agent_name (string or empty)\n- agent_phone (string or empty)\n' +
    '- url (full direct listing URL, not homepage)\n' +
    '- site (domain name only)\n\n' +
    'IMPORTANT:\n- Return ONLY a valid JSON array\n- No markdown, no backticks\n- Start with [ end with ]\n- Return [] if nothing found';
}

function extractJSON(text) {
  if (!text) return [];
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = text.indexOf('['), e = text.lastIndexOf(']');
  if (s === -1 || e <= s) return [];
  const str = text.slice(s, e + 1);
  try { const p = JSON.parse(str); return Array.isArray(p) ? p : []; }
  catch (err) {
    try {
      const lastObj = str.lastIndexOf('},');
      if (lastObj > 0) {
        const fixed = str.slice(0, lastObj + 1) + ']';
        const p2 = JSON.parse(fixed);
        return Array.isArray(p2) ? p2 : [];
      }
    } catch (e2) {}
    return [];
  }
}

async function fetchBatch(batch, i) {
  console.log(`[${i + 1}/${BATCHES.length}] ${batch.label}...`);
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: batch.twoStage ? 5000 : 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: buildPrompt(batch) }]
      })
    });
    const data = await resp.json();
    if (data.error) { console.error(`  ERROR: ${data.error.message}`); return []; }
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text).join('');
    const listings = extractJSON(text);
    console.log(`  -> ${listings.length} listings (${listings.filter(l => l.price > 0).length} with price)`);
    return listings;
  } catch (e) {
    console.error(`  FETCH ERROR: ${e.message}`);
    return [];
  }
}

function listingKey(p) {
  return ((p.title || '') + '|' + (p.site || '')).toLowerCase().replace(/\s+/g, ' ').trim();
}

(async function main() {
  // Load existing repo
  let repo = { meta: {}, listings: [] };
  try {
    repo = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(repo.listings)) repo.listings = [];
  } catch (e) { console.log('No existing repo.json — starting fresh.'); }

  const now = Date.now();
  const existing = new Map(repo.listings.map(p => [listingKey(p), p]));
  console.log(`Existing listings: ${existing.size}`);

  // Run batches SEQUENTIALLY with 3s gaps (no rate-limit races on a server)
  let foundCount = 0, newCount = 0, updatedCount = 0;
  for (let i = 0; i < BATCHES.length; i++) {
    const listings = await fetchBatch(BATCHES[i], i);
    for (const p of listings) {
      if (!p.title) continue;
      const key = listingKey(p);
      foundCount++;
      const prev = existing.get(key);
      if (prev) {
        // Update existing: refresh lastSeen, prefer non-zero price, keep firstSeen
        prev.lastSeen = now;
        prev.status = 'active';
        if (p.price > 0) prev.price = p.price;
        if (p.url && !prev.url) prev.url = p.url;
        if (p.beds > 0) prev.beds = p.beds;
        if (p.baths > 0) prev.baths = p.baths;
        if (p.size && !prev.size) prev.size = p.size;
        updatedCount++;
      } else {
        existing.set(key, Object.assign({}, p, {
          firstSeen: now, lastSeen: now, status: 'active'
        }));
        newCount++;
      }
    }
    if (i < BATCHES.length - 1) await new Promise(r => setTimeout(r, 3000));
  }

  // Freshness pass: stale after 14 days unseen, drop after 30
  let staleCount = 0, droppedCount = 0;
  const merged = [];
  for (const [key, p] of existing) {
    const unseenDays = (now - (p.lastSeen || now)) / DAY;
    if (unseenDays > 30) { droppedCount++; continue; }
    if (unseenDays > 14) { p.status = 'stale'; staleCount++; }
    merged.push(p);
  }

  // Per-site counts
  const sources = {};
  merged.forEach(p => { const s = p.site || 'unknown'; sources[s] = (sources[s] || 0) + 1; });

  const out = {
    meta: {
      lastRefresh: new Date(now).toISOString(),
      totalListings: merged.length,
      activeCount: merged.filter(p => p.status === 'active').length,
      staleCount: staleCount,
      withPrice: merged.filter(p => p.price > 0).length,
      newThisRun: newCount,
      updatedThisRun: updatedCount,
      droppedThisRun: droppedCount,
      sources: sources
    },
    listings: merged
  };

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 1));

  console.log('\n══════ REFRESH COMPLETE ══════');
  console.log(`Total in repo : ${merged.length}`);
  console.log(`Active        : ${out.meta.activeCount}`);
  console.log(`Stale (>14d)  : ${staleCount}`);
  console.log(`With price    : ${out.meta.withPrice}`);
  console.log(`New this run  : ${newCount}`);
  console.log(`Dropped (>30d): ${droppedCount}`);
})();
