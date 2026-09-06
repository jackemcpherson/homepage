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
                                tipper (prediction Worker)

Consumers:
  tipper      -- D1 (native Worker binding)
  footyBot    -- fitzroy (live feed) + MCP endpoint (LLM tool-use)

rds-js (npm) -- used by fitzroy for parsing R data files
```

| Project  | npm package              | Type                            | GitHub                    |
| -------- | ------------------------ | ------------------------------- | ------------------------- |
| fitzroy  | `fitzroy`                | Library + CLI                   | jackemcpherson/fitzRoy-ts |
| AFL-MCP  | private                  | Cloudflare Worker               | jackemcpherson/AFL-MCP    |
| rds-js   | `@jackemcpherson/rds-js` | Library                         | jackemcpherson/rds-js     |
| tipper   | private                  | Cloudflare Worker               | jackemcpherson/tipper     |
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

The AFL-MCP server exposes two Model Context Protocol tools. Use the
`https://afl.jackemcpherson.com/mcp` endpoint. Release 3.7.0 removed the
`tools` tool: its sandbox constraints now travel in the `code` tool's
description, the only surface every MCP client reads.

| Tool     | Purpose                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `schema` | Database structure and typed coverage. Optional bounded observation for one competition-season        |
| `code`   | Execute TypeScript against D1 in an isolated sandbox. Optional `competition` arg as a hint to the LLM |

The `code` tool runs user-submitted TypeScript in a Dynamic Worker isolate
with read-only database access via a `db.prepare(sql).bind(...).all()` bridge.
Queries must filter by competition explicitly: the `competition` argument is
documentation, not auto-injection. Sandbox constraints: no network, no npm,
a 30-second timeout, a 1 MB result cap, and 60 requests per minute per IP.

The `schema` tool accepts three parameter shapes. A no-argument call returns
static expectations for all four competitions in
`database.coverage_contract` version 2, without reading D1.

In version 2, each table declares a default (`range`, `expected`, `source`)
that applies to every column, and `columns` lists only exceptions that
deviate from it. A `how_to_read` key in the response explains the encoding.
The full response is about 29 KB, down from 126 KB under version 1.

The `competition` parameter filters `database.competitions` and
`coverage_contract.by_competition`. It does not change tables, notes, or join
examples. This call also does not read D1.

The `{"includeObserved":true,"competition":"AFLM","season":2026}` request measures
exactly one competition-season and attaches the result as a sibling
`observed` block beside the static contract. Measurements never mutate
expectations. Row fields use the `rows` unit, PAV uses `table_rows`, and
lineup coverage uses `match_presence`. The server caches successful
measurements for 15 minutes. The server rejects any other combination and
returns a contract error. For example, `includeObserved` requires both
`competition` and `season`.

`GET /mcp/health` reports sync freshness. It returns 503 when no sync occurred
for more than three hours or a recent critical sync error remains unresolved.
A later successful sync clears errors for that competition. Unrelated syncs
and sub-tasks cannot clear them. Fatal errors retain a three-hour window, and
all error records remain available.

Bearer-token admin routes trigger manual syncs and
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
All public `/mcp` and `/mcp/health` (also served at `/health`) endpoints
are rate-limited to 60 requests/minute per IP. Bearer-token-gated
`/mcp/admin/*` routes are not IP rate-limited.

## Fitzroy Library Reference

The following sections describe the supported fitzroy interface and data sources.

### Available Functions

| Function             | Returns               | Description                                                                                                                                                                   |
| -------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchMatches`       | `Match[]`             | Match data with optional `status` filter (Upcoming, Live, Complete, Postponed, Cancelled). Replaces v1's separate `fetchMatchResults` + `fetchFixture`.                       |
| `fetchPlayerStats`   | `SeasonPlayerStats`   | ~70 per-match statistics per player, wrapped in a `{ stats, failedMatchIds }` envelope: season-wide scrapes surface per-match failures instead of silently dropping them (v3) |
| `fetchLadder`        | `Ladder`              | Standings with wins, losses, percentage                                                                                                                                       |
| `fetchLineup`        | `Lineup`              | Named squads for a round                                                                                                                                                      |
| `fetchSquad`         | `Squad`               | Team roster with `season` or `all-time` scope                                                                                                                                 |
| `fetchTeams`         | `Team[]`              | All teams in a competition                                                                                                                                                    |
| `fetchTeamStats`     | `TeamStatsEntry[]`    | Aggregated team-level statistics                                                                                                                                              |
| `fetchPlayerDetails` | `PlayerDetailsResult` | Player rows with failed team names and squad scope                                                                                                                            |
| `fetchAwards`        | `AwardResult`         | Award rows with failed coaches rounds                                                                                                                                         |

As of v3 the package root exports only this supported surface. Raw AFL
API / Squiggle wire schemas (Zod) moved to the `fitzroy/schemas` subpath
export, so upstream drift no longer forces a major release.

The package also exports `resolveDefaultSeasonForCompetition(competition)`
in v3.2 and later. This asynchronous function selects the current or most
recent season from the AFL round schedule. Version 3.4 adds the pure
`roundLabel()`, `roundAbbreviation()`, and `roundTypeLabel()` helpers. They
derive R-fitzRoy-style round labels from `Match` fields.

Version 4 makes incomplete results machine-readable. Player details return
`{ players, failedTeams, scope }`, while awards return
`{ awards, failedRounds }`. Season coaches requests retain successful rounds.
Team statistics accept `competition` and use `gamesPlayed: number | null`.

### Common Parameters

All fetch functions accept a query object with these common parameters:

| Parameter     | Type              | Values or Purpose                                                                         |
| ------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `source`      | `DataSource`      | `"afl-api"`, `"footywire"`, `"afl-tables"`, `"squiggle"`, `"fryzigg"`, or `"afl-coaches"` |
| `season`      | `number`          | Season year, such as 2026                                                                 |
| `round`       | `number`          | Optional round number                                                                     |
| `competition` | `CompetitionCode` | Optional `"AFLM"`, `"AFLW"`, `"VFL"`, or `"VFLW"`                                         |
| `team`        | `string`          | Optional team name with fuzzy matching                                                    |

### Data Sources

| Source        | Coverage                                    | Best for                                        |
| ------------- | ------------------------------------------- | ----------------------------------------------- |
| `afl-api`     | AFLM 2012+, AFLW 2017+, VFL/VFLW 2021+      | Live scores, official data, multi-competition   |
| `footywire`   | AFLM 2010-present                           | SuperCoach scores, advanced stats               |
| `afl-tables`  | AFLM 1897-present (player/team stats 1965+) | Historical records                              |
| `squiggle`    | AFLM 2012-present                           | Prediction data, third-party analysis           |
| `fryzigg`     | AFLM 2012-2025, AFLW 2017-2022              | Advanced player statistics (RDS format)         |
| `afl-coaches` | AFLM 2006+, AFLW 2018+                      | AFLCA Champion Player votes (via `fetchAwards`) |

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

Successful results can still be incomplete. Check `failedMatchIds`,
`failedTeams`, or `failedRounds` before publishing derived data. Check squad
`scope` before treating a scraped player list as season-specific.

### Cloudflare Workers Compatibility

As of fitzroy 2.3.0, HTML scrapers use `parse5` + `cheerio/slim`, so the
library entry no longer pulls in `node:stream`. A Worker can import fitzroy
without the `nodejs_compat` compatibility flag.

## D1 Database Schema

The `afl-stats` database has 13 tables and five integrity views. It covers AFL
Men's, AFL Women's, VFL, and VFLW. Always filter queries by competition.
Join `seasons` to `competitions`, then use `WHERE c.code = ?`. Without
the filter, results silently mix competitions. Teams with the same name in
different competitions have distinct `team_id` values.

### Core Tables

The following tables contain match, weather, prediction, player, and lineup data.

#### `matches`

Each row contains one match. Identity columns include `season_id`,
`round_number`, `round_type`, `date`, `local_time`, and the venue and team IDs.

The nullable `kickoff_at` column records the canonical UTC source instant.
Unknown kickoff times remain null. Prediction deadlines use this column.
Never combine `date` and Melbourne `local_time` to reconstruct a deadline.
The nullable `lineups_observed_at` column records the last validated lineup
snapshot observation.

The `round` column contains a long label such as `Round 1` or `Grand Final`.
The `round_abbreviation` column contains AFL short codes from `OR` through
`GF`. Pre-2020 AFLM data can also use `EF` and `QF`. Finals round names
without a mapped short form fall back to `F<round_number>`, such as `F25` for
the AFLM 2026 `Wildcard Finals`.

The score columns include
points, margins, attendance, and each quarter's goals and behinds. The `status`
column records the match lifecycle and release 3.7.0 backfilled it for every
historical row. The 38 score-less VFL/VFLW 2021 COVID-era matches read
`Cancelled`. The `live_period_status` column stores the
raw AFL API status for siren detection without inference from null scores.

Release 3.4.0 added nullable `completed_quarter`. The value from 0 through 4 is
the highest completed quarter. Use it together with `status`. AFL-MCP's
five-minute sync does not provide real-time match data. `local_time` is Melbourne
time for every competition, including interstate matches.

Venue-native time is not stored. Release 3.7.0 dropped the legacy
`weather_temp_c` and `weather_type` columns (a frozen fryzigg record, AFLM
2010 through 2025, daily maxima). Use `match_weather` for all weather data.

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

Each row contains one current match prediction from Tipper. The primary key
is `match_id`. The Worker replaces eligible rows through a native D1 binding.
The `home_win_prob` and one-decimal `predicted_margin` columns use the home
team's perspective. `model_version` records the complete model identity, and
`generated_at` records publication time. FootyBot and AFL-MCP retain these
existing field meanings.

The nullable `tipper_run_id` links new predictions to their retained capture.
Older rows can have no capture link. A new deployment does not hide predictions
issued by earlier model revisions.

Each match can refresh strictly before its recorded kickoff while it remains
upcoming. A changed schedule cannot reopen a match after its previous deadline.
Fixture identity, venue, or kickoff corrections invalidate current rows while
preserving historical captures. Use `LEFT JOIN` and treat absence as unpublished.

#### Tipper Publication Records

AFL-MCP owns migrations for the shared schema, including these Tipper tables.

| Table                | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `tipper_runs`        | Ordered publication attempts and committed coverage.    |
| `tipper_predictions` | Append-only prediction captures for each run and match. |
| `tipper_game_ids`    | Validated local-to-Squiggle match identities.           |
| `tipper_reports`     | Weekly scoring attempts, observations, and results.     |
| `tipper_status`      | Activation timestamp and scheduler/reporting heartbeat. |

Captures retain fixture identity, UTC kickoff, consumed lineups, and rating
inputs. They also retain full-precision and issued predictions, provisional
status, model revision, and observation/publication timestamps. A capture records
the evidence consumed for an issued prediction, not a complete database snapshot.
The existing Task 41 archive remains separate. Historical or reconstructed rows
are not prospective captures.

#### Historical Prediction Backfills

`match_predictions` contains the 2026 historical backfill alongside real-time
tips. The backfill covers 213 completed AFLM and 31 completed AFLW matches,
using Elo and PAV rebuilt from eligible earlier matches and source matchday
lineups. FootyBot and AFL-MCP read both through the same table.

The `tipping_performance` schema recipe reports completed-match coverage,
correct winners, draws, accuracy excluding draws, and margin MAE.
Backfilled rows retain their actual generation timestamp and have no publication
run link. Migration `0023` removes the temporary reconstruction tables after
consolidating their predictions. Detailed replay evidence remains archived
locally.

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
`is_substitute` columns are flags. Coverage starts with AFLM 2015. AFLW, VFL,
and VFLW coverage starts in 2023: the AFL API does not publish announced
teams for earlier seasons in those competitions.

AFL-MCP replaces each validated current snapshot atomically and removes omitted
players. Invalid or incomplete source responses preserve the last valid snapshot.
The match's `lineups_observed_at` records its observation time. Lineup refreshes
continue for unlocked matches after their round starts, including the final
90 minutes before kickoff.

### Coverage Contract

Release 3.4.0 extended the existing `schema` tool with a typed
`database.coverage_contract` (version 2). Static expectations identify source,
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
  Successful no-op ticks are not logged. The system removes rows after 90 days.
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
after each match and upgrades the provenance to ERA5 after six days. Each
query stage permits 25 fetches (up to 75 per pass across the forecast,
fast-observed, and final-observed stages) and records failures in
`sync_log`. A local script performed the initial historical weather backfill.

`POST /mcp/admin/backfill` exposes the backfill operation. Its parameters are
`competitions`, `fromYear`, `toYear`, `skipShouldRunNow`, and `skipPav`. A request
can cover no more than 30 years. `GET /mcp/health` reports staleness for
monitoring.
Release 3.4.0 also added the annual, dry-run-first
`POST /mcp/admin/backfill-brownlow` operation and aggregate-only
`GET /mcp/admin/status`. Both require the existing admin bearer token.

## Tipper: Production Prediction Worker

Tipper forecasts AFLM and AFLW results with one Elo/PAV model. The Worker uses
native D1 through three modules. Prediction rebuilds ratings and calculates tips.
Publication owns input capture, scheduling, deadlines, and atomic writes.
Competition evidence serves and scores recorded predictions.

The production identity is `elo-pav-normal-v1@<full-source-revision>`.
The build embeds the complete source revision. This identity distinguishes the
corrected normal probability calculation from earlier predictions. Model work
happens on branches and lands through reviewed pull requests. The preserved
research revision supports reproduction of the retired CLI and experiments.

Elo starts at 1500, uses K 25 and update home advantage 160, and regresses by
0.1 between seasons. The model retains the incumbent margin-of-victory multiplier.

PAV retains the HPN formulas, zone pool 100, previous-season prior weight 15,
and missing-player default 5. Elo has weight 0.6. PAV uses calibration slope 6.986.
Prediction home advantage is 80, margin multiplier is 0.07, and sigma is 36.

The model clamps standard-normal probabilities to 0.01 through 0.99.
The full-precision margin selects the winner. An exact zero selects home.

For each competition, Elo rebuilds completed matches chronologically, starting
in the 2020 season. PAV preserves cumulative league totals from completed seasons
since 2021.
The rebuild processes player statistics only for the target season and loads
only the immediately previous season's final player PAV as its prior.
Only `Complete` matches with valid final scores update ratings. Live scores,
target-match statistics, and future results cannot enter predictions.
An earlier completed match can inform later unlocked matches in its round.

Both teams need valid announced lineups before PAV contributes. Validation checks
unique players, team ownership, and non-emergency team size. The initial sizes
are 23 for AFLM and 21 for AFLW. Review published 2027 rules before launch.
Otherwise, both lineup contributions are zero and the capture is `provisional`.
Elo retains its 0.6 weight and prediction home advantage.

### Publication and Locks

The existing Worker runs every five minutes. Matches first become eligible
within seven days of kickoff. Predictions refresh daily outside 24 hours,
hourly inside 24 hours, and every five minutes inside 90 minutes.

Each match freezes at its own recorded kickoff. A reschedule can change that
deadline while the previous deadline remains future. Later schedule corrections
cannot reopen it. Missing locked predictions remain missed.

A publication allocates an ordered run before reading a consistent input batch.
It computes the complete currently eligible set for one round. One D1 transaction
appends captures, replaces current predictions, and checks finalisation.
Changed fixtures, elapsed deadlines, incomplete output, and stale overlapping
runs reject the entire batch. Previous committed tips survive rejection.
After an ambiguous response, the publisher reads the original run before retrying.

The guarantee is database admission before the recorded deadline. It cannot
ensure Squiggle has fetched a tip or detect changes not yet synced into D1.
Activation starts prospective coverage and health checks. Old research-era gaps
do not become operational failures.

### HTTP Operations

| Operation                 | Behaviour                                                           |
| ------------------------- | ------------------------------------------------------------------- |
| `GET /tips`               | Stored AFLM tips in the existing Squiggle payload format.           |
| `GET /health`             | Publication, input, and reporting diagnostics.                      |
| `GET /performance?year=Y` | Latest retained AFLM weekly report, coverage, and observation time. |
| `POST /admin/refresh`     | Authenticated publication for one competition, season, and round.   |

`/tips` accepts optional `year` and `round` parameters. Unknown rounds return 404.
Known rounds without a complete valid feed return 503. Responses retain CORS,
issued precision, and the recorded model identity. Download `/tips` to export
the published predictions.

Scheduled work resolves and stores canonical Squiggle identities. Feed requests
make no external fetches. Existing mappings survive upstream outages. Missing
or ambiguous mappings make the feed unavailable while prediction storage for
FootyBot continues. Squiggle delivery remains AFLM-only.

Manual refresh requires the `ADMIN_TOKEN` Worker secret as a bearer token.
The Worker uses the platform's timing-safe comparison. Its request accepts only
competition, season, and round. Manual refresh follows the same publication
locks and cannot change model parameters or historical observation times.

Health checks individual expected matches, capture links, fixture consistency,
freshness, and scheduler heartbeat. Reporting diagnostics expose stale reports
separately. Performance alerts do not fail the deployment health check.

### Retained Weekly Reports

After Monday 22:00 UTC, the Worker scores captures selected at each match's lock.
It preserves the issued winner, precision, and model identity. Reports retain
the result and field observations used for scoring. Failed collection retries
hourly, and the previous successful report remains available with staleness.

Reports include winner accuracy, draws, MAE, log loss, and Brier score.
They retain field ranking, the close-band diagnostic, and paired comparison
against Punters. Field comparisons identify their common match sets and report
missing predictions and field data. The absolute three-tip market-gap threshold
raises an alert after the Worker retains the evidence.

The weekly GitHub workflow checks the stored report and attaches an artefact.
It has no D1 credentials, runs no model, and makes no commits to main.

### Deployment and Recovery

Apply the additive AFL-MCP migrations before enabling the new publisher.
Refresh upcoming fixtures and lineups, configure `ADMIN_TOKEN`, and record
activation before deploying the pinned artefact through the existing GitOps
process. Verify both competitions, captures, feed identities, locked matches,
and the first retained report before launch.

Keep old artefacts and the additive schema for recovery. Once the publisher is
active, recovery must use a version that understands its locks and records.
Do not restore the legacy direct writer. Squiggle ingestion agreement and
end-to-end acceptance remain launch dependencies. Contact and submission
require separate authorization.

## footyBot: Discord Consumer

footyBot is a Discord bot that runs entirely on Cloudflare Workers and
consumes the rest of the ecosystem two ways:

- The `/ask <question>` command uses a manual MCP tool-use loop against
  `https://afl.jackemcpherson.com/mcp`. It routes the question through the
  configured LLM. `gemini-3-flash` (stable) is the default, called through
  the Cloudflare Workers AI binding via AI Gateway. `claude-sonnet-4-5` runs
  when `LLM_PROVIDER="anthropic"`.
  All LLM traffic is proxied through Cloudflare AI Gateway with
  Authenticated Gateway enabled so Unified Billing covers it. A `/help`
  command posts usage examples.
- One per-minute cron starts durable Cloudflare Workflows.
  - One Live Match-Day Workflow polls the competitions in the day's fixture
    with round-scoped fetches. It posts QT, HT, 3QT, and FT scoreboards in
    channel order. Five consecutive failed polls raise an ops alert. The
    workflow then errors so the cron restarts it with a fresh engine context.
  - A single Round Publication Workflow, parameterised by purpose (preview
    or review), runs as two daily instances that retry within their
    Melbourne-time publication windows.

Each Round Publication contains exactly two messages. An authoritative factual
post comes first, followed by an AI-written editorial post.

FootyBot prepares and validates both before delivery. It records success only
after Discord confirms both.

Editorial rules:

- Model output cites supplied facts and may omit insignificant matches.
- Optional evidence never blocks a Review.
- Lineups never block a Preview.

All proactive posts use stable Discord delivery identifiers. A Workflow checks
recent channel history before and after sending, so a lost HTTP response does
not create a duplicate. Workflow state owns in-progress delivery. KV retains
the shared fixture cache, `/ask` quotas, cron heartbeat, and final Round
Publication markers.

State lives in a single `STATE` KV namespace. Hono handles the Discord
interaction webhook.

A queue consumer runs the tool-use loop. This lets Discord acknowledge the
interaction within three seconds.

Cron runs update the daily liveness marker. It distinguishes a stopped cron
from a run with no post.

An offline evaluation suite (`bun run eval`) tests `/ask` answer quality for
regressions.

## AFL Domain Essentials

The following sections describe the four supported competitions.

### AFLM Season

AFL Men's (AFLM) has 18 teams. Its season runs from March to September.

Each season has 23 home-and-away rounds and a Finals series.

### AFLM Opening Round

The Opening Round precedes Round 1.

From 2024 onward, AFL-MCP stores zero in its round number field.

### AFLM Finals Labels

Seasons before 2020 used `Qualifying` and `Elimination` Final. Seasons from 2020
use `Finals Week 1`.

### AFL Women's

AFL Women's (AFLW) has 18 teams. Its season runs from August to November.

### VFL

VFL is a second-tier men's competition with AFLM-affiliated reserves and
standalone clubs. Examples include Carlton, Collingwood, Box Hill Hawks, Casey
Demons, and Werribee Tigers.

The competition includes a `Wildcard` round before finals.

### VFLW

VFLW is a Victorian women's second-tier competition with AFLW affiliates and
standalone clubs such as Darebin.

Goals score 6 points, behinds score 1. Total = goals × 6 + behinds.

AFL-MCP stores `matches.local_time` in Melbourne local time for every
competition: AEST (UTC+10) during winter and AEDT (UTC+11) during daylight
saving (October to April). It intentionally discards venue-native time and adds
no venue-time columns. Fitzroy's public `Match` type still exposes
the upstream `venueLocalDate`. AFL-MCP does not persist that field.

Use nullable `matches.kickoff_at` for the canonical UTC instant. Unknown source
times remain unavailable. Local display fields cannot establish deadlines.

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
