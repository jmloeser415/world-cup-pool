// ─────────────────────────────────────────────────────────────────────────────
// Scoring engine for the 2026 pool rules. Pure functions — no network, no DB —
// so they can be unit-tested in test.mjs.
//
// Rules encoded:
//   Group:    3 / 1 / 0 per match  +  place bonus (1st +2, 2nd +1; 3rd/4th +0
//             even if they advance). Place bonus only once the group is complete.
//   Knockout: R32 +3, R16 +3, QF +4, SF +5, Final/title +6, 3rd-place game +3.
//             A win INCLUDES advancing via penalty shootout.
//   Top scorer (per pick): +1 per goal (shootout goals excluded), +2 if golden
//             boot at tournament end. x1.5 if no other player picked them AND it
//             is not Mbappé/Kane.
//   Top defense (per pick): +1 per clean sheet (a match where the team conceded
//             0 in normal+extra time; shootout goals don't count).
//   Tiebreaker: aggregate goal differential across all 4 teams.
// ─────────────────────────────────────────────────────────────────────────────

// Stage -> points. Aliases included because the feed's exact label for the new
// 48-team Round of 32 is unconfirmed; update.mjs logs any unrecognized stage.
export const KNOCKOUT_STAGE_POINTS = {
  ROUND_OF_32: 3, LAST_32: 3,
  ROUND_OF_16: 3, LAST_16: 3,
  QUARTER_FINALS: 4, QUARTER_FINAL: 4,
  SEMI_FINALS: 5, SEMI_FINAL: 5,
  THIRD_PLACE: 3, THIRD_PLACE_PLAYOFF: 3, '3RD_PLACE': 3,
  FINAL: 6,
};

export function normalizeName(s) {
  return (s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

// "GROUP_A" | "Group A" | "A"  ->  "A"
export function groupLetterFromApi(group) {
  if (!group) return null;
  const m = String(group).toUpperCase().match(/([A-L])\s*$/);
  return m ? m[1] : null;
}

function teamSide(match, teamId) {
  if (match.homeId === teamId) return 'HOME';
  if (match.awayId === teamId) return 'AWAY';
  return null;
}
function goalsFor(match, side)     { return (side === 'HOME' ? match.homeGoals : match.awayGoals) ?? 0; }
function goalsAgainst(match, side) { return (side === 'HOME' ? match.awayGoals : match.homeGoals) ?? 0; }

// Winner of a match, INCLUDING penalty-shootout advancement.
function isWinner(match, side) {
  if (match.winnerSide && match.winnerSide !== 'DRAW') return match.winnerSide === side;
  if (match.penWinnerSide) return match.penWinnerSide === side;
  return false;
}

const PRETTY_STAGE = {
  ROUND_OF_32: 'Round of 32', LAST_32: 'Round of 32',
  ROUND_OF_16: 'Round of 16', LAST_16: 'Round of 16',
  QUARTER_FINALS: 'Quarter-final', SEMI_FINALS: 'Semi-final',
  THIRD_PLACE: '3rd-place game', '3RD_PLACE': '3rd-place game', FINAL: 'Final',
};

// Score a single team across all its finished matches.
export function scoreTeam(team, matches, standingsByTeam, groupCompleteByLetter, warn = () => {}) {
  let groupMatchPoints = 0, placeBonus = 0, knockoutPoints = 0;
  let gf = 0, ga = 0, cleanSheets = 0, played = 0;
  let eliminatedStage = null, champion = false;

  for (const m of matches) {
    if (!m.isFinished) continue;
    const side = teamSide(m, team.id);
    if (!side) continue;

    const f = goalsFor(m, side), a = goalsAgainst(m, side);
    gf += f; ga += a; played += 1;
    if (a === 0) cleanSheets += 1; // clean sheet = conceded 0 (shootout excluded upstream)

    if (m.stage === 'GROUP_STAGE') {
      if (f > a) groupMatchPoints += 3;
      else if (f === a) groupMatchPoints += 1;
    } else {
      const pts = KNOCKOUT_STAGE_POINTS[m.stage];
      if (pts == null) { warn(`Unknown knockout stage "${m.stage}" (match ${m.id}, ${team.name})`); continue; }
      if (isWinner(m, side)) {
        knockoutPoints += pts;
        if (m.stage === 'FINAL') champion = true;
      } else if (m.stage !== 'THIRD_PLACE' && m.stage !== '3RD_PLACE') {
        eliminatedStage = m.stage; // lost a knockout (other than the consolation game)
      }
    }
  }

  // Place bonus only counts once the whole group is finished.
  const st = standingsByTeam[team.id];
  const letter = (st && st.group) || team.group;
  if (st && groupCompleteByLetter[letter]) {
    if (st.position === 1) placeBonus = 2;
    else if (st.position === 2) placeBonus = 1;
  }

  const groupPoints = groupMatchPoints + placeBonus;
  return {
    teamId: team.id, name: team.name, group: letter, owner: team.owner,
    groupMatchPoints, placeBonus, groupPoints,
    knockoutPoints, totalPoints: groupPoints + knockoutPoints,
    gf, ga, goalDiff: gf - ga, cleanSheets, played,
    groupRank: st ? st.position : null,
    status: champion ? 'Champion 🏆'
      : eliminatedStage ? `Out: ${PRETTY_STAGE[eliminatedStage] || eliminatedStage}`
      : played > 0 ? 'In progress' : 'Not started',
  };
}

// Score a single player from their already-computed team results + special picks.
// ctx: { scorersIndex, goldenBootKeys, tournamentComplete, topScorerPickCounts, cleanSheetsByTeam }
export function scorePlayer(player, teamResults, special, ctx) {
  const groupPoints    = teamResults.reduce((s, t) => s + t.groupPoints, 0);
  const knockoutPoints = teamResults.reduce((s, t) => s + t.knockoutPoints, 0);
  const goalDiff       = teamResults.reduce((s, t) => s + t.goalDiff, 0);

  let topScorerPoints = 0;
  if (special && special.topScorer) {
    const key = normalizeName(special.topScorer);
    let pts = ctx.scorersIndex[key] ?? 0;                       // 1 per goal
    if (ctx.tournamentComplete && ctx.goldenBootKeys.includes(key)) pts += 2; // golden boot
    const unique = (ctx.topScorerPickCounts[key] ?? 0) === 1;
    const excluded = key.includes('mbappe') || key.includes('kane');
    if (unique && !excluded) pts *= 1.5;                        // unique-pick multiplier
    topScorerPoints = pts;
  }

  let topDefensePoints = 0;
  if (special && special.topDefenseTeamId) {
    topDefensePoints = ctx.cleanSheetsByTeam[special.topDefenseTeamId] ?? 0;
  }

  return {
    playerId: player.id,
    groupPoints, knockoutPoints, topScorerPoints, topDefensePoints,
    totalPoints: groupPoints + knockoutPoints + topScorerPoints + topDefensePoints,
    goalDiff,
  };
}

// Sort by total desc, then goal-diff desc; assign 1-based rank (ties share a rank).
export function rankPlayers(playerScores) {
  const sorted = [...playerScores].sort(
    (a, b) => b.totalPoints - a.totalPoints || b.goalDiff - a.goalDiff,
  );
  let rank = 0, prev = null;
  sorted.forEach((p, i) => {
    if (!prev || p.totalPoints !== prev.totalPoints || p.goalDiff !== prev.goalDiff) rank = i + 1;
    p.rank = rank;
    prev = p;
  });
  return sorted;
}
