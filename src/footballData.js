// Thin client for football-data.org (v4). Swap this one file to change providers.
// Free token: https://www.football-data.org/client/register  (10 req/min)

const BASE = 'https://api.football-data.org/v4/competitions/WC';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) throw new Error('FOOTBALL_DATA_API_KEY is not set (see .env)');

  const season = process.env.WC_SEASON;
  const url = BASE + path + (season ? `${path.includes('?') ? '&' : '?'}season=${season}` : '');

  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'X-Auth-Token': key } });
    } catch (e) {
      // Network-level failure (DNS / TLS / IPv6 / dropped connection) shows up as "fetch failed".
      lastErr = e;
      if (attempt < 4) { await sleep(1500 * attempt); continue; } // backoff, then retry
      const cause = e?.cause?.code || e?.cause?.message || '';
      throw new Error(`network error reaching ${url} after ${attempt} tries: ${e.message}${cause ? ` (${cause})` : ''}`);
    }
    if (res.status === 429 && attempt < 4) { await sleep(6000); continue; } // rate limited — wait a beat
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`football-data.org ${res.status} on ${url}\n${body.slice(0, 500)}`);
    }
    return res.json();
  }
  throw lastErr;
}

export const getMatches  = () => get('/matches');
export const getStandings = () => get('/standings');
export const getScorers  = () => get('/scorers?limit=100'); // top 100 so a picked striker isn't missed
