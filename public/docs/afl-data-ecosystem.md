# AFL Data Ecosystem

Jack McPherson maintains this suite of TypeScript tools for Australian football
data. The suite includes fitzroy, AFL-MCP, rds-js, tipper, and footyBot. The data
covers AFL Men's, AFL Women's, VFL, and VFLW. All projects use strict TypeScript,
Bun, and Biome. Cloudflare Workers runs the deployed services.

## Ecosystem Overview

Five projects form the AFL data stack. They share a TypeScript style guide,
tooling conventions, and a Cloudflare D1 database.

```text
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
  tipper      -- D1 (native binding from its Worker; D1 REST API from the CLI)
  footyBot    -- fitzroy (live feed) + MCP endpoint (LLM tool-use)

rds-js (npm) -- used by fitzroy for parsing R data files
```

| Project  | npm package              | Type                            | GitHub                    |
| -------- | ------------------------ | ------------------------------- | ------------------------- |
| fitzroy  | `fitzroy`                | Library + CLI                   | jackemcpherson/fitzRoy-ts |
| AFL-MCP  | private                  | Cloudflare Worker               | jackemcpherson/AFL-MCP    |
| rds-js   | `@jackemcpherson/rds-js` | Library                         | jackemcpherson/rds-js     |
| tipper   | `@jackemcpherson/tipper` | CLI + Cloudflare Worker         | jackemcpherson/tipper     |
| footyBot | private                  | Cloudflare Worker (Discord bot) | jackemcpherson/footyBot   |

OpenTofu manages the Cloudflare resources in the `cloudflare-infra` repository.
These resources include D1, Workers, KV, queues, and DNS. Git is the source of
truth.

A gated pipeline applies plans, and a nightly job detects drift. The
separate `afl-watchdog` Worker polls the AFL-MCP and footyBot health markers
each hour. It alerts a Discord webhook when either marker becomes stale. Its
source is in the footyBot repository under `workers/watchdog`.

## Data Access: Start Here

For a new AFL data project, choose one of three approaches:

### 1. Fitzroy Library (Recommended Default)

Use fitzroy for scripts, CLIs, one-time analyses, and supported JavaScript
runtimes. Supported runtimes include Node.js, Bun, Deno, browsers, and
Cloudflare Workers.

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

// Player stats for a specific round. Version 3 returns a partial-result
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

Each call retrieves current data from an upstream source. The client requires no
database or credentials. It supports AFL API, FootyWire, AFL Tables, Squiggle,
and Fryzigg.
Pass `competition: "AFLM" | "AFLW" | "VFL" | "VFLW"` to scope to a specific
competition (defaults to AFLM for sources that support multiple).

### 2. D1 Database (Pre-Computed Historical Data)

Use D1 for Cloudflare Workers projects that need low-latency historical queries.
The database includes PAV ratings and team lineups.

AFL-MCP's cron sync populates the `afl-stats` D1 database. The database contains
match results, player statistics (~70 columns), PAV ratings, and lineups for
four competitions: AFLM (1990+), AFLW (2017+), VFL (2021+), and VFLW (2021+).
Tipper reads from this database. Its scheduled Worker uses a native D1 binding.
Its local CLI uses the Cloudflare D1 REST API.

To query D1 from a Cloudflare Worker, bind to the database in wrangler.toml:

```toml
[[d1_databases]]
binding = "DB"
database_name = "afl-stats"
database_id = "fe1c1a89-805f-481d-9ba0-b9f8dee04a36"
```

### 3. MCP Endpoint (LLM-Powered Tools)

Use the MCP endpoint for AI agents and LLM-powered applications that query AFL
data.

The AFL-MCP server exposes three Model Context Protocol tools. Use the
`https://afl.jackemcpherson.com/mcp` endpoint.

| Tool     | Purpose                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `schema` | Database structure and typed coverage. Optional bounded observation for one competition-season        |
| `tools`  | Sandbox capabilities and constraints                                                                  |
| `code`   | Execute TypeScript against D1 in an isolated sandbox. Optional `competition` arg as a hint to the LLM |

The `code` tool runs user-submitted TypeScript in a Dynamic Worker isolate
with read-only database access via a `db.prepare(sql).bind(...).all()` bridge.
Queries must filter by competition explicitly: the `competition` argument is
documentation, not auto-injection.

The `schema` tool accepts three parameter shapes. A no-argument call returns
static expectations for all four competitions. These expectations are in
`database.coverage_contract` version 1. The call does not read D1.

The `competition` parameter filters `database.competitions` and
`coverage_contract.by_competition`. It does not change tables, notes, or join
examples. This call also does not read D1.

The `{"includeObserved":true,"competition":"AFLM","season":2026}` request measures
exactly
one competition-season and keeps observations separate from expectations. Row
fields use the `rows` unit, PAV uses `table_rows`, and lineup coverage uses
`match_presence`. The server caches successful measurements for 15 minutes.
The server rejects any other combination and returns a contract error. For
example, `includeObserved` requires both `competition` and `season`.

`GET /mcp/health` reports sync freshness. It returns 503 when no sync occurred
for more than three hours. Bearer-token admin routes trigger manual syncs and
PAV rebuilds. These routes are `/mcp/admin/sync`, `/mcp/admin/backfill`,
`/mcp/admin/recalculate-pav`, and `/mcp/admin/recalculate-all-pav`.
Release 3.4.0 added two authenticated operations.

`POST /mcp/admin/backfill-brownlow` is a dry-run-first annual AFLM Brownlow vote
backfill for one or two seasons. It returns bounded aggregate resolution and
six-vote diagnostics before an operator enables writes.
`GET /mcp/admin/status` returns bounded aggregate sync freshness, lease,
integrity, and 24-hour degradation
diagnostics without exposing raw errors or identifiers. Brownlow ingestion,
cron, and manual sync share the same ten-minute operation lease, so they cannot
overlap.
All public endpoints are rate-limited to 60 requests/minute per IP.

## Fitzroy Library Reference

The following sections describe the supported fitzroy interface and data sources.

### Available Functions

| Function             | Returns             | Description                                                                                                                                                                   |
| -------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchMatches`       | `Match[]`           | Match data with optional `status` filter (Upcoming, Live, Complete, Postponed, Cancelled). Replaces v1's separate `fetchMatchResults` + `fetchFixture`.                       |
| `fetchPlayerStats`   | `SeasonPlayerStats` | ~70 per-match statistics per player, wrapped in a `{ stats, failedMatchIds }` envelope: season-wide scrapes surface per-match failures instead of silently dropping them (v3) |
| `fetchLadder`        | `Ladder`            | Standings with wins, losses, percentage                                                                                                                                       |
| `fetchLineup`        | `Lineup`            | Named squads for a round                                                                                                                                                      |
| `fetchSquad`         | `Squad`             | Full squad list for a team                                                                                                                                                    |
| `fetchTeams`         | `Team[]`            | All teams in a competition                                                                                                                                                    |
| `fetchTeamStats`     | `TeamStatsEntry[]`  | Aggregated team-level statistics                                                                                                                                              |
| `fetchPlayerDetails` | `PlayerDetails[]`   | Player biography and career info                                                                                                                                              |
| `fetchAwards`        | `Award[]`           | Brownlow, Coleman, All-Australian, Rising Star, coaches votes                                                                                                                 |

As of v3 the package root exports only this supported surface. Raw AFL
API / Squiggle wire schemas (Zod) moved to the `fitzroy/schemas` subpath
export, so upstream drift no longer forces a major release.

The package also exports `resolveDefaultSeasonForCompetition(competition)`
in v3.2 and later. This asynchronous function selects the current or most
recent season from the AFL round schedule. Version 3.4 adds the pure
`roundLabel()`, `roundAbbreviation()`, and `roundTypeLabel()` helpers. They
derive R-fitzRoy-style round labels from `Match` fields.

### Common Parameters

All fetch functions accept a query object with these common parameters:

| Parameter     | Type              | Values or Purpose                                                        |
| ------------- | ----------------- | ------------------------------------------------------------------------ |
| `source`      | `DataSource`      | `"afl-api"`, `"footywire"`, `"afl-tables"`, `"squiggle"`, or `"fryzigg"` |
| `season`      | `number`          | Season year, such as 2026                                                |
| `round`       | `number`          | Optional round number                                                    |
| `competition` | `CompetitionCode` | Optional `"AFLM"`, `"AFLW"`, `"VFL"`, or `"VFLW"`                        |
| `team`        | `string`          | Optional team name with fuzzy matching                                   |

### Data Sources

| Source        | Coverage                                    | Best for                                        |
| ------------- | ------------------------------------------- | ----------------------------------------------- |
| `afl-api`     | AFLM 2012+, AFLW 2017+, VFL/VFLW 2021+      | Live scores, official data, multi-competition   |
| `footywire`   | AFLM 2010-present                           | SuperCoach scores, advanced stats               |
| `afl-tables`  | AFLM 1897-present (player/team stats 1965+) | Historical records                              |
| `squiggle`    | AFLM 2012-present                           | Prediction data, third-party analysis           |
| `fryzigg`     | AFLM 2012-2025, AFLW 2017-2022              | Advanced player statistics (RDS format)         |
| `afl-coaches` | AFLM coaches votes                          | AFLCA Champion Player votes (via `fetchAwards`) |

Only `afl-api` covers VFL and VFLW. The fryzigg RDS dumps are snapshots. The
AFLM dump has no updates after September 2025. The AFLW dump has no updates
after January 2022. Fitzroy deliberately caps coverage at those seasons.

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
  // v3.1.0 live-match fields: prefer completedQuarter over livePeriodStatus
  // for break/siren detection (the upstream status strings regressed in 2026)
  matchClockPeriods: ReadonlyArray<MatchClockPeriod> | null;
  completedQuarter: 0 | 1 | 2 | 3 | 4 | null;
  venueLocalDate: string | null; // wall-clock start in the venue's timezone
  venueTimezone: string | null;  // IANA timezone name for the venue
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

VFL returns `null` for `goalAssists`, `marksInside50`, and `onePercenters`.
VFLW coverage is best-effort and sparse rather than universally absent: measured
AFL-MCP rows contain values for all three fields.

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

Zod validates all external data. A failure `Result` contains the original Zod
error details for an invalid API response.

### Cloudflare Workers Compatibility

As of fitzroy 2.3.0, HTML scrapers use `parse5` + `cheerio/slim`, so the
library entry no longer pulls in `node:stream`. A Worker can import fitzroy
without the `nodejs_compat` compatibility flag.

## D1 Database Schema

The `afl-stats` database has 12 tables and five integrity views. It covers AFL
Men's, AFL Women's, VFL, and VFLW. Always filter queries by competition.
Join `seasons` to `competitions`, then use `WHERE c.code = ?`. Without
the filter, results silently mix competitions. Teams with the same name in
different competitions have distinct `team_id` values.

### Core Tables

The following tables contain match, weather, prediction, player, and lineup data.

#### `matches`

Each row contains one match. Identity columns include `season_id`,
`round_number`, `round_type`, `date`, `local_time`, and the venue and team IDs.
The `round` column contains a long label such as `Round 1` or `Grand Final`.
The `round_abbreviation` column contains AFL short codes from `OR` through
`GF`. Pre-2020 AFLM data can also use `EF` and `QF`.

The score columns include
points, margins, attendance, and each quarter's goals and behinds. The `status`
column records the match lifecycle. The `live_period_status` column stores the
raw AFL API status for siren detection without inference from null scores.

Release 3.4.0 added nullable `completed_quarter`. The value from 0 through 4 is
the highest completed quarter. Use it together with `status`. AFL-MCP's
five-minute sync does not provide real-time match data. `local_time` is Melbourne
time for every competition, including interstate matches.

Venue-native time is not stored. The legacy
`weather_temp_c` and `weather_type` contain a frozen fryzigg record for AFLM
from 2010 through 2025. Temperatures are daily maxima. Use `match_weather` for
match-time numeric weather.

#### `match_weather`

Each row contains one match and one `kind` (`observed` or `forecast`).
The primary key is `(match_id, kind)`. Metrics cover the three-hour window from
the scheduled start. They include mean temperature, total precipitation, prior
24-hour precipitation, maximum wind speed and gusts, and mean humidity. The
record also includes `source`
(`era5_land+era5` for finalised observations, `historical_forecast` for
the fast post-match write, `best_match` for forecasts) and `fetched_at`.

Forecast rows appear from 7 days out, refresh in place, and are kept
after the observed row lands. Coverage: completed matches 1990+ across
all four competitions (cancelled matches and unplaceable placeholder
venues excluded). Weather data by
[Open-Meteo](https://open-meteo.com/) (CC-BY 4.0).

#### `match_predictions`

Each row contains one match prediction from tipper. The primary key
is `match_id`. Regeneration overwrites the row, so the table holds only the
latest prediction. The `home_win_prob` and `predicted_margin` columns use the
home team's perspective. Other columns record the model version and generation
time. The tipper Worker writes these rows through a native D1 binding.

Rows
refresh until the first match in the round starts.

Coverage starts in 2026 and
is sparse. Use `LEFT JOIN` and treat absence as unpublished.

#### `player_match_stats`

Each row contains one player and one match. Approximately 70 columns contain
disposals, marks, goals, tackles, contested possessions, clearances, pressure
acts, metres gained, hitouts, fantasy scores, Brownlow votes, and efficiency
metrics. VFL has NULL for `goal_assists`, `marks_inside_fifty`, and
`one_percenters`. VFLW values are best-effort and sparse, with measured
populated rows for all three columns.

#### `player_season_pav`

This table contains Player Approximate Value per season. Columns include
`off_pav`, `mid_pav`, `def_pav`, `total_pav`. One row per player per season
per team. PAV is a composite metric weighting offensive, midfield, and
defensive contributions using the HPN formula. Data is available only for AFLM
(1998+) and AFLW (2017+). VFL and VFLW lack the upstream inputs that the formula
needs.

#### `match_lineups`

This table contains announced team selections. The `is_emergency` and
`is_substitute` columns are flags. Coverage starts with AFLM 2015 and AFLW 2017.
VFL and VFLW coverage is best-effort.

### Coverage Contract

Release 3.4.0 extended the existing `schema` tool with a typed
`database.coverage_contract` (version 1). Static expectations identify source,
review date, range, and expected availability without reading D1. An optional
`includeObserved: true` request must name exactly one `competition` and `season`.
It overlays bounded measurements for stats and weather (`rows`), PAV
(`table_rows`), and lineup match coverage (`match_presence`). Expectations and
observations remain distinct, and zero measured rows do not prove absence.

The server caches successful observations for 15 minutes. It still exposes
exactly three MCP tools.

### Reference Tables

- The `competitions` table contains `AFLM`, `AFLW`, `VFL`, and `VFLW`.
- The `teams` table has a unique `(name, competition_id)` key. The same name across
  competitions yields distinct rows. Legacy names and nicknames are
  normalised to canonical names in code during ingest (there is no alias
  table).
- The `venues` table contains normalised venue names shared across competitions.
  It contains `latitude`, `longitude`, `timezone` (IANA), `roof`
  (`retractable` | `none`: Marvel Stadium is the only retractable roof),
  and `canonical_venue_id` (self-reference resolving sponsor/rename
  aliases, for example Domain Stadium to Subiaco. Join weather through the
  canonical venue).
- The `players` table contains master data and external identifiers.
- The `seasons` table has a unique `(competition_id, year)` key.
- The `sync_log` table contains append-only cron history (`timestamp`, `type`,
  `rows_affected`, `error`) used for freshness checks and backfill audits.
  Successful no-op ticks are not logged. Rows are pruned after 90 days.
- The `sync_lease` table contains a single-row mutual-exclusion lock. The lock
  ensures that cron and admin syncs
  cannot overlap (10-minute stale timeout).

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

AFL-MCP runs one `*/5 * * * *` cron for all four competitions. The
`shouldRunNow` predicate always permits the top-of-hour run. Other runs require
a match in the previous day or next three days. The same pipeline recalculates
PAV when new AFLM or AFLW player statistics arrive.

The top-of-hour pipeline also runs a weather stage. It refreshes seven-day
forecasts daily and match-day forecasts hourly. It writes a fast observation
after each match and upgrades the provenance to ERA5 after six days. Each pass
permits 25 fetches and records failures in `sync_log`. A local script performed
the initial historical weather backfill.

`POST /mcp/admin/backfill` exposes the backfill operation. Its parameters are
`competitions`, `fromYear`, `toYear`, `skipShouldRunNow`, and `skipPav`. A request
can cover no more than 30 years. `GET /mcp/health` reports staleness for
monitoring.
Release 3.4.0 also added the annual, dry-run-first
`POST /mcp/admin/backfill-brownlow` operation and aggregate-only
`GET /mcp/admin/status`. Both require the existing admin bearer token.

## Tipper: Prediction CLI + Worker

Tipper forecasts AFLM results with a hybrid model. The model combines
margin-of-victory Elo with a calibrated PAV lineup rating. Elo has 60% weight,
and PAV has 40% weight. A local CLI supports model development through the D1
REST API. A Cloudflare Worker publishes scheduled predictions. Both interfaces
use the same runtime-independent engine.

The main commands are:

- `tipper predict --season Y --round R` generates predictions.
- `tipper publish [--season Y --round R --comp AFLM|AFLW]` writes predictions
  to D1. It defaults to the next unplayed round.
- `tipper backtest [--season S] [--config ID]` runs a backtest.
- `tipper compare --config-a ID --config-b ID` runs a bootstrap hypothesis
  test.
- `tipper calibrate [--config ID]` derives the PAV calibration slope.
- `tipper config {list,show,current,promote,diff,create}` manages configuration
  lifecycle.

Configurations use SHA-256 content hashes. Promotion requires backtest results
that match the configuration hash. A challenger cannot reduce tip accuracy
against the incumbent in pooled 2021-2025 backtests. A recent three-season tip
deficit disqualifies a challenger regardless of LogLoss gains. The shipped
configuration has a 73.3% tip rate through round 14 of the 2026 sample.

Scheduled publishing runs as a tipper Cloudflare Worker. Version 3.4 restored
the Worker after its version 3.2 removal. The Worker uses the same GitOps
delivery process as the other Workers. A `*/15 * * * *` cron drives an in-code
gate for AFLM and AFLW. The Worker
republishes rounds with matches that start within seven days. It publishes
daily by default and hourly on match days.

During the Thursday team-announcement window, it publishes every 15 minutes.
This schedule gives footyBot current
numbers for its round preview.

A round freezes when its first match starts. The Worker uses a native read-write
D1 binding
without an API token. The build embeds the promoted configuration in the
artefact. The pinned SHA therefore identifies the deployed model.

`GET https://tipper.jackemcpherson.workers.dev/health` returns 200/503
derived from `match_predictions` freshness against the fixture window.
It is also the blocking post-deployment check. The CLI `tipper publish` command
through the D1 REST API remains the manual emergency path.

## footyBot: Discord Consumer

footyBot is a Discord bot that runs entirely on Cloudflare Workers and
consumes the rest of the ecosystem two ways:

- The `/ask <question>` command routes the question through the configured LLM
  (`gemini-3-flash-preview` by default via Google AI Studio's `v1beta`
  endpoint, or `claude-sonnet-4-5` when `LLM_PROVIDER="anthropic"`) inside
  a manual MCP tool-use loop against `https://afl.jackemcpherson.com/mcp`.
  All LLM traffic is proxied through Cloudflare AI Gateway with
  Authenticated Gateway enabled so Unified Billing covers it. A `/help`
  command posts usage examples.
- Two Workers cron triggers feed a proactive announcement channel:
  - `* * * * *` (every minute, gated by a KV-cached fixture window) pulls
    live matches via fitzroy and posts QT / HT / 3QT / FT scoreboards at
    quarter breaks. Break detection takes the maximum of several signals:
    `Match.completedQuarter` (primary, from the AFL API match clock),
    per-quarter score population, `status === "Complete"`, and the
    `livePeriodStatus` string (unreliable since mid-2026, when the AFL API
    stopped emitting `QTR_TIME`/`HALF_TIME`/`3QTR_TIME`). Posts advance
    on whichever signal arrives first. Per-match KV state (`live:{matchId}`)
    makes the tick idempotent.
  - `0 21 * * *` (~07:00 AEST / 08:00 AEDT) finds any
    `(competition, season, round)` that completed in the trailing 36 h
    and has not been summarised, then posts deterministic results and a
    ladder template plus a compact LLM storylines section covering every
    match. AFLM ladders from 2026 mark the direct-passage cut after sixth
    and wildcard cutoff after 10th. Storylines receive score shape,
    deterministic player highlights (`rating_points` leader plus
    multi-goal players), `match_predictions` calibration, six-game form,
    a computed previous-round ladder diff, and the next round's fixtures
    and current ladder positions. Observed `match_weather` remains
    material weather context. The state key is
    `summary:{comp}:{season}:{round}`.
  - The same per-minute cron also drives a round preview inside a Thursday
    18:20-21:00
    Melbourne window (18:20 is the official team-announcement time).
    It polls every 5 minutes via the MCP `code` tool and posts once a
    data gate passes (the round's opening match has announced lineups
    and a published prediction). Every pass from 20:50 can publish the preview.
    The run uses available data so one failed
    invocation cannot cost the round its preview. The post pairs a
    deterministic fixtures template with an LLM storylines section. The template
    groups fixtures by day. Each match includes a
    `FootyBot's Tip: <favourite> by <margin> (<prob>%)` line from
    `match_predictions`. The storylines use material forecast-weather context.
    Canonical venue roof metadata suppresses outdoor wind and rain evidence for
    roofed fixtures. The state key is `preview:{comp}:{season}:{round}`.

State lives in a single `STATE` KV namespace. Hono handles the Discord
interaction webhook. A queue consumer runs the tool-use loop so the
interaction can acknowledge within Discord's three-second window. Each live
tick writes a `lasttick:{melbourneDate}` liveness marker. The marker separates
a stopped cron from a run with no post. An offline evaluation suite
(`bun run eval`) tests `/ask` answer quality for regressions.

## AFL Domain Essentials

The four competitions covered:

- AFL Men's (AFLM) has 18 teams. Its season runs from March to September. It has
  an Opening
  Round (before Round 1, `round_number = 0`, 2024+ only), 23 home-and-away
  rounds, Finals series. Pre-2020 used `Qualifying`/`Elimination` Final.
  2020+ uses `Finals Week 1`.
- AFL Women's (AFLW) has 18 teams. Its season runs from August to November.
- VFL is a second-tier men's competition with a mix of AFLM-affiliated reserves
  and standalone clubs. Examples include Carlton, Collingwood, Box Hill Hawks,
  Casey Demons, and Werribee Tigers. It includes a `Wildcard` round before
  finals.
- VFLW is a Victorian women's second-tier competition with AFLW affiliates
  and standalone clubs such as Darebin.

Goals score 6 points, behinds score 1. Total = goals × 6 + behinds.

AFL-MCP stores `matches.local_time` in Melbourne local time for every
competition: AEST (UTC+10) during winter and AEDT (UTC+11) during daylight
saving (October to April). It intentionally discards venue-native time and adds
no venue-time columns. Fitzroy's public `Match` type still exposes
the upstream `venueLocalDate`. AFL-MCP does not persist that field.

Round labels mirror the AFL API and the R fitzRoy package: no
cross-competition normalisation. The `round` column contains the long form,
such as `Round 1`, `Wildcard`, or `Grand Final`. The `round_abbreviation` column
contains consistent AFL short codes. Use it for cross-competition queries.

Some teams have historical aliases. AFL-MCP normalises legacy AFLM names
during ingest (for example `Brisbane Bears` to `Brisbane Lions`, `Footscray` to
`Western Bulldogs`).

## TypeScript Conventions

All AFL data projects follow a shared style guide. Key rules:

### Tooling

Use Bun for package management and script execution. Use Biome for linting and
formatting. Use Vitest for tests and tsc for type checking. Run all scripts with
`bun run <name>`.

### TypeScript Configuration

Use `strict: true`, `noUncheckedIndexedAccess: true`,
`exactOptionalPropertyTypes: true`, `noUnusedLocals: true`,
`noUnusedParameters: true`. Target ES2022 with bundler module resolution.

### Biome Rules

Use `noExplicitAny: error`. Use `unknown` and narrow with Zod. Set
`noDefaultExport: error`, except for Worker entry points and `*.config.ts`. Set
`useConst: error`. Use two-space indentation, a 100-character line width, and
organised imports.

### Patterns

Validate external data with Zod at boundaries. Trust types
internally. Use `Result<T, E>` for expected failures. Prefer functional
transforms (`.filter().map().sort()`) over mutation. Use `Promise.all` for
concurrent fetches. Types first: define domain types before implementation.

Do not use `enum`. Use union types, such as
`type RoundType = "HomeAndAway" | "Finals"`. Do not use `any`. Use `unknown` and
narrow the value. Use only Web Standard APIs in library code, such as `fetch`,
`Request`, `Response`, `URL`, and `crypto`. Do not use Bun-specific or
Node.js-specific APIs.

### Naming

Use camelCase for variables and functions, PascalCase for types and interfaces,
SCREAMING_SNAKE for true constants, kebab-case for file names. Abbreviations as
words: `AflApi` not `AFLApi`.

For the complete conventions, read
<https://jackemcpherson.com/docs/typescript-style-guide.md>.

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

```text
src/
  types.ts        # Domain types: define first
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
