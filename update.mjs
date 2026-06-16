// `npm run update`            -> fetch results, build statsMap, PUT to the Make /stats endpoint
// `npm run update -- --dry-run` -> print the payload + a sanity leaderboard, write nothing
//
// This pushes TEAM stats (group + knockout + title/3rd + goals) — everything the
// website needs except the ⭐ scorer / 🛡️ defense categories, which aren't in the
// /stats contract yet (phase 2). Before June 11 there are no results, so it pushes zeros.
import 'dotenv/config';
import { PLAYERS, TEAMS } from './src/data.js';
import { getMatches, getStandings } from './src/footballData.js';
import { normalizeName, groupLetterFromApi } from './src/score.js';
import { buildStatsMap } from './src/buildStatsMap.js';
import { buildSchedule } from './src/buildSchedule.js';

const DRY_RUN = process.argv.includes('--dry-run');

// API team -> our team id (by name, then aliases)
const idx = new Map();
for (const t of TEAMS) {
  idx.set(normalizeName(t.name), t.id);
  for (const a of t.aliases || []) idx.set(normalizeName(a), t.id);
}
const idOf = (x) => (x ? idx.get(normalizeName(x.name)) ?? idx.get(normalizeName(x.shortName)) ?? null : null);
const idToName = new Map(TEAMS.map((t) => [t.id, t.name]));
const canonical = (name) => { const id = name ? idx.get(normalizeName(name)) : null; return id ? idToName.get(id) : name; };

// Mirror of the Make frontend's (corrected) team scoring, for a local sanity check.
const KO = [3, 3, 4, 5, 6]; // R32, R16, QF, SF, Final
const finishBonus = (f) => (f === 'first' ? 2 : f === 'second' ? 1 : 0);
const knockoutPts = (w) => KO.slice(0, Math.min(w, 5)).reduce((a, b) => a + b, 0);
const teamPts = (s) =>
  (s.game1 ?? 0) + (s.game2 ?? 0) + (s.game3 ?? 0) + finishBonus(s.finish) + knockoutPts(s.knockoutWins) + (s.won3rd ? 3 : 0);

async function main() {
  const [mr, sr] = await Promise.all([getMatches(), getStandings()]);
  const apiMatches = mr.matches || [];

  const matches = apiMatches.map((m) => {
    const ft = m.score?.fullTime || {};
    const w = m.score?.winner;
    const pen = m.score?.penalties;
    const penWinnerSide = pen && pen.home != null && pen.away != null ? (pen.home > pen.away ? 'HOME' : 'AWAY') : null;
    return {
      id: m.id, stage: m.stage, group: m.group, date: m.utcDate, status: m.status,
      isFinished: m.status === 'FINISHED' || m.status === 'AWARDED',
      homeId: idOf(m.homeTeam), awayId: idOf(m.awayTeam),
      homeGoals: ft.home, awayGoals: ft.away,
      winnerSide: w === 'HOME_TEAM' ? 'HOME' : w === 'AWAY_TEAM' ? 'AWAY' : w === 'DRAW' ? 'DRAW' : null,
      penWinnerSide,
    };
  });

  const gc = {};
  for (const m of matches)
    if (m.stage === 'GROUP_STAGE' && m.isFinished) { const L = groupLetterFromApi(m.group); if (L) gc[L] = (gc[L] || 0) + 1; }
  const groupCompleteByLetter = {};
  for (const L of 'ABCDEFGHIJKL') groupCompleteByLetter[L] = (gc[L] || 0) >= 6;

  const standingsByTeam = {};
  for (const s of sr.standings || []) {
    if (s.type && s.type !== 'TOTAL') continue;
    const L = groupLetterFromApi(s.group);
    for (const row of s.table || []) { const tid = idOf(row.team); if (tid) standingsByTeam[tid] = { position: row.position, group: L }; }
  }

  const warnings = [];
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };
  const statsMap = buildStatsMap(TEAMS, matches, standingsByTeam, groupCompleteByLetter, warn);

  // diagnostics: any drafted team the feed never named?
  const seen = new Set();
  for (const m of matches) { if (m.homeId) seen.add(m.homeId); if (m.awayId) seen.add(m.awayId); }
  const missing = matches.length ? TEAMS.filter((t) => !seen.has(t.id)).map((t) => t.name) : [];
  if (missing.length) warn(`Unmatched drafted teams (add an alias in src/data.js): ${missing.join(', ')}`);

  // local sanity leaderboard (team points only — excludes scorer/defense)
  const board = PLAYERS.map((p) => {
    let tt = 0, gd = 0;
    for (const t of TEAMS.filter((x) => x.owner === p.id)) {
      const s = statsMap[t.name];
      if (s) { tt += teamPts(s); gd += s.goalsFor - s.goalsAgainst; }
    }
    return { Player: p.name, TeamPts: tt, GD: gd };
  }).sort((a, b) => b.TeamPts - a.TeamPts || b.GD - a.GD);

  const finished = matches.filter((m) => m.isFinished).length;
  console.log(`\n📊  ${finished} finished match(es) · statsMap built for ${Object.keys(statsMap).length} teams`);
  console.table(board);
  if (warnings.length) console.warn('⚠️  ' + warnings.join('\n⚠️  '));

  const schedule = buildSchedule(apiMatches, canonical);
  console.log(`🗓️  schedule: ${schedule.length} matches · ${schedule.filter((m) => m.status === 'FINISHED').length} finished`);

  // Mark eliminated teams for the UI: lost a knockout, or finished the group outside the drawn bracket.
  const koTeams = new Set();
  for (const m of schedule)
    if (m.stage !== 'GROUP_STAGE') {
      if (m.home.name && m.home.name !== 'TBD') koTeams.add(m.home.name);
      if (m.away.name && m.away.name !== 'TBD') koTeams.add(m.away.name);
    }
  const bracketDrawn = koTeams.size > 0;
  for (const [name, s] of Object.entries(statsMap)) {
    s.eliminated = !!s.lostKnockout || (bracketDrawn && !koTeams.has(name) && (s.gamesPlayed ?? 0) >= 3);
    delete s.lostKnockout;
  }

  if (DRY_RUN) {
    console.log('\n--- DRY RUN: would PUT /stats (statsMap) and /schedule (schedule) ---');
    console.log('statsMap sample:', JSON.stringify(statsMap.Mexico));
    console.log('schedule sample:', JSON.stringify(schedule.find((m) => m.status === 'FINISHED') || schedule[0], null, 2));
    console.log('\n(nothing written — drop --dry-run to push)\n');
    return;
  }

  const base = process.env.STATS_PUSH_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) throw new Error('STATS_PUSH_URL / SUPABASE_ANON_KEY not set (see .env)');
  const root = base.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  const res = await fetch(`${root}/stats`, { method: 'PUT', headers, body: JSON.stringify({ statsMap }) });
  if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error(`PUT /stats ${res.status}: ${b.slice(0, 300)}`); }
  console.log(`✅  Pushed statsMap to /stats (${res.status}).`);

  // best-effort: needs the /schedule route (see Make prompt). Won't fail the run.
  const sres = await fetch(`${root}/schedule`, { method: 'PUT', headers, body: JSON.stringify({ schedule }) }).catch(() => null);
  if (sres && sres.ok) console.log(`✅  Pushed schedule to /schedule (${sres.status}).\n`);
  else console.warn(`⚠️  PUT /schedule -> ${sres ? sres.status : 'no response'}. Add the /schedule route in Make, then re-run.\n`);
}

main().catch((e) => { console.error('\n❌  Update failed:', e.message); process.exit(1); });
