# Figma Make brief — World Cup Pool scoreboard

The frontend is **read-only**. It connects to Supabase with the **anon public** key
and reads three tables that `update.mjs` keeps current. Never put the service-role
key in Figma Make.

## Connection
- Supabase URL: *(your Project URL)*
- Supabase anon key: *(your anon public key — Project Settings → API)*
- Use the `@supabase/supabase-js` client, or plain `fetch` against the auto REST API.

## Data contract (what to read)

**`player_scores`** — one row per player; this is the scoreboard.
| column | type | meaning |
|---|---|---|
| `player_name` | text | display name |
| `rank` | int | 1 = leader (already computed) |
| `group_points` / `knockout_points` / `top_scorer_points` / `top_defense_points` | number | breakdown |
| `total_points` | number | sort key |
| `goal_diff` | int | tiebreaker (aggregate GD across their 4 teams) |
| `top_scorer_name` / `top_defense_team` | text | null until DM picks are entered → show "—" |

**`team_scores`** — one row per drafted team (32); powers the Teams tab.
| column | meaning |
|---|---|
| `team_name`, `group_letter`, `owner_name` | who owns it, which group |
| `group_points`, `knockout_points`, `total_points` | points from this team |
| `matches_played`, `goals_for`, `goals_against`, `goal_diff`, `clean_sheets` | stats |
| `group_rank` | 1–4 within group (null pre-results) |
| `status` | "Not started" / "In progress" / "Out: Round of 16" / "Champion 🏆" |

**`sync_meta`** — single row (`id = 1`): `last_updated` (timestamp), `status`, `matches_finished`. Show "Last updated …" somewhere.

## Screens

**Tab 1 — Scoreboard** (default)
- Table sorted by `rank` (ascending). Columns: Rank, Player, Group, Knockout, Top Scorer, Top Defense, **Total**, GD.
- Emphasize the Total column; subtle bars/heatmap on the breakdown columns is a nice touch (the 2022 version used green→red shading).
- Header shows "Last updated {sync_meta.last_updated}".

**Tab 2 — Teams**
- One card per player (8 cards), ordered by `player_scores.rank`. Card header: player name + total points.
- Inside each card: their 4 teams from `team_scores` (`owner_name` = player), each row showing team name, group, this-team points, and `status`. Show the player's `top_scorer_name` / `top_defense_team` (or "— (pending)").

## Queries (supabase-js)
```js
const { data: scoreboard } = await supabase
  .from('player_scores').select('*').order('rank', { ascending: true });

const { data: teams } = await supabase
  .from('team_scores').select('*').order('owner_name').order('total_points', { ascending: false });

const { data: meta } = await supabase
  .from('sync_meta').select('*').eq('id', 1).single();
```

## Paste-ready prompt for Figma Make
> Build a World Cup pool scoreboard web app with two tabs: **Scoreboard** and **Teams**.
> Connect to my Supabase project (I'll provide the URL and anon key) and read three
> read-only tables: `player_scores`, `team_scores`, and `sync_meta`.
>
> **Scoreboard tab:** a ranked table of `player_scores` ordered by `rank` ascending.
> Columns: Rank, Player (`player_name`), Group (`group_points`), Knockout
> (`knockout_points`), Top Scorer (`top_scorer_points`), Top Defense
> (`top_defense_points`), Total (`total_points`, bold/emphasized), GD (`goal_diff`).
> Apply a subtle green→red heatmap to the four breakdown columns. Show
> "Last updated {sync_meta.last_updated}" in the header. Add a refresh button that
> re-queries Supabase.
>
> **Teams tab:** 8 player cards ordered to match the scoreboard rank. Each card shows
> the player's name and total points, then their 4 teams from `team_scores` (filter by
> `owner_name`), each row showing `team_name`, `group_letter`, this team's
> `total_points`, and `status`. Also show the player's `top_scorer_name` and
> `top_defense_team` (display "— pending" when null).
>
> Clean, sporty, mobile-friendly. Numbers update whenever the data in Supabase
> changes; never write to the database.
```

When the data is live you can also enable Supabase **Realtime** on these tables so the
UI updates the instant `npm run update` writes — but a refresh button is enough for V1.
