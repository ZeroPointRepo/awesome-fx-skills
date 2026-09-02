#!/usr/bin/env node
// Rewrite the star figure on every catalog entry from the live GitHub API.
//
// WHY THIS EXISTS, and why it is here before anything is actually stale. The 152 star figures
// in this README were written on 2026-08-23 and were still accurate when checked on 08-24 --
// zero drift, because the list is a day old. The sibling awesome-dsh-plugins list is three days
// old and had 54 of 75 figures more than 5% off, several by half. That is the same file, three
// days later. Installing the guard while the numbers are still right is the cheap moment.
//
// Nothing here was missing: verify-skills.mjs already resolves every source repo through the API
// every Monday, and build-catalog.mjs already carries live counts into CATALOG.md. The number
// was being fetched weekly and thrown away for the one file a human actually reads.
//
// Entry shape (same parser contract as verify-installs.mjs, deliberately):
//   - **What it does** with [name](https://github.com/owner/repo) by [author](url). Desc. 1,234★, MIT.
//
// Only the digits before ★ are touched. Never the description, never the command, never a
// figure on a line with no GitHub link. Idempotent: re-running with no upstream movement is a
// no-op, so it will not produce empty weekly commits.
//
// Usage: GH_TOKEN=... node .github/scripts/refresh-stars.mjs README.md

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { region } from './lib/markers.mjs';

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const file = process.argv[2] || 'README.md';
const H = {
  'User-Agent': 'awesome-fx-skills-stars',
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

const text = readFileSync(file, 'utf8');
// Scope note, and it differs from verify-skills.mjs on purpose. That script reads the `catalog`
// markers because only skills have an install command to verify. Star figures are carried by
// every catalog surface here — MCP servers, gateways and bridges, ports and packaging, embedding
// fx — and by the Featured skill line at the top, which is not a "- **" bullet at all. All of
// them rot identically, so this has its own wider `stars` markers and operates on any line inside
// them holding both a GitHub repo link and a star figure. Two scopes, two named marker pairs,
// neither of them a heading.
const { inner, head, tail } = region(text, 'stars', file);
const lines = inner.split('\n');

// Match the house style exactly: plain integer below 1000, one-decimal k at or above it
// (105★, 1.4k★, 10.5k★, 106.6k★). The sibling dsh-plugins list uses comma grouping instead,
// so this is deliberately NOT shared code — getting it wrong rewrites every line in the file.
const fmt = (n) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`);
const parse = (t) => {
  const s = t.trim().toLowerCase();
  return s.endsWith('k') ? Math.round(parseFloat(s) * 1000) : parseInt(s.replace(/,/g, ''), 10);
};

const targets = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/\[([^\]]+)\]\(https:\/\/github\.com\/([^/)]+)\/([^/)#]+)\)/);
  const star = lines[i].match(/([\d][\d,.]*k?)★/i);
  if (!m || !star) continue;
  targets.push({ i, slug: `${m[2]}/${m[3].replace(/\.git$/i, '')}`, was: star[1], name: m[1] });
}

console.log(`Refreshing ${targets.length} star figures in ${file}\n`);

let changed = 0, failed = 0;
let q = 0;
async function worker() {
  while (q < targets.length) {
    const t = targets[q++];
    let j;
    try {
      const r = await fetch(`https://api.github.com/repos/${t.slug}`, { headers: H });
      if (!r.ok) {
        // Never guess. A rate-limited or 404 run leaves the existing figure alone and says so.
        failed++;
        console.log(`  SKIP  ${t.slug} (HTTP ${r.status}) — figure left at ${t.was}★`);
        continue;
      }
      j = await r.json();
    } catch (e) {
      failed++;
      console.log(`  SKIP  ${t.slug} (network) — figure left at ${t.was}★`);
      continue;
    }
    const now = fmt(j.stargazers_count);
    if (now === t.was) continue;
    const before = parse(t.was);
    const drift = before ? Math.round(((j.stargazers_count - before) / before) * 100) : 0;
    lines[t.i] = lines[t.i].replace(`${t.was}★`, `${now}★`);
    changed++;
    console.log(`  ${t.name}: ${t.was}★ -> ${now}★  (${drift > 0 ? '+' : ''}${drift}%)`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

if (changed) writeFileSync(file, head + lines.join('\n') + tail);
console.log(`\nchanged=${changed} unchecked=${failed} total=${targets.length}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nunchecked=${failed}\n`);
}
process.exit(0);
