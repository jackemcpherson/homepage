# CLAUDE.md

@AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What This Is

The personal site for jackemcpherson.com: a minimal holding page, a set of
blog posts, public development style guides, and AFL fixture calendars. The
site has no build tools, bundler, or framework. A Cloudflare Worker serves the
`public/` assets.

## Development

Open `public/index.html` in a browser. There is no build step, dev server, or
test suite. To preview the asset-serving behaviour (including `_headers`)
locally: `npx wrangler@4 dev`.

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

| Path                | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `public/`           | Contains all served files                                  |
| `public/_headers`   | Defines security headers and the Cache-Control policy      |
| `wrangler.jsonc`    | Defines the Worker name, asset behaviour, and domains      |
| `.assetsignore`     | Excludes `.DS_Store` from the uploaded assets              |

## Architecture

| Path                 | Role                                                      |
| -------------------- | --------------------------------------------------------- |
| `public/index.html`  | Defines the holding page, name, and social links          |
| `public/style.css`   | Defines the shared shell: home, indexes, standard posts   |
| `public/posts/`      | Contains blog posts and their images and icons            |
| `public/posts/elo/`  | Contains the shared ELO chart engine, CSS, and club data  |
| `public/docs/`       | Contains public style guides and reference documents      |
| `public/calendars/`  | Contains AFL fixture calendars (`.ics`) and their index   |
| `public/404.html`    | Defines the not-found page (`not_found_handling`)         |
| `public/sitemap.xml` | Lists every page under its canonical URL                  |
| `public/favicon.svg` | Defines a red square with the "JM" initials               |

## Design Conventions

The site has two styling regimes:

- Standard pages (home, indexes, album and software posts, docs) use the
  shared shell in `style.css`: Charter for body text, Helvetica Neue for
  links, `#C0392B` for the theme colour, accent rule, selection highlight,
  hover underlines, and focus rings.
- Art-directed posts own their design completely: `bald-man-scale.html`
  carries its styles inline, and the ELO posts combine shared assets in
  `posts/elo/` with a small inline per-club theme block (colours, guernsey
  masthead art). These pages set their own fonts and `theme-color`.

Sitewide policies:

- The holding page intentionally links only to social profiles. Do not add
  navigation to `/posts/`, `/docs/`, or `/calendars/` from the home page.
- Canonical URLs are extensionless (`/posts/bald-man-scale`). Use that form
  in canonicals, `og:url`, internal links, and the sitemap. It depends on
  `html_handling: auto-trailing-slash` in `wrangler.jsonc`.
- Caching lives in `public/_headers`. Never add `?v=` query strings to asset
  URLs.
- No inline JavaScript anywhere: the CSP is `script-src 'self'`, so scripts
  must be external files and elements must not use inline event handlers.
- The commented HTML in `index.html` contains a portrait image slot for
  `portrait.png`.
