// Monte Carlo tournament forecast. Runs in the Node updater (Math.random is fine here).
//
// V1 SIMPLIFICATIONS (documented):
//  - Match goals: independent Poisson from an Elo-style strength gap.
//  - Knockout draws decided by Elo win-probability (penalties).
//  - Bracket: the 32 advancers are seeded by rating (best vs worst each round), not
//    FIFA's exact slot mapping. Affects who-plays-whom, never the scoring rules.
//  - Best 8 third-place teams chosen by (points, GD, GF) across the 12 groups.
//  - Scorer points enter as a per-player expected-value constant (scorerEV).

const KO_POINTS = [3, 3, 4, 5, 6]; // R32, R16, QF, SF, Final
const BASE_GOALS = 1.35;

export const eloWinProb = (rA, rB) => 1 / (1 + 10 ** ((rB - rA) / 400));

export function expectedGoals(rA, rB) {
  const supremacy = ((rA - rB) / 100) * 0.35; // ~0.35 goals per 100 rating points
  const clamp = (x) => Math.max(0.2, Math.min(5, x));
  return [clamp(BASE_GOALS + supremacy / 2), clamp(BASE_GOALS - supremacy / 2)];
}

export function poissonSample(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// One match -> { gA, gB, winner: 'A'|'B'|'D' }. In knockouts a 'D' is resolved on pens.
export function simMatch(rA, rB, knockout = false) {
  const [lA, lB] = expectedGoals(rA, rB);
  const gA = poissonSample(lA), gB = poissonSample(lB);
  let winner = gA > gB ? 'A' : gB > gA ? 'B' : 'D';
  if (knockout && winner === 'D') winner = Math.random() < eloWinProb(rA, rB) ? 'A' : 'B';
  return { gA, gB, winner };
}

// group ranking: points, then goal diff, then goals for
const cmpTeam = (a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf;

// PURE: given a resolved outcome, compute each player's pool total + GD tiebreaker.
// outcome: Map name -> { groupGamePts, placeBonus, knockoutPts, gf, ga, cleanSheets }
// players: [{ id, teams:[name], defenseTeam: name|null }]
export function scoreOutcome(outcome, players, scorerEV = {}) {
  const res = {};
  for (const p of players) {
    let teamTotal = 0, gd = 0;
    for (const tn of p.teams) {
      const s = outcome.get(tn);
      if (!s) continue;
      teamTotal += s.groupGamePts + s.placeBonus + s.knockoutPts;
      gd += s.gf - s.ga;
    }
    const defense = p.defenseTeam ? (outcome.get(p.defenseTeam)?.cleanSheets ?? 0) : 0;
    const scorer = scorerEV[p.id] ?? 0;
    res[p.id] = { total: teamTotal + defense + scorer, gd, teamTotal, defense };
  }
  return res;
}

function simulateKnockout(seeds /* sorted by rating desc */, ratingOf) {
  let round = seeds.slice();
  let roundIdx = 0; // 0=R32 … 4=Final
  let sfLosers = [];
  while (round.length > 1) {
    const winners = [], losers = [];
    const n = round.length;
    for (let i = 0; i < n / 2; i++) {
      const A = round[i], B = round[n - 1 - i]; // best vs worst
      const { gA, gB, winner } = simMatch(ratingOf(A.name), ratingOf(B.name), true);
      A.gf += gA; A.ga += gB; B.gf += gB; B.ga += gA;
      if (gB === 0) A.cs += 1;
      if (gA === 0) B.cs += 1;
      const W = winner === 'A' ? A : B, L = winner === 'A' ? B : A;
      W.ko += KO_POINTS[roundIdx];
      winners.push(W); losers.push(L);
    }
    if (roundIdx === 3) sfLosers = losers;
    round = winners; roundIdx += 1;
  }
  if (sfLosers.length === 2) { // 3rd-place game
    const [A, B] = sfLosers;
    const { gA, gB, winner } = simMatch(ratingOf(A.name), ratingOf(B.name), true);
    A.gf += gA; A.ga += gB; B.gf += gB; B.ga += gA;
    if (gB === 0) A.cs += 1;
    if (gA === 0) B.cs += 1;
    (winner === 'A' ? A : B).ko += 3;
  }
}

// Run the forecast. Returns per player:
//   { winProb, projectedTotal, teamTotal, scorerPoints, defensePoints, teams:{name:pts} }
export function runForecast({ groups, ratingOf, current, remainingGroupFixtures, players, scorerEV = {}, sims = 20000 }) {
  const draftedTeams = [...new Set(players.flatMap((p) => p.teams))];
  const wins = {}, totalSum = {}, teamTotalSum = {}, defenseSum = {}, teamPtsSum = {};
  for (const p of players) { wins[p.id] = 0; totalSum[p.id] = 0; teamTotalSum[p.id] = 0; defenseSum[p.id] = 0; }

  for (let i = 0; i < sims; i++) {
    const st = new Map();
    const ensure = (n) => {
      if (!st.has(n)) {
        const c = current.get(n) || {};
        st.set(n, { name: n, pts: c.groupGamePts ?? 0, gf: c.gf ?? 0, ga: c.ga ?? 0, cs: c.cleanSheets ?? 0, ko: 0, place: 0 });
      }
      return st.get(n);
    };
    for (const teams of Object.values(groups)) for (const t of teams) ensure(t);

    // remaining group games
    for (const [h, a] of remainingGroupFixtures) {
      const A = ensure(h), B = ensure(a);
      const { gA, gB } = simMatch(ratingOf(h), ratingOf(a), false);
      A.gf += gA; A.ga += gB; B.gf += gB; B.ga += gA;
      if (gA > gB) A.pts += 3; else if (gB > gA) B.pts += 3; else { A.pts += 1; B.pts += 1; }
      if (gB === 0) A.cs += 1;
      if (gA === 0) B.cs += 1;
    }

    // group tables -> advancers (top 2 + place bonus) and the 8 best thirds
    const thirds = [], advancers = [];
    for (const teams of Object.values(groups)) {
      const ranked = teams.map(ensure).sort(cmpTeam);
      ranked[0].place = 2; ranked[1].place = 1;
      advancers.push(ranked[0], ranked[1]);
      if (ranked[2]) thirds.push(ranked[2]);
    }
    thirds.sort(cmpTeam);
    advancers.push(...thirds.slice(0, 8));

    advancers.sort((x, y) => ratingOf(y.name) - ratingOf(x.name));
    simulateKnockout(advancers, ratingOf);

    const outcome = new Map();
    for (const t of st.values())
      outcome.set(t.name, { groupGamePts: t.pts, placeBonus: t.place, knockoutPts: t.ko, gf: t.gf, ga: t.ga, cleanSheets: t.cs });

    const scored = scoreOutcome(outcome, players, scorerEV);
    let bestId = null, best = null;
    for (const p of players) {
      const s = scored[p.id];
      totalSum[p.id] += s.total; teamTotalSum[p.id] += s.teamTotal; defenseSum[p.id] += s.defense;
      if (!best || s.total > best.total || (s.total === best.total && s.gd > best.gd)) { best = s; bestId = p.id; }
    }
    wins[bestId] += 1;
    for (const tn of draftedTeams) { const o = outcome.get(tn); if (o) teamPtsSum[tn] = (teamPtsSum[tn] || 0) + o.groupGamePts + o.placeBonus + o.knockoutPts; }
  }

  const r1 = (x) => Math.round(x * 10) / 10;
  const out = {};
  for (const p of players) {
    const teams = {};
    for (const tn of p.teams) teams[tn] = r1((teamPtsSum[tn] || 0) / sims);
    out[p.id] = {
      winProb: +(100 * wins[p.id] / sims).toFixed(1),
      projectedTotal: Math.round(totalSum[p.id] / sims),
      teamTotal: r1(teamTotalSum[p.id] / sims),
      scorerPoints: r1(scorerEV[p.id] ?? 0),
      defensePoints: r1(defenseSum[p.id] / sims),
      teams,
    };
  }
  return out;
}
