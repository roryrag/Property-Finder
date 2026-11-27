// Copies the app shell (no data, no crawler code) into ./dist and deploys it.
//   node deploy.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const SHELL = ['index.html', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon-180.png'];
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist');
for (const f of SHELL) fs.copyFileSync(f, 'dist/' + f);
fs.writeFileSync('dist/_headers', '/*\n  X-Robots-Tag: noindex\n/index.html\n  Cache-Control: no-cache\n/sw.js\n  Cache-Control: no-cache\n');
execSync('npx wrangler deploy', { stdio: 'inherit' });
