#!/usr/bin/env node

/**
 * Browser automation to grab API credentials and set up Dropbox app.
 * Drives the user's real Chrome profile so logged-in sessions persist.
 *
 * Run: node hunter/worker/setup-browser.js
 */

import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CHROME_PROFILE = join(process.env.HOME, 'Library/Application Support/Google/Chrome');
const ENV_PATH = join(import.meta.dirname, '..', '..', '.env');

// Collect credentials
const creds = {};

// Load existing .env if present
if (existsSync(ENV_PATH)) {
  const lines = readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) creds[match[1].trim()] = match[2].trim();
  }
}

async function run() {
  console.log('[setup] Launching Chrome with user profile...');

  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false,
    channel: 'chrome',
    args: ['--no-first-run', '--no-default-browser-check'],
    viewport: { width: 1280, height: 900 },
    timeout: 60000,
  });

  try {
    // ── Step 1: Supabase credentials ──
    if (!creds.VITE_SUPABASE_URL || !creds.VITE_SUPABASE_ANON_KEY) {
      console.log('[setup] Step 1: Getting Supabase credentials...');
      await getSupabaseCreds(browser);
    } else {
      console.log('[setup] Step 1: Supabase creds already in .env, skipping');
    }

    // ── Step 2: Gemini API key ──
    if (!creds.GEMINI_API_KEY) {
      console.log('[setup] Step 2: Getting Gemini API key...');
      await getGeminiKey(browser);
    } else {
      console.log('[setup] Step 2: Gemini key already in .env, skipping');
    }

    // ── Step 3: Dropbox app ──
    if (!creds.DROPBOX_APP_KEY) {
      console.log('[setup] Step 3: Creating Dropbox app...');
      await setupDropbox(browser);
    } else {
      console.log('[setup] Step 3: Dropbox creds already in .env, skipping');
    }

    // Write .env
    writeEnv();
    console.log('[setup] Done! .env written to', ENV_PATH);

  } finally {
    await browser.close();
  }
}

async function getSupabaseCreds(browser) {
  const page = await browser.newPage();
  try {
    await page.goto('https://supabase.com/dashboard/projects', { waitUntil: 'networkidle', timeout: 30000 });

    // Check if logged in
    const url = page.url();
    if (url.includes('sign-in') || url.includes('login')) {
      console.log('[setup] Not logged into Supabase. Waiting 30s for manual login...');
      await page.waitForURL('**/dashboard/**', { timeout: 60000 });
    }

    // Find the project — look for any project link
    console.log('[setup] Looking for Supabase projects...');
    await page.waitForSelector('a[href*="/project/"]', { timeout: 15000 });

    // Get the first project link
    const projectLink = await page.$('a[href*="/project/"]');
    const href = await projectLink.getAttribute('href');
    const projectRef = href.match(/\/project\/([^/]+)/)?.[1];

    if (!projectRef) {
      console.log('[setup] Could not find project ref. Please check manually.');
      return;
    }

    console.log('[setup] Found project:', projectRef);

    // Go to API settings
    await page.goto(`https://supabase.com/dashboard/project/${projectRef}/settings/api`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Get the URL
    const urlEl = await page.$('input[value*="supabase.co"]');
    if (urlEl) {
      creds.VITE_SUPABASE_URL = await urlEl.getAttribute('value');
      creds.SUPABASE_URL = creds.VITE_SUPABASE_URL;
      console.log('[setup] Got Supabase URL:', creds.VITE_SUPABASE_URL);
    }

    // Get the anon key — it's usually in a code block or input
    const pageText = await page.textContent('body');
    const anonMatch = pageText.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (anonMatch) {
      creds.VITE_SUPABASE_ANON_KEY = anonMatch[0];
      creds.SUPABASE_SERVICE_KEY = anonMatch[0]; // Will use anon for now; service key needs separate grab
      console.log('[setup] Got Supabase anon key');
    }

    // Try to get service role key too
    const revealBtns = await page.$$('button:has-text("Reveal")');
    for (const btn of revealBtns) {
      await btn.click();
      await page.waitForTimeout(500);
    }

    // After revealing, try again for service key
    const pageText2 = await page.textContent('body');
    const keys = pageText2.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g);
    if (keys && keys.length >= 2) {
      // First is usually anon, second is service role
      creds.VITE_SUPABASE_ANON_KEY = keys[0];
      creds.SUPABASE_SERVICE_KEY = keys[1];
      console.log('[setup] Got both Supabase keys');
    }

  } catch (err) {
    console.error('[setup] Supabase error:', err.message);
  } finally {
    await page.close();
  }
}

async function getGeminiKey(browser) {
  const page = await browser.newPage();
  try {
    await page.goto('https://aistudio.google.com/apikey', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check if logged in
    const url = page.url();
    if (url.includes('accounts.google.com')) {
      console.log('[setup] Not logged into Google. Waiting for manual login...');
      await page.waitForURL('**/aistudio.google.com/**', { timeout: 60000 });
      await page.waitForTimeout(3000);
    }

    // Look for existing API keys on the page
    const pageText = await page.textContent('body');
    const keyMatch = pageText.match(/AIza[A-Za-z0-9_-]{35}/);
    if (keyMatch) {
      creds.GEMINI_API_KEY = keyMatch[0];
      console.log('[setup] Found existing Gemini API key');
      return;
    }

    // Try clicking "Create API key" button
    const createBtn = await page.$('button:has-text("Create API key")');
    if (createBtn) {
      await createBtn.click();
      await page.waitForTimeout(3000);

      // Look for the key in a dialog or on the page
      const dialogText = await page.textContent('body');
      const newKey = dialogText.match(/AIza[A-Za-z0-9_-]{35}/);
      if (newKey) {
        creds.GEMINI_API_KEY = newKey[0];
        console.log('[setup] Created new Gemini API key');
        return;
      }
    }

    console.log('[setup] Could not find/create Gemini key automatically. Check Google AI Studio.');
  } catch (err) {
    console.error('[setup] Gemini error:', err.message);
  } finally {
    await page.close();
  }
}

async function setupDropbox(browser) {
  const page = await browser.newPage();
  try {
    // Go to Dropbox app creation page
    await page.goto('https://www.dropbox.com/developers/apps/create', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const url = page.url();
    if (url.includes('login') || url.includes('signin')) {
      console.log('[setup] Not logged into Dropbox. Waiting for manual login...');
      await page.waitForURL('**/developers/**', { timeout: 60000 });
      await page.waitForTimeout(2000);
    }

    // Check if we're on the create page
    if (page.url().includes('/create')) {
      // Select "Scoped access"
      const scopedBtn = await page.$('input[value="app_folder"], label:has-text("Scoped access"), [data-testid*="scoped"]');
      if (scopedBtn) await scopedBtn.click();

      // Select "Full Dropbox" access
      const fullBtn = await page.$('input[value="full_dropbox"], label:has-text("Full Dropbox"), [data-testid*="full"]');
      if (fullBtn) await fullBtn.click();

      // Enter app name
      const nameInput = await page.$('input[name="name"], input[placeholder*="name"], input[type="text"]');
      if (nameInput) {
        await nameInput.fill('Newpress Hunter');
      }

      // Create the app
      const createBtn = await page.$('button:has-text("Create app"), input[type="submit"]');
      if (createBtn) {
        await createBtn.click();
        await page.waitForTimeout(5000);
      }
    }

    // We should now be on the app settings page (or already there if app exists)
    // Try navigating to the app directly
    await page.goto('https://www.dropbox.com/developers/apps', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Find our app
    const hunterLink = await page.$('a:has-text("Newpress Hunter")');
    if (hunterLink) {
      await hunterLink.click();
      await page.waitForTimeout(3000);
    }

    // Get app key and secret from the settings page
    const settingsText = await page.textContent('body');

    // App key is usually a short alphanumeric string
    const appKeyEl = await page.$('input[readonly][value], code, .app-key');
    if (appKeyEl) {
      const val = await appKeyEl.getAttribute('value') || await appKeyEl.textContent();
      if (val && val.length > 8 && val.length < 30) {
        creds.DROPBOX_APP_KEY = val.trim();
        console.log('[setup] Got Dropbox app key:', creds.DROPBOX_APP_KEY);
      }
    }

    // Look for "Show" button to reveal secret
    const showBtn = await page.$('button:has-text("Show")');
    if (showBtn) {
      await showBtn.click();
      await page.waitForTimeout(1000);
    }

    // Try to generate access token
    const generateBtn = await page.$('button:has-text("Generate"), button:has-text("generate access token")');
    if (generateBtn) {
      await generateBtn.click();
      await page.waitForTimeout(3000);

      // Look for the token
      const tokenText = await page.textContent('body');
      const tokenMatch = tokenText.match(/sl\.[A-Za-z0-9_-]{100,}/);
      if (tokenMatch) {
        creds.DROPBOX_ACCESS_TOKEN = tokenMatch[0];
        console.log('[setup] Got Dropbox access token');
      }
    }

    // Screenshot the final state for debugging
    await page.screenshot({ path: '/tmp/dropbox-setup.png' });
    console.log('[setup] Screenshot saved to /tmp/dropbox-setup.png');

  } catch (err) {
    console.error('[setup] Dropbox error:', err.message);
  } finally {
    await page.close();
  }
}

function writeEnv() {
  const lines = [];
  for (const [key, val] of Object.entries(creds)) {
    if (val) lines.push(`${key}=${val}`);
  }
  writeFileSync(ENV_PATH, lines.join('\n') + '\n');
  console.log('[setup] Wrote', lines.length, 'env vars');
}

run().catch(err => {
  console.error('[setup] Fatal:', err);
  process.exit(1);
});
