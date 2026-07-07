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
import { normalizeName, groupLetterFromApi, openPlayGoals } from './src/score.js';
import { buildTeamRatings, goldenBootProbs } from './src/ratings.js';
import { runForecast } from './src/forecast.js';
import { KO_BRACKET_ORDER } from './src/bracket.js';

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

  // ── knockout results already played → lock them into every simulation ────────
  // (winner advances, loser is out); keyed by team pair so simulateBracket applies them.
  const KO_STAGES = new Set(['ROUND_OF_32', 'LAST_32', 'ROUND_OF_16', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', '3RD_PLACE', 'FINAL']);
  const knownKO = new Map();
  for (const m of mr.matches || []) {
    if (!KO_STAGES.has(m.stage)) continue;
    if (!(m.status === 'FINISHED' || m.status === 'AWARDED')) continue;
    const h = canonical(m.homeTeam?.name), a = canonical(m.awayTeam?.name);
    if (!h || !a) continue;
    const og = openPlayGoals(m.score); // goals for the sim: open play only (exclude the shootout)
    const ft = m.score?.fullTime || {};
    const w = m.score?.winner;
    const pen = m.score?.penalties;
    // A shootout decides only if it isn't level; else fall back to the full-time (shootout-inclusive) score.
    const penSide = pen && pen.home != null && pen.away != null && pen.home !== pen.away ? (pen.home > pen.away ? 'HOME' : 'AWAY') : null;
    const ftSide = (ft.home ?? 0) > (ft.away ?? 0) ? 'HOME' : (ft.away ?? 0) > (ft.home ?? 0) ? 'AWAY' : null;
    const wonSide = w === 'HOME_TEAM' ? 'HOME' : w === 'AWAY_TEAM' ? 'AWAY' : penSide ?? ftSide;
    if (!wonSide) continue; // winner not resolvable yet — leave it to the simulation
    const key = h < a ? `${h} | ${a}` : `${a} | ${h}`;
    knownKO.set(key, { goals: { [h]: og.home ?? 0, [a]: og.away ?? 0 }, winner: wonSide === 'HOME' ? h : a });
  }
  if (knownKO.size) console.log(`🔒  ${knownKO.size} knockout result(s) locked in.`);

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

  // Per-striker inputs; runForecast turns these into points each sim, scaling goals by how
  // many matches the striker's team actually plays in that run (0 once the team is eliminated).
  const GOALS_PER_MATCH = 0.55; // a designated top scorer's ~goals per game
  const scorers = {};
  for (const p of PLAYERS) {
    const sp = SPECIAL_PICKS[p.id];
    if (!sp?.topScorer) continue;
    const k = normalizeName(sp.topScorer);
    const mult = tsCounts[k] === 1 && !k.includes('mbappe') && !k.includes('kane') ? 1.5 : 1;
    scorers[p.id] = {
      team: scorerTeamByKey.get(k) || '',
      currentGoals: scorersIndex[k] ?? 0,
      gpm: GOALS_PER_MATCH,
      mult,
      goldenBootPts: (goldenProbs.get(k) ?? 0) * 2,
    };
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

  // Real knockout draw: confirm the hardcoded bracket still equals the 32 actual advancers
  // (top 2 per group + 8 best thirds); if not, fall back to the rating reseed.
  const realAdvancers = (() => {
    const top2 = [], thirds = [];
    for (const s of sr.standings || []) {
      if (s.type && s.type !== 'TOTAL') continue;
      for (const row of s.table || []) {
        const nm = canonical(row.team?.name);
        if (row.position <= 2) top2.push(nm);
        else if (row.position === 3) thirds.push({ nm, p: row.points ?? 0, gd: row.goalDifference ?? 0, gf: row.goalsFor ?? 0 });
      }
    }
    thirds.sort((a, b) => b.p - a.p || b.gd - a.gd || b.gf - a.gf);
    return new Set([...top2, ...thirds.slice(0, 8).map((t) => t.nm)]);
  })();
  const bracketOk = KO_BRACKET_ORDER.length === 32 && new Set(KO_BRACKET_ORDER).size === 32
    && realAdvancers.size === 32 && KO_BRACKET_ORDER.every((n) => realAdvancers.has(n));
  console.log(bracketOk
    ? '🪜  Using the real knockout bracket (src/bracket.js).'
    : '⚠️  src/bracket.js ≠ the 32 actual advancers — using rating-seeded bracket; update KO_BRACKET_ORDER.');

  const forecast = runForecast({ groups, ratingOf: R.ratingOf, current, remainingGroupFixtures, players: fcPlayers, scorers, sims: SIMS, bracketOrder: bracketOk ? KO_BRACKET_ORDER : null, knownKO });

  // ── report ───────────────────────────────────────────────────────────────────
  const board = PLAYERS.map((p) => ({ Player: p.name, 'Win %': forecast[p.id].winProb, 'Proj. pts': forecast[p.id].projectedTotal, ScorerPts: forecast[p.id].scorerPoints }))
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
