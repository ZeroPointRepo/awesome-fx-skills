# Contributing

Pull requests are very welcome. Adding an entry takes about two minutes.

## Adding a skill

Add one bullet to the right section of `README.md`, in the same shape as its neighbours:

```markdown
- **What it does for the reader** with [skill-name](https://github.com/owner/repo) by [owner](https://github.com/owner). One or two factual sentences. 1.2k★, MIT.

  <details>
  <summary>Install</summary>

  ```sh
  /skills add owner/repo --skill skill-name
  ```

  </details>
```

Sections are ordered by the job the reader is trying to do, and entries inside a section are
ordered roughly by how widely they are installed. If nothing fits, propose a new section in the PR
description rather than forcing an entry into the closest one.

## The bar

An entry gets merged when all of these hold.

1. **The install command works.** `owner/repo` resolves through the GitHub API under exactly that
   name, is not archived, and contains a `SKILL.md` whose folder name **or** frontmatter `name:`
   equals the `--skill` value. That is the rule fx's own installer applies, and
   `.github/scripts/verify-skills.mjs` re-runs it on every PR and every Monday.
2. **There is something to install.** A public repo with a real `SKILL.md`, not an announcement, a
   waitlist, or a landing page.
3. **The description says what it does**, not what it aspires to. No marketing adjectives.
4. **Paid is fine, hidden pricing is not.** Many of the best tools are commercial. If a skill needs
   a paid account or an API key to do anything, the description says so plainly.
5. **It would be worth listing regardless of who maintains it.**

Rejections are for dead links, nothing installable, duplicates, and spam. Anything else gets a
reply saying exactly what would get it in. If an entry is nearly right, the maintainers will fix
the formatting rather than bounce the PR.

## Adding an MCP server

Same idea, in the `fx MCP servers` section. Include the URL for a remote server, or the exact
command for a stdio one. A remote server has to answer an MCP `initialize` over HTTPS: either a
`200` for an open server, or a `401` carrying an RFC 9728 `WWW-Authenticate` challenge for a
protected one. Never put a literal token in a config block; fx rejects a literal `Authorization`
header by design, so use `bearer_token_env` or OAuth.

## Reporting something broken

Open an issue with the "Report a broken entry" template. Weekly automation catches renames,
archives, and skills that disappear out of a repo, but it cannot tell you a skill has quietly
become useless. That report has to come from a person.

## A note on our own entries

The maintainer of this list also builds developer tools
([TranscriptAPI](https://transcriptapi.com), [StayingAPI](https://stayingapi.com),
[Zillapi](https://zillapi.com)), and two of them appear on this page: `youtube-full` in the
Featured slot, and `transcriptapi` and `zillapi` under Live data APIs. They were listed only once
a genuinely working entry existed, they carry the same format and the same verification as
everything else, they appear at most once per section, and a competing entry is never rejected to
protect them.

The list is meant to be useful with every one of those entries deleted. If it stops being that,
open an issue and say so.

## Licence

Entries you contribute are licensed [CC BY 4.0](LICENSE-CONTENT.md), like the rest of the list.
Scripts in this repo are MIT.
