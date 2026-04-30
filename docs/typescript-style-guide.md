# TypeScript Development Style Guide

Project conventions, tech stack, and design principles for TypeScript development.
Informed by the Google TypeScript Style Guide, the Astral (uv/ruff) philosophy of
fast single-purpose tooling, and FastAPI patterns adapted for the TypeScript ecosystem.

---

## Tech Stack

### Core

| Tool | Role | Why |
|------|------|-----|
| **TypeScript** | Language | Strict mode, always |
| **Hono** | Web framework | Lightweight, Workers-native, typed routes — the FastAPI of TS |
| **Zod** | Runtime validation | Pydantic equivalent — define once, get types + validation |
| **D1** | Database | Cloudflare's SQLite — co-located with Workers |
| **Drizzle ORM** | Database ORM | Type-safe SQL, D1-native, schema as code |

### Tooling

| Tool | Role | Python equivalent |
|------|------|-------------------|
| **Bun** | Package manager + script runner + bundler | uv |
| **Biome** | Lint + format (single tool) | ruff |
| **Vitest** | Test runner | pytest |
| **wrangler** | Dev server + deploy CLI | uvicorn + deployment |
| **tsc** | Type checker | mypy |

**Why Bun over pnpm/npm:** Bun is the closest analogue to uv — a single
Rust/Zig binary that handles package management, script running, and
bundling. `bun install` is significantly faster than npm/pnpm. Bun also
includes a built-in test runner (`bun test`), but we use Vitest for
Workers-specific tests because of its Miniflare integration for testing
D1, KV, and other Cloudflare bindings locally.

**Important:** Bun is used as the package manager and local runner, but
the code still deploys to Cloudflare Workers (which uses the V8 runtime,
not Bun's runtime). Don't rely on Bun-specific APIs (`Bun.file()`,
`Bun.serve()`, etc.) in application code — stick to Web Standard APIs
(`fetch`, `Request`, `Response`, `crypto`) which work in both Bun and
Workers. This keeps the codebase portable.

### Infrastructure (Cloudflare)

| Service | Role |
|---------|------|
| **Workers** | Compute (HTTP handlers + cron triggers) |
| **D1** | SQLite database |
| **Vectorize** | Vector search index |
| **Workers AI** | Embedding generation |
| **Dynamic Workers** | Sandboxed code execution (Code Mode) |

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

All scripts are invoked via `bun run <name>` (e.g., `bun run dev`, `bun run test`).
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

**Lock file:** Bun uses `bun.lockb` (binary format). Commit it to version control
— it's the equivalent of `uv.lock`.

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

- **`strict: true`** — enables all strict checks. Non-negotiable.
- **`noUncheckedIndexedAccess: true`** — `array[0]` returns `T | undefined`, not `T`. Forces you to handle missing data from API responses.
- **`exactOptionalPropertyTypes: true`** — distinguishes between `undefined` and "missing". Catches real bugs in config objects.

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
        "noExplicitAny": "error"    // ban `any` — use `unknown` instead
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

| Construct | Convention | Example |
|-----------|-----------|---------|
| Variables, functions, methods | `camelCase` | `fetchMatchResults`, `seasonId` |
| Types, interfaces, classes | `PascalCase` | `Match`, `PlayerMatchStats`, `AflApiClient` |
| Constants (true constants) | `SCREAMING_SNAKE` | `MAX_RETRY_COUNT`, `DEFAULT_PAGE_SIZE` |
| Enum-like unions | `PascalCase` values | `type RoundType = "HomeAndAway" \| "Finals"` |
| File names | `kebab-case` | `afl-api.ts`, `player-stats.ts` |
| Test files | `*.test.ts` | `afl-api.test.ts` |
| Type-only files | `*.types.ts` or `types.ts` | `types.ts` |
| Private class members | `private` keyword | No underscore prefix — use the language |

### Naming Principles

- **Be descriptive.** `fetchMatchResultsForRound` over `getResults`. `seasonId` over `sid`.
- **Boolean variables** start with `is`, `has`, `should`, `can`: `isStale`, `hasNewData`.
- **Collections** are plural: `matches`, `playerStats`, `rounds`.
- **Functions that return promises** don't need an `async` suffix — the return type says it.
- **Abbreviations** follow Google style: treat as words, not acronyms. `AflApi`, not `AFLApi`. `HttpClient`, not `HTTPClient`. Exception: two-letter acronyms stay uppercase in PascalCase (`ID`, `IO`).

---

## Type System

### Prefer `interface` for Object Shapes

```typescript
// Good — use interface for object shapes
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

// Good — use type for unions, intersections, mapped types
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
and don't tree-shake well. Union types are pure type-level and disappear at runtime.

### Ban `any`, Use `unknown`

```typescript
// Bad — silently disables all type checking
function parseResponse(data: any) { ... }

// Good — forces you to narrow before using
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

### Prefer `readonly` for Data That Shouldn't Change

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
get a single-line `/** comment */` if their purpose isn't obvious from the name.

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
   * given match — the players table has no team column.
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

- **Always:** Public functions, exported interfaces/types, module-level constants.
- **Sometimes:** Private methods with non-obvious logic. Complex type transformations.
- **Never:** Self-explanatory one-liners. Getters/setters with obvious names.

```typescript
// No doc needed — name says everything
function isStale(lastDate: Date, thresholdDays: number): boolean {
  return daysBetween(lastDate, new Date()) > thresholdDays;
}

// Doc needed — non-obvious calculation
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
// Bad — silent failure
try {
  await fetchData();
} catch {
  // do nothing
}

// Good — log and handle
try {
  await fetchData();
} catch (error) {
  console.error("Failed to fetch data:", error);
  throw new AflApiError("Data fetch failed", 502, "/cfs/afl/matchItems");
}
```

---

## Project Structure

```
src/
  types.ts              # All shared types — define these first
  worker.ts             # Entry point: Hono app + scheduled handler
  db.ts                 # D1 query helpers
  etl/
    afl-api.ts          # AFL official API client
    footywire.ts        # FootyWire scraper (fallback)
    transforms.ts       # Response normalisation, flattening
    pav.ts              # PAV calculation
    pipeline.ts         # Orchestrator: freshness → extract → load → embed
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

- **`types.ts` is written first.** Before any fetch logic, define Match, Player,
  PlayerMatchStats, etc. The compiler guides everything from there.
- **One file per data source.** `afl-api.ts`, `footywire.ts` — each owns its HTTP
  calls, response parsing, and Zod validation.
- **`transforms.ts` is pure functions.** No I/O, no side effects. Takes raw API
  shapes, returns domain types. Easy to unit test.
- **`pipeline.ts` is the orchestrator.** Calls sources in priority order, handles
  fallback logic, coordinates loading and embedding. This is the cron handler's
  entry point.
- **Tests mirror src structure.** Test files live in `test/` and mirror the `src/`
  directory tree.

---

## Code Patterns

### Async/Await Everywhere

```typescript
// Good — reads top-to-bottom like synchronous code
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
// Good — type-safe, better semantics than plain objects
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
// Good — chain transforms, no mutation
function processMatchResults(raw: AflMatchResponse[]): Match[] {
  return raw
    .filter((m) => m["match.date"] !== "")
    .map(flattenMatchScores)
    .map(normaliseTeamNames)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

// Bad — mutating in place
function processMatchResults(raw: AflMatchResponse[]): void {
  for (const m of raw) {
    m.homeTeam = normaliseTeamName(m.homeTeam);  // mutation
  }
  raw.sort(/* ... */);  // mutation
}
```

### Parallel Fetches with `Promise.all`

```typescript
// Good — concurrent where order doesn't matter
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

**Schema definition (`src/db/schema.ts`):**

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
  // ... 50+ columns — define all in schema
});
```

**Query patterns:**

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

**Migrations:**

```bash
# Generate migration from schema changes
bunx drizzle-kit generate

# Apply migration to local D1
bunx wrangler d1 migrations apply afl-mcp --local

# Apply migration to remote D1
bunx wrangler d1 migrations apply afl-mcp --remote
```

**Drizzle config (`drizzle.config.ts`):**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
```

**Principles:**
- Schema is the single source of truth — all table definitions live in `src/db/schema.ts`.
- Use Drizzle's query builder for all application queries. Raw SQL via `db.run(sql`...`)`
  is acceptable for complex aggregations or when the query builder is awkward.
- The `execute_sql` MCP tool still accepts raw SQL strings from agents — those bypass
  Drizzle and go directly to D1 (read-only, validated).
- Generate migrations from schema diffs, never write migration SQL by hand.

---

## Testing

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
for watch mode during development. For quick one-off tests that don't need
Cloudflare bindings, `bun test` (Bun's built-in runner) also works — it's
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

- **Snapshot API responses** into `test/fixtures/`. Never hit real APIs in tests.
- **Test transforms thoroughly** — they're pure functions, easy to cover.
- **Test Zod schemas** against both valid and invalid payloads.
- **Integration tests** use Miniflare (local Workers simulator) for D1 and KV.
- **Name tests as sentences** — `it("handles missing periodScore gracefully")`.

---

## Design Principles

### 1. Types First, Code Second

Define your domain types before writing any logic. Let the type system
guide the implementation.

### 2. Validate at Boundaries, Trust Internally

Use Zod to validate all external data (API responses, user input). Once
validated, trust the types — no defensive null checks deep inside business logic.

### 3. Pure Core, Effectful Shell

Keep business logic (transforms, calculations, validation) as pure functions.
Push I/O (fetch, database, logging) to the edges. This makes the core
trivially testable.

### 4. Fail Loudly, Recover Gracefully

Throw meaningful errors with context. Catch them at the appropriate level
(usually the route handler or pipeline orchestrator). Never swallow errors silently.

### 5. Prefer Composition Over Inheritance

Use functions, interfaces, and composition. Classes are fine for stateful things
(API clients with cached tokens), but don't build deep inheritance hierarchies.

### 6. Minimise Dependencies

Every dependency is a maintenance burden. Prefer the platform (Web APIs, Workers
runtime) over libraries. Use libraries for genuine complexity (Zod, Hono, Drizzle),
not for things you can write in 10 lines.

### 7. Single Responsibility Files

One module, one purpose. `afl-api.ts` talks to the AFL API. `transforms.ts`
transforms data. `pipeline.ts` orchestrates. If a file is doing two unrelated
things, split it.

---

## References

**Important:** Before setting up project standards, tooling, or writing application
code, read through all of the documentation linked below. Each link uses the
`defuddle.md` prefix which returns clean, agent-readable markdown. Read the full
documentation — not just the getting started pages — to understand the conventions,
APIs, and patterns available in each tool.

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
