export const config = { runtime: 'edge' };

/**
 * Simple access code gate. Validates a code against an environment variable.
 * No usernames, no sessions — just a shared secret.
 */
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { code } = await req.json();
  const validCode = process.env.ACCESS_CODE;

  if (!validCode) {
    // If no access code is configured, allow everyone
    return new Response('OK', { status: 200 });
  }

  if (code === validCode) {
    return new Response('OK', { status: 200 });
  }

  return new Response('Invalid code', { status: 401 });
}
