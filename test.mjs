// `npm test` — offline checks of the scoring engine. No network, no DB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreTeam, scorePlayer, rankPlayers } from './src/score.js';
import { buildStatsMap } from './src/buildStatsMap.js';
import { devig, buildTeamRatings } from './src/ratings.js';
import { scoreOutcome, eloWinProb, expectedGoals, runForecast } from './src/forecast.js';
import { buildSchedule } from './src/buildSchedule.js';

let passed = 0;
const check = (label, fn) => { fn(); passed++; console.log(`  ✓ ${label}`); };

const g = (stage, homeId, awayId, hg, ag, extra = {}) => ({
  stage, group: 'GROUP_I', isFinished: true, homeId, awayId, homeGoals: hg, awayGoals: ag,
  winnerSide: hg > ag ? 'HOME' : ag > hg ? 'AWAY' : 'DRAW', ...extra,
});

console.log('\nScoring engine self-test:\n');

// Your France example: 3 group wins (9) + winning the group (+2) = 11.
check('group: 3 wins + group winner = 11 pts', () => {
  const team = { id: 'fra', name: 'France', group: 'I', owner: 'igor' };
  const matches = [g('GROUP_STAGE', 'fra', 'x1', 2, 0), g('GROUP_STAGE', 'x2', 'fra', 0, 1), g('GROUP_STAGE', 'fra', 'x3', 3, 1)];
  const r = scoreTeam(team, matches, { fra: { position: 1, group: 'I' } }, { I: true });
  assert.equal(r.groupPoints, 11);
  assert.equal(r.cleanSheets, 2); // conceded 0 in matches 1 & 2
  assert.equal(r.goalDiff, 5);    // 6 for, 1 against
});

// No place bonus until the whole group is finished.
check('group: place bonus withheld until group complete', () => {
  const team = { id: 'fra', name: 'France', group: 'I', owner: 'igor' };
  const matches = [g('GROUP_STAGE', 'fra', 'x1', 2, 0)];
  const r = scoreTeam(team, matches, { fra: { position: 1, group: 'I' } }, { I: false });
  assert.equal(r.placeBonus, 0);
  assert.equal(r.groupPoints, 3);
});

// 2nd place = +1.
check('group: 2nd place bonus = +1', () => {
  const team = { id: 'esp', name: 'Spain', group: 'H', owner: 'avery' };
  const matches = [g('GROUP_STAGE', 'esp', 'x1', 1, 1)];
  const r = scoreTeam(team, matches, { esp: { position: 2, group: 'H' } }, { H: true });
  assert.equal(r.groupPoints, 2); // 1 (draw) + 1 (2nd)
});

// Full knockout run: R32 3 + R16 3 + QF 4 + SF 5 + Final 6 = 21, and champion.
check('knockout: win every round = 21 pts + champion', () => {
  const team = { id: 'win', name: 'Winner', group: 'A', owner: 'igor' };
  const ko = (stage) => ({ stage, isFinished: true, homeId: 'win', awayId: 'opp', homeGoals: 1, awayGoals: 0, winnerSide: 'HOME' });
  const matches = ['ROUND_OF_32', 'ROUND_OF_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'FINAL'].map(ko);
  const r = scoreTeam(team, matches, {}, {});
  assert.equal(r.knockoutPoints, 21);
  assert.equal(r.status, 'Champion 🏆');
});

// Advancing on penalties counts as a knockout win.
check('knockout: penalty-shootout win counts', () => {
  const team = { id: 'pk', name: 'Penalties', group: 'A', owner: 'igor' };
  const matches = [{ stage: 'QUARTER_FINALS', isFinished: true, homeId: 'pk', awayId: 'opp', homeGoals: 1, awayGoals: 1, winnerSide: 'DRAW', penWinnerSide: 'HOME' }];
  const r = scoreTeam(team, matches, {}, {});
  assert.equal(r.knockoutPoints, 4);
});

// Losing a knockout match marks the team out at that stage (not champion).
check('knockout: a loss = eliminated, no points', () => {
  const team = { id: 'lose', name: 'Loser', group: 'A', owner: 'igor' };
  const matches = [{ stage: 'SEMI_FINALS', isFinished: true, homeId: 'lose', awayId: 'opp', homeGoals: 0, awayGoals: 2, winnerSide: 'AWAY' }];
  const r = scoreTeam(team, matches, {}, {});
  assert.equal(r.knockoutPoints, 0);
  assert.equal(r.status, 'Out: Semi-final');
});

// Top scorer: 6 goals, unique pick, not Mbappé/Kane -> 6 * 1.5 = 9.
check('player: unique top scorer gets 1.5x', () => {
  const r = scorePlayer({ id: 'p' }, [{ groupPoints: 0, knockoutPoints: 0, goalDiff: 0 }],
    { topScorer: 'Some Striker' },
    { scorersIndex: { somestriker: 6 }, goldenBootKeys: [], tournamentComplete: false, topScorerPickCounts: { somestriker: 1 }, cleanSheetsByTeam: {} });
  assert.equal(r.topScorerPoints, 9);
});

// Mbappé is excluded from the 1.5x multiplier even if uniquely picked.
check('player: Mbappé excluded from 1.5x', () => {
  const r = scorePlayer({ id: 'p' }, [{ groupPoints: 0, knockoutPoints: 0, goalDiff: 0 }],
    { topScorer: 'Kylian Mbappé' },
    { scorersIndex: { kylianmbappe: 8 }, goldenBootKeys: [], tournamentComplete: false, topScorerPickCounts: { kylianmbappe: 1 }, cleanSheetsByTeam: {} });
  assert.equal(r.topScorerPoints, 8);
});

// Golden boot bonus (+2) applies at tournament end, then the multiplier.
check('player: golden boot +2 then x1.5', () => {
  const r = scorePlayer({ id: 'p' }, [{ groupPoints: 0, knockoutPoints: 0, goalDiff: 0 }],
    { topScorer: 'Some Striker' },
    { scorersIndex: { somestriker: 6 }, goldenBootKeys: ['somestriker'], tournamentComplete: true, topScorerPickCounts: { somestriker: 1 }, cleanSheetsByTeam: {} });
  assert.equal(r.topScorerPoints, 12); // (6 + 2) * 1.5
});

// Top defense: +1 per clean sheet of the picked team.
check('player: top defense = clean sheets', () => {
  const r = scorePlayer({ id: 'p' }, [{ groupPoints: 5, knockoutPoints: 0, goalDiff: 2 }],
    { topDefenseTeamId: 'brazil' },
    { scorersIndex: {}, goldenBootKeys: [], tournamentComplete: false, topScorerPickCounts: {}, cleanSheetsByTeam: { brazil: 4 } });
  assert.equal(r.topDefensePoints, 4);
  assert.equal(r.totalPoints, 9); // 5 group + 4 defense
});

// Tiebreaker: equal totals are ordered by goal differential.
check('ranking: ties broken by goal differential', () => {
  const ranked = rankPlayers([
    { playerId: 'a', totalPoints: 10, goalDiff: 2 },
    { playerId: 'b', totalPoints: 10, goalDiff: 5 },
    { playerId: 'c', totalPoints: 12, goalDiff: 0 },
  ]);
  assert.deepEqual(ranked.map((p) => p.playerId), ['c', 'b', 'a']);
  assert.equal(ranked[0].rank, 1);
});

// ── buildStatsMap: produces the exact shape the Make app reads ──────────────
const fm = (o) => ({ isFinished: true, group: 'GROUP_A', penWinnerSide: null, ...o });

check('buildStatsMap: group + knockout + 3rd place', () => {
  const matches = [
    fm({ id: 1, stage: 'GROUP_STAGE', date: '2026-06-11', homeId: 'x', awayId: 'y1', homeGoals: 2, awayGoals: 0, winnerSide: 'HOME' }),
    fm({ id: 2, stage: 'GROUP_STAGE', date: '2026-06-15', homeId: 'y2', awayId: 'x', homeGoals: 0, awayGoals: 1, winnerSide: 'AWAY' }),
    fm({ id: 3, stage: 'GROUP_STAGE', date: '2026-06-20', homeId: 'x', awayId: 'y3', homeGoals: 3, awayGoals: 1, winnerSide: 'HOME' }),
    fm({ id: 4, stage: 'ROUND_OF_32', date: '2026-06-29', homeId: 'x', awayId: 'z1', homeGoals: 1, awayGoals: 0, winnerSide: 'HOME' }),
    fm({ id: 5, stage: 'ROUND_OF_16', date: '2026-07-03', homeId: 'x', awayId: 'z2', homeGoals: 2, awayGoals: 1, winnerSide: 'HOME' }),
    fm({ id: 6, stage: 'QUARTER_FINALS', date: '2026-07-08', homeId: 'x', awayId: 'z3', homeGoals: 0, awayGoals: 0, winnerSide: 'DRAW', penWinnerSide: 'HOME' }),
    fm({ id: 7, stage: 'SEMI_FINALS', date: '2026-07-12', homeId: 'x', awayId: 'z4', homeGoals: 1, awayGoals: 2, winnerSide: 'AWAY' }),
    fm({ id: 8, stage: 'THIRD_PLACE', date: '2026-07-18', homeId: 'x', awayId: 'z5', homeGoals: 3, awayGoals: 0, winnerSide: 'HOME' }),
  ];
  const s = buildStatsMap([{ id: 'x', name: 'X', group: 'A', owner: 'igor' }], matches, { x: { position: 1, group: 'A' } }, { A: true })['X'];
  assert.deepEqual([s.game1, s.game2, s.game3], [3, 3, 3]);
  assert.equal(s.finish, 'first');
  assert.equal(s.knockoutWins, 3);   // R32, R16, QF (won on pens); SF lost
  assert.equal(s.wonTitle, false);
  assert.equal(s.won3rd, true);
  assert.equal(s.goalsFor, 13);      // group 6 + knockout 7
  assert.equal(s.goalsAgainst, 4);   // group 1 + knockout 3
  assert.equal(s.gamesPlayed, 8);    // 3 group + R32 + R16 + QF + SF + 3rd-place
  assert.equal(s.lostKnockout, false); // lost the SEMI (excepted) then WON the 3rd-place game -> not out
  assert.equal(s.groupEliminated, false); // finished 1st in group
  assert.equal(s.cleanSheets, 5);    // conceded 0 in g1, g2, R32, QF, 3rd-place
});

check('buildStatsMap: champion = knockoutWins 5, and fixed formula = 21', () => {
  const ko = (stage, id) => fm({ id, stage, date: String(id), homeId: 'c', awayId: 'o', homeGoals: 1, awayGoals: 0, winnerSide: 'HOME' });
  const matches = [ko('ROUND_OF_32', 11), ko('ROUND_OF_16', 12), ko('QUARTER_FINALS', 13), ko('SEMI_FINALS', 14), ko('FINAL', 15)];
  const s = buildStatsMap([{ id: 'c', name: 'C', group: 'A', owner: 'igor' }], matches, {}, {})['C'];
  assert.equal(s.knockoutWins, 5);
  assert.equal(s.wonTitle, true);
  assert.equal(s.gamesPlayed, 5);      // 5 knockout matches, no group games in this mock
  assert.equal(s.lostKnockout, false);
  const KO = [3, 3, 4, 5, 6];
  const koPoints = KO.slice(0, Math.min(s.knockoutWins, 5)).reduce((a, b) => a + b, 0);
  assert.equal(koPoints, 21); // 3+3+4+5+6 — the value the buggy `knockoutWins*3 + 5` got wrong (20)
});

check('elimination rules: 4th place out; KO losses out except the semifinal', () => {
  const T = (id) => ({ id, name: id, group: 'A', owner: 'igor' });
  // 4th in a finished group -> groupEliminated, with no knockout loss
  const g4 = buildStatsMap([T('g4')], [fm({ id: 1, stage: 'GROUP_STAGE', date: '1', homeId: 'g4', awayId: 'o', homeGoals: 0, awayGoals: 1, winnerSide: 'AWAY' })], { g4: { position: 4, group: 'A' } }, { A: true }).g4;
  assert.equal(g4.groupEliminated, true);
  assert.equal(g4.lostKnockout, false);
  // knockout-only teams (no group standings)
  const ko = (id, stage) => buildStatsMap([T(id)], [fm({ id: 9, stage, date: '1', homeId: id, awayId: 'o', homeGoals: 0, awayGoals: 1, winnerSide: 'AWAY' })], {}, {})[id];
  assert.equal(ko('a', 'ROUND_OF_16').lostKnockout, true);    // lost R16 -> out
  assert.equal(ko('b', 'QUARTER_FINALS').lostKnockout, true);  // lost QF -> out
  assert.equal(ko('c', 'SEMI_FINALS').lostKnockout, false);    // lost SEMI -> NOT out (plays 3rd-place game)
  assert.equal(ko('d', 'THIRD_PLACE').lostKnockout, true);     // lost 3rd-place game -> out
  assert.equal(ko('e', 'FINAL').lostKnockout, true);           // lost FINAL -> out (runner-up)
});

// ── ratings: FIFA + odds blend ──────────────────────────────────────────────
check('ratings: devig removes the margin (probabilities sum to 1)', () => {
  const m = devig([{ key: 'A', decimal: 1.5 }, { key: 'B', decimal: 2.5 }]);
  assert.ok(Math.abs([...m.values()].reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(m.get('a') > m.get('b')); // shorter price = higher implied prob
});

check('ratings: market favorite outrates an equal-FIFA rival', () => {
  const R = buildTeamRatings([{ team: 'A', points: 1800 }, { team: 'B', points: 1800 }], [{ team: 'A', decimal: 2 }, { team: 'B', decimal: 12 }]);
  assert.ok(R.ratingOf('A') > R.ratingOf('B'));
});

check('ratings: real data ranks Spain/Argentina/France near the top', () => {
  const d = JSON.parse(readFileSync('./src/odds-data.json', 'utf8'));
  const R = buildTeamRatings(d.fifaRankings, d.outrightOdds);
  const top6 = d.fifaRankings.map((t) => ({ t: t.team, r: R.ratingOf(t.team) })).sort((a, b) => b.r - a.r).slice(0, 6).map((x) => x.t);
  assert.ok(['Spain', 'Argentina', 'France'].every((t) => top6.includes(t)), 'top6=' + top6.join(','));
});

// ── forecast engine ─────────────────────────────────────────────────────────
check('forecast: eloWinProb + expectedGoals behave', () => {
  assert.equal(eloWinProb(1700, 1700), 0.5);
  assert.ok(eloWinProb(1900, 1500) > 0.9);
  const [strong, weak] = expectedGoals(1900, 1500);
  assert.ok(strong > weak);
});

check('forecast: scoreOutcome = teams + defense + scorerEV', () => {
  const outcome = new Map([
    ['X', { groupGamePts: 9, placeBonus: 2, knockoutPts: 21, gf: 12, ga: 3, cleanSheets: 4 }],
    ['Y', { groupGamePts: 3, placeBonus: 0, knockoutPts: 0, gf: 2, ga: 5, cleanSheets: 1 }],
    ['Z', { groupGamePts: 0, placeBonus: 0, knockoutPts: 0, gf: 1, ga: 1, cleanSheets: 6 }],
  ]);
  const r = scoreOutcome(outcome, [{ id: 'p', teams: ['X', 'Y'], defenseTeam: 'Z' }], { p: 5 });
  assert.equal(r.p.total, 46);     // (9+2+21) + (3) + Z.cleanSheets 6 + scorerEV 5
  assert.equal(r.p.teamTotal, 35); // (9+2+21) + 3
  assert.equal(r.p.defense, 6);    // Z clean sheets
  assert.equal(r.p.gd, 6);         // (12-3) + (2-5)
});

check('forecast: runForecast win probabilities sum to 100', () => {
  const groups = {};
  let idx = 0;
  for (const L of 'ABCDEFGHIJKL') groups[L] = [0, 1, 2, 3].map(() => `T${idx++}`);
  const ratingOf = (n) => 1500 + Number(n.slice(1)) * 9;
  const players = [
    { id: 'p1', teams: ['T0', 'T4', 'T8', 'T12'], defenseTeam: 'T0' },
    { id: 'p2', teams: ['T1', 'T5', 'T9', 'T13'], defenseTeam: 'T1' },
  ];
  const out = runForecast({ groups, ratingOf, current: new Map(), remainingGroupFixtures: [], players, scorerEV: {}, sims: 300 });
  assert.ok(Math.abs(out.p1.winProb + out.p2.winProb - 100) < 1e-6);
  assert.ok(Number.isFinite(out.p1.projectedTotal));
});

// ── buildSchedule ────────────────────────────────────────────────────────────
check('buildSchedule: maps finished matches and TBD knockouts', () => {
  const api = [
    { id: 2, utcDate: '2026-07-05T19:00:00Z', stage: 'ROUND_OF_16', group: null, status: 'SCHEDULED', homeTeam: null, awayTeam: null, score: { fullTime: {} } },
    { id: 1, utcDate: '2026-06-13T19:00:00Z', stage: 'GROUP_STAGE', group: 'GROUP_B', status: 'FINISHED', homeTeam: { name: 'Mexico' }, awayTeam: { name: 'Switzerland' }, score: { fullTime: { home: 2, away: 0 } } },
  ];
  const s = buildSchedule(api, (n) => n); // identity canonical
  assert.equal(s[0].id, 1); // sorted by date
  assert.equal(s[0].stageLabel, 'Group Stage');
  assert.equal(s[0].group, 'Group B');
  assert.equal(s[0].homeScore, 2);
  assert.equal(s[0].home.name, 'Mexico');
  assert.ok(s[0].home.flag.length > 0); // flag resolved
  assert.equal(s[1].stageLabel, 'Round of 16');
  assert.equal(s[1].home.name, 'TBD');
  assert.equal(s[1].homeScore, null);
});

check('buildSchedule: seed fills unnamed knockout sides; real feed data wins', () => {
  const api = [
    { id: 100, utcDate: '2026-06-29T20:30:00Z', stage: 'LAST_32', group: null, status: 'TIMED', homeTeam: { name: 'Germany' }, awayTeam: null, score: { fullTime: {} } },
    { id: 200, utcDate: '2026-06-30T19:00:00Z', stage: 'LAST_32', group: null, status: 'TIMED', homeTeam: null, awayTeam: null, score: { fullTime: {} } },
  ];
  const seed = { 100: { home: 'Brazil', away: 'Paraguay' }, 200: { home: 'France', away: 'Sweden' } };
  const byId = Object.fromEntries(buildSchedule(api, (n) => n, seed).map((m) => [m.id, m]));
  assert.equal(byId[100].home.name, 'Germany');   // feed already named home -> seed ignored
  assert.equal(byId[100].away.name, 'Paraguay');  // feed away was null -> seed fills it
  assert.equal(byId[200].home.name, 'France');    // both sides come from the seed
  assert.equal(byId[200].away.name, 'Sweden');
  assert.ok(byId[200].away.flag.length > 0);      // seeded team still resolves a flag
});

console.log(`\n✅  All ${passed} checks passed.\n`);
