#!/usr/bin/env node
/* PostToolUse hook — syntax-check the inline JS in index.html after an edit.
   CLAUDE.md requires `node --check` on the extracted script after every JS
   change; this automates it. Exits 2 with an explanation on stderr when the
   inline JS is broken, so the failure is surfaced back to Claude immediately. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// Hook input (JSON on stdin) tells us which file was edited.
let filePath = '';
try {
  var raw = fs.readFileSync(0, 'utf8');
  filePath = ((JSON.parse(raw) || {}).tool_input || {}).file_path || '';
} catch (e) { /* no/garbled stdin — fall through and check index.html anyway */ }

// Only act when index.html is the file that changed.
if (filePath && !/index\.html$/i.test(filePath.replace(/\\/g, '/'))) process.exit(0);

const target = path.join(process.cwd(), 'index.html');
if (!fs.existsSync(target)) process.exit(0);

const html = fs.readFileSync(target, 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, js = '';
while ((m = re.exec(html))) js += '\n;(function(){\n' + m[1] + '\n})();\n';

const tmp = path.join(os.tmpdir(), '_bb_check_' + process.pid + '.js');
fs.writeFileSync(tmp, js);
try {
  require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  fs.unlinkSync(tmp);
  process.exit(0);
} catch (e) {
  try { fs.unlinkSync(tmp); } catch (_) {}
  const msg = (e.stderr ? e.stderr.toString() : e.message).trim();
  console.error('index.html inline JS has a SYNTAX ERROR — fix before continuing:\n' + msg);
  process.exit(2);
}
