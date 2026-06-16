// Build the schedule payload the website renders: one row per match, sorted by date,
// with flags, scores, status, and resolved (or TBD) teams. `canonical` maps a feed
// team name to our display name (so the frontend's owner/⭐/🛡️ tags match).
import { groupLetterFromApi } from './score.js';
import { flagFor } from './flags.js';

const STAGE_LABEL = {
  GROUP_STAGE: 'Group Stage',
  ROUND_OF_32: 'Round of 32', LAST_32: 'Round of 32',
  ROUND_OF_16: 'Round of 16', LAST_16: 'Round of 16',
  QUARTER_FINALS: 'Quarterfinal', SEMI_FINALS: 'Semifinal',
  THIRD_PLACE: '3rd Place', '3RD_PLACE': '3rd Place', FINAL: 'Final',
};

const side = (name) => ({ name: name || 'TBD', flag: name ? flagFor(name) : '' });

export function buildSchedule(apiMatches, canonical = (n) => n) {
  return apiMatches
    .map((m) => {
      const home = m.homeTeam?.name ? canonical(m.homeTeam.name) : null;
      const away = m.awayTeam?.name ? canonical(m.awayTeam.name) : null;
      const hasScore = ['FINISHED', 'AWARDED', 'IN_PLAY', 'PAUSED'].includes(m.status);
      const ft = m.score?.fullTime || {};
      const letter = groupLetterFromApi(m.group);
      return {
        id: m.id,
        date: m.utcDate,
        stage: m.stage,
        stageLabel: STAGE_LABEL[m.stage] || m.stage,
        group: letter ? `Group ${letter}` : null,
        status: m.status,
        home: side(home),
        away: side(away),
        homeScore: hasScore ? ft.home ?? null : null,
        awayScore: hasScore ? ft.away ?? null : null,
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
