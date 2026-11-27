/* ═══════════════════════════════════════════════════════
   BROKERBUDDY — listing liveness check (2026-11-27)
   Answers "is this listing page still up?" without spending
   a Claude call. Used by refresh.js for every known listing
   the crawl didn't see this run, and by clean-sold.js to
   clear sold candidates that are actually still for sale.

   Verdicts:
     'alive'   — the page loads (2xx) at its own address
     'gone'    — 404/410, or redirected away to a homepage /
                 listings index (how WordPress & Wix retire pages)
     'unknown' — timeout, 5xx, 403, WAF trouble: NOT evidence of
                 a sale, so callers must not age the listing on it
═══════════════════════════════════════════════════════ */

const vm = require('vm');

const TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (compatible; TobagoPropertyFinder/1.0)';
const sucuriCookies = new Map();  // host -> "name=value" (shared with refresh.js)

/* Sucuri CloudProxy JS challenge (realestatetobago.com) — see refresh.js */
function solveSucuri(html) {
  if (!/sucuri_cloudproxy_js/.test(html)) return null;
  const m = html.match(/S='([^']+)'/);
  if (!m) return null;
  try {
    const S = m[1];
    const s = {}, w = String.fromCharCode;
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let u = 0; u < 64; u++) s[A.charAt(u)] = u;
    let U = 0, r = '', l = 0, c, a;
    for (let i = 0; i < S.length; i++) {
      c = s[S.charAt(i)]; U = (U << 6) + c; l += 6;
      while (l >= 8) { ((a = (U >>> (l -= 8)) & 0xff) || (i < (S.length - 2))) && (r += w(a)); }
    }
    const sandbox = { document: {}, location: { reload() {} } };
    vm.runInContext(r, vm.createContext(sandbox), { timeout: 1000 });
    return (sandbox.document.cookie || '').split(';')[0] || null;
  } catch (e) { return null; }
}

function pathOf(u) {
  try { return new URL(u).pathname.replace(/\/+$/, '').toLowerCase(); } catch (e) { return ''; }
}

async function checkAlive(url, _retried) {
  if (!/^https?:\/\//i.test(url || '')) return 'unknown';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let host = '';
    try { host = new URL(url).host; } catch (e) {}
    const headers = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' };
    const cookie = sucuriCookies.get(host);
    if (cookie) headers['Cookie'] = cookie;
    const resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers });
    const status = resp.status;
    // Only read a body when we need it (Sucuri challenge); otherwise drop it.
    if (!resp.ok && !_retried) {
      const body = await resp.text().catch(() => '');
      clearTimeout(t);
      if (/sucuri_cloudproxy_js/.test(body)) {
        const c = solveSucuri(body);
        if (c) { sucuriCookies.set(host, c); return checkAlive(url, true); }
        return 'unknown';
      }
    } else {
      try { await resp.body?.cancel(); } catch (e) {}
      clearTimeout(t);
    }
    if (status === 404 || status === 410) return 'gone';
    if (status >= 200 && status < 300) {
      // Redirected to a different, shallower page = the listing was retired.
      const want = pathOf(url), got = pathOf(resp.url);
      if (got !== want && got.split('/').filter(Boolean).length < want.split('/').filter(Boolean).length) return 'gone';
      return 'alive';
    }
    return 'unknown';
  } catch (e) {
    clearTimeout(t);
    return 'unknown';
  }
}

/* Check many URLs with a small worker pool; returns Map(url -> verdict). */
async function checkMany(urls, concurrency = 4, delayMs = 250) {
  const out = new Map();
  const queue = [...new Set(urls)];
  async function worker() {
    while (queue.length) {
      const u = queue.shift();
      out.set(u, await checkAlive(u));
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}

module.exports = { checkAlive, checkMany, solveSucuri, sucuriCookies };
