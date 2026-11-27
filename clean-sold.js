/* One-off / on-demand: clear sold candidates that are actually still for sale.
   Same rules refresh.js applies each run (re-listed, or page still loads),
   but over ALL candidates at once instead of a rolling batch.
     node clean-sold.js            -> report only
     node clean-sold.js --write    -> rewrite data/sold.json
   Agent-verified comps (source !== 'candidate') are never touched. */
const fs = require('fs');
const path = require('path');
const { checkMany } = require('./liveness');

const SOLD_FILE = path.join(__dirname, 'data', 'sold.json');
const REPO_FILE = path.join(__dirname, 'data', 'repo.json');
const nu = u => String(u || '').toLowerCase().trim().replace(/[?#].*$/, '').replace(/\/+$/, '');

(async () => {
  const sold = JSON.parse(fs.readFileSync(SOLD_FILE, 'utf8'));
  const repo = JSON.parse(fs.readFileSync(REPO_FILE, 'utf8'));
  const active = new Set(repo.listings.map(p => nu(p.url)).filter(Boolean));
  const cands = sold.listings.filter(c => c.source === 'candidate');
  const relisted = cands.filter(c => active.has(nu(c.url)));
  const toCheck = cands.filter(c => !active.has(nu(c.url)) && /^https?:/.test(c.url || ''));
  const v = await checkMany(toCheck.map(c => c.url));
  const now = Date.now();
  const tally = { alive: 0, gone: 0, unknown: 0 };
  const drop = new Set(relisted.map(c => c.id));
  for (const c of toCheck) {
    const r = v.get(c.url); tally[r]++;
    if (r === 'alive') drop.add(c.id);
    else if (r === 'gone') c.checkedAt = now;
  }
  console.log(`candidates ${cands.length}: re-listed ${relisted.length}, ` +
    `alive ${tally.alive}, gone ${tally.gone}, unknown ${tally.unknown}, no-url ${cands.length - relisted.length - toCheck.length}`);
  const bySite = {};
  for (const c of cands) if (drop.has(c.id)) bySite[c.site] = (bySite[c.site] || 0) + 1;
  console.log('removing by site:', bySite);
  if (process.argv.includes('--write')) {
    sold.listings = sold.listings.filter(c => !drop.has(c.id));
    sold.meta = Object.assign({}, sold.meta, {
      totalComps: sold.listings.length,
      candidateCount: sold.listings.filter(c => c.source === 'candidate').length,
      cleanedAt: new Date(now).toISOString()
    });
    fs.writeFileSync(SOLD_FILE, JSON.stringify(sold, null, 1));
    console.log(`wrote ${SOLD_FILE}: ${sold.listings.length} entries left`);
  }
})();
