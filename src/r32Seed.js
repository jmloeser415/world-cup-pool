// Round-of-32 matchups, seeded by football-data fixture id.
//
// WHY: on football-data.org's free tier, knockout participants don't populate until
// ~kickoff, so upcoming R32 fixtures come back as "TBD vs TBD" even though the bracket
// is finalized. We seed the known pairings here; buildSchedule only uses a seed entry
// for a side the feed itself hasn't named yet, so real data always wins (and this
// self-corrects if a pairing is ever wrong, once the feed fills that fixture in).
//
// Derived from the final group standings + the official 2026 bracket rule (4 winners vs
// runners-up, 8 winners vs best-thirds, 8 remaining runners-up vs each other) and
// cross-checked against the pairings football-data had already confirmed and
// en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage. Non-drafted teams use the
// feed's own spelling (Congo DR, Cape Verde Islands) so the name doesn't flip later.
// STOPGAP — safe to delete once the feed populates the knockout teams on its own.
export const R32_SEED = {
  537417: { home: 'South Africa', away: 'Canada' },              // Jun 28 — 2A v 2B
  537423: { home: 'Brazil', away: 'Japan' },                     // Jun 29 — 1C v 2F
  537415: { home: 'Germany', away: 'Paraguay' },                 // Jun 29 — 1E v 3D
  537418: { home: 'Netherlands', away: 'Morocco' },              // Jun 29 — 1F v 2C
  537424: { home: 'Ivory Coast', away: 'Norway' },               // Jun 30 — 2E v 2I
  537416: { home: 'France', away: 'Sweden' },                    // Jun 30 — 1I v 3F
  537425: { home: 'Mexico', away: 'Ecuador' },                   // Jun 30 — 1A v 3E
  537426: { home: 'England', away: 'Congo DR' },                 // Jul 1  — 1L v 3K
  537422: { home: 'Belgium', away: 'Senegal' },                  // Jul 1  — 1G v 3I
  537421: { home: 'United States', away: 'Bosnia-Herzegovina' }, // Jul 1  — 1D v 3B
  537420: { home: 'Spain', away: 'Austria' },                    // Jul 2  — 1H v 2J
  537419: { home: 'Portugal', away: 'Croatia' },                 // Jul 2  — 2K v 2L
  537429: { home: 'Switzerland', away: 'Algeria' },              // Jul 2  — 1B v 3J
  537428: { home: 'Australia', away: 'Egypt' },                  // Jul 3  — 2D v 2G
  537427: { home: 'Argentina', away: 'Cape Verde Islands' },     // Jul 3  — 1J v 2H
  537430: { home: 'Colombia', away: 'Ghana' },                   // Jul 3  — 1K v 3L
};
