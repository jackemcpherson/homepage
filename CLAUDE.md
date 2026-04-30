# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A static personal holding page for jackemcpherson.com. No build tools, no bundler, no framework — just `index.html` and `style.css` served directly via GitHub Pages.

## Development

Open `index.html` in a browser. There is no build step, dev server, or test suite.

## Deployment

Hosted on GitHub Pages with a custom domain (`jackemcpherson.com` via CNAME). Pushing to the default branch deploys automatically.

## Architecture

- **index.html** — Single-page holding page with name and social links (GitHub, LinkedIn, X, Email). Uses Charter webfont via CDN.
- **style.css** — All styling. Uses CSS custom properties in `:root` for colors, fonts, and spacing. Includes CSS animations (accent-rule draw, card fade-in), responsive breakpoint at 480px, and print styles.
- **favicon.svg** — Red square with "JM" initials, uses the accent color `#C0392B`.

## Design Conventions

- Accent color: `#C0392B` (used in theme-color meta, accent rule, selection highlight, hover underlines, focus rings, favicon)
- Typography: Charter (serif) for body/name, Helvetica Neue (sans) for social links
- Minimal, centered card layout with middot-separated social links
- Portrait image slot exists in HTML (commented out), expects `portrait.png`
