#!/usr/bin/env node
// Build CATALOG.md: the full machine-built index of skills that install into fx.
//
// README.md is the curated page and is written by hand. CATALOG.md is not. It is rebuilt from
// scratch on every verify-skills run, from two sources that are both authoritative rather than
// remembered:
//
//   1. skills.sh, the agent-skill registry behind `npx skills`. Its search API returns real
//      install counts, which is the only popularity signal in this ecosystem that is not a proxy.
//   2. README.md's own catalog, parsed out of the page, so the two files cannot drift apart.
//
// Every candidate then earns its row the same way a README entry does: the repo resolves through
// the GitHub API, is not archived or a fork, and holds a SKILL.md whose folder name or frontmatter
// `name:` matches the skill, which is exactly what fx's installer filters on. Anything that fails
// is dropped and counted, so a shrinking catalog is visible rather than silent.
//
// Usage: GH_TOKEN=... node .github/scripts/build-catalog.mjs
// Writes CATALOG.md and refreshes the count in README.md's "Full catalog" line.

import { readFileSync, writeFileSync } from 'node:fs';
import { scope, replaceRegion } from './lib/markers.mjs';

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const MIN_INSTALLS = Number(process.env.MIN_INSTALLS || 500);

const H = {
  'User-Agent': 'awesome-fx-skills-catalog',
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: H });
    if (r.ok) return r;
    if (r.status === 403 || r.status === 429) {
      await sleep(5000 * (i + 1));
      continue;
    }
    return r;
  }
  return null;
}

// ------------------------------------------------------------------ discovery

// The registry has no "list everything" route, only search. These are the jobs the catalog is
// organised around, so the sweep matches what a reader would look for.
const QUERIES = [
  'code review', 'testing', 'documentation', 'database', 'postgres', 'git', 'deploy', 'docker',
  'kubernetes', 'security', 'frontend', 'react', 'nextjs', 'typescript', 'python', 'rust',
  'design', 'pdf', 'excel', 'powerpoint', 'slack', 'notion', 'linear', 'jira', 'figma', 'aws',
  'terraform', 'mobile', 'swift', 'android', 'seo', 'content writing', 'video', 'image',
  'data analysis', 'machine learning', 'agent', 'mcp', 'refactor', 'debugging', 'subagent',
  'agent team', 'orchestration', 'planning', 'spec driven', 'prompt engineering', 'code quality',
  'accessibility', 'performance', 'monitoring', 'observability', 'browser automation',
  'web scraping', 'api client', 'shell', 'email', 'research', 'finance',
];

const found = new Map();
for (const q of QUERIES) {
  try {
    const r = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(q)}&limit=40`);
    if (!r.ok) {
      console.log(`  registry "${q}": HTTP ${r.status}`);
      await sleep(5000);
      continue;
    }
    const j = await r.json();
    for (const s of j.skills || []) if (!found.has(s.id)) found.set(s.id, s);
  } catch (e) {
    console.log(`  registry "${q}": ${e.message}`);
  }
  await sleep(3500); // the search API rate-limits hard
}
console.log(`Registry sweep: ${found.size} unique skills from ${QUERIES.length} queries`);

if (found.size < 200) {
  // The registry failed rather than the ecosystem vanishing. Keep the last good catalog.
  console.error(`Registry returned only ${found.size} skills. Keeping the existing CATALOG.md instead of shrinking it.`);
  process.exit(1);
}

// ------------------------------------------------------------------ curated entries from README

const readme = readFileSync('README.md', 'utf8');
// Marker-scoped, not heading-scoped. This used to window from "## fx skills" to "## fx MCP
// servers" and fall back to the WHOLE README when either heading moved, which silently pulled
// every MCP server, gateway and packaging entry into the skill count. `scope` aborts instead.
// See .github/scripts/lib/markers.mjs.
const scoped = scope(readme, 'catalog');

const curated = new Map();
for (const m of scoped.matchAll(/- \*\*(.+?)\*\* with \[([\w.-]+)\]\(https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\)/g)) {
  curated.set(`${m[3].toLowerCase()}#${m[2].toLowerCase()}`, m[1]);
}
console.log(`Curated headlines parsed from README.md: ${curated.size}`);

// Our own entries are not in the registry sweep; they belong in the index like anything else.
for (const [slug, skill] of [['ZeroPointRepo/youtube-skills', 'youtube-full']]) {
  const id = `${slug}/${skill}`;
  if (!found.has(id)) found.set(id, { id, skillId: skill, source: slug, installs: 0 });
}

// ------------------------------------------------------------------ verify

const candidates = [...found.values()]
  .filter((s) => s.installs >= MIN_INSTALLS || curated.has(`${s.source.toLowerCase()}#${s.skillId.toLowerCase()}`) || s.installs === 0)
  .filter((s) => /^[\w.-]+\/[\w.-]+$/.test(s.source));
console.log(`Candidates at or above ${MIN_INSTALLS} installs: ${candidates.length}`);

const repoCache = new Map();
async function repoInfo(slug) {
  const key = slug.toLowerCase();
  if (repoCache.has(key)) return repoCache.get(key);
  const p = (async () => {
    const r = await api(`https://api.github.com/repos/${slug}`);
    if (!r || !r.ok) return null;
    const j = await r.json();
    if (j.archived || j.fork) return null;
    const tr = await api(`https://api.github.com/repos/${slug}/git/trees/${j.default_branch}?recursive=1`);
    const tree = tr && tr.ok ? await tr.json() : { tree: [] };
    return {
      full_name: j.full_name,
      stars: j.stargazers_count,
      desc: j.description,
      license: j.license?.spdx_id || null,
      branch: j.default_branch,
      paths: (tree.tree || []).filter((t) => t.path.endsWith('SKILL.md')).map((t) => t.path),
    };
  })();
  repoCache.set(key, p);
  return p;
}

const fmCache = new Map();
async function frontmatterNames(slug, branch, paths) {
  const key = slug.toLowerCase();
  if (fmCache.has(key)) return fmCache.get(key);
  const p = (async () => {
    const map = new Map();
    if (paths.length > 80) return map; // bounded: mega-repos are matched by folder name only
    for (const path of paths) {
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${slug}/${branch}/${path}`);
        if (!r.ok) continue;
        const m = (await r.text()).slice(0, 6000).match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!m) continue;
        const nm = m[1].match(/^name:\s*["']?([^"'\r\n]+)["']?\s*$/m);
        if (nm) map.set(nm[1].trim(), path);
      } catch {}
    }
    return map;
  })();
  fmCache.set(key, p);
  return p;
}

const rows = [];
const dropped = { unresolved: 0, noMatch: 0 };

let i = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (i < candidates.length) {
      const s = candidates[i++];
      const info = await repoInfo(s.source);
      if (!info || info.full_name.toLowerCase() !== s.source.toLowerCase()) {
        dropped.unresolved++;
        continue;
      }
      const byDir = info.paths.find((p) => p === `${s.skillId}/SKILL.md` || p.endsWith(`/${s.skillId}/SKILL.md`));
      let matched = Boolean(byDir);
      if (!matched) {
        const names = await frontmatterNames(s.source, info.branch, info.paths);
        matched = names.has(s.skillId);
      }
      if (!matched) {
        dropped.noMatch++;
        continue;
      }
      rows.push({
        skill: s.skillId,
        slug: info.full_name,
        installs: s.installs,
        stars: info.stars,
        blurb: curated.get(`${info.full_name.toLowerCase()}#${s.skillId.toLowerCase()}`) || info.desc || '',
        license: info.license,
      });
    }
  })
);

rows.sort((a, b) => b.installs - a.installs || a.slug.localeCompare(b.slug));
console.log(`Rows: ${rows.length}. Dropped: ${dropped.unresolved} unresolved/archived/renamed, ${dropped.noMatch} no matching SKILL.md.`);

if (rows.length < 200) {
  console.error(`Refusing to write a catalog of only ${rows.length} rows.`);
  process.exit(1);
}

// ------------------------------------------------------------------ render

const esc = (s) => String(s || '').replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const oneLine = (s, max = 110) => {
  const t = esc(s);
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
};
const short = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

const body = rows
  .map(
    (r) =>
      `| [${esc(r.skill)}](https://github.com/${r.slug}) | ${oneLine(r.blurb)} | ${r.installs ? short(r.installs) : '—'} | ${short(r.stars)} | \`/skills add ${r.slug} --skill ${r.skill}\` |`
  )
  .join('\n');

const catalog = `# fx skill catalog

Auto-generated index of every skill this repo can resolve and install-check for fx. The curated,
organised list is [README.md](README.md).

| Skill | What it does | Installs | ★ | Install |
|---|---|---|---|---|
${body}

<sub>${rows.length} skills · rebuilt by [\`build-catalog.mjs\`](.github/scripts/build-catalog.mjs) on every
[verify-skills](.github/workflows/verify-skills.yml) run · install counts from the
[skills.sh](https://skills.sh) registry · every row's SKILL.md was resolved through the GitHub API
this run · edits here are overwritten, send them to [README.md](README.md).</sub>
`;

writeFileSync('CATALOG.md', catalog);
console.log(`Wrote CATALOG.md (${rows.length} skills)`);

// ------------------------------------------------------------------ the two tiers, on the page
// The page states BOTH numbers because they answer different questions and only one of them is a
// claim about function:
//   install-verified - entries on the curated page whose `/skills add` line was re-checked
//                      against fx's own resolution rules on the last run.
//   resolved         - every skill the generator could reach and index into CATALOG.md. Reaching
//                      a repository is not evidence that the skill installs or works.
// Both come from files this repository generates, and neither is typed by hand. A missing or
// unparsable input aborts rather than printing a plausible number.
const verifiedBadge = (() => {
  try {
    return JSON.parse(readFileSync('badges/verified.json', 'utf8'));
  } catch (e) {
    console.error(`Could not read badges/verified.json: ${e.message}. Refusing to state an install-verified count.`);
    process.exit(1);
  }
})();
const passRatio = /^(\d+)\/(\d+) passing/.exec(String(verifiedBadge.message || ''));
if (!passRatio) {
  console.error(`badges/verified.json message "${verifiedBadge.message}" does not start with "N/M passing". Refusing to state an install-verified count.`);
  process.exit(1);
}
const installVerified = Number(passRatio[1]);

const coverageBody = JSON.stringify({
  schemaVersion: 1,
  label: 'coverage',
  message: `${installVerified} install-verified / ${rows.length} resolved`,
  color: '000000',
}, null, 2) + '\n';
let coverageChanged = true;
try { coverageChanged = readFileSync('badges/coverage.json', 'utf8') !== coverageBody; } catch { /* first run */ }
if (coverageChanged) writeFileSync('badges/coverage.json', coverageBody);

// The pointer line lives between markers now. It used to be rewritten by matching its own prose,
// which meant rewording the sentence would silently disable the refresh, and it called every
// resolved row "verified" — a different and larger tier than the one the badge stands behind.
const updated = replaceRegion(
  readme,
  'fullcatalog',
  `- **Full catalog:** every fx skill this list resolves (${rows.length}) in [CATALOG.md](CATALOG.md)`
);
if (updated !== readme) {
  writeFileSync('README.md', updated);
  console.log('Refreshed the README catalog count');
}
console.log(`Coverage: ${installVerified} install-verified / ${rows.length} resolved`);
