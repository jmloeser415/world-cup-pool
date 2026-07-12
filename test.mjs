// `npm test` — offline checks of the scoring engine. No network, no DB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreTeam, scorePlayer, rankPlayers, openPlayGoals } from './src/score.js';
import { buildStatsMap } from './src/buildStatsMap.js';
import { devig, buildTeamRatings } from './src/ratings.js';
import { scoreOutcome, eloWinProb, expectedGoals, runForecast, simulateBracket, poissonSample } from './src/forecast.js';
import { buildSchedule } from './src/buildSchedule.js';
import { R32_SEED } from './src/r32Seed.js';
import { KO_BRACKET_ORDER } from './src/bracket.js';

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
  const scorers = { p1: { team: 'T0', currentGoals: 2, gpm: 0.55, mult: 1.5, goldenBootPts: 0.4 } };
  const out = runForecast({ groups, ratingOf, current: new Map(), remainingGroupFixtures: [], players, scorers, sims: 300 });
  assert.ok(Math.abs(out.p1.winProb + out.p2.winProb - 100) < 1e-6);
  assert.ok(Number.isFinite(out.p1.projectedTotal));
  assert.ok(out.p1.scorerPoints > 3);   // 2 current goals ×1.5, plus future-match EV + golden boot
  assert.equal(out.p2.scorerPoints, 0); // p2 has no scorer pick
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
  assert.equal(s[0].winner, 'home'); // Mexico won 2-0
  assert.equal(s[1].winner, null);   // not played -> no winner
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

// ── real knockout bracket ─────────────────────────────────────────────────────
check('bracket: KO_BRACKET_ORDER matches the R32 seed (32 teams, same pairings)', () => {
  assert.equal(KO_BRACKET_ORDER.length, 32);
  assert.equal(new Set(KO_BRACKET_ORDER).size, 32);
  const bracketPairs = [];
  for (let i = 0; i < 32; i += 2) bracketPairs.push([KO_BRACKET_ORDER[i], KO_BRACKET_ORDER[i + 1]].sort().join(' v '));
  const seedPairs = Object.values(R32_SEED).map((m) => [m.home, m.away].sort().join(' v '));
  assert.equal(bracketPairs.length, 16);
  assert.deepEqual(bracketPairs.slice().sort(), seedPairs.slice().sort()); // same 16 ties
});

check('bracket: simulateBracket plays the full tree (107 KO pts, 16 R32 winners)', () => {
  const teams = Array.from({ length: 32 }, (_, i) => ({ name: 'T' + i, gf: 0, ga: 0, cs: 0, ko: 0, place: 0, fg: 0 }));
  const ratingOf = (n) => 1500 + Number(n.slice(1)) * 3; // distinct ratings
  simulateBracket(teams, ratingOf);
  const totalKo = teams.reduce((a, t) => a + t.ko, 0);
  assert.equal(totalKo, 107);                             // 16·3 + 8·3 + 4·4 + 2·5 + 1·6 + 1·3(3rd)
  assert.equal(teams.filter((t) => t.ko > 0).length, 16); // only the 16 R32 winners ever score KO points
});

check('forecast: knownKO locks a played knockout result (winner advances, loser out)', () => {
  const ratingOf = (n) => 1500 + Number(n.slice(1)) * 3;
  const knownKO = new Map([['T0 | T1', { goals: { T0: 0, T1: 2 }, winner: 'T1' }]]); // lock the R32 tie at slots 0,1
  for (let trial = 0; trial < 25; trial++) {
    const teams = Array.from({ length: 32 }, (_, i) => ({ name: 'T' + i, gf: 0, ga: 0, cs: 0, ko: 0, place: 0, fg: 0 }));
    simulateBracket(teams, ratingOf, knownKO);
    assert.equal(teams[0].ko, 0);   // T0 lost its R32 tie -> never scores KO points
    assert.ok(teams[1].ko >= 3);    // T1 won R32 (locked) -> at least the R32 points
    assert.equal(teams[0].gf, 0); assert.equal(teams[0].ga, 2); // actual goals applied to the loser
    assert.ok(teams[1].cs >= 1);    // T1 conceded 0 in the locked tie -> a clean sheet
    assert.equal(teams[0].fg, 0);   // T0 eliminated -> no future (simulated) matches counted
    assert.ok(teams[1].fg >= 1);    // T1 advanced -> plays at least the simulated R16
  }
});

check('knockout: shootout with null feed-winner + tied penalties advances the full-time leader', () => {
  const T = (id) => ({ id, name: id, group: 'A', owner: 'igor' });
  const m = fm({ id: 1, stage: 'LAST_16', date: '1', homeId: 'sui', awayId: 'col', homeGoals: 4, awayGoals: 3, winnerSide: null, penWinnerSide: null, ftWinnerSide: 'HOME' });
  const sui = buildStatsMap([T('sui')], [m], {}, {}).sui;
  const col = buildStatsMap([T('col')], [m], {}, {}).col;
  assert.equal(sui.knockoutWins, 2);    // won this R16 shootout (4-3 full-time) -> reached+won R16 = 2 rounds
  assert.equal(sui.lostKnockout, false);
  assert.equal(col.knockoutWins, 0);    // no knockout win in the provided match
  assert.equal(col.lostKnockout, true); // Colombia out
});

check('buildStatsMap: knockout wins survive a missing intermediate round (feed gap)', () => {
  const T = (id) => ({ id, name: id, group: 'A', owner: 'igor' });
  // Won R32 and QF, but the R16 result never landed in the feed -> still 3 rounds (R32 + R16 + QF).
  const r32 = fm({ id: 1, stage: 'LAST_32', date: '1', homeId: 'eng', awayId: 'a', homeGoals: 2, awayGoals: 1, winnerSide: 'HOME' });
  const qf = fm({ id: 3, stage: 'QUARTER_FINALS', date: '3', homeId: 'x', awayId: 'eng', homeGoals: 1, awayGoals: 2, winnerSide: 'AWAY' });
  const eng = buildStatsMap([T('eng')], [r32, qf], {}, {}).eng;
  assert.equal(eng.knockoutWins, 3);
  assert.equal(eng.lostKnockout, false);
});

check('buildSchedule: shootout with null winner + tied penalties resolves to the full-time leader', () => {
  const api = [{ id: 9, utcDate: '2026-07-07T20:00:00Z', stage: 'LAST_16', group: null, status: 'FINISHED', homeTeam: { name: 'Switzerland' }, awayTeam: { name: 'Colombia' }, score: { winner: null, penalties: { home: 3, away: 3 }, fullTime: { home: 4, away: 3 } } }];
  const s = buildSchedule(api, (n) => n);
  assert.equal(s[0].winner, 'home'); // Switzerland advanced (4-3) despite a null winner + tied penalties line
});

check('openPlayGoals: excludes the shootout; sums regulation + extra time', () => {
  assert.deepEqual(openPlayGoals({ fullTime: { home: 2, away: 1 } }), { home: 2, away: 1 }); // 90-min match
  // 0-0 into penalties (Switzerland-Colombia): open play 0-0 even though full-time reads 4-3
  assert.deepEqual(openPlayGoals({ regularTime: { home: 0, away: 0 }, extraTime: { home: 0, away: 0 }, fullTime: { home: 4, away: 3 }, penalties: { home: 3, away: 3 } }), { home: 0, away: 0 });
  // extra-time goals are additive (Argentina-Cape Verde): reg 1-1 + et 2-1 = 3-2
  assert.deepEqual(openPlayGoals({ regularTime: { home: 1, away: 1 }, extraTime: { home: 2, away: 1 }, fullTime: { home: 3, away: 2 } }), { home: 3, away: 2 });
});

check('buildStatsMap: a 0-0 shootout is a clean sheet with no open-play goals', () => {
  const T = (id) => ({ id, name: id, group: 'A', owner: 'igor' });
  // update.mjs feeds open-play goals (0-0); home advances on the full-time (shootout) score
  const m = fm({ id: 1, stage: 'QUARTER_FINALS', date: '1', homeId: 'esp', awayId: 'x', homeGoals: 0, awayGoals: 0, winnerSide: null, penWinnerSide: null, ftWinnerSide: 'HOME' });
  const esp = buildStatsMap([T('esp')], [m], {}, {}).esp;
  assert.equal(esp.cleanSheets, 1); // conceded 0 in open play
  assert.equal(esp.goalsFor, 0);
  assert.equal(esp.knockoutWins, 3); // won the QF -> reached+won R32 + R16 + QF = 3 rounds
});

check('poissonSample: zero mean scores nothing; large mean averages near the mean', () => {
  for (let i = 0; i < 50; i++) assert.equal(poissonSample(0), 0); // eliminated striker (0 future games) -> 0 goals
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += poissonSample(2);
  assert.ok(Math.abs(sum / 3000 - 2) < 0.25, 'mean ~2, got ' + sum / 3000);
});

console.log(`\n✅  All ${passed} checks passed.\n`);
