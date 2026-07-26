# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What This Is

A static personal holding page for jackemcpherson.com. The site has no build
tools, bundler, or framework. A Cloudflare Worker serves the `public/` assets.

## Development

Open `index.html` in a browser. There is no build step, dev server, or test
suite. To preview the asset-serving behaviour (including `_headers`) locally:
`npx wrangler@4 dev`.

### Documentation

Markdown files follow `public/docs/markdown-style-guide.md`.

```sh
rumdl check --deny-config-warnings .
vale --no-global .
```

Use `rumdl check --deny-config-warnings --fix .` to apply safe Markdown fixes.

## Deployment

Hosted on Cloudflare Workers (Static Assets) with a custom domain
(`jackemcpherson.com`). Pushing to `main` triggers Workers Builds (configured in
the Cloudflare dashboard via the Cloudflare GitHub App), which runs
`npx wrangler@4 deploy` and ships to production. Builds typically land within
30-60 seconds after a push. To deploy manually, run `npx wrangler@4 deploy`
from the repository root.

Workers Builds posts a `Workers Builds: jackemcpherson-homepage` check run. To
verify a deployment, confirm that this check succeeds. Then run
`npx wrangler@4 deployments list` and find a `Created:` timestamp newer than the
push. The Cloudflare dashboard also contains the complete build log.

Layout:

| Path              | Purpose                                                     |
| ----------------- | ----------------------------------------------------------- |
| `public/`         | Contains all served files                                   |
| `public/_headers` | Defines HSTS, CSP, X-Frame-Options, and Permissions-Policy  |
| `wrangler.jsonc`  | Defines the Worker name, compatibility date, and asset path |
| `.assetsignore`   | Excludes `.DS_Store` from the uploaded assets               |

## Architecture

| File          | Role                                                                   |
| ------------- | ---------------------------------------------------------------------- |
| `index.html`  | Defines the holding page, name, and social links                       |
| `style.css`   | Defines colours, fonts, spacing, animations, responsive, and print CSS |
| `favicon.svg` | Defines a red square with the "JM" initials                            |

## Design Conventions

- Use `#C0392B` for the theme colour, accent rule, selection highlight, hover
  underlines, focus rings, and favicon.
- Use Charter for the body and name. Use Helvetica Neue for social links.
- Use a minimal, centred card layout with middot-separated social links.
- The commented HTML contains a portrait image slot for `portrait.png`.
