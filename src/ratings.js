// Team strength = blend of FIFA ranking + market outright odds.
// Produces an Elo-like rating (~1500–1950) per team for the Monte Carlo.
// Heuristic and tunable (oddsWeight) — documented inline.
import { normalizeName } from './score.js';

export const decimalToProb = (d) => (d > 0 ? 1 / d : 0);

// Remove the bookmaker margin so implied probabilities sum to 1. Keyed by normalized name.
export function devig(entries /* [{ key, decimal }] */) {
  const raw = entries.map((e) => ({ key: normalizeName(e.key), p: decimalToProb(e.decimal) }));
  const sum = raw.reduce((s, r) => s + r.p, 0) || 1;
  const out = new Map();
  for (const r of raw) out.set(r.key, r.p / sum);
  return out;
}

// Percentile rank (0..1) of each entry's value within the set.
function percentiles(map /* Map key->value */) {
  const sorted = [...map.entries()].sort((a, b) => a[1] - b[1]);
  const n = sorted.length;
  const pct = new Map();
  sorted.forEach(([k], i) => pct.set(k, n > 1 ? i / (n - 1) : 0.5));
  return pct;
}

// Build a strength lookup. oddsWeight = how much to trust the market vs FIFA (0..1).
export function buildTeamRatings(fifaRankings = [], outrightOdds = [], { oddsWeight = 0.6, lo = 1500, hi = 1950 } = {}) {
  const fifa = new Map();
  for (const r of fifaRankings) {
    const key = normalizeName(r.team);
    const score = r.points != null ? r.points : r.rank != null ? 2000 - r.rank * 12 : null;
    if (score != null) fifa.set(key, score);
  }
  const fifaPct = percentiles(fifa);
  const titleProb = devig(outrightOdds.map((o) => ({ key: o.team, decimal: o.decimal })));
  const oddsPct = percentiles(titleProb);

  const ratings = new Map();
  for (const k of new Set([...fifaPct.keys(), ...oddsPct.keys()])) {
    const f = fifaPct.get(k);
    const o = oddsPct.get(k);
    const q = f != null && o != null ? (1 - oddsWeight) * f + oddsWeight * o : (f ?? o);
    ratings.set(k, lo + q * (hi - lo));
  }
  const defaultRating = lo + 0.15 * (hi - lo); // unranked / weakest teams

  return {
    defaultRating,
    ratingOf: (name) => ratings.get(normalizeName(name)) ?? defaultRating,
    titleProbOf: (name) => titleProb.get(normalizeName(name)) ?? 0,
  };
}

// Fair P(golden boot) per player (de-vigged), keyed by normalized name.
export const goldenBootProbs = (goldenBootOdds = []) =>
  devig(goldenBootOdds.map((o) => ({ key: o.player, decimal: o.decimal })));
