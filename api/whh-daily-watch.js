import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 30 };

/**
 * Westchester House Hunter — daily watch endpoint.
 *
 *   POST /api/whh-daily-watch  (manual trigger from the UI)
 *   GET  /api/whh-daily-watch  (cron trigger — see vercel.json)
 *
 * Returns: { lastRun, newListings: [], snapshotUrl? }
 *
 * Current state: STUB. Real Compass/Zillow scraping requires either
 * a paid MLS feed or an Apify/ScraperAPI integration. Until then this
 * endpoint reports the cron is wired and ready, runs no scraper, and
 * returns an empty list. When the scraper lands, drop it into
 * `scanForNewListings()` and the rest of the pipeline picks it up.
 */

const WATCH_LOG_KEY = 'whh:watch:log';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  // GET = cron trigger (Vercel cron uses GET). POST = manual UI trigger.
  // Both go through checkAccess (cron passes a known token via x-access-code).
  const denied = await checkAccess(req);
  if (denied) return denied;

  const now = new Date().toISOString();
  const newListings = await scanForNewListings();

  // TODO: when scraper exists, push newListings into the Supabase
  // winchester-state row so the next client read picks them up.
  // For now, just report.

  return new Response(JSON.stringify({
    lastRun: now,
    newListings,
    note: newListings.length
      ? `${newListings.length} new candidate${newListings.length === 1 ? '' : 's'} found`
      : 'no new listings — scraper not yet configured. wire MLS / Apify when ready.',
    nextRun: 'tomorrow 05:00 ET (Vercel cron)'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function scanForNewListings() {
  // STUB. Implement when MLS/Apify integration is available.
  // Expected return shape per item:
  // { street, city, state, zip, price, beds, baths, sqft, lotSqft, mlsUrl, sourceTimestamp }
  return [];
}
