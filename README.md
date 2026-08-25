# Jack McPherson Homepage

This repository contains Jack McPherson's personal homepage, blog posts,
public development style guides, and AFL fixture calendars. Cloudflare Workers
serves the files in `public/` as static assets.

---

## Local Development

Install Node.js and Wrangler, then start the local asset server:

```bash
npx wrangler@4 dev
```

Open the local address that Wrangler prints. Edit files under `public/` and
refresh the browser to review changes.

## Deployment

Deploy the static assets and route configuration with Wrangler:

```bash
npx wrangler@4 deploy
```

The `wrangler.jsonc` file defines the asset directory, URL handling, the
not-found page, and custom domains.

## Project Layout

| Path                 | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `public/index.html`  | Homepage markup.                                   |
| `public/style.css`   | Shared shell styles for standard pages.            |
| `public/posts/`      | Blog posts, post images, and icons.                |
| `public/posts/elo/`  | Shared ELO chart engine, styles, and club data.    |
| `public/docs/`       | Public development and documentation standards.    |
| `public/calendars/`  | AFL fixture calendars in iCalendar format.         |
| `public/_headers`    | Security headers and the Cache-Control policy.     |
| `public/404.html`    | Not-found page.                                    |
| `public/sitemap.xml` | Canonical URL listing for search engines.          |
| `public/favicon.svg` | Site icon.                                         |
| `wrangler.jsonc`     | Cloudflare Workers asset and route configuration.  |

## Public Guides

- [Markdown style guide](public/docs/markdown-style-guide.md)
- [Python style guide](public/docs/python-style-guide.md)
- [TypeScript style guide](public/docs/typescript-style-guide.md)
- [Infrastructure style guide](public/docs/infrastructure-style-guide.md)
- [Infrastructure authoring guide](public/docs/infrastructure-authoring-guide.md)
- [AFL data ecosystem](public/docs/afl-data-ecosystem.md)

## Documentation Checks

Run both documentation checks before publishing changes:

```bash
rumdl check --deny-config-warnings .
vale --no-global .
```
