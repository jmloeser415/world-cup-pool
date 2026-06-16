// ─────────────────────────────────────────────────────────────────────────────
// THE DRAFT — single source of truth. Edit this file to fix anything.
// (Parsed from your Draft 2026 sheet. Items marked "VERIFY" were cut off in the
//  screenshot and inferred — please double-check them.)
// ─────────────────────────────────────────────────────────────────────────────

// draft_position = snake-draft order from round 1.
export const PLAYERS = [
  { id: 'igor',  name: 'Igor',  draftPosition: 1 },
  { id: 'avery', name: 'Avery', draftPosition: 2 },
  { id: 'jason', name: 'Jason', draftPosition: 3 },
  { id: 'will',  name: 'Will',  draftPosition: 4 },
  { id: 'jono',  name: 'Jono',  draftPosition: 5 },
  { id: 'nate',  name: 'Nate',  draftPosition: 6 },
  { id: 'cam',   name: 'Cam',   draftPosition: 7 },
  { id: 'clay',  name: 'Clay',  draftPosition: 8 },
];

// owner = player id.  group = group letter (display + place-bonus gating; the API's
//   own standings are authoritative for rank, so a wrong letter here is low-risk).
// aliases = alternate names the data feed might use, so we can match results to teams.
export const TEAMS = [
  // Igor
  { id: 'france',        name: 'France',             group: 'I', owner: 'igor' },
  { id: 'mexico',        name: 'Mexico',             group: 'A', owner: 'igor' }, // VERIFY group (host, top of A cut off)
  { id: 'switzerland',   name: 'Switzerland',        group: 'B', owner: 'igor' },
  { id: 'ghana',         name: 'Ghana',              group: 'L', owner: 'igor' },

  // Avery
  { id: 'spain',         name: 'Spain',              group: 'H', owner: 'avery' },
  { id: 'united-states', name: 'United States',      group: 'D', owner: 'avery', aliases: ['USA', 'United States of America'] },
  { id: 'croatia',       name: 'Croatia',            group: 'L', owner: 'avery' },
  { id: 'australia',     name: 'Australia',          group: 'D', owner: 'avery' },

  // Jason
  { id: 'brazil',        name: 'Brazil',             group: 'C', owner: 'jason' },
  { id: 'uruguay',       name: 'Uruguay',            group: 'H', owner: 'jason' },
  { id: 'senegal',       name: 'Senegal',            group: 'I', owner: 'jason' },
  { id: 'bosnia-herzegovina', name: 'Bosnia-Herzegovina', group: 'B', owner: 'jason', aliases: ['Bosnia and Herzegovina', 'Bosnia & Herzegovina'] },

  // Will
  { id: 'england',       name: 'England',            group: 'L', owner: 'will' },
  { id: 'japan',         name: 'Japan',              group: 'F', owner: 'will' },
  { id: 'ecuador',       name: 'Ecuador',            group: 'E', owner: 'will' },
  { id: 'czechia',       name: 'Czechia',            group: 'A', owner: 'will', aliases: ['Czech Republic'] },

  // Jono
  { id: 'argentina',     name: 'Argentina',          group: 'J', owner: 'jono' },
  { id: 'colombia',      name: 'Colombia',           group: 'K', owner: 'jono' },
  { id: 'turkiye',       name: 'Türkiye',            group: 'D', owner: 'jono', aliases: ['Turkey', 'Turkiye'] },
  { id: 'ivory-coast',   name: 'Ivory Coast',        group: 'E', owner: 'jono', aliases: ["Côte d'Ivoire", "Cote d'Ivoire"] },

  // Nate
  { id: 'germany',       name: 'Germany',            group: 'E', owner: 'nate' },
  { id: 'belgium',       name: 'Belgium',            group: 'G', owner: 'nate' }, // VERIFY group (top of G cut off)
  { id: 'canada',        name: 'Canada',             group: 'B', owner: 'nate' },
  { id: 'scotland',      name: 'Scotland',           group: 'C', owner: 'nate' },

  // Cam
  { id: 'portugal',      name: 'Portugal',           group: 'K', owner: 'cam' },
  { id: 'morocco',       name: 'Morocco',            group: 'C', owner: 'cam' },
  { id: 'south-korea',   name: 'South Korea',        group: 'A', owner: 'cam', aliases: ['Korea Republic', 'Republic of Korea', 'Korea, South'] },
  { id: 'sweden',        name: 'Sweden',             group: 'F', owner: 'cam' },

  // Clay
  { id: 'netherlands',   name: 'Netherlands',        group: 'F', owner: 'clay' },
  { id: 'norway',        name: 'Norway',             group: 'I', owner: 'clay' },
  { id: 'egypt',         name: 'Egypt',              group: 'G', owner: 'clay' },
  { id: 'austria',       name: 'Austria',            group: 'J', owner: 'clay' },
];

// ─────────────────────────────────────────────────────────────────────────────
// SPECIAL PICKS (DM'd privately — you don't have these yet).
// When a player tells you their picks, fill them in here and re-run `npm run update`.
//   topScorer:         the player's full name as it appears in the data feed's
//                      top-scorer list, e.g. 'Kylian Mbappé'. Leave null until known.
//   topDefenseTeamId:  a team id from the TEAMS list above (e.g. 'brazil'). Any team
//                      is allowed — it does not have to be one they drafted.
// Reminder: Mbappé & Kane are NOT eligible for the 1.5x unique-top-scorer multiplier.
// ─────────────────────────────────────────────────────────────────────────────
// topScorer stored as the FULL name so it matches the data feed's scorer list
// (the website shows short names like "Lukaku" — that's just display).
// Uniqueness for the 1.5x: Oyarzabal (3 picks) and Haaland (2 picks) are NOT
// unique -> no multiplier. Lautaro / Lukaku / Ronaldo are unique -> 1.5x.
export const SPECIAL_PICKS = {
  igor:  { topScorer: 'Lautaro Martínez',  topDefenseTeamId: 'argentina' },
  avery: { topScorer: 'Romelu Lukaku',     topDefenseTeamId: 'brazil' },
  jason: { topScorer: 'Erling Haaland',    topDefenseTeamId: 'england' },
  will:  { topScorer: 'Mikel Oyarzabal',   topDefenseTeamId: 'france' },
  jono:  { topScorer: 'Mikel Oyarzabal',   topDefenseTeamId: 'argentina' },
  nate:  { topScorer: 'Mikel Oyarzabal',   topDefenseTeamId: 'spain' },
  cam:   { topScorer: 'Cristiano Ronaldo', topDefenseTeamId: 'spain' },
  clay:  { topScorer: 'Erling Haaland',    topDefenseTeamId: 'england' },
};
