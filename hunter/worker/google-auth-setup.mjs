#!/usr/bin/env node

/**
 * One-time Google OAuth2 setup for Hunter Script Copilot.
 * Opens browser for consent, exchanges auth code for refresh token.
 *
 * Prerequisites:
 *   1. Create a Google Cloud project
 *   2. Enable Google Docs API + Google Drive API
 *   3. Create OAuth 2.0 credentials (Desktop app)
 *   4. Download the client ID and secret
 *
 * Run: node hunter/worker/google-auth-setup.mjs
 */

import { createServer } from 'node:http';
import { URL } from 'node:url';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const SCOPES = [
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

const REDIRECT_PORT = 8764;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log('\n=== Hunter Script Copilot — Google OAuth Setup ===\n');
  console.log('This will get you a GOOGLE_REFRESH_TOKEN for the Docs + Drive APIs.\n');

  const clientId = await ask('Enter your GOOGLE_CLIENT_ID: ');
  const clientSecret = await ask('Enter your GOOGLE_CLIENT_SECRET: ');

  if (!clientId.trim() || !clientSecret.trim()) {
    console.error('Both client ID and secret are required.');
    process.exit(1);
  }

  // Build the consent URL
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId.trim());
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log('\nOpening browser for Google consent...');
  console.log(`If it doesn't open, visit:\n${authUrl.toString()}\n`);

  // Open browser
  try {
    execSync(`open "${authUrl.toString()}"`);
  } catch {
    console.log('(Could not open browser automatically)');
  }

  // Start local server to catch the redirect
  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname === '/callback') {
        const authCode = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error: ${error}</h1><p>Close this tab and try again.</p>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (authCode) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Done! You can close this tab.</h1><p>Return to the terminal.</p>');
          server.close();
          resolve(authCode);
          return;
        }
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`Listening on http://localhost:${REDIRECT_PORT}/callback ...\n`);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for OAuth callback'));
    }, 5 * 60 * 1000);
  });

  console.log('Got auth code, exchanging for tokens...');

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error(`Token exchange failed (${tokenRes.status}):`, text);
    process.exit(1);
  }

  const tokens = await tokenRes.json();

  console.log('\n=== SUCCESS ===\n');
  console.log('Add these to your .env file:\n');
  console.log(`GOOGLE_CLIENT_ID=${clientId.trim()}`);
  console.log(`GOOGLE_CLIENT_SECRET=${clientSecret.trim()}`);
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\n');

  if (!tokens.refresh_token) {
    console.warn('WARNING: No refresh_token received. You may need to revoke access at');
    console.warn('https://myaccount.google.com/permissions and run this again.');
    console.warn('Make sure prompt=consent is in the auth URL (it should be).');
  }

  rl.close();
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  rl.close();
  process.exit(1);
});
