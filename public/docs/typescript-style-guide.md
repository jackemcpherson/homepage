# TypeScript Development Style Guide

This guide defines tools, project structure, and code conventions for TypeScript
projects. Use these rules for human-authored and AI-authored TypeScript code.

---

## Tech Stack

Use the runtime, frameworks, and development tools in this section.

### Core Runtime and Frameworks

| Tool                | Role                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| `TypeScript`        | Language with `strict: true`, checked with `tsc`                          |
| `Effect`            | Typed errors, concurrency, dependency injection (`Layer`), and `Schedule` |
| `effect/Schema`     | Boundary validation, codecs, and inferred domain types                    |
| `TanStack Start`    | Primary web framework for SSR, Server Functions, and routing              |
| `Foldkit`           | Secondary user interface framework using Model-View-Update on Effect      |
| `Hono` or `HttpApi` | HTTP routing on Cloudflare Workers                                        |
| `D1`                | Cloudflare SQLite database                                                |
| `Drizzle ORM`       | Type-safe SQL schema and query builder inside Effect services             |

### Tooling

| Tool           | Role                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| `Vite+` (`vp`) | Unified CLI for tasks, bundling (`rolldown`), checks, and tests         |
| `Bun`          | Package manager (`bun.lock`) and local script runtime                   |
| `Oxlint`       | Type-aware linter and `anti-slop` AST plugins (`vp check`)              |
| `Oxfmt`        | Code formatter (`vp check`)                                             |
| `tsc`          | TypeScript 7 type checker (`vp check` and `typecheck` script)           |
| `Vitest`       | Test runner with `@effect/vitest` (`vp test`)                           |
| `Alchemy`      | TypeScript infrastructure definitions and deployment (`alchemy.run.ts`) |

### Runtime Rules

- Target the Cloudflare Workers runtime (`workerd`).
- Do not use Bun-specific APIs such as `Bun.file()` or `Bun.serve()` in
  Worker code.
- Use Web Standard APIs such as `fetch`, `Request`, `Response`, and `crypto`.
- Use the platform modules built into `effect`, such as `effect/http` and
  `FileSystem`, for platform operations.
- Pin `effect` to an exact version. The `effect/cli` and `effect/http` modules
  carry an unstable tag and can change in a minor release.

### The Minimal-Worker Exception

Use the full stack of Effect, Alchemy, Drizzle, and TanStack or Hono by default.
Apply the Minimal-Worker Exception only when a project meets all of these
conditions:

- The Worker has three or fewer routes.
- The database layer uses few SQL statements.
- One person maintains the project.

Follow these rules when you apply the Minimal-Worker Exception:

- Use Web Standard routing, parameterised SQL, and `wrangler`.
- Omit Effect `Layer` composition and Alchemy.
- Validate all external inputs at boundaries with `effect/Schema`.
- Run `vp check` on every change.
- Record the exception and the migration threshold in `CLAUDE.md`.

### Package Scripts

Configure these scripts in `package.json`:

```json
{
  "scripts": {
    "dev": "vp dev",
    "check": "vp check",
    "typecheck": "tsc -p tsconfig.app.json && tsc -p tsconfig.node.json",
    "test": "vp test",
    "deploy": "vp check && bun run typecheck && vp test && bun run alchemy.run.ts --deploy"
  },
  "overrides": {
    "vite": "npm:@voidzero-dev/vite-plus-core@1.4.0",
    "vitest": "5.0.5"
  }
}
```

- Run `vp check`, `bun run typecheck`, and `vp test` before every deployment
  and in CI. The `vp check` type check does not report every compiler
  diagnostic.
- Keep the `overrides` block. `@effect/vitest` imports its own `vitest` copy,
  and tests fail with a runner state error without the overrides.
- Match the override versions to the installed `vite-plus` and `vitest`
  releases.
- Pin every dependency to an exact version.
- Commit `bun.lock` to version control.

### Project Setup

Run these commands to create a new project:

```shell
mkdir project-name && cd project-name
bun init -y
bun add --exact effect drizzle-orm hono
bun add --exact -d vite-plus vitest @effect/vitest typescript @oxlint/plugins @cloudflare/workers-types @types/bun drizzle-kit alchemy
npx skills add dmmulroy/anti-slop --skill install-anti-slop
vp check
```

## TypeScript Configuration

Use strict mode in all projects. Split Worker runtime types from Node and Bun
tooling configs so ambient globals do not leak across boundaries. TypeScript 7
defaults `types` to an empty list, so each tsconfig must list its ambient types.

Configure the root `tsconfig.json` file with project references:

```jsonc
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
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "files": []
}
```

Set `noEmit` so `tsc` only checks types. Vite+ emits the build output.

Configure `tsconfig.app.json` for Cloudflare Workers and user interface code:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

Configure `tsconfig.node.json` for Alchemy, Vite+, and Drizzle configuration
files. The vendored `anti-slop` plugins import files with a `.ts` extension:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["bun"],
    "allowImportingTsExtensions": true
  },
  "include": [
    "alchemy.run.ts",
    "vite.config.ts",
    "drizzle.config.ts",
    "tools/**/*"
  ]
}
```

## Vite+, Oxlint, and Anti-Slop Configuration

Configure linting, formatting, and testing in `vite.config.ts`. Enable
`typeAware: true` so `vp check` runs semantic rules alongside the vendored
`anti-slop` plugins in `tools/oxlint/`. Enable `typeCheck: true` so `vp check`
also reports type errors.

The upstream `anti-slop` plugins have 23 rules: 18 generic rules and 5 Effect
rules. Enable all of them in Effect projects.

```typescript
import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
      denyWarnings: true,
    },
    jsPlugins: [
      "./tools/oxlint/anti-slop/index.ts",
      "./tools/oxlint/anti-slop/effect/index.ts",
    ],
    rules: {
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/no-unnecessary-condition": "error",
      "typescript/no-unnecessary-type-assertion": "error",
      "typescript/explicit-module-boundary-types": "error",

      // Every generic anti-slop rule.
      "anti-slop/no-array-filter-map": "error",
      "anti-slop/no-reduce-accumulator-copy": "error",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-readable-spacing": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",

      // Every Effect anti-slop rule.
      "anti-slop-effect/no-manual-effect-error-tag": "error",
      "anti-slop-effect/no-manual-tag-comparison": "error",
      "anti-slop-effect/no-manual-tagged-construction": "error",
      "anti-slop-effect/no-service-constructor-imports": "error",
      "anti-slop-effect/prefer-effect-match": "error",
    },
    overrides: [
      {
        // List the project's real entry and boundary files.
        files: ["src/index.ts", "src/mcp/**", "test/**"],
        rules: {
          "anti-slop/no-unknown-parameters": "off",
        },
      },
    ],
  },
  fmt: {
    useTabs: false,
    tabWidth: 2,
    printWidth: 100,
    // rumdl is the only Markdown formatter.
    ignorePatterns: ["**/*.md"],
  },
  test: {
    globals: true,
    // Use the runtime that the project targets.
    environment: "node",
  },
});
```

### Linter Rules

| Rule                    | Requirement                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| No chained assertions   | Do not write `x as unknown as Foo`. Add `// SAFETY: reason` before an FFI assertion.                                   |
| No internal narrowing   | Decode external inputs at the boundary with `Schema.decodeUnknownEffect`. Do not pass `unknown` into domain functions. |
| No type widening        | Do not widen a union or `Schema.Struct` to `Record<string, unknown>` or `string`.                                      |
| No speculative fallback | Do not apply `??` or `||` fallback values to values that cannot be nullish.                                            |
| No module mocking       | Do not call `vi.mock()` in tests. Inject test dependencies with `Context.Service` and `Layer`.                         |
| No manual tag switches  | Use `Match.value`, `Match.type`, or `Effect.catchTags` instead of `switch (val._tag)`.                                 |

## Naming Conventions

Follow the Google TypeScript Style Guide naming rules, adapted for Effect.

| Construct                       | Convention                  | Example                                        |
| ------------------------------- | --------------------------- | ---------------------------------------------- |
| Variables, functions, methods   | `camelCase`                 | `fetchMatchResults`, `seasonId`                |
| Types, interfaces, classes      | `PascalCase`                | `Match`, `PlayerMatchStats`, `AflApi`          |
| Effect Schemas and TaggedErrors | `PascalCase`                | `MatchSchema`, `AflApiError`, `StaleDataError` |
| Effect Services and Layers      | `PascalCase`                | `AflApi`, `AflApi.layer`, `AflApiTest`         |
| True constants                  | `SCREAMING_SNAKE`           | `MAX_RETRY_COUNT`, `DEFAULT_PAGE_SIZE`         |
| Enum-like unions                | `PascalCase` values         | `type RoundType = "HomeAndAway" \| "Finals"`   |
| File names                      | `kebab-case`                | `afl-api.ts`, `player-stats.ts`                |
| Test files                      | `*.test.ts`                 | `afl-api.test.ts`                              |
| Type or Schema files            | `*.types.ts` or `schema.ts` | `types.ts`, `schema.ts`                        |
| Private class members           | `private` keyword           | `private readonly client`                      |

### Naming Principles

- Start Boolean variables with `is`, `has`, `should`, or `can`.
- Use plural names for collections such as `matches`, `playerStats`, and
  `rounds`.
- Omit `Effect` or `Async` suffixes from function names. The return type
  identifies the Effect or Promise.
- Write abbreviations of three or more letters in `PascalCase`, such as `AflApi`
  and `HttpClient`.
- Keep two-letter abbreviations uppercase, such as `ID` and `IO`.

## Type System and Schema Validation

Use strict types and schemas to represent valid states and check external data.

### Interfaces, Types, and Schemas

- Use `interface` for internal object shapes and service contracts.
- Use `type` for unions, intersections, and mapped types.
- Use `effect/Schema` for all data models that cross system boundaries.
- Mark all properties `readonly` and use `ReadonlyArray<T>`.
- Do not use `enum` or `any`. Use `Schema.Literal` or union types instead.
- Add explicit return types to all exported functions and service methods.
  The `typescript/explicit-module-boundary-types` rule enforces them. Do not
  enable `isolatedDeclarations`: it rejects inferred `Schema` and
  `Schema.TaggedError` types.

### Boundary Validation with Schema

Decode all external data with `effect/Schema`. Derive static types from the
schema definition.

```typescript
import { type Effect, Schema } from "effect";

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

export const parseMatchResponse: (
  input: unknown,
) => Effect.Effect<AflMatchResponse, Schema.SchemaError> =
  Schema.decodeUnknownEffect(AflMatchResponseSchema);
```

### Tagged Unions and Match

Use `Data.TaggedEnum` and exhaustive `Match` pipelines instead of `switch`
statements over discriminant fields.

```typescript
import { Data, Match } from "effect";

export type SearchResult = Data.TaggedEnum<{
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

export const formatResult: (result: SearchResult) => string =
  Match.type<SearchResult>().pipe(
    Match.tag("MatchResult", (r) => `${r.homeTeam} vs ${r.awayTeam}`),
    Match.tag("PlayerSeasonResult", (r) => `${r.playerName} (${r.year})`),
    Match.exhaustive,
  );
```

## Documentation with TSDoc

Follow Google Python docstring conventions, adapted to TSDoc syntax.

- Document all exported functions, Effect services, schemas, interfaces, and
  module constants.
- Document private helpers when their logic is not clear from the signature.
- Do not document one-line functions when their names and types explain their
  behaviour.

```typescript
/**
 * Fetch AFL match results for a season.
 *
 * Resolves season and round identifiers from the official AFL API, then
 * fetches completed match results. Falls back to FootyWire when the primary
 * API fails or returns stale data.
 *
 * @param season - The season year, for example 2027.
 * @param roundNumber - Optional round number to fetch.
 * @returns An Effect that yields match results sorted by date.
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

## Error Handling and Effect Control Flow

Represent expected failures as values in the Effect `E` channel. Do not use
`throw`, `try/catch`, or `Effect.orDie` in domain logic.

- Define domain errors with `Schema.TaggedError`.
- Wrap Promise-based third-party APIs at boundaries with `Effect.tryPromise`.
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

export const fetchWithFallback = (
  season: number,
): Effect.Effect<
  ReadonlyArray<Match>,
  FootywireError,
  AflApi | FootywireApi
> =>
  fetchFromAflApi(season).pipe(
    Effect.retry({
      schedule: Schedule.exponential("200 millis"),
      times: 3,
    }),
    Effect.catchTags({
      AflApiError: (err) =>
        Effect.logWarning(`AFL API failed (${err.endpoint}), falling back`).pipe(
          Effect.andThen(fetchFromFootywire(season)),
        ),
      StaleDataError: (err) =>
        Effect.logWarning(
          `AFL API stale (${err.lastUpdate.toISOString()}), falling back`,
        ).pipe(Effect.andThen(fetchFromFootywire(season))),
    }),
  );
```

## Frontend and Full-Stack Frameworks

Separate server and browser runtime boundaries clearly.

### Primary Framework: TanStack Start

Use TanStack Start for web applications, server-side rendering (SSR), and
dashboards on Cloudflare Workers. Run Effect workflows on the server inside
`createServerFn` with `AppRuntime`, and return plain serialisable data to React
components. Do not run `Effect` `Fiber` instances inside React client hooks.

- Validate router parameters and server function inputs with
  `Schema.toStandardSchemaV1(MyEffectSchema)`.
- Run server effects through `AppRuntime.runPromise` from `/src/layers.ts`.
- Do not call `Effect.provide(AppLayer)` inside a request handler.
- Log server failures with `Effect.tapCause(Effect.logError)` before
  returning across the network boundary.

```typescript
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { getLadderForSeason } from "../etl/pipeline";
import { AppRuntime } from "../layers";

const SeasonInput = Schema.Struct({ year: Schema.Number });

export const fetchLadderFn = createServerFn({ method: "GET" })
  .inputValidator(Schema.toStandardSchemaV1(SeasonInput))
  .handler(async ({ data }): Promise<ReadonlyArray<LadderEntry>> => {
    return AppRuntime.runPromise(
      getLadderForSeason(data.year).pipe(
        Effect.tapCause(Effect.logError),
      ),
    );
  });
```

### Secondary Framework: Foldkit

Use Foldkit for client-side state machines or internal tools that connect to the
Foldkit DevTools Model Context Protocol (MCP) server.

- Define user interface state in one immutable `Schema.Struct` named `Model`.
- Define state transitions as `Message` tagged unions.
- Keep `update(model, message)` pure and return `[nextModel, commands]`.
- Represent browser side effects such as HTTP requests, timers, and WebSockets
  as Foldkit `Command` and `Subscription` values.

## Project Structure

Organise project files using this directory layout:

```text
src/
  types.ts              # Shared domain schemas, tagged errors, and types
  worker.ts             # Worker fetch, TanStack Start, and cron entry point
  layers.ts             # AppLayer and ManagedRuntime wired to Worker bindings
  db/
    schema.ts           # Drizzle SQLite table definitions
    service.ts          # Drizzle wrapped as a Context.Service
  etl/
    afl-api.ts          # AFL official API Context.Service
    footywire.ts        # FootyWire fallback Context.Service
    transforms.ts       # Pure synchronous functions for normalisation
    pav.ts              # Pure synchronous functions for PAV calculation
    pipeline.ts         # Effect.fn orchestrator for the ETL workflow
  mcp/
    server.ts           # MCP protocol handler
    tools.ts            # Tool definitions validated with effect/Schema
    code-mode.ts        # Dynamic Worker Code Mode handler
  lib/
    team-mapping.ts     # Team name normalisation
    date-utils.ts       # AEST and AEDT date handling

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
  fixtures/             # Snapshot API payloads for offline tests
    afl-api-round-1.json
    footywire-results-2027.html

alchemy.run.ts          # Cloudflare infrastructure and resource bindings
vite.config.ts          # Vite+, Oxlint, Oxfmt, and Vitest configuration
drizzle.config.ts       # Drizzle Kit migration configuration
tsconfig.json           # Root project references
tsconfig.app.json       # Worker and user interface compiler configuration
tsconfig.node.json      # Tooling and infrastructure compiler configuration
package.json
```

## Code Patterns

Use these patterns for Effect services, concurrency, database access, and
infrastructure bindings.

### Workflows with `Effect.fn`

Define exported Effect workflows with `Effect.fn("traceName")` and an explicit
return type annotation. This pattern adds call-site stack traces and telemetry
spans automatically.

```typescript
import { Effect } from "effect";
import { Database, type DatabaseError } from "../db/service";
import { AflApi, type AflApiError } from "./afl-api";
import { VectorStore, type VectorStoreError } from "./vector-store";

export interface EtlSummary {
  readonly newData: boolean;
  readonly matchesLoaded: number;
}

export const runEtlPipeline: (
  currentYear: number,
) => Effect.Effect<
  EtlSummary,
  AflApiError | DatabaseError | VectorStoreError,
  AflApi | Database | VectorStore
> = Effect.fn("runEtlPipeline")(function* (currentYear: number) {
  const afl = yield* AflApi;
  const db = yield* Database;
  const vectorStore = yield* VectorStore;

  const seasonId = yield* afl.getSeasonId(currentYear);
  const rounds = yield* afl.getRoundIds(seasonId);
  const freshness = yield* db.checkFreshness();

  if (!freshness.isStale) {
    return { newData: false, matchesLoaded: 0 };
  }

  const matches = yield* afl.fetchNewMatches(rounds, freshness.lastRound);
  yield* db.loadMatches(matches);
  yield* vectorStore.generateEmbeddings(matches);

  return { newData: true, matchesLoaded: matches.length };
});
```

### Services and Layers

Do not pass raw `env: Env` objects through domain functions. Define services
with `Context.Service` and build `AppRuntime` once in `/src/layers.ts` using
`cloudflare:workers`.

```typescript
import { Context, Effect, Layer } from "effect";
import { type AflApiError, type Match } from "../types";

export class AflApi extends Context.Service<
  AflApi,
  {
    readonly getSeasonId: (year: number) => Effect.Effect<number, AflApiError>;
    readonly fetchMatchResults: (
      seasonId: number,
    ) => Effect.Effect<ReadonlyArray<Match>, AflApiError>;
  }
>()("AflApi") {
  static readonly layer: Layer.Layer<AflApi> = Layer.succeed(AflApi, {
    getSeasonId: (year) => Effect.succeed(year),
    fetchMatchResults: () => Effect.succeed([]),
  });
}
```

Assemble the shared runtime in `/src/layers.ts`:

```typescript
import { env } from "cloudflare:workers";
import { Layer, ManagedRuntime } from "effect";
import { makeDatabaseLayer } from "./db/service";
import { AflApi } from "./etl/afl-api";
import { FootywireApi } from "./etl/footywire";

export const AppLayer = Layer.mergeAll(
  AflApi.layer,
  FootywireApi.layer,
  makeDatabaseLayer(env.DB),
);

export const AppRuntime = ManagedRuntime.make(AppLayer);
```

### Bounded Concurrency

Specify explicit concurrency limits when you run Effects over collections:

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

Use `Map` for key-value lookups. Use immutable array methods such as `.filter`,
`.map`, and `.toSorted` for data transformations.

Write:

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

Do not write:

```typescript
export function processMatchResults(raw: Array<AflMatchResponse>): void {
  for (const m of raw) {
    m["venue.name"] = normaliseTeamName(m["venue.name"]);
  }
  raw.sort();
}
```

### Infrastructure with Alchemy

Declare all Cloudflare resources and Worker bindings in `alchemy.run.ts`. Do not
maintain manual `wrangler.toml` or `interface Env` definitions unless the
Minimal-Worker Exception applies.

```typescript
import alchemy from "alchemy";
import { Ai, D1Database, VectorizeIndex, Worker } from "alchemy/cloudflare";

const app = await alchemy("afl-mcp");

export const db = await D1Database("afl-db", {
  name: "afl-mcp-db",
  migrationsDir: "./migrations",
});

export const vectorIndex = await VectorizeIndex("afl-vectors", {
  name: "afl-match-embeddings",
  dimensions: 768,
  metric: "cosine",
});

export const worker = await Worker("afl-worker", {
  name: "afl-mcp",
  entrypoint: "./src/worker.ts",
  bindings: {
    DB: db,
    VECTORIZE: vectorIndex,
    AI: Ai(),
  },
});

export type WorkerEnv = typeof worker.Env;

await app.finalize();
```

### Database Layer with Drizzle ORM

Define all tables in `/src/db/schema.ts` and wrap Drizzle inside a
`Context.Service` in `/src/db/service.ts`. Generate migrations with
`bunx drizzle-kit generate`. Do not write migration SQL by hand.

```typescript
import { Context, Effect, Layer, Schema } from "effect";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export class DatabaseError extends Schema.TaggedError<DatabaseError>()(
  "DatabaseError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface DatabaseImpl {
  readonly query: <A>(
    fn: (db: DrizzleD1Database<typeof schema>) => Promise<A>,
  ) => Effect.Effect<A, DatabaseError>;
}

export class Database extends Context.Service<Database, DatabaseImpl>()(
  "Database",
) {}

export const makeDatabaseLayer = (
  d1: D1Database,
): Layer.Layer<Database> => {
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

## Testing

Use `@effect/vitest` for unit and integration tests. Set `test.environment` to
the runtime that the project targets. Miniflare no longer supports the
`miniflare` test environment.

- Run tests with `vp test`.
- Save snapshot API payloads in `/test/fixtures/`.
- Do not make live network requests in tests.
- Test pure transforms with standard `it(...)` blocks.
- Test Effect workflows with `it.effect(...)` and test `Layer` implementations.
- Name each test with a sentence that states the expected behaviour.

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { AflApi } from "../../src/etl/afl-api";
import { flattenMatchScores } from "../../src/etl/transforms";
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
  const AflApiTest = Layer.succeed(AflApi, {
    getSeasonId: () => Effect.succeed(2027),
    fetchMatchResults: () => Effect.succeed([]),
  });

  it.effect("resolves matches using injected test layer", () =>
    Effect.gen(function* () {
      const api = yield* AflApi;
      const matches = yield* api.fetchMatchResults(2027);
      expect(matches).toEqual([]);
    }).pipe(Effect.provide(AflApiTest)),
  );
});
```

## Design Principles

Apply these principles when two implementation options appear to conflict.

### 1. Define Schemas and Types First

Define `effect/Schema` models, tagged errors, and service contracts in
`/src/types.ts` before you write implementation code.

### 2. Decode at Boundaries and Trust Internal Types

Validate external data one time at the system edge with `effect/Schema`. Do not
use `typeof` checks, speculative fallback values, or `unknown` parameters inside
domain logic.

### 3. Separate Pure Logic from Effectful Operations

Keep calculations and data transformations in pure synchronous functions. Keep
HTTP, database, and AI operations inside `Context.Service` layers.

### 4. Track Errors and Dependencies in Types

Record all expected failures in the Effect `E` channel with
`Schema.TaggedError`.
Record all required capabilities in the `R` channel with `Context.Service`.

### 5. Pass All Automated Checks

Run `vp check`, `bun run typecheck`, and `vp test` with zero warnings or
errors before you finish a task.

### 6. Minimise External Dependencies

Prefer Web Standard APIs, `effect`, and Cloudflare Workers bindings over
third-party utility libraries.

### 7. Keep One Responsibility in Each File

Give each module one clear purpose. Split a file when it handles two unrelated
responsibilities.

## References

Read the linked documentation before you configure tools or write application
code. Each link uses the `defuddle.md` prefix to return Markdown suitable for
agents.

- [Google TypeScript Style Guide](https://defuddle.md/google.github.io/styleguide/tsguide.html)
- [TSDoc specification](https://defuddle.md/tsdoc.org/)
- [Vite+ documentation](https://defuddle.md/viteplus.dev/guide/)
- [Oxc documentation](https://defuddle.md/oxc.rs/docs/guide/introduction.html)
- [dmmulroy/anti-slop Oxlint rules](https://defuddle.md/github.com/dmmulroy/anti-slop)
- [Effect documentation](https://defuddle.md/effect.website/docs/)
- [TanStack Start documentation](https://defuddle.md/tanstack.com/start/latest/docs/framework/react/overview)
- [Foldkit documentation](https://defuddle.md/foldkit.dev/)
- [Alchemy documentation](https://defuddle.md/alchemy.run/)
- [Bun documentation](https://defuddle.md/bun.sh/docs)
- [Hono documentation](https://defuddle.md/hono.dev/)
- [Drizzle ORM documentation](https://defuddle.md/orm.drizzle.team/)
- [Cloudflare Workers documentation](https://defuddle.md/developers.cloudflare.com/workers/)
- [Cloudflare D1 documentation](https://defuddle.md/developers.cloudflare.com/d1/)
- [Cloudflare Vectorize documentation](https://defuddle.md/developers.cloudflare.com/vectorize/)
- [Cloudflare Workers AI documentation](https://defuddle.md/developers.cloudflare.com/workers-ai/)
- [Cloudflare Dynamic Workers documentation](https://defuddle.md/developers.cloudflare.com/workers/runtime-apis/dynamic-worker/)
- [Vitest documentation](https://defuddle.md/vitest.dev/)
