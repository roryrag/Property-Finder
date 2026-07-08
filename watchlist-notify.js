/* ═══════════════════════════════════════════════════════
   BROKERBUDDY — Watch List WhatsApp alerts
   Runs in GitHub Actions right after refresh.js, before the
   data commit. Matches THIS RUN's new listings against the
   per-client criteria in data/watchlist.json and sends the
   agent one WhatsApp digest via CallMeBot (free personal
   gateway — the agent authorizes it once from their phone).

   Secrets (repo Settings → Secrets and variables → Actions):
     CALLMEBOT_PHONE   agent's WhatsApp number, e.g. +18681234567
     CALLMEBOT_APIKEY  key CallMeBot texts back after authorization

   Fail-soft by design: a missing secret, empty watchlist, or
   CallMeBot hiccup logs a warning and exits 0 — alerting must
   never block the listings refresh from committing.
═══════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const REPO_FILE  = path.join(__dirname, 'data', 'repo.json');
const WATCH_FILE = path.join(__dirname, 'data', 'watchlist.json');

function loadJson(file) {
  // strip a UTF-8 BOM if some editor added one — JSON.parse rejects it
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { return null; }
}

/* Same matching semantics as watchMatches() in index.html — keep in sync.
   Unpriced listings PASS the price filter (they're leads worth a look;
   the message marks them "price on request"). */
function matches(w, p) {
  if (w.active === false) return false;
  if (w.types && w.types.length) {
    if (w.types.indexOf(String(p.type || '').toLowerCase()) === -1) return false;
  }
  if (w.areas && w.areas.length) {
    const hay = ((p.location || '') + ' ' + (p.title || '')).toLowerCase();
    if (!w.areas.some(a => a && hay.indexOf(String(a).toLowerCase().trim()) !== -1)) return false;
  }
  const price = Number(p.price) || 0;
  if (price > 0) {
    if (Number(w.priceMin) > 0 && price < Number(w.priceMin)) return false;
    if (Number(w.priceMax) > 0 && price > Number(w.priceMax)) return false;
  }
  if (Number(w.bedsMin) > 0 && !(Number(p.beds) >= Number(w.bedsMin))) return false;
  return true;
}

function fmtPrice(p) {
  if (!p) return 'price on request';
  if (p >= 1000000) return 'TT$' + (p / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (p >= 1000) return 'TT$' + Math.round(p / 1000) + 'k';
  return 'TT$' + Number(p).toLocaleString();
}

async function sendWhatsApp(phone, apikey, text) {
  const url = 'https://api.callmebot.com/whatsapp.php' +
    '?phone=' + encodeURIComponent(phone) +
    '&apikey=' + encodeURIComponent(apikey) +
    '&text=' + encodeURIComponent(text);
  const resp = await fetch(url);
  const body = await resp.text();
  // CallMeBot returns 200 with a human-readable page; errors appear in the body
  const ok = resp.ok && !/ERROR|not registered|wrong/i.test(body);
  console.log('  CallMeBot HTTP ' + resp.status + (ok ? ' — sent' : ' — FAILED: ' + body.slice(0, 200)));
  return ok;
}

(async function main() {
  const phone = (process.env.CALLMEBOT_PHONE || '').trim();
  const apikey = (process.env.CALLMEBOT_APIKEY || '').trim();
  if (!phone || !apikey) {
    console.log('Watch List: CALLMEBOT_PHONE / CALLMEBOT_APIKEY secrets not set — skipping alerts.');
    return;
  }

  const watchData = loadJson(WATCH_FILE);
  const watches = (watchData && Array.isArray(watchData.watches)) ? watchData.watches.filter(w => w.active !== false) : [];
  if (!watches.length) { console.log('Watch List: no active watches in data/watchlist.json — nothing to do.'); return; }

  const repo = loadJson(REPO_FILE);
  if (!repo || !Array.isArray(repo.listings)) { console.log('Watch List: no repo.json — skipping.'); return; }

  // "New this run": refresh.js stamps new listings firstSeen = the same `now`
  // it writes to meta.lastRefresh. A 10-minute tolerance guards against any
  // future drift; the previous run is always ~a week older.
  const runTs = Date.parse(repo.meta && repo.meta.lastRefresh) || 0;
  if (!runTs) { console.log('Watch List: repo.json has no lastRefresh — skipping.'); return; }
  const fresh = repo.listings.filter(p => Number(p.firstSeen) >= runTs - 10 * 60 * 1000);
  console.log('Watch List: ' + watches.length + ' active watch(es), ' + fresh.length + ' new listing(s) this run.');

  // Group matches per client
  const lines = [];
  let matchCount = 0;
  for (const w of watches) {
    const hits = fresh.filter(p => matches(w, p));
    if (!hits.length) continue;
    lines.push('');
    lines.push('\u{1F464} ' + (w.client || 'Client'));
    for (const p of hits.slice(0, 5)) {
      matchCount++;
      lines.push('• ' + (p.title || 'Listing') + ' — ' + fmtPrice(Number(p.price)) +
        ((p.location) ? ' · ' + p.location : ''));
      if (p.url) lines.push('  ' + p.url);
    }
    if (hits.length > 5) lines.push('  …and ' + (hits.length - 5) + ' more in the app');
  }

  if (!matchCount) { console.log('Watch List: no new listings matched any client criteria.'); return; }

  const header = '\u{1F514} BrokerBuddy Watch List\n' + matchCount + ' new match' + (matchCount !== 1 ? 'es' : '') + ' from this week’s refresh:';
  let text = header + '\n' + lines.join('\n');
  if (text.length > 3000) text = text.slice(0, 2970) + '\n…more in the app';

  try {
    await sendWhatsApp(phone, apikey, text);
  } catch (e) {
    console.log('Watch List: send failed (' + e.message + ') — continuing anyway.');
  }
})();
