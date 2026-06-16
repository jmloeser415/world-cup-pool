// Team -> flag emoji, for the schedule. Keyed by normalized name, with aliases for
// the spellings the data feed uses (so non-drafted teams still get a flag).
import { normalizeName } from './score.js';

const F = [
  ['🇲🇽', ['Mexico']], ['🇿🇦', ['South Africa']], ['🇰🇷', ['South Korea', 'Korea Republic']], ['🇨🇿', ['Czechia', 'Czech Republic']],
  ['🇨🇦', ['Canada']], ['🇧🇦', ['Bosnia-Herzegovina', 'Bosnia and Herzegovina', 'Bosnia & Herzegovina']], ['🇶🇦', ['Qatar']], ['🇨🇭', ['Switzerland']],
  ['🇧🇷', ['Brazil']], ['🇲🇦', ['Morocco']], ['🇭🇹', ['Haiti']], ['🏴󠁧󠁢󠁳󠁣󠁴󠁿', ['Scotland']],
  ['🇺🇸', ['United States', 'USA']], ['🇵🇾', ['Paraguay']], ['🇦🇺', ['Australia']], ['🇹🇷', ['Türkiye', 'Turkey']],
  ['🇩🇪', ['Germany']], ['🇨🇼', ['Curaçao', 'Curacao']], ['🇨🇮', ['Ivory Coast', "Côte d'Ivoire", "Cote d'Ivoire"]], ['🇪🇨', ['Ecuador']],
  ['🇳🇱', ['Netherlands']], ['🇯🇵', ['Japan']], ['🇸🇪', ['Sweden']], ['🇹🇳', ['Tunisia']],
  ['🇧🇪', ['Belgium']], ['🇪🇬', ['Egypt']], ['🇮🇷', ['Iran', 'IR Iran']], ['🇳🇿', ['New Zealand']],
  ['🇪🇸', ['Spain']], ['🇨🇻', ['Cape Verde', 'Cabo Verde', 'Cape Verde Islands']], ['🇸🇦', ['Saudi Arabia']], ['🇺🇾', ['Uruguay']],
  ['🇫🇷', ['France']], ['🇸🇳', ['Senegal']], ['🇮🇶', ['Iraq']], ['🇳🇴', ['Norway']],
  ['🇦🇷', ['Argentina']], ['🇩🇿', ['Algeria']], ['🇦🇹', ['Austria']], ['🇯🇴', ['Jordan']],
  ['🇵🇹', ['Portugal']], ['🇨🇩', ['Congo DR', 'DR Congo', 'Democratic Republic of the Congo', 'Congo']], ['🇺🇿', ['Uzbekistan']], ['🇨🇴', ['Colombia']],
  ['🏴󠁧󠁢󠁥󠁮󠁧󠁿', ['England']], ['🇭🇷', ['Croatia']], ['🇬🇭', ['Ghana']], ['🇵🇦', ['Panama']],
];

const MAP = new Map();
for (const [flag, names] of F) for (const n of names) MAP.set(normalizeName(n), flag);

export const flagFor = (name) => MAP.get(normalizeName(name)) ?? '';
