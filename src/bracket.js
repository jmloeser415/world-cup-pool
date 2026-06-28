// The real 2026 knockout bracket: the 32 Round-of-32 participants in BRACKET-LEAF order.
//
// Adjacent pairs (0,1),(2,3),… are the R32 ties, and winners advance by adjacency — the
// two R32 winners at (2j,2j+1) meet in R16 match j, those regions meet in the QF, and so
// on, with the halves meeting only in the final. So this array alone encodes the tree.
//
// Built from the official bracket (FIFA match numbers 73–104,
// en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage) layered onto the R32 matchups
// in src/r32Seed.js, and validated at run time against the 32 actual advancers (forecast.mjs).
// Names must match the standings-derived (canonical) team names the forecast uses.
// Tree: R16 89(W74,W77) 90(W73,W75)→QF97 · 93(W83,W84) 94(W81,W82)→QF98 → SF101;
//       91(W76,W78) 92(W79,W80)→QF99 · 95(W86,W88) 96(W85,W87)→QF100 → SF102; Final 104.
export const KO_BRACKET_ORDER = [
  // ── top half ──
  'Germany', 'Paraguay',                  // R32 M74 ┐ R16 M89 ┐ QF M97 ┐ SF M101
  'France', 'Sweden',                     // R32 M77 ┘         │        │
  'South Africa', 'Canada',               // R32 M73 ┐ R16 M90 ┘        │
  'Netherlands', 'Morocco',               // R32 M75 ┘                  │
  'Portugal', 'Croatia',                  // R32 M83 ┐ R16 M93 ┐ QF M98 ┘
  'Spain', 'Austria',                     // R32 M84 ┘         │
  'United States', 'Bosnia-Herzegovina',  // R32 M81 ┐ R16 M94 ┘
  'Belgium', 'Senegal',                   // R32 M82 ┘
  // ── bottom half ──
  'Brazil', 'Japan',                      // R32 M76 ┐ R16 M91 ┐ QF M99 ┐ SF M102
  'Ivory Coast', 'Norway',                // R32 M78 ┘         │        │
  'Mexico', 'Ecuador',                    // R32 M79 ┐ R16 M92 ┘        │
  'England', 'Congo DR',                  // R32 M80 ┘                  │
  'Argentina', 'Cape Verde Islands',      // R32 M86 ┐ R16 M95 ┐ QF M100┘
  'Australia', 'Egypt',                   // R32 M88 ┘         │
  'Switzerland', 'Algeria',               // R32 M85 ┐ R16 M96 ┘
  'Colombia', 'Ghana',                    // R32 M87 ┘
];
