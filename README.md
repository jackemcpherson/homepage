# Jack McPherson Homepage

This repository contains Jack McPherson's personal homepage and public
development style guides. Cloudflare Workers serves the files in `public/` as
static assets.

---

## Local Development

Install Node.js and Wrangler, then start the local asset server:

```bash
npx wrangler dev
```

Open the local address that Wrangler prints. Edit files under `public/` and
refresh the browser to review changes.

## Deployment

Deploy the static assets and route configuration with Wrangler:

```bash
npx wrangler deploy
```

The `wrangler.jsonc` file defines the asset directory and custom domains.

## Project Layout

| Path                 | Purpose                                           |
| -------------------- | ------------------------------------------------- |
| `public/index.html`  | Homepage markup.                                  |
| `public/style.css`   | Homepage presentation and responsive styles.      |
| `public/favicon.svg` | Site icon.                                        |
| `public/docs/`       | Public development and documentation standards.   |
| `wrangler.jsonc`     | Cloudflare Workers asset and route configuration. |

## Public Guides

- [Markdown style guide](public/docs/markdown-style-guide.md)
- [Python style guide](public/docs/python-style-guide.md)
- [TypeScript style guide](public/docs/typescript-style-guide.md)
- [Infrastructure development style guide](public/docs/infrastructure-style-guide.md)
- [Infrastructure authoring guide](public/docs/infrastructure-authoring-guide.md)
- [AFL data ecosystem](public/docs/afl-data-ecosystem.md)

## Documentation Checks

Run both documentation checks before publishing changes:

```bash
rumdl check --deny-config-warnings .
vale --no-global .
```
