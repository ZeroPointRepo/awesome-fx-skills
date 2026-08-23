#!/usr/bin/env node
// Re-check every `/skills add` line in README.md against the rule fx itself applies.
//
// Anyone can claim "verified" once, by hand, on launch day. The claim only means something if a
// machine re-runs it on a cadence and the badge that reports it is written by that run.
//
// What this catches that a link checker structurally cannot:
//   RENAMED / ARCHIVED   the repo moved or was archived upstream. Both still return HTTP 200, so a
//                        plain link check passes them clean forever.
//   SKILL REMOVED        the repo is fine, the skill folder inside it is gone or was renamed. This
//                        is the failure mode unique to a skills list, and nothing else sees it.
//
// The match rule is copied from fx's own installer (src/builtins/skills.zig,
// installFromDirectoryWithMetadataReader): it walks a cloned repository for every SKILL.md, takes
// the parent directory name as the skill name, and accepts a --skill filter that equals either
// that directory name OR the `name:` in the file's frontmatter. Checking only the directory name
// would report working entries as broken.
//
// Usage: GH_TOKEN=... node .github/scripts/verify-skills.mjs [README.md]
// Exit code is non-zero when something is wrong, so the Actions status reflects reality.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const file = process.argv[2] || 'README.md';
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);

const H = {
  'User-Agent': 'awesome-fx-skills-verify',
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns { ok, res } on a real answer, or { rateLimited: true } when GitHub throttled us for
// long enough that we never got one. Those two are different facts and the caller treats them
// differently: a throttled lookup is "not checked", never "broken". Counting a rate limit as a
// broken entry would flip the badge red for a reason that has nothing to do with the list.
async function api(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    let r;
    try {
      r = await fetch(url, { headers: H });
    } catch {
      await sleep(2000 * (i + 1));
      continue;
    }
    if (r.ok) return { res: r };
    if (r.status === 403 || r.status === 429) {
      await sleep(5000 * (i + 1));
      continue;
    }
    return { res: r };
  }
  return { rateLimited: true };
}

const text = readFileSync(file, 'utf8');

// Scope to the skills catalog, so the badge count matches the entries the page actually claims.
// The Featured skill above it is the same entry repeated, and the accordions below hold prose.
const start = text.indexOf('## fx skills');
const end = text.indexOf('## fx MCP servers');
const scoped = start >= 0 && end > start ? text.slice(start, end) : text;

// One entry per `/skills add <owner>/<repo> --skill <name>` line inside the catalog.
const entries = [];
const seen = new Set();
for (const m of scoped.matchAll(/\/skills add ([\w.-]+\/[\w.-]+) --skill ([\w.-]+)/g)) {
  const key = `${m[1]}#${m[2]}`;
  if (seen.has(key)) continue;
  seen.add(key);
  entries.push({ slug: m[1], skill: m[2] });
}

console.log(`Parsed ${entries.length} install commands from ${file}\n`);
if (!entries.length) {
  console.error('No install commands found. The catalog headings probably moved.');
  process.exit(1);
}

function parseFrontmatterName(txt) {
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const nm = m[1].match(/^name:\s*["']?([^"'\r\n]+)["']?\s*$/m);
  return nm ? nm[1].trim() : null;
}

const problems = [];
const ok = [];
const notChecked = [];

async function check(e) {
  const a = await api(`https://api.github.com/repos/${e.slug}`);
  if (a.rateLimited) {
    notChecked.push(`${e.slug} --skill ${e.skill}: rate limited before the repo could be resolved`);
    return;
  }
  if (!a.res.ok) {
    problems.push(`${e.slug} --skill ${e.skill}: repo lookup HTTP ${a.res.status}`);
    return;
  }
  const j = await a.res.json();
  if (j.archived) {
    problems.push(`${e.slug} --skill ${e.skill}: ARCHIVED upstream`);
    return;
  }
  if (j.full_name.toLowerCase() !== e.slug.toLowerCase()) {
    problems.push(`${e.slug}: RENAMED, now ${j.full_name}`);
    return;
  }

  const t = await api(`https://api.github.com/repos/${e.slug}/git/trees/${j.default_branch}?recursive=1`);
  if (t.rateLimited) {
    notChecked.push(`${e.slug} --skill ${e.skill}: rate limited before the repository tree could be read`);
    return;
  }
  if (!t.res.ok) {
    problems.push(`${e.slug} --skill ${e.skill}: could not read the repository tree (HTTP ${t.res.status})`);
    return;
  }
  const tree = await t.res.json();
  const paths = (tree.tree || []).filter((t) => t.path.endsWith('SKILL.md')).map((t) => t.path);

  // fx match rule, leg one: the folder holding SKILL.md is named --skill.
  const byDir = paths.find((p) => p === `${e.skill}/SKILL.md` || p.endsWith(`/${e.skill}/SKILL.md`));
  if (byDir) {
    ok.push(`${e.slug} --skill ${e.skill}: folder match at ${byDir}`);
    return;
  }

  // Leg two: some SKILL.md in the repo declares `name: <--skill>` in its frontmatter.
  // Bounded so one mega-repo cannot spend the whole rate limit.
  for (const p of paths.slice(0, 120)) {
    const res = await fetch(`https://raw.githubusercontent.com/${e.slug}/${j.default_branch}/${p}`);
    if (!res.ok) continue;
    if (parseFrontmatterName((await res.text()).slice(0, 8000)) === e.skill) {
      ok.push(`${e.slug} --skill ${e.skill}: frontmatter match at ${p}`);
      return;
    }
  }

  problems.push(
    `${e.slug} --skill ${e.skill}: no SKILL.md in the repo matches this name by folder or frontmatter (${paths.length} SKILL.md files scanned)`
  );
}

let i = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (i < entries.length) await check(entries[i++]);
  })
);

ok.sort();
problems.sort();
notChecked.sort();
console.log(`OK (${ok.length}):`);
ok.forEach((s) => console.log('  ' + s));
if (notChecked.length) {
  console.log(`\nNOT CHECKED (${notChecked.length}) - throttled by the GitHub API, not a finding:`);
  notChecked.forEach((s) => console.log('  ' + s));
}
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):`);
  problems.forEach((s) => console.log('  ' + s));
}

const total = entries.length;
const passing = ok.length;
// The badge reports what was actually confirmed. Entries we could not reach are subtracted from
// the denominator and named in the message rather than quietly counted as passing or failing.
const checked = ok.length + problems.length;
const message = notChecked.length
  ? `${passing}/${checked} passing, ${notChecked.length} not checked`
  : `${passing}/${total} passing`;
const color = problems.length === 0 ? 'brightgreen' : problems.length <= 2 ? 'yellow' : 'red';

mkdirSync('badges', { recursive: true });
writeFileSync(
  'badges/verified.json',
  JSON.stringify({ schemaVersion: 1, label: 'install checks', message, color }, null, 2) + '\n'
);
writeFileSync(
  'badges/checked-at.json',
  JSON.stringify({ schemaVersion: 1, label: 'last checked', message: new Date().toISOString().slice(0, 10), color: 'blue' }, null, 2) + '\n'
);

console.log(`\nWrote badges/verified.json (${message}) and badges/checked-at.json`);
// Exit non-zero only for a real finding. A throttled run is incomplete, not failing.
process.exit(problems.length ? 1 : 0);
