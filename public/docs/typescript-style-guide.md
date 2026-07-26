# TypeScript Development Style Guide

Project conventions, tools, and design principles for TypeScript development.
The Google TypeScript Style Guide informs these conventions. They also use the
Astral preference for fast, single-purpose tools and adapted FastAPI patterns.

---

## Tech Stack

Use the core runtime and development tools in this section.

### Core

| Tool            | Role               | Why                                                          |
| --------------- | ------------------ | ------------------------------------------------------------ |
| **TypeScript**  | Language           | Strict mode, always                                          |
| **Hono**        | Web framework      | Lightweight, Workers-native, and typed                       |
| **Zod**         | Runtime validation | Defines runtime validation and inferred types                |
| **D1**          | Database           | Cloudflare's SQLite: co-located with Workers                 |
| **Drizzle ORM** | Database ORM       | Type-safe SQL, D1-native, schema as code                     |

### The Minimal-Worker Exception

Hono, Drizzle, and the rest of the core stack are the default for new projects.
A small Cloudflare Worker can use hand-written routing and raw parameterised SQL.
This exception suits a few routes, few SQL statements, and one maintainer. In
that case, framework overhead can exceed the code that it replaces. Always use
Zod at external boundaries.

Record the exception in the project's CLAUDE.md. State a review threshold, such
as adopting Hono when routes exceed one conditional chain. AFL-MCP is the
canonical example.

### Tooling

| Tool         | Role                                      | Python equivalent    |
| ------------ | ----------------------------------------- | -------------------- |
| **Bun**      | Package manager + script runner + bundler | uv                   |
| **Biome**    | Lint + format (single tool)               | ruff                 |
| **Vitest**   | Test runner                               | pytest               |
| **wrangler** | Dev server + deploy CLI                   | uvicorn + deployment |
| **tsc**      | Type checker                              | mypy                 |

#### Why the Project Uses Bun

Bun provides package management, script execution, and bundling in one binary.
It has a role similar to uv in Python projects. Use Vitest for Workers tests
because its Miniflare integration supports local Cloudflare bindings such as D1
and KV.

Use Bun as the package manager and local runner. Cloudflare
Workers runs the deployed code in V8. Do not use Bun-specific application APIs
such as `Bun.file()` or `Bun.serve()`. Use Web Standard APIs such as `fetch`,
`Request`, `Response`, and `crypto`. Both Bun and Workers support these APIs.

### Infrastructure (Cloudflare)

| Service             | Role                                    |
| ------------------- | --------------------------------------- |
| **Workers**         | Compute (HTTP handlers + cron triggers) |
| **D1**              | SQLite database                         |
| **Vectorize**       | Vector search index                     |
| **Workers AI**      | Embedding generation                    |
| **Dynamic Workers** | Sandboxed code execution (Code Mode)    |

### Package Scripts

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest",
    "check": "biome check .",
    "format": "biome format --write .",
    "typecheck": "tsc --noEmit"
  }
}
```

Invoke all scripts through `bun run <name>`. For example, use `bun run dev` or
`bun run test`.
For one-off commands, use `bunx` (equivalent to `uvx`): `bunx wrangler deploy`.

### Project Setup

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Scaffold a new Cloudflare Workers project
bunx create-cloudflare@latest afl-mcp --type worker --lang ts

# Install dependencies
cd afl-mcp
bun add hono zod drizzle-orm
bun add -d @cloudflare/workers-types vitest @biomejs/biome typescript drizzle-kit

# Initialise Biome
bunx @biomejs/biome init

# Verify everything works
bun run dev
```

#### Lock File

Bun uses `bun.lockb`. Commit this file to version control. It has the same role
as `uv.lock` in a Python project.

---

## TypeScript Configuration

Always use strict mode. No exceptions.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "noUncheckedIndexedAccess": true,   // forces handling undefined on array/object access
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types"]
  }
}
```

### Key Compiler Flags

- Enable `strict: true` to activate all strict checks.
- Enable `noUncheckedIndexedAccess: true`. An indexed access then returns
  `T | undefined`, which requires handling for a missing value.
- Enable `exactOptionalPropertyTypes: true` to distinguish `undefined` from a
  missing property. This setting identifies errors in configuration objects.

---

## Biome Configuration

```jsonc
// biome.json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"    // ban `any`: use `unknown` instead
      },
      "style": {
        "useConst": "error",         // prefer const over let
        "noNonNullAssertion": "warn" // discourage `!` postfix
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "organizeImports": {
    "enabled": true
  }
}
```

---

## Naming Conventions

Follow the Google TypeScript Style Guide naming rules.

| Construct                     | Convention                 | Example                                      |
| ----------------------------- | -------------------------- | -------------------------------------------- |
| Variables, functions, methods | `camelCase`                | `fetchMatchResults`, `seasonId`              |
| Types, interfaces, classes    | `PascalCase`               | `Match`, `PlayerMatchStats`, `AflApiClient`  |
| Constants (true constants)    | `SCREAMING_SNAKE`          | `MAX_RETRY_COUNT`, `DEFAULT_PAGE_SIZE`       |
| Enum-like unions              | `PascalCase` values        | `type RoundType = "HomeAndAway" \| "Finals"` |
| File names                    | `kebab-case`               | `afl-api.ts`, `player-stats.ts`              |
| Test files                    | `*.test.ts`                | `afl-api.test.ts`                            |
| Type-only files               | `*.types.ts` or `types.ts` | `types.ts`                                   |
| Private class members         | `private` keyword          | No underscore prefix: use the language       |

### Naming Principles

- Use descriptive names, such as `fetchMatchResultsForRound` and `seasonId`.
- Start Boolean variables with `is`, `has`, `should`, or `can`. Examples are
  `isStale` and `hasNewData`.
- Use plural names for collections, such as `matches`, `playerStats`, and
  `rounds`.
- Omit an `async` suffix from a function that returns a promise. The return type
  identifies the promise.
- Treat abbreviations as words. Use `AflApi` and `HttpClient`. Keep two-letter
  abbreviations uppercase in PascalCase, such as `ID` and `IO`.

---

## Type System

Use strict types to model valid states and check external data.

### Prefer `interface` for Object Shapes

```typescript
// Good: use interface for object shapes
interface Match {
  id: number;
  seasonId: number;
  roundNumber: number;
  homeTeamId: number;
  awayTeamId: number;
  homePoints: number;
  awayPoints: number;
  margin: number;
}

// Good: use type for unions, intersections, mapped types
type RoundType = "HomeAndAway" | "Finals";
type SearchResult = MatchResult | PlayerSeasonResult;
type Nullable<T> = T | null;
```

### Ban `enum`, Use Union Types

```typescript
// Bad
enum WeatherType {
  RAIN = "RAIN",
  FINE = "FINE",
  OVERCAST = "OVERCAST",
}

// Good
type WeatherType = "RAIN" | "FINE" | "OVERCAST";
```

Enums generate runtime code, have surprising behaviour with reverse mappings,
and do not tree-shake well. Union types are pure type-level and disappear at runtime.

### Ban `any`, Use `unknown`

```typescript
// Bad: silently disables all type checking
function parseResponse(data: any) { ... }

// Good: forces you to narrow before using
function parseResponse(data: unknown) {
  const parsed = MatchSchema.parse(data);  // Zod validates + narrows
}
```

### Use Zod at Boundaries

Every piece of external data (API responses, user input, environment variables)
must pass through Zod validation before entering your typed domain.

```typescript
import { z } from "zod";

// Define schema
const AflMatchResponseSchema = z.object({
  "match.matchId": z.string(),
  "match.date": z.string(),
  "venue.name": z.string(),
  "homeTeamScore.matchScore.totalScore": z.number(),
  "homeTeamScore.matchScore.goals": z.number(),
  "homeTeamScore.matchScore.behinds": z.number(),
  "homeTeamScore.periodScore": z.array(z.object({
    "score.goals": z.number(),
    "score.behinds": z.number(),
  })).optional(),
  "awayTeamScore.matchScore.totalScore": z.number(),
  "awayTeamScore.matchScore.goals": z.number(),
  "awayTeamScore.matchScore.behinds": z.number(),
});

// Infer type FROM the schema (single source of truth)
type AflMatchResponse = z.infer<typeof AflMatchResponseSchema>;

// Validate at the boundary
const raw = await res.json();
const match = AflMatchResponseSchema.parse(raw);  // throws ZodError if invalid
```

### Prefer `readonly` for Data That Should Not Change

```typescript
interface LadderEntry {
  readonly position: number;
  readonly team: string;
  readonly played: number;
  readonly wins: number;
  readonly percentage: number;
  readonly premiership_points: number;
}
```

### Use Discriminated Unions for Mixed Result Types

```typescript
interface MatchResult {
  type: "match";
  matchId: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  margin: number;
}

interface PlayerSeasonResult {
  type: "player_season";
  playerId: number;
  playerName: string;
  team: string;
  year: number;
  games: number;
}

type SearchResult = MatchResult | PlayerSeasonResult;

// TypeScript narrows automatically on the discriminant
function formatResult(result: SearchResult): string {
  switch (result.type) {
    case "match":
      return `${result.homeTeam} vs ${result.awayTeam}`;  // TS knows this is MatchResult
    case "player_season":
      return `${result.playerName} (${result.year})`;      // TS knows this is PlayerSeasonResult
  }
}
```

---

## Documentation (TSDoc)

Follow Google Python style docstring conventions, adapted to TSDoc syntax.
Document all public functions, interfaces, and types. Internal helpers
get a single-line `/** comment */` if the name does not explain their purpose.

### Function Documentation

```typescript
/**
 * Fetch AFL match results for a given season from the official API.
 *
 * Resolves season and round IDs, then fetches all completed match
 * results. Falls back to FootyWire if AFL API data is stale (more
 * than 3 days behind).
 *
 * @param season - The season year (e.g., 2026).
 * @param roundNumber - Specific round to fetch. Fetches all completed
 *   rounds if omitted.
 * @returns Match results sorted by date, with quarter scores flattened.
 * @throws {AflApiError} If the token endpoint is unreachable.
 *
 * @example
 * ```typescript
 * const results = await fetchMatchResults(2026);
 * const round1 = await fetchMatchResults(2026, 1);
 * ```
 */
async function fetchMatchResults(
  season: number,
  roundNumber?: number,
): Promise<Match[]> {
```

### Interface Documentation

```typescript
/**
 * Per-player statistics for a single match.
 *
 * One row per player per match. Contains 50+ statistical columns
 * covering disposals, scoring, contested ball, and advanced metrics.
 * Available from 2000 onwards for most columns; fantasy scores from
 * 2007 onwards.
 */
interface PlayerMatchStats {
  /** Unique row identifier. */
  id: number;

  /** Foreign key to matches table. */
  matchId: number;

  /** Foreign key to players table. */
  playerId: number;

  /**
   * Foreign key to teams table.
   *
   * This is how you determine which team a player played for in a
   * given match: the players table has no team column.
   */
  teamId: number;

  /** Total kicks in the match. */
  kicks: number | null;

  /** Total handballs in the match. */
  handballs: number | null;

  // ...
}
```

### When to Document

- Always document public functions, exported interfaces and types, and
  module-level constants.
- Document private methods and complex type transformations when their logic
  needs an explanation.
- Do not document one-line functions or accessor methods when their names explain
  their purpose.

```typescript
// No doc needed: name says everything
function isStale(lastDate: Date, thresholdDays: number): boolean {
  return daysBetween(lastDate, new Date()) > thresholdDays;
}

// Doc needed: calculation requires an explanation
/**
 * Calculate Player Approximate Value for a season.
 *
 * PAV is a composite metric weighting offensive, midfield, and
 * defensive contributions. The formula weights each statistical
 * category against league averages for the season.
 *
 * @param stats - Aggregated season statistics for the player.
 * @param leagueAvg - League-wide averages for normalisation.
 * @returns PAV breakdown by zone (off, mid, def) and total.
 */
function calculatePav(
  stats: AggregatedStats,
  leagueAvg: LeagueAverages,
): PavRating {
```

---

## Error Handling

Use explicit result types for expected failures and exceptions for other errors.

### Use Custom Error Classes

```typescript
class AflApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "AflApiError";
  }
}

class StaleDataError extends Error {
  constructor(
    public readonly lastUpdate: Date,
    public readonly thresholdDays: number,
  ) {
    super(
      `Data is ${daysBetween(lastUpdate, new Date())} days old (threshold: ${thresholdDays})`,
    );
    this.name = "StaleDataError";
  }
}
```

### Use `Result` Pattern for Expected Failures

For operations that can fail in expected ways (not exceptional errors),
return a discriminated union instead of throwing.

This mandate applies to libraries whose callers handle failures as values,
such as fitzroy and rds-js. For applications, use the pattern at fallible seams.
A Worker or CLI can instead catch a thrown domain error at its external boundary.

```typescript
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

async function fetchWithFallback(season: number): Promise<Result<Match[]>> {
  const aflResult = await fetchFromAflApi(season);
  if (aflResult.success) return aflResult;

  const footywireResult = await fetchFromFootywire(season);
  if (footywireResult.success) return footywireResult;

  return {
    success: false,
    error: new Error("All data sources failed"),
  };
}
```

### Never Swallow Errors

```typescript
// Bad: silent failure
try {
  await fetchData();
} catch {
  // do nothing
}

// Good: log and handle
try {
  await fetchData();
} catch (error) {
  console.error("Failed to fetch data:", error);
  throw new AflApiError("Data fetch failed", 502, "/cfs/afl/matchItems");
}
```

---

## Project Structure

```text
src/
  types.ts              # All shared types: define these first
  worker.ts             # Entry point: Hono app + scheduled handler
  db.ts                 # D1 query helpers
  etl/
    afl-api.ts          # AFL official API client
    footywire.ts        # FootyWire scraper (fallback)
    transforms.ts       # Response normalisation, flattening
    pav.ts              # PAV calculation
    pipeline.ts         # Orchestrator: freshness to extract to load to embed
  mcp/
    server.ts           # MCP protocol handler
    tools.ts            # Tool definitions (traditional 5-tool interface)
    code-mode.ts        # Code Mode handler (2-tool interface)
  lib/
    validation.ts       # Zod schemas for external data
    team-mapping.ts     # Team name normalisation across sources
    date-utils.ts       # AEST/AEDT-aware date handling

test/
  etl/
    afl-api.test.ts
    transforms.test.ts
    pav.test.ts
  mcp/
    tools.test.ts
  fixtures/             # Snapshot API responses for testing
    afl-api-round-1.json
    footywire-results-2026.html

wrangler.toml           # Cloudflare Workers config
tsconfig.json
biome.json
package.json
```

### Principles

- Define the domain types in `types.ts` before you write fetch logic. The compiler
  then guides the remaining work.
- Put each data source in one file. For example, `afl-api.ts` owns its HTTP calls,
  response parsing, and Zod validation.
- Keep the functions in `transforms.ts` free of I/O and side effects. They accept
  raw API shapes and return domain types.
- Use `pipeline.ts` to call sources in priority order, handle fallback logic, and
  coordinate loading and embedding. It is the cron handler entry point.
- Tests mirror src structure. Test files live in `test/` and mirror the `src/`
  directory tree.

---

## Code Patterns

Use these patterns for common TypeScript project structures and boundaries.

### Async/Await Everywhere

```typescript
// Good: reads top-to-bottom like synchronous code
async function runEtlPipeline(env: Env): Promise<EtlResult> {
  const seasonId = await afl.getSeasonId(currentYear);
  const rounds = await afl.getRoundIds(seasonId);
  const freshness = await checkFreshness(env.DB);

  if (!freshness.isStale) {
    return { newData: false };
  }

  const matches = await fetchNewMatches(rounds, freshness.lastRound);
  await loadMatches(env.DB, matches);
  await generateEmbeddings(env.AI, env.VECTORIZE, matches);

  return { newData: true, matchesLoaded: matches.length };
}
```

### Use `Map` for Lookups

```typescript
// Good: type-safe, better semantics than plain objects
const teamNameMap = new Map<string, string>([
  ["Brisbane", "Brisbane Lions"],
  ["GWS", "GWS Giants"],
  ["Western Bulldogs", "Western Bulldogs"],
  ["Bulldogs", "Western Bulldogs"],
  ["Footscray", "Western Bulldogs"],
]);

function normaliseTeamName(raw: string): string {
  return teamNameMap.get(raw) ?? raw;
}
```

### Functional Transforms Over Mutation

```typescript
// Good: chain transforms, no mutation
function processMatchResults(raw: AflMatchResponse[]): Match[] {
  return raw
    .filter((m) => m["match.date"] !== "")
    .map(flattenMatchScores)
    .map(normaliseTeamNames)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

// Bad: mutating in place
function processMatchResults(raw: AflMatchResponse[]): void {
  for (const m of raw) {
    m.homeTeam = normaliseTeamName(m.homeTeam);  // mutation
  }
  raw.sort(/* ... */);  // mutation
}
```

### Parallel Fetches with `Promise.all`

```typescript
// Good: concurrent where order does not matter
const [results, stats, ladder] = await Promise.all([
  fetchMatchResults(seasonId),
  fetchPlayerStats(seasonId),
  fetchLadder(seasonId),
]);

// Use Promise.allSettled when partial failure is acceptable
const roundResults = await Promise.allSettled(
  roundIds.map((id) => fetchRoundResults(id)),
);

const successful = roundResults
  .filter((r): r is PromiseFulfilledResult<Match[]> => r.status === "fulfilled")
  .flatMap((r) => r.value);
```

### Environment Bindings (Cloudflare Workers)

```typescript
// Define your bindings type
interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  LOADER: DynamicWorkerLoader;  // for Code Mode
  AFL_API_CACHE: KVNamespace;   // optional: cache token
}

// Hono gives you typed access
const app = new Hono<{ Bindings: Env }>();

app.get("/api/ladder/:year", async (c) => {
  const year = parseInt(c.req.param("year"));
  const db = drizzle(c.env.DB, { schema });
  const result = await db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.seasonId, year));
  return c.json(result);
});
```

### Drizzle ORM (Database Layer)

Drizzle is the database ORM for all D1 interactions. Define schema in TypeScript,
get type-safe queries, and generate migrations from schema changes.

#### Schema Definition (`src/db/schema.ts`)

```typescript
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const seasons = sqliteTable("seasons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  competitionId: integer("competition_id").notNull(),
  year: integer("year").notNull(),
});

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  abbreviation: text("abbreviation").notNull(),
  competitionId: integer("competition_id").notNull(),
});

export const matches = sqliteTable("matches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  seasonId: integer("season_id").notNull().references(() => seasons.id),
  round: text("round").notNull(),
  roundNumber: integer("round_number").notNull(),
  roundType: text("round_type").notNull(),
  date: text("date").notNull(),
  venueId: integer("venue_id").notNull(),
  homeTeamId: integer("home_team_id").notNull().references(() => teams.id),
  awayTeamId: integer("away_team_id").notNull().references(() => teams.id),
  homeGoals: integer("home_goals"),
  homeBehinds: integer("home_behinds"),
  homePoints: integer("home_points"),
  awayGoals: integer("away_goals"),
  awayBehinds: integer("away_behinds"),
  awayPoints: integer("away_points"),
  margin: integer("margin"),
  attendance: integer("attendance"),
  weatherTempC: real("weather_temp_c"),
  weatherType: text("weather_type"),
});

export const playerMatchStats = sqliteTable("player_match_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: integer("match_id").notNull().references(() => matches.id),
  playerId: integer("player_id").notNull(),
  teamId: integer("team_id").notNull().references(() => teams.id),
  kicks: integer("kicks"),
  handballs: integer("handballs"),
  disposals: integer("disposals"),
  goals: integer("goals"),
  behinds: integer("behinds"),
  tackles: integer("tackles"),
  contestedPossessions: integer("contested_possessions"),
  clearances: integer("clearances"),
  brownlowVotes: integer("brownlow_votes"),
  // ... 50+ columns: define all in schema
});
```

#### Query Patterns

```typescript
import { drizzle } from "drizzle-orm/d1";
import { eq, and, gt, desc } from "drizzle-orm";
import * as schema from "./db/schema";

// Initialise from D1 binding
const db = drizzle(env.DB, { schema });

// Simple select
const match = await db
  .select()
  .from(schema.matches)
  .where(eq(schema.matches.id, matchId));

// Filtered + ordered
const recentMatches = await db
  .select()
  .from(schema.matches)
  .where(and(
    eq(schema.matches.seasonId, seasonId),
    gt(schema.matches.roundNumber, lastLoadedRound),
  ))
  .orderBy(desc(schema.matches.date));

// Join
const statsWithPlayer = await db
  .select({
    playerName: schema.players.surname,
    team: schema.teams.name,
    disposals: schema.playerMatchStats.disposals,
    goals: schema.playerMatchStats.goals,
  })
  .from(schema.playerMatchStats)
  .innerJoin(schema.players, eq(schema.playerMatchStats.playerId, schema.players.id))
  .innerJoin(schema.teams, eq(schema.playerMatchStats.teamId, schema.teams.id))
  .where(eq(schema.playerMatchStats.matchId, matchId))
  .orderBy(desc(schema.playerMatchStats.disposals));

// Insert
await db.insert(schema.matches).values(newMatches);

// Upsert
await db.insert(schema.matches)
  .values(newMatch)
  .onConflictDoUpdate({
    target: schema.matches.id,
    set: { homePoints: newMatch.homePoints, awayPoints: newMatch.awayPoints },
  });
```

#### Migrations

```bash
# Generate migration from schema changes
bunx drizzle-kit generate

# Apply migration to local D1
bunx wrangler d1 migrations apply afl-mcp --local

# Apply migration to remote D1
bunx wrangler d1 migrations apply afl-mcp --remote
```

#### Drizzle Configuration (`drizzle.config.ts`)

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
```

#### Drizzle Principles

- Keep all table definitions in `src/db/schema.ts`.
- Use Drizzle's query builder for application queries. Use raw SQL through
  `db.run()` for a complex aggregation that the query builder cannot express
  clearly.
- The `execute_sql` MCP tool accepts validated, read-only SQL from agents. This
  operation sends the SQL directly to D1.
- Generate migrations from schema diffs. Do not write migration SQL by hand.

---

## Testing

Use Vitest and Miniflare for unit and Worker integration tests.

### Use Vitest

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "miniflare",  // Cloudflare Workers test environment
  },
});
```

Run tests via `bun run test` (which invokes Vitest) or `bun run test -- --watch`
for watch mode during development. For quick one-off tests that do not need
Cloudflare bindings, `bun test` (Bun's built-in runner) also works: it is
Jest-compatible and faster for pure function tests.

### Test Structure

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { flattenMatchScores } from "../src/etl/transforms";
import rawRound1 from "./fixtures/afl-api-round-1.json";

describe("flattenMatchScores", () => {
  it("extracts quarter scores from nested periodScore array", () => {
    const result = flattenMatchScores(rawRound1.items[0]);

    expect(result.homeQ1Goals).toBe(3);
    expect(result.homeQ1Behinds).toBe(2);
    expect(result.awayQ4Goals).toBe(4);
  });

  it("handles missing periodScore gracefully", () => {
    const input = { ...rawRound1.items[0] };
    delete input["homeTeamScore.periodScore"];

    const result = flattenMatchScores(input);

    expect(result.homeQ1Goals).toBeNull();
  });

  it("preserves total scores even when quarter data is missing", () => {
    const input = { ...rawRound1.items[0] };
    delete input["homeTeamScore.periodScore"];

    const result = flattenMatchScores(input);

    expect(result.homePoints).toBe(95);  // total still present
  });
});
```

### Test Principles

- Snapshot API responses into `test/fixtures/`. Never hit real APIs in tests.
- Test transforms thoroughly because they are pure functions.
- Test Zod schemas against both valid and invalid payloads.
- Integration tests use Miniflare (local Workers simulator) for D1 and KV.
- Name tests as sentences: `it("handles missing periodScore gracefully")`.

---

## Design Principles

Use these principles when the detailed rules do not decide an approach.

### 1. Types First, Code Second

Define your domain types before writing any logic. Let the type system
guide the implementation.

### 2. Validate at Boundaries, Trust Internally

Use Zod to validate all external data (API responses, user input). Once
validated, trust the types: no defensive null checks deep inside business logic.

### 3. Separate Logic from Input and Output

Keep business logic (transforms, calculations, validation) in pure functions.
Keep fetch, database, and logging operations at the system boundaries. You can
then test the business logic without I/O setup.

### 4. Report Errors with Context

Throw meaningful errors with context. Catch them at the appropriate level
(usually the route handler or pipeline orchestrator). Never swallow errors silently.

### 5. Prefer Composition Over Inheritance

Use functions, interfaces, and composition. Classes are fine for stateful things
(API clients with cached tokens), but do not build deep inheritance hierarchies.

### 6. Minimise Dependencies

Each dependency adds maintenance. Prefer Web APIs and the Workers runtime. Add a
library when it implements required complex behaviour, such as Zod, Hono, or
Drizzle.

### 7. Single Responsibility Files

Give each module one purpose. `afl-api.ts` accesses the AFL API. `transforms.ts`
transforms data. `pipeline.ts` coordinates operations. Split a file that has two
unrelated purposes.

---

## References

Before you set project standards, configure tools, or write application code,
read the linked documentation. Each link uses the `defuddle.md` prefix, which
returns agent-readable Markdown. Read the complete documentation, including pages
outside the getting-started section.

- [Google TypeScript Style Guide](https://defuddle.md/google.github.io/styleguide/tsguide.html)
- [TSDoc specification](https://defuddle.md/tsdoc.org/)
- [Bun documentation](https://defuddle.md/bun.sh/docs)
- [Hono documentation](https://defuddle.md/hono.dev/)
- [Zod documentation](https://defuddle.md/zod.dev/)
- [Drizzle ORM documentation](https://defuddle.md/orm.drizzle.team/)
- [Cloudflare Workers documentation](https://defuddle.md/developers.cloudflare.com/workers/)
- [Cloudflare Wrangler CLI documentation](https://defuddle.md/developers.cloudflare.com/workers/wrangler/)
- [Cloudflare D1 documentation](https://defuddle.md/developers.cloudflare.com/d1/)
- [Cloudflare Vectorize documentation](https://defuddle.md/developers.cloudflare.com/vectorize/)
- [Cloudflare Workers AI documentation](https://defuddle.md/developers.cloudflare.com/workers-ai/)
- [Cloudflare Dynamic Workers documentation](https://defuddle.md/developers.cloudflare.com/workers/runtime-apis/dynamic-worker/)
- [Biome documentation](https://defuddle.md/biomejs.dev/)
- [Vitest documentation](https://defuddle.md/vitest.dev/)
