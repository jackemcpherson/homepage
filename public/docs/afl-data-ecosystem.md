# AFL Data Ecosystem

> A suite of TypeScript tools for working with Australian football data,
> built by Jack McPherson. Includes a data access library (fitzroy), a
> multi-competition database covering AFL Men's (1990+), AFL Women's
> (2017+), VFL (2021+) and VFLW (2021+) (AFL-MCP), an RDS file parser
> (rds-js), a prediction engine (tipper), and a Discord bot that posts
> live-match scoreboards and round wraps (footyBot). All projects use
> strict TypeScript, Bun, Biome, and Cloudflare Workers.

## Ecosystem Overview

Five projects form the AFL data stack. They share a TypeScript style guide,
tooling conventions, and a Cloudflare D1 database.

```
AFL API / FootyWire / AFL Tables / Squiggle / Fryzigg RDS
                        |
                    fitzroy (npm library)
                        |
                   AFL-MCP (Cloudflare Worker)
                    /         \
            MCP endpoint    Cloudflare D1 (afl-stats)
          (LLM tools)            \
                                tipper (prediction CLI)

Consumers:
  tipper      -- D1
  footyBot    -- fitzroy (live feed) + MCP endpoint (LLM tool-use)

rds-js (npm) -- used by fitzroy for parsing R data files
```

| Project | npm package | Type | GitHub |
|---------|-------------|------|--------|
| fitzroy | `fitzroy` | Library + CLI | jackemcpherson/fitzRoy-ts |
| AFL-MCP | private | Cloudflare Worker | jackemcpherson/AFL-MCP |
| rds-js | `@jackemcpherson/rds-js` | Library | jackemcpherson/rds-js |
| tipper | `@jackemcpherson/tipper` | CLI + Worker | jackemcpherson/tipper |
| footyBot | private | Cloudflare Worker (Discord bot) | jackemcpherson/footyBot |

## Data Access — Start Here

For a new AFL data project, choose one of three approaches:

### 1. fitzroy library (recommended default)

Best for: scripts, CLIs, one-off analysis, any runtime (Node.js, Bun, Deno,
browsers, Cloudflare Workers).

```bash
bun add fitzroy
```

```typescript
import { fetchMatches, fetchPlayerStats } from "fitzroy";

// Current season completed matches from AFL API
const results = await fetchMatches({
  source: "afl-api",
  season: 2026,
  status: "Complete",
});
if (results.success) {
  console.log(results.data.length, "matches");
}

// Player stats for a specific round. v3 returns a partial-result
// envelope: { stats, failedMatchIds }.
const statsResult = await fetchPlayerStats({
  source: "afl-api",
  season: 2026,
  round: 10,
});
if (statsResult.success) {
  const { stats, failedMatchIds } = statsResult.data;
}
```

Data comes fresh from upstream sources each time. No database or credentials
needed. Supports AFL API, FootyWire, AFL Tables, Squiggle, and Fryzigg.
Pass `competition: "AFLM" | "AFLW" | "VFL" | "VFLW"` to scope to a specific
competition (defaults to AFLM for sources that support multiple).

### 2. D1 database (pre-computed historical data)

Best for: Cloudflare Workers projects that need decades of historical data,
pre-computed PAV ratings, team lineups, or low-latency queries across the
full AFL ecosystem.

The `afl-stats` D1 database is populated by AFL-MCP's cron sync and contains
match results, player statistics (~70 columns), PAV ratings, and lineups for
**four competitions**: AFLM (1990+), AFLW (2017+), VFL (2021+), VFLW (2021+).
Tipper reads from this same database.

To query D1 from a Cloudflare Worker, bind to the database in wrangler.toml:

```toml
[[d1_databases]]
binding = "DB"
database_name = "afl-stats"
database_id = "fe1c1a89-805f-481d-9ba0-b9f8dee04a36"
```

### 3. MCP endpoint (LLM-powered tools)

Best for: AI agents and LLM-powered applications that need to query AFL data
dynamically.

The AFL-MCP server exposes 3 tools via the Model Context Protocol at
`https://afl.jackemcpherson.com/mcp`:

| Tool | Purpose |
|------|---------|
| `schema` | Database structure, per-competition coverage, column details, join patterns |
| `tools` | Sandbox capabilities and constraints |
| `code` | Execute TypeScript against D1 in an isolated sandbox; optional `competition` arg as a hint to the LLM |

The `code` tool runs user-submitted TypeScript in a Dynamic Worker isolate
with read-only database access via a `db.prepare(sql).bind(...).all()` bridge.
Queries must filter by competition explicitly — the `competition` argument is
documentation, not auto-injection.

## fitzroy Library Reference

### Available Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `fetchMatches` | `Match[]` | Match data with optional `status` filter (Upcoming, Live, Complete, Postponed, Cancelled). Replaces v1's separate `fetchMatchResults` + `fetchFixture`. |
| `fetchPlayerStats` | `SeasonPlayerStats` | ~70 per-match statistics per player, wrapped in a `{ stats, failedMatchIds }` envelope — season-wide scrapes surface per-match failures instead of silently dropping them (v3) |
| `fetchLadder` | `Ladder` | Standings with wins, losses, percentage |
| `fetchLineup` | `Lineup` | Named squads for a round |
| `fetchSquad` | `Squad` | Full squad list for a team |
| `fetchTeams` | `Team[]` | All teams in a competition |
| `fetchTeamStats` | `TeamStatsEntry[]` | Aggregated team-level statistics |
| `fetchPlayerDetails` | `PlayerDetails[]` | Player biography and career info |
| `fetchAwards` | `Award[]` | Brownlow, Coleman, All-Australian, Rising Star, coaches votes |

As of v3 the package root exports only this supported surface. Raw AFL
API / Squiggle wire schemas (Zod) moved to the `fitzroy/schemas` subpath
export, so upstream drift no longer forces a major release.

### Common Parameters

All fetch functions accept a query object. Common parameters:

- `source` (DataSource) — `"afl-api"`, `"footywire"`, `"afl-tables"`, `"squiggle"`, `"fryzigg"`
- `season` (number) — e.g., 2026
- `round` (number, optional) — specific round number
- `competition` (CompetitionCode, optional) — `"AFLM" | "AFLW" | "VFL" | "VFLW"`
- `team` (string, optional) — team name (fuzzy-matched)

### Data Sources

| Source | Coverage | Best for |
|--------|----------|----------|
| `afl-api` | AFLM 2012+, AFLW 2017+, VFL/VFLW 2021+ | Live scores, official data, multi-competition |
| `footywire` | AFLM 2012-present | SuperCoach scores, advanced stats |
| `afl-tables` | AFLM 1897-present | Historical records |
| `squiggle` | AFLM 2000-present | Prediction data, third-party analysis |
| `fryzigg` | AFLM 1990-present, AFLW | Advanced player statistics (RDS format) |

`afl-api` is the only source that covers VFL/VFLW.

### Key Types

```typescript
interface Match {
  matchId: string;
  season: number;
  competition: CompetitionCode; // "AFLM" | "AFLW" | "VFL" | "VFLW"
  roundNumber: number;
  roundType: "HomeAndAway" | "Finals";
  roundName: string | null;     // "Round 1", "Opening Round", "Grand Final"
  roundCode: string | null;     // fitzroy's normalised short code
  date: Date;
  venue: string;
  homeTeam: string;
  awayTeam: string;
  homePoints: number | null;    // null for upcoming fixtures
  awayPoints: number | null;
  margin: number | null;
  attendance: number | null;
  weatherTempCelsius: number | null;
  q1Home: QuarterScore | null;
  // ... quarter scores for all 4 quarters, both teams
  // Pre-game upstream statuses (UNCONFIRMED_TEAMS, CONFIRMED_TEAMS,
  // PLACEHOLDER) normalise to "Upcoming"; unknown raw statuses also
  // default to "Upcoming" rather than "Complete" (fitzroy >= 3.0.1).
  status: "Upcoming" | "Live" | "Complete" | "Postponed" | "Cancelled";
  livePeriodStatus: string | null; // afl-api score-level status: LIVE, QTR_TIME, HALF_TIME, 3QTR_TIME, FULL_TIME (raw upstream string)
  source: DataSource;
}

interface PlayerStats {
  matchId: string;
  season: number;
  competition: CompetitionCode;
  playerId: string;
  givenName: string;
  surname: string;
  displayName: string;
  team: string;
  kicks: number | null;
  handballs: number | null;
  disposals: number | null;
  marks: number | null;
  goals: number | null;
  tackles: number | null;
  contestedPossessions: number | null;
  totalClearances: number | null;
  // ... ~70 statistical fields
}
```

VFL and VFLW return `null` for `goalAssists`, `marksInside50`, and
`onePercenters` — the AFL API doesn't track these for those competitions.

### Error Handling

fitzroy returns a `Result<T, E>` for fetch operations:

```typescript
import { fetchMatches } from "fitzroy";

const result = await fetchMatches({ source: "afl-api", season: 2026 });
if (!result.success) {
  console.error("fetch failed:", result.error.message);
} else {
  for (const match of result.data) {
    // ...
  }
}
```

All external data passes through Zod validation. Invalid API responses are
returned as a failure `Result` with the original Zod error details.

### Cloudflare Workers compatibility

As of fitzroy 2.3.0, HTML scrapers use `parse5` + `cheerio/slim`, so the
library entry no longer pulls in `node:stream`. fitzroy can be imported
from a Worker without setting the `nodejs_compat` compatibility flag.

## D1 Database Schema

The `afl-stats` database has 10 tables plus 5 integrity views and covers four competitions: AFL
Men's, AFL Women's, VFL, and VFLW. **Always filter queries by competition**
(join through `seasons → competitions`, then `WHERE c.code = ?`) — without
the filter, results mix competitions silently because team rows with the same
name (e.g. Carlton AFLM vs Carlton VFL) are distinct `team_id` values.

### Core Tables

**matches** — One row per match. Key columns: `season_id`, `round` (long
form like `Round 1`, `Grand Final`, `Wildcard`), `round_abbreviation` (AFL
standard short codes: `Rd N`, `OR`, `WC`, `FW1`, `SF`, `PF`, `GF`, plus
`EF`/`QF` for pre-2020 AFLM), `round_number`, `round_type` (`Regular` or
`Finals`), `date`, `local_time`, `venue_id`, `home_team_id`, `away_team_id`,
`home_points`, `away_points`, `margin`, `attendance`, `weather_temp_c`,
quarter-by-quarter scores (`home_q1_goals` through `away_q4_behinds`),
`status` (lifecycle: `Upcoming` / `Live` / `Complete` / `Postponed` /
`Cancelled`) and `live_period_status` (raw AFL API score-level status —
`LIVE`, `QTR_TIME`, `HALF_TIME`, `3QTR_TIME`, `FULL_TIME` — for siren
detection without inferring state from null scores).

**player_match_stats** — One row per player per match. ~70 columns covering
disposals, marks, goals, tackles, contested possessions, clearances, pressure
acts, metres gained, hitouts, fantasy scores, Brownlow votes, and efficiency
metrics. VFL/VFLW have NULL for `goal_assists`, `marks_inside_fifty`, and
`one_percenters`.

**player_season_pav** — Player Approximate Value per season. Columns:
`off_pav`, `mid_pav`, `def_pav`, `total_pav`. One row per player per season
per team. PAV is a composite metric weighting offensive, midfield, and
defensive contributions using the HPN formula. **Available for AFLM (1998+)
and AFLW (2017+) only** — VFL/VFLW lack the upstream stat inputs the formula
needs.

**match_lineups** — Announced team selections. `is_emergency` and
`is_substitute` flags. Coverage: AFLM 2015+, AFLW 2017+, VFL/VFLW best-effort.

### Reference Tables

- **competitions** — `AFLM`, `AFLW`, `VFL`, `VFLW`.
- **teams** — `(name, competition_id)` UNIQUE; same team name across
  competitions yields distinct rows.
- **team_names** — Alias lookups (nicknames, SDNR indigenous names, legacy
  names) mapped to canonical `team_id` for ingest normalisation.
- **venues** — Normalised venue names; shared across competitions.
- **venue_names** — Alias lookups for venues, mapped to canonical `venue_id`.
- **players** — Player master data with external IDs for cross-referencing.
- **seasons** — `(competition_id, year)` UNIQUE.
- **sync_logs** — Cron run history (timestamp, competition, source, outcome,
  row counts) used for freshness checks and backfill audits.

### Common Query Patterns

All queries should join through `competitions` and filter by `c.code`:

```sql
-- AFLW season results with team names
SELECT m.date, ht.name AS home_team, m.home_points,
       at.name AS away_team, m.away_points, m.margin
FROM matches m
JOIN seasons s ON m.season_id = s.id
JOIN competitions c ON s.competition_id = c.id
JOIN teams ht ON m.home_team_id = ht.id
JOIN teams at ON m.away_team_id = at.id
WHERE c.code = 'AFLW' AND s.year = 2025
ORDER BY m.date;

-- Top disposals for an AFLM round
SELECT p.first_name || ' ' || p.surname AS player, t.name AS team,
       pms.disposals, pms.kicks, pms.handballs
FROM player_match_stats pms
JOIN matches m ON pms.match_id = m.id
JOIN seasons s ON m.season_id = s.id
JOIN competitions c ON s.competition_id = c.id
JOIN players p ON pms.player_id = p.id
JOIN teams t ON pms.team_id = t.id
WHERE c.code = 'AFLM' AND s.year = 2026 AND m.round_number = 10
ORDER BY pms.disposals DESC
LIMIT 20;

-- Cross-competition Grand Finals (the round_abbreviation use case)
SELECT c.code, s.year, ht.name AS home, m.home_points,
       at.name AS away, m.away_points
FROM matches m
JOIN seasons s ON m.season_id = s.id
JOIN competitions c ON s.competition_id = c.id
JOIN teams ht ON m.home_team_id = ht.id
JOIN teams at ON m.away_team_id = at.id
WHERE m.round_abbreviation = 'GF'
ORDER BY s.year DESC, c.code;

-- AFLW season PAV leaders
SELECT p.first_name || ' ' || p.surname AS player, t.name AS team,
       pav.total_pav, pav.off_pav, pav.mid_pav, pav.def_pav
FROM player_season_pav pav
JOIN players p ON pav.player_id = p.id
JOIN teams t ON pav.team_id = t.id
JOIN seasons s ON pav.season_id = s.id
JOIN competitions c ON s.competition_id = c.id
WHERE c.code = 'AFLW' AND s.year = 2025
ORDER BY pav.total_pav DESC
LIMIT 20;
```

### Data Freshness

AFL-MCP runs a single cron (`*/5 * * * *`) that dispatches all four
competitions per tick, gated by a `shouldRunNow` predicate (always runs at
the top of the hour; otherwise only when a match exists within ±3 days).
PAV is recalculated from inside the same pipeline whenever new player stats
land for AFLM or AFLW.

Backfill is exposed at `POST /mcp/admin/backfill` (parameters:
`competitions`, `fromYear`, `toYear`, `skipShouldRunNow`, `skipPav`).

## footyBot — Discord Consumer

footyBot is a Discord bot that runs entirely on Cloudflare Workers and
consumes the rest of the ecosystem two ways:

- **`/ask <question>`** — routes the question through the configured LLM
  (Gemini 3 Flash by default via Google AI Studio's `v1beta` endpoint,
  or Claude Sonnet 4.5 when `LLM_PROVIDER="anthropic"`) inside a manual
  MCP tool-use loop against `https://afl.jackemcpherson.com/mcp`. All LLM
  traffic is proxied through Cloudflare AI Gateway with Authenticated
  Gateway enabled so Unified Billing covers it.
- **Proactive posts** — two Workers cron triggers feed an announce
  channel:
  - `* * * * *` (every minute, gated by a KV-cached fixture window) pulls
    live matches via fitzroy and posts QT / HT / 3QT / FT scoreboards
    when `Match.livePeriodStatus` transitions. Per-match KV state
    (`live:{matchId}`) makes the tick idempotent.
  - `0 21 * * *` (~07:00 AEST / 08:00 AEDT) finds any
    `(competition, season, round)` that completed in the trailing 36 h
    and hasn't been summarised, then posts a deterministic results +
    ladder template plus a 2–3 paragraph LLM storylines section. State
    in `summary:{comp}:{season}:{round}`.

State lives in a single `STATE` KV namespace. Hono handles the Discord
interaction webhook; a queue consumer runs the tool-use loop so the
interaction can ack within Discord's 3 s window.

## AFL Domain Essentials

The four competitions covered:

- **AFL Men's (AFLM)** — 18 teams. Season runs March to September: Opening
  Round (before Round 1, `round_number = 0`, 2024+ only), 23 home-and-away
  rounds, Finals series. Pre-2020 used `Qualifying`/`Elimination` Final;
  2020+ uses `Finals Week 1`.
- **AFL Women's (AFLW)** — 18 teams. Season runs August to November.
- **VFL** — second-tier men's competition with mix of AFLM-affiliated
  reserves (Carlton, Collingwood, etc.) and standalone clubs (Box Hill
  Hawks, Casey Demons, Werribee Tigers). Includes a `Wildcard` round before
  finals.
- **VFLW** — Victorian women's second-tier competition with AFLW affiliates
  and standalone clubs (Darebin, etc.).

Goals score 6 points, behinds score 1. Total = goals × 6 + behinds.

All match times are in Melbourne local time: AEST (UTC+10) during winter,
AEDT (UTC+11) during daylight saving (October to April). fitzroy's `parseDate`
and `toAestString` utilities handle this correctly.

Round labels mirror the AFL API and the R fitzRoy package — no
cross-competition normalisation. The `round` column is the long form
(`Round 1`, `Wildcard`, `Grand Final`); `round_abbreviation` is the AFL's
standard short code (`Rd 1`, `WC`, `GF`) and is consistent across all four
competitions, so it's the right column for cross-competition queries.

Some teams have historical aliases. AFL-MCP normalises legacy AFLM names
during ingest (e.g. `Brisbane Bears` → `Brisbane Lions`, `Footscray` →
`Western Bulldogs`).

## TypeScript Conventions

All AFL data projects follow a shared style guide. Key rules:

**Tooling:** Bun (package manager + runner), Biome (lint + format), Vitest
(tests), tsc (type checking). All scripts via `bun run <name>`.

**TypeScript config:** `strict: true`, `noUncheckedIndexedAccess: true`,
`exactOptionalPropertyTypes: true`, `noUnusedLocals: true`,
`noUnusedParameters: true`. Target ES2022 with bundler module resolution.

**Biome rules:** `noExplicitAny: error` (use `unknown` and narrow with Zod),
`noDefaultExport: error` (exception: Worker entry points and *.config.ts),
`useConst: error`, 2-space indent, 100-char line width, organised imports.

**Patterns:** Validate external data with Zod at boundaries, trust types
internally. Use `Result<T, E>` for expected failures. Prefer functional
transforms (`.filter().map().sort()`) over mutation. Use `Promise.all` for
concurrent fetches. Types first — define domain types before implementation.

**No `enum`** — use union types: `type RoundType = "HomeAndAway" | "Finals"`.
**No `any`** — use `unknown` and narrow.
**Web Standard APIs only** in library code (fetch, Request, Response, URL,
crypto). No Bun-specific or Node.js-specific APIs.

**Naming:** camelCase for variables/functions, PascalCase for types/interfaces,
SCREAMING_SNAKE for true constants, kebab-case for file names. Abbreviations as
words: `AflApi` not `AFLApi`.

Full conventions: https://jackemcpherson.com/docs/typescript-style-guide.md

## Starting a New Project

```bash
# Scaffold
mkdir my-afl-project && cd my-afl-project
bun init -y
bun add fitzroy zod
bun add -d @biomejs/biome typescript vitest

# Initialise tooling
bunx @biomejs/biome init
```

Set up `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "bun run src/index.ts",
    "test": "vitest",
    "check": "biome check .",
    "format": "biome format --write .",
    "typecheck": "tsc --noEmit"
  }
}
```

Recommended project structure:

```
src/
  types.ts        # Domain types — define first
  index.ts        # Entry point
  lib/            # Shared utilities
  transforms/     # Pure data transformations
test/
  fixtures/       # Snapshot data for tests
biome.json
tsconfig.json
package.json
```

For Cloudflare Workers projects, add `hono` (web framework), `drizzle-orm`
(database ORM), and `wrangler` (dev server + deploy CLI). See the full style
guide for Hono routing, Drizzle schema, and Workers deployment patterns.
