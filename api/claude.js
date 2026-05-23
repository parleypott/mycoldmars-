import { checkAccess } from './_lib/access.js';
import { withSentry } from './_lib/sentry.js';

export const config = { runtime: 'edge' };

/**
 * Thin proxy to Anthropic API. Adds the API key and pipes the
 * streaming response straight to the browser. Takes <100ms of
 * server time — all waiting happens client-side.
 *
 * Gated by checkAccess(): without the right x-access-code header the
 * endpoint 401s. Without this, anyone with the URL could blast through
 * Johnny's Anthropic budget by hitting /api/claude directly.
 */
export default withSentry(async function handler(req) {
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'POST only');
  }
  const denied = await checkAccess(req);
  if (denied) return denied;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonError(500, 'misconfigured', 'ANTHROPIC_API_KEY is not set on the server.');
  }

  const body = await req.text();

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    });
  } catch (err) {
    // Network error reaching Anthropic — previously this threw an
    // uncaught TypeError and Vercel returned a bare HTML 500 page.
    return jsonError(502, 'anthropic_unreachable', err?.message || String(err));
  }

  // Pipe Anthropic's response (including SSE stream) straight to browser
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
});

function jsonError(status, error, message) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
