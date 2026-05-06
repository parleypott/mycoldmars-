/**
 * Dropbox API client for Hunter.
 * Uses Dropbox HTTP API directly — no SDK dependency.
 * Auto-refreshes access token using DROPBOX_REFRESH_TOKEN.
 */

const BASE = 'https://api.dropboxapi.com/2';
const CONTENT_BASE = 'https://content.dropboxapi.com/2';

// Team namespace ID for accessing full Dropbox Business folder structure
const NAMESPACE_ID = process.env.DROPBOX_NAMESPACE_ID || '3229197859';

// Token state — auto-refreshes when expired
let cachedAccessToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  // If we have a valid cached token, use it
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;

  if (refreshToken && appKey && appSecret) {
    // Auto-refresh using refresh token
    console.log('[dropbox] refreshing access token...');
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: appKey,
        client_secret: appSecret,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dropbox token refresh failed ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    cachedAccessToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    console.log(`[dropbox] token refreshed, expires in ${data.expires_in}s`);
    return cachedAccessToken;
  }

  // Fallback to static token from env
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) throw new Error('No Dropbox credentials configured (need DROPBOX_REFRESH_TOKEN or DROPBOX_ACCESS_TOKEN)');
  return token;
}

async function headers() {
  return {
    Authorization: `Bearer ${await getToken()}`,
    'Content-Type': 'application/json',
    'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', namespace_id: NAMESPACE_ID }),
  };
}

/**
 * List files in a Dropbox folder.
 * Returns array of { name, path, size, isFolder }.
 */
export async function listFolder(path, recursive = false) {
  const res = await fetch(`${BASE}/files/list_folder`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({
      path: path === '/' ? '' : path,
      recursive,
      include_media_info: true,
      limit: 2000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox list_folder error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  let entries = data.entries.map(mapEntry);

  // Handle pagination
  let cursor = data.cursor;
  let hasMore = data.has_more;
  while (hasMore) {
    const more = await fetch(`${BASE}/files/list_folder/continue`, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ cursor }),
    });
    if (!more.ok) break;
    const moreData = await more.json();
    entries = entries.concat(moreData.entries.map(mapEntry));
    cursor = moreData.cursor;
    hasMore = moreData.has_more;
  }

  return entries;
}

/**
 * Download a file from Dropbox to a local path.
 * Returns the local path.
 */
export async function downloadFile(dropboxPath, localPath) {
  const { createWriteStream } = await import('node:fs');
  const { mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');

  await mkdir(dirname(localPath), { recursive: true });

  const token = await getToken();
  const res = await fetch(`${CONTENT_BASE}/files/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }),
      'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', namespace_id: NAMESPACE_ID }),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox download error ${res.status}: ${text.slice(0, 300)}`);
  }

  const writer = createWriteStream(localPath);
  const reader = res.body.getReader();

  return new Promise((resolve, reject) => {
    function pump() {
      reader.read().then(({ done, value }) => {
        if (done) { writer.end(); resolve(localPath); return; }
        if (!writer.write(value)) {
          writer.once('drain', pump);
        } else {
          pump();
        }
      }).catch(reject);
    }
    writer.on('error', reject);
    pump();
  });
}

/**
 * Get metadata for a file or folder.
 */
export async function getMetadata(path) {
  const res = await fetch(`${BASE}/files/get_metadata`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({
      path,
      include_media_info: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox get_metadata error ${res.status}: ${text.slice(0, 300)}`);
  }

  return mapEntry(await res.json());
}

function mapEntry(e) {
  return {
    name: e.name,
    path: e.path_lower || e.path_display,
    pathDisplay: e.path_display,
    size: e.size || 0,
    isFolder: e['.tag'] === 'folder',
    mediaInfo: e.media_info || null,
    modified: e.server_modified || null,
  };
}
