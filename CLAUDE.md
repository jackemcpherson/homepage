# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A static personal holding page for jackemcpherson.com. No build tools, no bundler, no framework — `public/` contains the entire site, served as assets from a Cloudflare Worker.

## Development

Open `index.html` in a browser. There is no build step, dev server, or test suite. To preview the asset-serving behavior (including `_headers`) locally: `npx wrangler@4 dev`.

## Deployment

Hosted on Cloudflare Workers (Static Assets) with a custom domain (`jackemcpherson.com`). Pushing to `main` triggers Workers Builds, which runs `npx wrangler@4 deploy` and ships to production. Manual deploy: `npx wrangler@4 deploy` from the repo root.

Layout:
- `public/` — everything that gets served. Edit files here.
- `public/_headers` — security headers (HSTS, CSP, X-Frame-Options, Permissions-Policy, etc.).
- `wrangler.jsonc` (root) — Worker name, compat date, assets directory pointer.
- `.assetsignore` (root) — within `public/`, files to skip (just `.DS_Store`).

## Architecture

- **index.html** — Single-page holding page with name and social links (GitHub, LinkedIn, X, Email). Uses Charter webfont via CDN.
- **style.css** — All styling. Uses CSS custom properties in `:root` for colors, fonts, and spacing. Includes CSS animations (accent-rule draw, card fade-in), responsive breakpoint at 480px, and print styles.
- **favicon.svg** — Red square with "JM" initials, uses the accent color `#C0392B`.

## Design Conventions

- Accent color: `#C0392B` (used in theme-color meta, accent rule, selection highlight, hover underlines, focus rings, favicon)
- Typography: Charter (serif) for body/name, Helvetica Neue (sans) for social links
- Minimal, centered card layout with middot-separated social links
- Portrait image slot exists in HTML (commented out), expects `portrait.png`
