/**
 * Google Docs + Drive API client for Hunter.
 * Uses REST API directly — no SDK dependency.
 * Auto-refreshes access token using GOOGLE_REFRESH_TOKEN (same pattern as dropbox-client.js).
 */

const DOCS_BASE = 'https://docs.googleapis.com/v1';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

// Token state — auto-refreshes when expired
let cachedAccessToken = null;
let tokenExpiresAt = 0;

export async function getGoogleToken() {
  // If we have a valid cached token, use it (with 60s buffer)
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error('Google OAuth not configured — need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN in .env. Run google-auth-setup.mjs to get these.');
  }

  console.log('[google] refreshing access token...');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);
  console.log(`[google] token refreshed, expires in ${data.expires_in}s`);
  return cachedAccessToken;
}

async function headers() {
  return {
    Authorization: `Bearer ${await getGoogleToken()}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch full structured document from Google Docs API.
 * Returns the raw JSON with body.content[], headers, footers, tables, etc.
 */
export async function fetchDocStructured(docId) {
  const url = `${DOCS_BASE}/documents/${docId}`;
  console.log(`[google] fetching structured doc ${docId}...`);

  const res = await fetch(url, { headers: await headers() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Docs API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const doc = await res.json();
  console.log(`[google] fetched doc "${doc.title}" (${doc.body?.content?.length || 0} elements)`);
  return doc;
}

/**
 * Fetch document revision list from Drive API.
 * Useful for version tracking — returns revisionId, modifiedTime, lastModifyingUser.
 */
export async function fetchDocRevisions(docId) {
  const url = `${DRIVE_BASE}/files/${docId}/revisions?fields=revisions(id,modifiedTime,lastModifyingUser)&pageSize=100`;

  const res = await fetch(url, { headers: await headers() });
  if (!res.ok) {
    const text = await res.text();
    // Drive API might not be enabled or no permission — non-fatal
    console.log(`[google] revisions fetch failed ${res.status}: ${text.slice(0, 100)}`);
    return [];
  }

  const data = await res.json();
  return data.revisions || [];
}

/**
 * Get the latest revision ID for a document.
 */
export async function getLatestRevisionId(docId) {
  const revisions = await fetchDocRevisions(docId);
  if (!revisions.length) return null;
  return revisions[revisions.length - 1].id;
}

/**
 * Check if a document has been modified since a given revision.
 * Uses Drive API modifiedTime for efficiency (no need to fetch full revisions).
 */
export async function checkDocModified(docId, sinceTimestamp) {
  const url = `${DRIVE_BASE}/files/${docId}?fields=modifiedTime`;

  const res = await fetch(url, { headers: await headers() });
  if (!res.ok) return true; // assume modified if we can't check

  const data = await res.json();
  return new Date(data.modifiedTime).getTime() > new Date(sinceTimestamp).getTime();
}

/**
 * Extract doc ID from a Google Docs URL.
 */
export function extractDocId(url) {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Can't extract doc ID from: ${url}`);
  return match[1];
}
