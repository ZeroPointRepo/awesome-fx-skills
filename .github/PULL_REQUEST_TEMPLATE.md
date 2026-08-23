## What kind of change is this?

- [ ] New skill entry
- [ ] New MCP server, gateway, port, or embedding entry
- [ ] Fix a broken or outdated entry
- [ ] Other (README, CONTRIBUTING, infra)

## Checklist for a new skill

- [ ] `owner/repo` resolves on GitHub under exactly that name and is not archived.
- [ ] The repo contains a `SKILL.md` whose **folder name** or **frontmatter `name:`** matches the
      `--skill` value in the install command.
- [ ] It is not already listed anywhere in the README.
- [ ] The entry matches the format: a bold action phrase, then
      `with [skill](repo-url) by [owner](owner-url).` then a factual description and the star count,
      followed by a collapsed `Install` block holding one `/skills add` line.
- [ ] It is in the section that matches the job it does.

## Checklist for a new MCP server

- [ ] The remote URL answers an MCP `initialize` over HTTPS (a `200`, or a `401` with an RFC 9728
      `WWW-Authenticate` challenge), or the stdio command is copied from the project's own docs.
- [ ] No literal token appears in any config block. fx rejects a literal `Authorization` header.

## Anything else maintainers should know?

<!-- Optional context -->
