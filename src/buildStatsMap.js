// Turn normalized API matches into the exact `statsMap` shape the Make app reads.
// Output per team: { game1, game2, game3, finish, knockoutWins, wonTitle, won3rd,
//                    goalsFor, goalsAgainst }  (keyed by team display name).
import { groupLetterFromApi } from './score.js';

// Stages whose WIN advances you (increments knockoutWins). The 3rd-place game is
// NOT here — it's tracked separately as won3rd.
const ADVANCE_STAGES = new Set([
  'ROUND_OF_32', 'LAST_32', 'ROUND_OF_16', 'LAST_16',
  'QUARTER_FINALS', 'QUARTER_FINAL', 'SEMI_FINALS', 'SEMI_FINAL', 'FINAL',
]);
const THIRD_PLACE_STAGES = new Set(['THIRD_PLACE', '3RD_PLACE', 'THIRD_PLACE_PLAYOFF']);

const side = (m, id) => (m.homeId === id ? 'HOME' : m.awayId === id ? 'AWAY' : null);
const gf = (m, s) => (s === 'HOME' ? m.homeGoals : m.awayGoals) ?? 0;
const ga = (m, s) => (s === 'HOME' ? m.awayGoals : m.homeGoals) ?? 0;
function won(m, s) {
  if (m.winnerSide && m.winnerSide !== 'DRAW') return m.winnerSide === s;
  if (m.penWinnerSide) return m.penWinnerSide === s; // advanced on penalties
  return false;
}

export function buildStatsMap(teams, matches, standingsByTeam, groupCompleteByLetter, warn = () => {}) {
  const out = {};
  for (const t of teams) {
    const mine = matches.filter((m) => m.isFinished && side(m, t.id));

    // group games, chronological -> game1/2/3 (3 win / 1 draw / 0 loss)
    const groupGames = mine
      .filter((m) => m.stage === 'GROUP_STAGE')
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const gp = [null, null, null];
    groupGames.slice(0, 3).forEach((m, i) => {
      const s = side(m, t.id), f = gf(m, s), a = ga(m, s);
      gp[i] = f > a ? 3 : f === a ? 1 : 0;
    });

    let goalsFor = 0, goalsAgainst = 0, knockoutWins = 0, wonTitle = false, won3rd = false, lostKnockout = false, cleanSheets = 0;
    for (const m of mine) {
      const s = side(m, t.id);
      goalsFor += gf(m, s);
      goalsAgainst += ga(m, s);
      if (ga(m, s) === 0) cleanSheets += 1; // shutout: conceded 0 (shootout goals excluded). Only finished matches.
      if (m.stage === 'GROUP_STAGE') continue;
      if (THIRD_PLACE_STAGES.has(m.stage)) {
        if (won(m, s)) won3rd = true;
        else lostKnockout = true; // lost the 3rd-place game -> out
        continue;
      }
      if (ADVANCE_STAGES.has(m.stage)) {
        if (won(m, s)) { knockoutWins += 1; if (m.stage === 'FINAL') wonTitle = true; }
        // A knockout loss eliminates you — EXCEPT the semifinal (the loser still plays the 3rd-place game).
        else if (m.stage !== 'SEMI_FINALS' && m.stage !== 'SEMI_FINAL') lostKnockout = true;
      } else {
        warn(`Unknown knockout stage "${m.stage}" for ${t.name} (match ${m.id})`);
      }
    }

    // group finish only counts once the whole group is played
    let finish = 'other';
    const st = standingsByTeam[t.id];
    const letter = (st && st.group) || t.group;
    const groupComplete = !!(st && groupCompleteByLetter[letter]);
    if (groupComplete) {
      if (st.position === 1) finish = 'first';
      else if (st.position === 2) finish = 'second';
    }
    // 4th in a finished group can never reach the Round of 32 -> eliminated now.
    // (3rd place is left undecided here — it depends on the 8-best-thirds cut, which
    //  update.mjs resolves once the full R32 bracket is drawn.)
    const groupEliminated = groupComplete && st.position === 4;

    out[t.name] = { game1: gp[0], game2: gp[1], game3: gp[2], finish, knockoutWins, wonTitle, won3rd, goalsFor, goalsAgainst, gamesPlayed: mine.length, cleanSheets, lostKnockout, groupEliminated };
  }
  return out;
}
