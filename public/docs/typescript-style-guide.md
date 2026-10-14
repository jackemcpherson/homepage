# TypeScript Development Style Guide

This guide defines the tools, code conventions, and delivery rules for
TypeScript projects on Cloudflare Workers.

---

## Tech Stack

Use the runtime, frameworks, and tools in this section.

### Core Runtime and Frameworks

| Tool                      | Role                                                       |
| ------------------------- | ---------------------------------------------------------- |
| **TypeScript**            | Language (`strict: true`, type-checked via `tsgo`)         |
| **Effect**                | Typed errors, concurrency, dependency injection, schedules |
| **effect/Schema**         | Boundary validation, codecs, and inferred domain types     |
| **TanStack Start**        | Primary full-stack and UI framework with server rendering  |
| **Foldkit**               | Secondary UI framework (Elm Architecture on Effect)        |
| **Hono / Effect HttpApi** | Headless API routing on Cloudflare Workers                 |
| **D1**                    | Cloudflare SQLite database                                 |
| **Drizzle ORM**           | Type-safe SQL schema and query builder in Effect services  |

### Tooling

| Tool                     | Role                                                        |
| ------------------------ | ----------------------------------------------------------- |
| **Vite+ (`vp`)**         | Unified CLI: environment, installs, tasks, checks, builds   |
| **Node.js 24 LTS**       | Local runtime for tools, tests, and scripts (`vp env`)      |
| **pnpm**                 | Package manager (`pnpm-lock.yaml`) driven by `vp install`   |
| **Oxlint + `anti-slop`** | Linter and AST guardrail plugins (`oxlint` via `vp check`)  |
| **Oxfmt**                | Code formatter (`oxfmt` via `vp check`)                     |
| **tsgo**                 | TypeScript type checker (`tsgo` via `vp check`)             |
| **Vitest**               | Test runner (`@effect/vitest` and Miniflare via `vp test`)  |
| **Wrangler**             | Local bindings, `Env` type generation, and artefact upload  |

### Runtime Rules

Write application code for the Cloudflare Workers runtime (`workerd`).

- Use Web Standard APIs such as `fetch`, `Request`, `Response`, and `crypto`.
- Use Effect platform modules such as `effect/http` for platform services.
- Do not use Node.js built-ins such as `node:fs` or `process` in application
  or Worker code. Node.js runs only the tools, tests, and scripts.

### The Minimal-Worker Exception

Default to Effect, Drizzle, and TanStack Start or Hono. Use the Minimal-Worker
Exception only when a project meets all of these conditions:

- The project has three or fewer routes.
- The project has few SQL statements.
- The project has one maintainer.

Under this exception, apply these rules:

- Use Web Standard routing and parameterised SQL instead of Effect `Layer`
  services.
- Validate all external inputs at boundaries with `effect/Schema` or Zod.
- Run `vp check` before every commit.
- Record the exception in the project's `CLAUDE.md` file.
- State the threshold for a migration to full Effect and Hono in the same
  file, such as routes that exceed one conditional chain.

The exception changes application code only. The Worker still uses the
[Cloudflare delivery](#cloudflare-delivery) path.

### Package Scripts

Define these scripts in `package.json`:

```json
{
  "scripts": {
    "dev": "vp dev",
    "check": "vp check",
    "test": "vp test",
    "types": "wrangler types --include-runtime=false",
    "build": "vp check && vp test --run && vp build"
  }
}
```

- Always gate `build` on `vp check && vp test --run`.
- Run a script with `vp run <name>`, such as `vp run types`.
- Do not add a `deploy` script. Continuous integration publishes the build
  artefact, and `cloudflare-infra` deploys it.

### Environment and Dependencies

Vite+ manages the Node.js version and the package manager for each project.
Use pnpm as the package manager.

- Pin both with `vp env pin node@24 pnpm@11`. Commit the `.node-version` file
  and the `packageManager` field that the command writes.
- Install dependencies with `vp install`. Add or remove them with `vp add`,
  `vp add -D`, and `vp remove`. Do not edit dependency versions by hand.
- Commit `pnpm-lock.yaml` to version control.
- Run each one-off command from a local package with `vp exec <command>`.
- Run local TypeScript scripts directly with `node scripts/<name>.ts`.
  Node.js 24 removes the types and runs the result without a build step.

### Continuous Integration

Set up each GitHub Actions job with `voidzero-dev/setup-vp`. The action
installs Vite+, Node.js, and pnpm, then runs `vp install` with a cache. Do not
add separate `setup-node` or package-manager steps.

```yaml
- uses: voidzero-dev/setup-vp@<exact-release>
  with:
    node-version: "24"
    cache: true
- run: vp check
- run: vp test --run
- run: vp build
```

Pin the action to an exact release or a commit SHA. Do not use the `v1` tag,
because it no longer receives updates.

### Project Setup

Use these commands to start a new project:

```shell
# Scaffold the project with pnpm and the pre-commit hook
vp create vite:library --directory <project-name> --package-manager pnpm --hooks
cd <project-name>

# Pin Node.js and pnpm, then add dependencies
vp env pin node@24 pnpm@11
vp add effect drizzle-orm hono
vp add -D @cloudflare/workers-types @effect/vitest drizzle-kit wrangler

# Verify formatting, lint rules, and types
vp check
```

Vendor the `anti-slop` Oxlint plugin from
[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at a pinned commit
into `tools/oxlint/anti-slop/`. Change its plugin imports to
`vite-plus/lint/plugins`, and record the commit in `vite.config.ts`.

---

## TypeScript Configuration

Use strict mode in all projects. Do not weaken compiler flags.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types", "./worker-configuration.d.ts"]
  }
}
```

The `erasableSyntaxOnly` flag rejects syntax that Node.js cannot remove
without a build step, such as `enum`, `namespace`, and constructor parameter
properties.

---

## Vite+, Oxlint, and `anti-slop` Configuration

Configure linting, formatting, and testing in `vite.config.ts`. Import
`defineConfig` from `vite-plus`. Load the vendored `anti-slop` plugin and its
Effect rules from `tools/oxlint/anti-slop/`.

```typescript
// vite.config.ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
      { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" },
    ],
    rules: {
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "error",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop-effect/no-manual-tag-comparison": "error",
      "anti-slop-effect/no-manual-effect-error-tag": "error",
      "anti-slop-effect/no-manual-tagged-construction": "error",
      "anti-slop-effect/no-service-constructor-imports": "error",
      "anti-slop-effect/prefer-effect-match": "error",
    },
  },
  fmt: {
    printWidth: 100,
  },
  test: {
    globals: true,
    environment: "miniflare",
  },
});
```

### Linter Rules

The configured rules enforce these requirements:

| Requirement                   | Rule                                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| No unjustified assertions     | Never write `x as unknown as Foo`. Justify one `as` with `// SAFETY:` |
| No internal runtime narrowing | Decode with `Schema.decodeUnknownEffect` at the boundary only         |
| No known-value widening       | Never widen a typed value to `Record<string, unknown>` or `string`    |
| No module mocking             | Never use `vi.mock()`. Inject test services with `Layer`              |
| No manual `_tag` switches     | Use `Match.value`, `Match.type`, or `Effect.catchTag`                 |
| No manual `_tag` values       | Build tagged values and errors with their constructors                |
| No service constructor import | Provide services through layers, not imported `make*` functions       |

Put each unavoidable single `as` assertion at a foreign function interface
boundary. Write `// SAFETY: <reason>` on the line before it.

---

## Naming Conventions

Use these names for each construct:

| Construct                     | Convention                   | Example                                        |
| ----------------------------- | ---------------------------- | ---------------------------------------------- |
| Variables, functions, methods | `camelCase`                  | `fetchMatchResults`, `seasonId`                |
| Types, interfaces, classes    | `PascalCase`                 | `Match`, `PlayerMatchStats`, `AflApi`          |
| Effect Schemas, TaggedErrors  | `PascalCase`                 | `MatchSchema`, `AflApiError`, `StaleDataError` |
| Effect Services and Layers    | `PascalCase` + `Live`/`Test` | `AflApi`, `AflApiLive`, `AflApiTest`           |
| Constants (true constants)    | `SCREAMING_SNAKE`            | `MAX_RETRY_COUNT`, `DEFAULT_PAGE_SIZE`         |
| Enum-like unions              | `PascalCase` values          | `type RoundType = "HomeAndAway" \| "Finals"`   |
| File names                    | `kebab-case`                 | `afl-api.ts`, `player-stats.ts`                |
| Test files                    | `*.test.ts`                  | `afl-api.test.ts`                              |
| Type and schema files         | `*.types.ts` or `schema.ts`  | `types.ts`, `schema.ts`                        |
| Private class members         | `private` keyword            | No underscore prefix                           |

- Start Boolean variable names with `is`, `has`, `should`, or `can`.
- Use plural names for collections, such as `matches` and `playerStats`.
- Do not append `Effect` or `Async` to function names.
- Treat abbreviations of three or more letters as words, such as `AflApi` and
  `HttpClient`.
- Keep two-letter abbreviations uppercase, such as `ID` and `IO`.

---

## Type System and Schema Validation

Model domain data with types and schemas before you write behaviour.

### Interfaces, Types, and Schemas

- Use `interface` for internal object shapes and service contracts.
- Use `type` for unions, intersections, and mapped types.
- Use `effect/Schema` for all domain models that cross system boundaries.
- Mark all properties `readonly` and prefer `ReadonlyArray<T>`.
- Do not use `enum` or `any`. Use `Schema.Literal` or union types.

### Boundary Validation with `effect/Schema`

Decode all external data with `effect/Schema`. External data includes API
responses, user inputs, remote procedure call payloads, and agent tool
arguments. Derive static types from each schema.

```typescript
import { Schema } from "effect";

export const AflMatchResponseSchema = Schema.Struct({
  "match.matchId": Schema.String,
  "match.date": Schema.String,
  "venue.name": Schema.String,
  "homeTeamScore.matchScore.totalScore": Schema.Number,
  "homeTeamScore.matchScore.goals": Schema.Number,
  "homeTeamScore.matchScore.behinds": Schema.Number,
  "homeTeamScore.periodScore": Schema.optional(
    Schema.Array(
      Schema.Struct({
        "score.goals": Schema.Number,
        "score.behinds": Schema.Number,
      }),
    ),
  ),
  "awayTeamScore.matchScore.totalScore": Schema.Number,
  "awayTeamScore.matchScore.goals": Schema.Number,
  "awayTeamScore.matchScore.behinds": Schema.Number,
});

export type AflMatchResponse = typeof AflMatchResponseSchema.Type;

export const parseMatchResponse = Schema.decodeUnknownEffect(AflMatchResponseSchema);
```

### Tagged Unions and `Match`

Model mixed results as tagged unions. Handle every case with `Match`.

```typescript
import { Data, Match } from "effect";

type SearchResult = Data.TaggedEnum<{
  MatchResult: {
    readonly matchId: number;
    readonly homeTeam: string;
    readonly awayTeam: string;
    readonly margin: number;
  };
  PlayerSeasonResult: {
    readonly playerId: number;
    readonly playerName: string;
    readonly year: number;
    readonly games: number;
  };
}>;

const formatResult = Match.type<SearchResult>().pipe(
  Match.tag("MatchResult", (r) => `${r.homeTeam} vs ${r.awayTeam}`),
  Match.tag("PlayerSeasonResult", (r) => `${r.playerName} (${r.year})`),
  Match.exhaustive,
);
```

---

## Documentation with TSDoc

Write TSDoc comments for the public surface of each module.

- Document all exported functions, Effect services, schemas, interfaces, and
  module-level constants.
- Document private helpers only when their logic is not self-evident.
- Do not document one-line functions whose names and signatures explain their
  behaviour.

```typescript
/**
 * Fetch AFL match results for a given season.
 *
 * Resolves season and round IDs from the official AFL API, then fetches
 * all completed match results. Falls back to FootyWire if the primary API
 * fails or returns stale data (more than 3 days behind).
 *
 * @param season - The season year, for example 2027.
 * @param roundNumber - Specific round to fetch. Fetches all completed
 *   rounds if omitted.
 * @returns An Effect yielding match results sorted by date.
 *
 * @example
 * ```typescript
 * const results = yield* fetchMatchResults(2027);
 * const round1 = yield* fetchMatchResults(2027, 1);
 * ```
 */
export const fetchMatchResults = (
  season: number,
  roundNumber?: number,
): Effect.Effect<
  ReadonlyArray<Match>,
  DataSourceError,
  AflApi | FootywireApi
> => ...
```

---

## Error Handling and Effect Control Flow

Keep every expected failure in the Effect error channel.

- Do not use `throw` or `try/catch` in application logic.
- Define domain errors with `Schema.TaggedError` or `Data.TaggedError`.
- Wrap third-party APIs that return a `Promise` with `Effect.tryPromise` at
  the boundary.
- Handle retries and fallback sources with `Effect.retry`, `Schedule`, and
  `Effect.catchTags`.

```typescript
import { Effect, Schedule, Schema } from "effect";

export class AflApiError extends Schema.TaggedError<AflApiError>()(
  "AflApiError",
  {
    message: Schema.String,
    statusCode: Schema.Number,
    endpoint: Schema.String,
  },
) {}

export class StaleDataError extends Schema.TaggedError<StaleDataError>()(
  "StaleDataError",
  {
    lastUpdate: Schema.Date,
    thresholdDays: Schema.Number,
  },
) {}

export const fetchWithFallback = (season: number) =>
  fetchFromAflApi(season).pipe(
    Effect.retry(
      Schedule.exponential("200 millis").pipe(Schedule.upTo({ times: 3 })),
    ),
    Effect.catchTags({
      AflApiError: (err) =>
        Effect.logWarning(`AFL API failed (${err.endpoint}), falling back`).pipe(
          Effect.andThen(fetchFromFootywire(season)),
        ),
      StaleDataError: (err) =>
        Effect.logWarning(`AFL API stale (${err.lastUpdate.toISOString()}), falling back`).pipe(
          Effect.andThen(fetchFromFootywire(season)),
        ),
    }),
  );
```

---

## Frontend and Full-Stack Frameworks

Use TanStack Start by default. Use Foldkit for state-machine interfaces.

### Primary Framework: TanStack Start

Use TanStack Start for web applications, server rendering, and interactive
dashboards on Cloudflare Workers.

- Validate router parameters and server function inputs with
  `Schema.toStandardSchemaV1(MyEffectSchema)`.
- Run Effect workflows inside `createServerFn` with `Effect.runPromise` or
  `ManagedRuntime`.
- Agree a release procedure in `cloudflare-infra` before the first deployment.
  TanStack Start emits several modules and static assets, and the standard
  single-bundle release cannot carry them. HK Food uses its own procedure for
  the same reason.

```typescript
import { createServerFn } from "@tanstack/react-start";
import { Schema, Effect } from "effect";
import { getLadderForSeason } from "../etl/pipeline";
import { AppLayer } from "../layers";

const SeasonInput = Schema.Struct({ year: Schema.Number });

export const fetchLadderFn = createServerFn({ method: "GET" })
  .inputValidator(Schema.toStandardSchemaV1(SeasonInput))
  .handler(async ({ data }) => {
    return Effect.runPromise(
      getLadderForSeason(data.year).pipe(Effect.provide(AppLayer)),
    );
  });
```

### Secondary Framework: Foldkit

Use Foldkit for complex state-machine interfaces. Also use it for internal
tools that you inspect with the Foldkit DevTools MCP server.

- Define UI state in a single immutable `Schema.Struct` named `Model`.
- Define transitions as `Message` tagged unions.
- Keep `update(model, message)` pure. Return `[nextModel, commands]`.

---

## Project Structure

Use this layout for an Effect Worker project:

```text
src/
  types.ts              # Shared domain schemas & types (define first)
  worker.ts             # Entry point: Worker fetch / TanStack Start / cron handler
  layers.ts             # Effect Layer composition (Live vs Test bindings)
  db/
    schema.ts           # Drizzle SQLite table definitions
    service.ts          # Drizzle wrapped as an Effect Context.Service
  etl/
    afl-api.ts          # AFL official API Effect service & layer
    footywire.ts        # FootyWire fallback Effect service & layer
    transforms.ts       # Pure synchronous functions: normalisation, flattening
    pav.ts              # Pure synchronous functions: PAV calculation
    pipeline.ts         # Effect.gen orchestrator: freshness -> extract -> load -> embed
  mcp/
    server.ts           # MCP protocol handler
    tools.ts            # Tool definitions (validated via effect/Schema)
    code-mode.ts        # Dynamic Worker Code Mode handler
  lib/
    team-mapping.ts     # Team name normalisation
    date-utils.ts       # AEST/AEDT-aware date handling

migrations/             # Generated Drizzle SQL, published with each release

tools/
  oxlint/
    anti-slop/          # Vendored anti-slop AST rules
      effect/           # Vendored Effect AST rules

test/
  etl/
    afl-api.test.ts
    transforms.test.ts
    pav.test.ts
  mcp/
    tools.test.ts
  fixtures/             # Snapshot API payloads for offline testing
    afl-api-round-1.json
    footywire-results-2027.html

wrangler.jsonc             # Local bindings for vp dev, Miniflare, and wrangler types
worker-configuration.d.ts  # Generated Env type (vp run types)
vite.config.ts             # Vite+, Oxlint, Oxfmt, and Vitest configuration
drizzle.config.ts          # Drizzle Kit migration config
.node-version              # Node.js version pinned by vp env pin
tsconfig.json
package.json
pnpm-lock.yaml
```

---

## Code Patterns

Apply these patterns to workflows, services, concurrency, transforms, delivery,
and data access.

### Workflows with `Effect.gen`

Write each multi-step workflow as one `Effect.gen` function.

```typescript
import { Effect } from "effect";

export const runEtlPipeline = (currentYear: number) =>
  Effect.gen(function* () {
    const afl = yield* AflApi;
    const db = yield* Database;
    const vectorStore = yield* VectorStore;

    const seasonId = yield* afl.getSeasonId(currentYear);
    const rounds = yield* afl.getRoundIds(seasonId);
    const freshness = yield* db.checkFreshness();

    if (!freshness.isStale) {
      return { newData: false, matchesLoaded: 0 } as const;
    }

    const matches = yield* afl.fetchNewMatches(rounds, freshness.lastRound);
    yield* db.loadMatches(matches);
    yield* vectorStore.generateEmbeddings(matches);

    return { newData: true, matchesLoaded: matches.length } as const;
  });
```

### Services and Layers

Do not pass raw `env: Env` objects through domain functions. Define services
with `Context.Service` and construct implementations with `Layer`. Read bindings
from `Env` only in the entry point and in `Layer` constructors.

```typescript
import { Context, Effect, Layer } from "effect";

export class AflApi extends Context.Service<
  AflApi,
  {
    readonly getSeasonId: (year: number) => Effect.Effect<number, AflApiError>;
    readonly fetchMatchResults: (seasonId: number) => Effect.Effect<ReadonlyArray<Match>, AflApiError>;
  }
>()("AflApi") {}

export const AflApiLive = Layer.succeed(AflApi, {
  getSeasonId: (year) => /* live implementation */,
  fetchMatchResults: (seasonId) => /* live implementation */,
});
```

### Bounded Concurrency

Specify an explicit concurrency limit when you map over a collection.

```typescript
const [results, stats, ladder] = yield* Effect.all(
  [
    afl.fetchMatchResults(seasonId),
    afl.fetchPlayerStats(seasonId),
    afl.fetchLadder(seasonId),
  ],
  { concurrency: "unbounded" },
);

const [successes, failures] = yield* Effect.partition(
  roundIds,
  (id) => afl.fetchRoundResults(id),
  { concurrency: 5 },
);
```

### Pure Transforms and Lookups

Use `Map` for key-value lookups. Use immutable array methods such as
`.filter`, `.map`, and `.toSorted` for data transformations.

```typescript
const teamNameMap = new Map<string, string>([
  ["Brisbane", "Brisbane Lions"],
  ["GWS", "GWS Giants"],
  ["Western Bulldogs", "Western Bulldogs"],
  ["Bulldogs", "Western Bulldogs"],
  ["Footscray", "Western Bulldogs"],
]);

export function normaliseTeamName(raw: string): string {
  return teamNameMap.get(raw) ?? raw;
}

export function processMatchResults(
  raw: ReadonlyArray<AflMatchResponse>,
): ReadonlyArray<Match> {
  return raw
    .filter((m) => m["match.date"] !== "")
    .map(flattenMatchScores)
    .map(normaliseTeamNames)
    .toSorted((a, b) => a.date.getTime() - b.date.getTime());
}
```

### Cloudflare Delivery

The `cloudflare-infra` repository manages every Cloudflare resource with
OpenTofu. Application repositories own code, tests, and migrations. They do
not create, change, or deploy Cloudflare resources.

- Declare production bindings, routes, cron triggers, and the compatibility
  date in `targets/<app>/worker.json` in `cloudflare-infra`.
- Keep `wrangler.jsonc` in the application repository for local development
  only.
- Copy the binding names from `worker.json` into `wrangler.jsonc`. Local
  development, Miniflare, and `wrangler types` then match production.
- Generate `Env` with `vp run types`. Do not write `interface Env` by hand.
- Set Worker secrets with `wrangler secret put`. Never commit or print a
  secret value.

#### Warning: Untracked Production State

Do not run `wrangler deploy` or `wrangler d1 migrations apply --remote`. Do
not run an infrastructure-as-code tool such as Alchemy against the account.
These commands create live state that OpenTofu does not manage. The nightly
drift check then fails.

#### Supported Bindings

The shared `worker-app` module supports these binding types:

- D1 databases, KV namespaces, and Queue producers.
- Rate limits, Workers AI, and Workflows.
- Plain-text variables, secrets, and the Dynamic Worker Loader.

Add support to `modules/worker-app` in `cloudflare-infra` before you use
another binding type, such as Vectorize.

#### Publish a Release

Continuous integration publishes each release from `main`:

1. Run `vp run build` to produce one ES module bundle.
2. Upload the bundle to R2 as `worker-artifacts/<app>/<git-sha>.js`.
3. If the Worker uses D1, upload the migration archive to R2.

Name the migration archive `worker-artifacts/<app>/<git-sha>-migrations.tar.gz`.
Put only regular SQL files under one `migrations/` directory in the archive.
The Worker loads the bundle as its `index.js` main module.

#### Promote a Release

Run the promotion workflow in `cloudflare-infra` with the full commit SHA:

```shell
gh workflow run promote-worker.yml -f app=<app> -f version=<full-40-character-sha>
```

The workflow checks the bundle and migration digests. It then opens a
promotion pull request. After you merge the pull request, dispatch
`apply-prod` for the Target. The pipeline applies the pinned migrations,
deploys the bundle, and verifies the Worker.

### Drizzle ORM

Define all tables in `src/db/schema.ts`. Wrap Drizzle inside an Effect service
in `src/db/service.ts`.

```typescript
// src/db/service.ts
import { Context, Effect, Layer, Schema } from "effect";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export class DatabaseError extends Schema.TaggedError<DatabaseError>()(
  "DatabaseError",
  { message: Schema.String, cause: Schema.optional(Schema.Unknown) },
) {}

export class Database extends Context.Service<
  Database,
  {
    readonly query: <A>(
      fn: (db: DrizzleD1Database<typeof schema>) => Promise<A>,
    ) => Effect.Effect<A, DatabaseError>;
  }
>()("Database") {}

export const DatabaseLive = (d1: D1Database) => {
  const client = drizzle(d1, { schema });
  return Layer.succeed(Database, {
    query: (fn) =>
      Effect.tryPromise({
        try: () => fn(client),
        catch: (cause) =>
          new DatabaseError({ message: "D1 query failed", cause }),
      }),
  });
};
```

Generate migrations into `migrations/` with `vp exec drizzle-kit generate`. Do
not write migration SQL by hand. Apply migrations to the local database only:

```shell
vp exec wrangler d1 migrations apply <database-name> --local
```

The `apply-prod` pipeline applies remote migrations from the pinned release.
Do not edit or reverse a migration after a release publishes it. Write a new
migration to correct a fault.

---

## Testing

Test pure logic and Effect workflows without network access.

- Run tests with `vp test`, which uses `@effect/vitest` and Miniflare.
- Store snapshot API payloads in `test/fixtures/`.
- Never make live network requests in tests.
- Test pure transforms with standard `it(...)` blocks.
- Test Effect workflows with `it.effect(...)` and test `Layer`
  implementations.
- Never use `vi.mock()`.
- Name each test as a behavioural sentence, such as
  `falls back to FootyWire when AFL API returns 503`.

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { flattenMatchScores } from "../../src/etl/transforms";
import { AflApi } from "../../src/etl/afl-api";
import rawRound1 from "../fixtures/afl-api-round-1.json";

describe("flattenMatchScores", () => {
  it("extracts quarter scores from nested periodScore array", () => {
    const result = flattenMatchScores(rawRound1.items[0]);

    expect(result.homeQ1Goals).toBe(3);
    expect(result.homeQ1Behinds).toBe(2);
    expect(result.awayQ4Goals).toBe(4);
  });
});

describe("AflApi workflow", () => {
  const MockAflApiLayer = Layer.succeed(AflApi, {
    getSeasonId: () => Effect.succeed(2027),
    fetchMatchResults: () => Effect.succeed([]),
  });

  it.effect("resolves matches using injected test layer", () =>
    Effect.gen(function* () {
      const api = yield* AflApi;
      const matches = yield* api.fetchMatchResults(2027);
      expect(matches).toEqual([]);
    }).pipe(Effect.provide(MockAflApiLayer)),
  );
});
```

---

## Core Rules

Apply these rules when two conventions appear to conflict.

### 1. Define Schemas and Types First

Define `effect/Schema` models, tagged errors, and service interfaces in
`types.ts` before you write implementation code.

### 2. Decode at Boundaries and Trust Internally

Validate external data one time at the system edge with `effect/Schema`. Do
not use `typeof` checks or `unknown` parameters inside domain logic.

### 3. Separate Pure Logic from Input and Output

Keep calculations and data transformations in pure synchronous functions. Keep
HTTP, database, and AI operations inside Effect `Layer` services.

### 4. Make Errors and Dependencies Explicit

Track all expected failures in the Effect `E` channel with
`Schema.TaggedError`. Track all capabilities in the `R` channel with
`Context.Service`.

### 5. Pass `vp check`

Make all code pass `vp check` with zero warnings or errors before completion.
The check runs Oxfmt, Oxlint with `anti-slop`, and `tsgo`.

### 6. Minimise Dependencies

Prefer Web Standard APIs, `effect`, and native Cloudflare Workers bindings over
third-party utilities.

### 7. Keep One Responsibility in Each Module

Put one concern in each file. For example, `afl-api.ts` holds the API service,
`transforms.ts` holds pure transforms, and `pipeline.ts` holds orchestration.

### 8. Deploy Only Through `cloudflare-infra`

Publish a build artefact and let the GitOps pipeline deploy it. Do not deploy
from an application repository.

---

## References

Read the linked documentation before you configure tools or write application
code. Each link uses the `defuddle.md` prefix to return agent-readable
Markdown.

- [Google TypeScript Style Guide](https://defuddle.md/google.github.io/styleguide/tsguide.html)
- [TSDoc specification](https://defuddle.md/tsdoc.org/)
- [Vite+ documentation](https://defuddle.md/viteplus.dev/guide/)
- [pnpm documentation](https://defuddle.md/pnpm.io/)
- [Oxc documentation](https://defuddle.md/oxc.rs/docs/guide/introduction.html)
- [dmmulroy/anti-slop Oxlint rules](https://defuddle.md/github.com/dmmulroy/anti-slop)
- [Effect documentation](https://defuddle.md/effect.website/docs/)
- [TanStack Start documentation](https://defuddle.md/tanstack.com/start/latest/docs/framework/react/overview)
- [Foldkit documentation](https://defuddle.md/foldkit.dev/)
- [Hono documentation](https://defuddle.md/hono.dev/)
- [Drizzle ORM documentation](https://defuddle.md/orm.drizzle.team/)
- [Cloudflare Workers documentation](https://defuddle.md/developers.cloudflare.com/workers/)
- [Cloudflare Wrangler CLI documentation](https://defuddle.md/developers.cloudflare.com/workers/wrangler/)
- [Cloudflare D1 documentation](https://defuddle.md/developers.cloudflare.com/d1/)
- [Cloudflare Workers AI documentation](https://defuddle.md/developers.cloudflare.com/workers-ai/)
- [Cloudflare Dynamic Workers documentation](https://defuddle.md/developers.cloudflare.com/workers/runtime-apis/dynamic-worker/)
- [Vitest documentation](https://defuddle.md/vitest.dev/)
