// Thin client for football-data.org (v4). Swap this one file to change providers.
// Free token: https://www.football-data.org/client/register  (10 req/min)

const BASE = 'https://api.football-data.org/v4/competitions/WC';

async function get(path) {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) throw new Error('FOOTBALL_DATA_API_KEY is not set (see .env)');

  const season = process.env.WC_SEASON;
  const url = BASE + path + (season ? `${path.includes('?') ? '&' : '?'}season=${season}` : '');

  const res = await fetch(url, { headers: { 'X-Auth-Token': key } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`football-data.org ${res.status} on ${url}\n${body.slice(0, 500)}`);
  }
  return res.json();
}

export const getMatches  = () => get('/matches');
export const getStandings = () => get('/standings');
export const getScorers  = () => get('/scorers?limit=30');
