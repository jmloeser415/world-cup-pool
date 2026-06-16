// `npm run forecast`            -> compute the Monte Carlo forecast, PUT it to /forecast
// `npm run forecast -- --dry-run` -> print the forecast, write nothing
//
// Kept separate from update.mjs so the (proven) score push stays untouched.
// Pushing requires the edge function to expose /forecast (see the Make prompt);
// until then, a live PUT warns instead of failing.
import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { PLAYERS, TEAMS, SPECIAL_PICKS } from './src/data.js';
import { getMatches, getStandings, getScorers } from './src/footballData.js';
import { normalizeName, groupLetterFromApi } from './src/score.js';
import { buildTeamRatings, goldenBootProbs } from './src/ratings.js';
import { runForecast } from './src/forecast.js';

const DRY_RUN = process.argv.includes('--dry-run');
const SIMS = 20000;
const ODDS_PATH = new URL('./src/odds-data.json', import.meta.url);

// name -> our team id (name + aliases); and canonicalization to our display names
const idx = new Map(), idToName = new Map();
for (const t of TEAMS) {
  idToName.set(t.id, t.name);
  idx.set(normalizeName(t.name), t.id);
  for (const a of t.aliases || []) idx.set(normalizeName(a), t.id);
}
const canonical = (name) => { const id = name ? idx.get(normalizeName(name)) : null; return id ? idToName.get(id) : name; };

async function main() {
  if (!existsSync(ODDS_PATH)) throw new Error('src/odds-data.json missing — run the odds/ratings gatherer first.');
  const odds = JSON.parse(readFileSync(ODDS_PATH, 'utf8'));

  const [mr, sr] = await Promise.all([getMatches(), getStandings()]);
  let scorersRes = { scorers: [] };
  try { scorersRes = await getScorers(); } catch { /* fine — scorer EV degrades to odds only */ }

  // ── strengths (FIFA + odds), canonicalized to our names ──────────────────────
  const R = buildTeamRatings(
    odds.fifaRankings.map((r) => ({ ...r, team: canonical(r.team) })),
    odds.outrightOdds.map((o) => ({ ...o, team: canonical(o.team) })),
  );
  const goldenProbs = goldenBootProbs(odds.goldenBootOdds);
  const scorerTeamByKey = new Map(odds.goldenBootOdds.map((g) => [normalizeName(g.player), canonical(g.team)]));

  // ── groups from standings ────────────────────────────────────────────────────
  const groups = {};
  for (const s of sr.standings || []) {
    if (s.type && s.type !== 'TOTAL') continue;
    const L = groupLetterFromApi(s.group);
    if (!L) continue;
    groups[L] = (s.table || []).map((row) => canonical(row.team?.name)).filter(Boolean);
  }

  // ── current group state + remaining fixtures from matches ────────────────────
  const current = new Map();
  const ensure = (n) => { if (!current.has(n)) current.set(n, { groupGamePts: 0, gf: 0, ga: 0, cleanSheets: 0 }); return current.get(n); };
  const remainingGroupFixtures = [];
  for (const m of mr.matches || []) {
    if (m.stage !== 'GROUP_STAGE') continue;
    const h = canonical(m.homeTeam?.name), a = canonical(m.awayTeam?.name);
    if (!h || !a) continue;
    const finished = m.status === 'FINISHED' || m.status === 'AWARDED';
    if (!finished) { remainingGroupFixtures.push([h, a]); continue; }
    const hg = m.score?.fullTime?.home ?? 0, ag = m.score?.fullTime?.away ?? 0;
    const H = ensure(h), A = ensure(a);
    H.gf += hg; H.ga += ag; A.gf += ag; A.ga += hg;
    if (ag === 0) H.cleanSheets += 1;
    if (hg === 0) A.cleanSheets += 1;
    if (hg > ag) H.groupGamePts += 3; else if (ag > hg) A.groupGamePts += 3; else { H.groupGamePts += 1; A.groupGamePts += 1; }
  }

  // ── players (forecast view) + scorer expected-value ──────────────────────────
  const scorersIndex = {};
  for (const sc of scorersRes.scorers || []) scorersIndex[normalizeName(sc.player?.name)] = sc.goals ?? 0;
  const tsCounts = {};
  for (const p of PLAYERS) { const ts = SPECIAL_PICKS[p.id]?.topScorer; if (ts) { const k = normalizeName(ts); tsCounts[k] = (tsCounts[k] || 0) + 1; } }

  const fcPlayers = PLAYERS.map((p) => ({
    id: p.id,
    teams: TEAMS.filter((t) => t.owner === p.id).map((t) => t.name),
    defenseTeam: SPECIAL_PICKS[p.id]?.topDefenseTeamId ? idToName.get(SPECIAL_PICKS[p.id].topDefenseTeamId) : null,
  }));

  const scorerEV = {};
  for (const p of PLAYERS) {
    const sp = SPECIAL_PICKS[p.id];
    if (!sp?.topScorer) { scorerEV[p.id] = 0; continue; }
    const k = normalizeName(sp.topScorer);
    const pGB = goldenProbs.get(k) ?? 0;
    const currentGoals = scorersIndex[k] ?? 0;
    const mult = tsCounts[k] === 1 && !k.includes('mbappe') && !k.includes('kane') ? 1.5 : 1;
    const tr = R.ratingOf(scorerTeamByKey.get(k) || '');
    const pct = Math.max(0, Math.min(1, (tr - 1500) / 450));
    const expRemainingGoals = 0.55 * (1.5 + pct * 4.5); // ~0.55 goals × expected remaining matches
    scorerEV[p.id] = (currentGoals + expRemainingGoals) * mult + pGB * 2;
  }

  // ── validate then run ────────────────────────────────────────────────────────
  const groupCount = Object.keys(groups).length;
  const advancers = Object.values(groups).reduce((n, g) => n + Math.min(2, g.length), 0) + 8;
  const teamNames = [...new Set(Object.values(groups).flat())];
  const defaulted = teamNames.filter((n) => R.ratingOf(n) === R.defaultRating);
  if (groupCount !== 12 || advancers !== 32) {
    console.warn(`⚠️  Expected 12 groups / 32 advancers, got ${groupCount} groups / ${advancers}. Standings may be incomplete — forecast skipped.`);
    return;
  }
  if (defaulted.length) console.warn(`⚠️  ${defaulted.length} team(s) using default rating (name mismatch w/ odds data): ${defaulted.join(', ')}`);

  const forecast = runForecast({ groups, ratingOf: R.ratingOf, current, remainingGroupFixtures, players: fcPlayers, scorerEV, sims: SIMS });

  // ── report ───────────────────────────────────────────────────────────────────
  const board = PLAYERS.map((p) => ({ Player: p.name, 'Win %': forecast[p.id].winProb, 'Proj. pts': forecast[p.id].projectedTotal, ScorerEV: +scorerEV[p.id].toFixed(1) }))
    .sort((a, b) => b['Win %'] - a['Win %']);
  console.log(`\n🔮  Forecast (${SIMS.toLocaleString()} sims) · ${remainingGroupFixtures.length} group games left`);
  console.table(board);

  if (DRY_RUN) { console.log('\n--- DRY RUN: payload that WOULD be PUT to /forecast ---'); console.log(JSON.stringify({ forecast }, null, 2)); return; }

  const base = process.env.STATS_PUSH_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) throw new Error('STATS_PUSH_URL / SUPABASE_ANON_KEY not set (see .env)');
  const res = await fetch(base.replace(/\/$/, '') + '/forecast', {
    method: 'PUT', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ forecast }),
  });
  if (res.ok) console.log(`\n✅  Pushed forecast to /forecast (${res.status}).\n`);
  else console.warn(`\n⚠️  PUT /forecast -> ${res.status}. Add the /forecast route in Make (see prompt), then re-run.\n`);
}

main().catch((e) => { console.error('\n❌  Forecast failed:', e.message); process.exit(1); });
