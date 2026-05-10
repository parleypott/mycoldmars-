import { checkAccess } from './_lib/access.js';

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
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const denied = checkAccess(req);
  if (denied) return denied;

  const body = await req.text();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body,
  });

  // Pipe Anthropic's response (including SSE stream) straight to browser
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
