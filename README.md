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

## Immutable Build Publication

The publisher packages committed assets and configuration into a versioned
archive, file manifest, and release marker. It preserves headers, redirects,
and explicit Worker modules. Publishing creates immutable objects in the
`worker-artifacts` R2 bucket. It does not deploy a Worker or change traffic.

Use Bun 1.4.0 to test and package a commit locally:

```bash
bunx @biomejs/biome@2.5.11 check --indent-style=space --indent-width=2 scripts
bun test scripts/publish-build.test.mjs
bun scripts/publish-build.mjs package FULL_COMMIT /tmp/homepage-build
```

Replace `FULL_COMMIT` with the complete Git revision and choose a new output
directory. The package command needs no credentials. To include Worker modules,
append their committed paths after the output directory.

The Publish homepage build workflow checks every PR. On main, it publishes the
selected commit. Manual dispatch accepts an earlier commit from main history.
The `artifact-publish` environment must restrict deployment branches to `main`.
Configure `CLOUDFLARE_ACCOUNT_ID` as an environment variable and these secrets:

- `R2_ARTIFACTS_ACCESS_KEY_ID`
- `R2_ARTIFACTS_SECRET_ACCESS_KEY`

The publisher credential needs object access only to `worker-artifacts`.
It must not access state or deploy Workers. A retry verifies existing objects
and creates only missing objects. Conflicting bytes stop publication.
The release marker follows successful archive and manifest readback.

Select the resulting publication in `cloudflare-infra`, then review its Plan.
Workers Builds retains current deployment ownership until the migration freeze.
Do not treat successful publication as deployment or health verification.

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
