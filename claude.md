# Tobago Property Finder

Single-file vanilla-JS web app for Tobago real estate agents. No framework.
- Main app: index.html (~227KB, all CSS/HTML/JS inline)
- Shared repo crawler: refresh.js (runs in GitHub Actions, twice daily, groups A/B)
- Login: any name + PIN 1234

## Conventions
- Vanilla JS only, no build step, no frameworks
- Design system: Playfair Display headings + DM Sans body; forest green
  #0D3D28/#165C3E/#1E7A52, gold #C49A3C, cream/sand neutrals; dark mode via body.dark
- After ANY JS edit, run: node --check on the extracted script before done
- All persistence is localStorage (keys prefixed tpf_)

## 9 property sites, crawl vs search (see refresh.js)
- Crawl works: charbonnerealty, mybunchofkeys, rain-properties
- Search only: pin.tt, terracaribbean
- Dead/unreachable: realestatetobago (dropped)
- Rate-limit prone: caribbeanMLS, seajade, villas (split into groups A/B)

## Deploy
GitHub repo roryrag/Property-Finder. Host on Cloudflare Pages (free, auto-deploy on push).
