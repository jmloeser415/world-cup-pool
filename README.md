# World Cup 2026 Pool — Scoreboard & Forecast

Live scoreboard + Monte Carlo forecast for an 8-person World Cup pool. A small local
script pulls results from football-data.org, computes scores and a forecast by the pool
rules, and pushes them to the website's backend. The frontend (built in Figma Make) just
reads and renders.

```
football-data.org ──► update.mjs / forecast.mjs (this repo) ──► Supabase edge fn ──► Figma Make site
   (live results)         fetch → compute → PUT                  (/stats, /forecast)    (polls every 30s)
```

## Commands

| command | what it does |
|---|---|
| `npm run refresh` | **the one to use** — runs `update` then `forecast` |
| `npm run update` | fetch results → compute team stats → `PUT /stats` |
| `npm run forecast` | run the Monte Carlo → `PUT /forecast` |
| `npm test` | offline scoring + forecast self-tests |

Add `-- --dry-run` to `update` or `forecast` to print the payload and write nothing.
Run `npm run refresh` whenever you want fresh numbers (after a game or a day's slate).

## Setup (~5 min)

1. `cp .env.example .env` and fill in:
   - `FOOTBALL_DATA_API_KEY` — free token from <https://www.football-data.org/client/register>
   - `STATS_PUSH_URL` — the edge-function base URL (pre-filled)
   - `SUPABASE_ANON_KEY` — the site's public anon key (pre-filled; safe — RLS-protected)
2. `npm install`
3. `npm test`, then `npm run refresh`

`.env` is gitignored — never commit it.

## How it fits together

The frontend's backend is a Supabase edge function (created by Figma Make) that stores a
few JSON blobs and exposes:

- `GET /stats` → `{ statsMap, forecast, updatedAt }` — the site reads this every 30s
- `PUT /stats`, `PUT /stats/team/:name` — set team stats (used by `update.mjs`)
- `PUT /forecast` — set the forecast (used by `forecast.mjs`)

### Data contracts

`statsMap[teamName]` — one per drafted team:
`{ game1, game2, game3, finish, knockoutWins, wonTitle, won3rd, goalsFor, goalsAgainst }`.
The frontend turns these into points (group games 3/1/0, finish bonus 2/1, knockout
3/3/4/5/6, 3rd-place +3) plus the GD tiebreaker.

`forecast[playerId]`:
`{ winProb, projectedTotal, teamTotal, scorerPoints, defensePoints, teams: { name: pts } }`.

## Scoring rules (encoded in `src/score.js`, unit-tested)

- **Group:** 3 win / 1 draw / 0 loss per game, + 2 for winning the group, + 1 for 2nd.
- **Knockout:** R32 3, R16 3, QF 4, SF 5, Final 6; 3rd-place game 3.
- **Top scorer:** 1 per goal, ×1.5 if a unique pick (excl. Mbappé/Kane), + 2 for the Golden Boot.
- **Top defense:** 1 per clean sheet.
- **Tiebreaker:** aggregate goal differential across your 4 teams.

## How the forecast works (`src/forecast.js`)

20,000 Monte Carlo simulations from the current results. Team strength blends FIFA
ranking + market title odds (`src/odds-data.json`). Each sim plays the remaining group
games + the knockout bracket (penalties for draws), then scores everyone by the rules.
Win % = share of sims won; projected points = average final total. Top-scorer points use
Golden Boot odds.

## During the tournament — watch the console for

- **Round of 32 (from June 28):** the feed's label for the new round is unconfirmed; a
  warning fires on any unrecognized knockout stage. Send me the exact stage string — it's
  a one-line fix in `src/score.js` / `src/buildStatsMap.js`.
- **Unmatched teams:** if a drafted team never matches the feed, `update.mjs` warns — add
  the feed's spelling to that team's `aliases` in `src/data.js`.
- **Odds drift:** `src/odds-data.json` is a snapshot; re-gather it every few days.

## Editing

- The draft + special picks live in `src/data.js`.
- Rankings/odds live in `src/odds-data.json`.

## Files

| file | role |
|---|---|
| `src/data.js` | the draft: players, teams, groups, special picks |
| `src/score.js` | scoring rules + helpers (unit-tested) |
| `src/buildStatsMap.js` | builds the `statsMap` payload from API results |
| `update.mjs` | push scores to `/stats` |
| `src/ratings.js` | FIFA + odds → team strength |
| `src/forecast.js` | Monte Carlo engine |
| `src/odds-data.json` | rankings + odds snapshot |
| `forecast.mjs` | push forecast to `/forecast` |
| `test.mjs` | offline self-tests (`npm test`) |
