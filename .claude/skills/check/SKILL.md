---
name: check
description: Syntax-check the inline JavaScript in index.html (BrokerBuddy's single-file app). Use after editing index.html, or whenever the user asks to validate/check the app's JS.
---

# Check index.html inline JS

BrokerBuddy is a single ~250KB `index.html` with all JS inline. CLAUDE.md
requires a clean `node --check` of the extracted script after every JS change.
This skill runs that check on demand (the same logic also runs automatically
via the PostToolUse hook in `.claude/settings.json`).

Run:

```bash
echo '{}' | node .claude/check-html.js && echo "OK — index.html inline JS is valid"
```

- Exit 0 + "OK …" → the inline JS parses cleanly.
- Non-zero → it prints the `SyntaxError` with file/line context. Fix that
  before considering the edit done; do not commit a failing check.

The script extracts every `<script>` block without a `src` attribute, wraps
each in an IIFE, and runs `node --check` on the concatenation.
