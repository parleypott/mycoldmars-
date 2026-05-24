// queen-scarlet-school: world explorer — generate fresh imagery in the
// kid's curated taste (loved images become references + tags).
//
// Body: {
//   world: string,
//   styleContext: { refs: [], titles: [], tags: [], prompt_suffix: string },
//   count: number  // how many fresh images to paint (default 4, max 6)
// }
//
// Response: { images: [{ id, url, title, tags }], world, ms }
//
// V1 STATUS: stubbed. Reads styleContext, builds the prompt, returns a
// "not-yet-wired" 200 so the UI degrades cleanly. Wire to nano-banana
// (Gemini imagen) when ready — same pattern as qss-character-card.js but
// with the loved corpus injected as inline-image references in the
// multimodal prompt.

import { checkAccess as sharedCheckAccess } from './_lib/access.js';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const t0 = Date.now();
  try {
    await sharedCheckAccess(req);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  const world = (body.world || 'burgundy').slice(0, 32);
  const ctx = body.styleContext || {};
  const count = Math.max(1, Math.min(6, Number(body.count) || 4));

  // Build the prompt we WOULD send. Useful even when stubbed — the client
  // can show "here's what we'd ask for" if curious.
  const builtPrompt = [
    'Paint a new image in the visual world of the references provided.',
    ctx.prompt_suffix || '',
    ctx.titles && ctx.titles.length ? `Inspired by: ${ctx.titles.join(', ')}.` : '',
    ctx.tags && ctx.tags.length ? `Lean into: ${ctx.tags.slice(0, 8).join(', ')}.` : '',
    'Same painted lighting, same paper texture, same atmospheric depth.',
    'Single frame, frame-worthy composition, NOT a sticker, NOT vector.',
  ].filter(Boolean).join(' ');

  // V1 stub return — client falls back gracefully.
  return new Response(JSON.stringify({
    images: [],
    world,
    count,
    builtPrompt,
    note: 'taste saved · gen pipe not wired yet · prompt available above',
    ms: Date.now() - t0
  }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
