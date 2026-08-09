# Project Instructions

## Project Standards

This repository adopts Jack's infrastructure authoring and Markdown standards:
https://jackemcpherson.com/docs/

Project decisions:

- This site uses Cloudflare Workers Static Assets without Worker TypeScript.
- Public documentation checks exclude internal agent files, plans, immutable
  source snapshots, and generated artefacts. `.rumdl.toml` and `.vale.ini`
  define the exact exclusions.
- Run `rumdl check --deny-config-warnings .` and `vale --no-global .` for
  Markdown changes.
