// Server-side worlds registry — mirror of queen-scarlet-school/lib/worlds.js.
//
// Both files MUST stay in sync. If you add a world or change canonText
// in one place, update the other.
//
// Why two copies: the client file is a self-contained <script> include
// with no build step, the server file is an ES module that Vercel edge
// functions import. The data shape is identical; the surface area is
// trimmed here to just what the server actually needs (slug + canonText).

export const WORLDS = {
  'queen-scarlet': {
    slug: 'queen-scarlet',
    name: "Queen Scarlet's Apocalypse School",
    canonText: `You are writing for "Queen Scarlet's Apocalypse School" — a magical school setting where the staff treat impossible logistics (eleven-minute PA announcements, four-mile underground canals, banned bean varieties) as routine scheduling matters. Dark-satirical-absurd tone. Children are competent and resigned; adults are bureaucratic and oblivious. Calculator helmets, paperwork, beans, bunkers, dragons running schools.`,
  },
  'burgundy': {
    slug: 'burgundy',
    name: 'Burgundy and the Ricos',
    canonText: `You are writing for "Burgundy and the Ricos" — a story world about Burgundy, a puppy who became a king and then transcended into a technology-godlike figure. He built the Ricos: extraordinarily advanced robots. This world shares a universe with "Queen Scarlet's Apocalypse School" but operates by different rules with different characters and a different feel. Tone, voice, and specific lore details to be defined by Johnny.`,
  },
};

export const DEFAULT_WORLD = 'queen-scarlet';

// Resolve a slug to its world record. Falls back to default if missing
// or unknown — never throws. Server endpoints should call this and
// inject `world.canonText` into their system prompts.
export function resolveWorld(slug) {
  const key = typeof slug === 'string' ? slug.toLowerCase().trim() : '';
  return WORLDS[key] || WORLDS[DEFAULT_WORLD];
}

// Convenience: pull the canon overlay block out of a body, ready to
// slot into a system prompt. Always returns a non-empty string.
export function canonOverlayForBody(body) {
  const slug = body?.world_slug || body?.world || DEFAULT_WORLD;
  const w = resolveWorld(slug);
  return `\n\n═══ WORLD CANON: ${w.name} ═══\n${w.canonText}\n`;
}
