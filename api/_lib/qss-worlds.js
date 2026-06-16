// Server-side worlds registry — mirror of public/queen-scarlet-school/lib/worlds.js.
//
// Both files MUST stay in sync. If you add a world or change canonText
// or artStyle in one place, update the other.
//
// Why two copies: the client file is a self-contained <script> include
// with no build step, the server file is an ES module that Vercel edge
// functions import. The data shape is identical; the surface area is
// trimmed here to just what the server actually needs (slug + canonText
// + artStyle).

export const WORLDS = {
  'queen-scarlet': {
    slug: 'queen-scarlet',
    name: "Queen Scarlet's Apocalypse School",
    canonText: `You are writing for "Queen Scarlet's Apocalypse School" — a magical school setting where the staff treat impossible logistics (eleven-minute PA announcements, four-mile underground canals, banned bean varieties) as routine scheduling matters. Dark-satirical-absurd tone. Children are competent and resigned; adults are bureaucratic and oblivious. Calculator helmets, paperwork, beans, bunkers, dragons running schools.`,
    artStyle: {
      styleBlock: `STYLE: Hand-drawn children's storybook illustration in the tradition of warm classroom-comedy picture books. Thick uniform black ink outlines, slightly hand-varied weight. Flat cel-shaded color blocks — no gradients, no painterly textures, no airbrush, no rendering. Warm cream off-white paper background (#F4ECD8). Big rounded kid-friendly shapes. Soft natural light, no dramatic shadows. Faces are simple and expressive. Slight scrappiness, not slick — a smart, taste-driven illustrator's hand, not a stock asset.

PROP RULE (CRITICAL — read twice):
Each character has THEIR OWN distinct look. PROPS ARE PERSONAL — they belong to ONE character at a time. NEVER copy one character's signature prop onto another.

- Kevin (and Kevin ONLY) wears the grey calculator-helmet. Nobody else.
- Benny (and Benny ONLY) wears the orange safety vest and rides the forklift.
- Mark Rober looks like a normal Earth man — earnest, average build, polo shirt, no fantasy props, no helmet, no oversized accessory. Just a guy.
- Queen Scarlet is the red dragon. Only her.
- All other students and adults are ORDINARY-LOOKING kids and grown-ups with naturalistic features — varied skin tones, regular clothes, regular hair, NO calculator helmets, NO gas masks, NO antennae, NO doorknob noses. The humor comes from what's HAPPENING in the scene, not from giving every character a strange prop.

Most characters in a scene should be NORMAL-LOOKING — backgrounded students at desks, regular grown-ups, ordinary kids. Only the ONE or TWO main characters of the scene get their signature element, and only if it's their established look.

Palette: tomato red, butter yellow, teal, ochre, sky blue, mossy green, lavender, salmon pink, warm cream.

Skin tones rotate: deep brown / warm brown / golden / olive / freckled cream. White is the LAST option, not the first.`,
      references: `STYLE REFERENCE: Imagine the warm classroom-comedy register of Lauren Child + Oliver Jeffers + the panels in a Captain Underpants book, but more grounded — a real classroom with kids who actually look like kids, plus one absurd element happening in the scene (a beaver on a forklift, a kid on a scooter with a rocket). The absurdity lives in WHAT HAPPENS, not in every face. Cream paper. Black ink. Flat color. Real kids. One weird thing.`,
      dontList: `DO NOT: painterly brushwork, watercolor texture, photorealism, manga/anime, gradients, glow effects, lens flares, photorealistic shading, text/labels/captions/signs visible in the image, calculator-helmet on anyone but Kevin, gas mask on anyone but Benny, comic panel layouts, speech bubbles, thought bubbles, multi-beat collages. NEVER default to white skin. NEVER give every character an absurd prop — most characters are just normal kids and grown-ups with normal looks.`,
      paper: `Plain warm cream / off-white paper (#F4ECD8). Subjects centered or composed cinematically. Scenes can have classroom backgrounds, props, and other kids when they're part of the story.`,
    },
  },
  'burgundy': {
    slug: 'burgundy',
    name: 'Puppy Town — the Rico Uprising',
    canonText: `You are writing for "Puppy Town — the Rico Uprising" — Act I of a multi-volume saga about a backwater mining planet on the edge of the Universe Alliance Commodity Market.

═══ TONE ═══
This is NOT the playful sticker register of Queen Scarlet's Apocalypse School. This is grim industrial fable. Cinematic. Retro-futurist. The grown-ups are tyrants and the puppies are workers, miners, smugglers, peasants. Burgundy is intellectual, intense, calculating — sympathetic at the start, ruthless by the end of Act I. Studio Ghibli tonal weight (closer to Princess Mononoke + The Iron Giant + a Cormac McCarthy frontier).

═══ SETTING ═══
PUPPY TOWN is a mining planet — iron and a handful of esoteric specialty metals. Strategically negligible. Workforce: peasant puppy miners living at subsistence. The royal palace sits above the largest shaft complex. Most of what the planet produces ships offworld as tribute to Nicholas, an arms dealer none of the puppies have ever seen.

AESTHETIC: retro-futurist. MSDOS green-on-black terminals running heavy industrial equipment. CRT monitors. Hand-soldered boards. Audible relays. Boxy machines visibly assembled from scrap. The opposite of sleek — that is the point.

═══ CANONICAL CHARACTERS ═══
- BURGUNDY — the King's son. Tinker, engineer, autodidact. Builds in the palace basement against his father's orders. Has the peasant miners' trust because he works alongside them. Wires MSDOS terminals to industrial equipment. Writes self-modifying feedback loops that turn dumb machines into self-improving ones. By the end of Act I he overthrows his father, executes him after the surrender, crowns himself, and posts a sign declaring: "BURGUNDY, KING OF THE PUPPIES, GOD OF MACHINES." (This motto predates his coronation as Puppy King — it is his self-claimed title.)
- THE PUPPY KING (Burgundy's father) — tyrant, hoarder. Believes rule is hereditary class, not merit. Refuses innovation on principle. Pays tribute to Nicholas and calls it stewardship. Dies on his own throne, crown already passed to his son.
- THE QUEEN (Burgundy's mother) — unnamed, hates her husband. Quietly funds Burgundy's underground market purchases. Operates inside the palace without the King's notice. Open hook to fill in.
- NICHOLAS — off-world arms dealer. Receives Puppy Town's tribute. Never appears on the planet but looms over every scene. Setup for later acts.
- THE SPACE PIRATES — puppy smuggler crew. Run material in past the King's customs in exchange for whatever Burgundy can pay. Bridge to Act II.
- THE PEASANT MINERS — Burgundy's true court. Watch him build. Form the militia. After the siege, become the workforce of the new regime.

═══ TECH: THE RICO ═══
A Rico is a boxy, scrap-built robot — hardware mediocre, scored together from salvaged plate and rivets, CRT readout face glowing dim green with MSDOS-style text. The BREAKTHROUGH is not the hardware. The breakthrough is Burgundy wiring his terminal into the machine and writing self-modifying feedback loops. The Rico scores its own outcomes, mutates its parameters, runs itself thousands of times a day. After one week unattended in the mines, the prototype goes from useless to flawless. One unit outproduces a full shift.

- MINING RICO — original civilian variant. Industrial.
- BATTLE RICO V1 — armored, weaponized variant. Built in secret. Two hundred deployed in the siege. Untouched by the King's tanks.

═══ ACT I BEATS (canonical reference points) ═══
1. THE PITCH — Burgundy presents the prototype to his father, rejected violently.
2. THE FAILURE — Burgundy smuggles it into the mines. It performs terribly.
3. THE LOOP — Burgundy wires his terminal in and writes self-modifying feedback code. Walks away.
4. THE RETURN — One week later, the Rico mines flawlessly. One unit outproduces a full shift.
5. THE NETWORK — Smuggling operation: peasants, his mother, space pirates. The basement becomes a factory.
6. THE ARMY — Two hundred Battle Ricos V1. Peasant militia trained in whispers.
7. THE SIEGE — Palace doors fall. The King's tanks are scrap in minutes.
8. THE CROWN — The King surrenders the crown himself. Burgundy takes it — then orders the Ricos to kill him anyway.
9. THE NEW KING — Burgundy posts the motto "Burgundy, King of the Puppies, God of Machines." Crowns himself Puppy King. The planet's entire industrial capacity is repointed at Rico production.

═══ THEMES ═══
- Class revolt powered by tech the rulers refused to see.
- Self-modifying systems as the great equalizer — and the new weapon.
- The son becomes the father. (The surrender wasn't enough. Burgundy wanted the man dead.)
- Tribute, periphery, and dependence. Nicholas is still out there.

═══ VOICE RULES ═══
- Plain language. No marketing, no "weave/tapestry/delve/intricate/the story needs".
- Period-accurate scrap-tech vocabulary: solder, relay, schematic, terminal, shaft, ore, scrip, ledger, customs, tribute, hoard.
- Take the world seriously. The puppies are PEOPLE. The Ricos are dangerous.
- When writing Burgundy, lean cold-eyed. He is twelve, brilliant, and quietly furious.

═══ OPEN CALLS ═══
Henry can fill in: the Queen's name, the planet's official name (if different from "Puppy Town"), the specific esoteric metals.`,
    artStyle: {
      styleBlock: `STYLE: painterly cinematic illustration in the lineage of Studio Ghibli, Brad Bird's Iron Giant, and the YUCATAN 1512 movie poster. Hand-painted feel — visible brush strokes, soft edges, atmospheric depth, painted lighting. NOT vector, NOT sticker, NOT flat-cel. Treat each portrait as a single frame from an animated film about an industrial revolution on a backwater mining planet.
Palette: deep teal-blue night + warm amber lamplight + sienna and burgundy reds + iron-gray + occasional CRT-green or magma-orange accent. Cool ambient backdrop with one warm light source carving the subject. Heavy chiaroscuro. Earth-tone, never saccharine.
Framing: cinematic 3/4 portrait, character lit by a practical source (lamp, CRT glow, distant mine fire, broken stained glass). Atmosphere matters as much as character — show the world around them.
Texture: visible paper grain or canvas tooth. Watercolor washes for skies/atmosphere. Crisp ink only where structural (machine edges, schematic lines on whiteboards). Bias soft over sharp. Bias painted over inked.
Quality: looks like a still from a film, not a sticker on a notebook. Frame-worthy, not laptop-worthy.`,
      references: `REFERENCES (match these): Studio Ghibli (Mononoke / Castle in the Sky / Howl's Moving Castle) for character work and atmospheric backgrounds. Brad Bird's Iron Giant for the Rico aesthetic and the kid-with-giant-machine compositions. The YUCATAN 1512 movie poster by Alex Vede for flat-but-cinematic limited-palette tonal control. Carson Ellis, Sydney Smith, and Beatrice Alemagna for high-end painterly children's-book character illustration. The puppies are LITERAL dogs (brown-and-white, working breeds, weathered) wearing period-accurate work clothes and royal cloaks — NOT anthropomorphic cute cartoon mascots.`,
      dontList: `DO NOT use: sticker outlines, thick uniform black outlines, flat-cel coloring, warm cream "kid's book paper" background, vinyl-laptop-sticker quality, manga/anime conventions, photorealism, bright saccharine palettes, generic Disney-3D look, vector-clean lines. DO NOT make the puppies cute, baby-faced, or wearing "playful" outfits — they are workers and rebels in a hard world. DO NOT make the Ricos sleek, modern, or smooth — they are scrap-built, hand-soldered, deliberately ugly.`,
      paper: `Deep cinematic background — the character is embedded in their environment (mineshaft, basement workshop, throne room, smoke, lamplight). The background is NOT a flat colored paper. Show atmosphere.`,
    },
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

// Per-world art style — returns the styleBlock + references + dontList
// + paper for the active world. Used by qss-character-card to swap art
// register based on which world is generating the portrait.
export function artStyleForBody(body) {
  const slug = body?.world_slug || body?.world || DEFAULT_WORLD;
  const w = resolveWorld(slug);
  return w.artStyle || WORLDS[DEFAULT_WORLD].artStyle;
}

// ─── DB-backed live overrides ────────────────────────────────────────
// The World Style Hub (UI at /universe/<world>/style/) writes art_style
// and canon_text into the qss_worlds row. loadWorldStyle merges the DB
// values OVER the bundled defaults so Johnny can iterate on style
// without a deploy. DB miss / network error / column null → fall back
// to bundled defaults silently. Cache TTL keeps prod off Supabase on
// every portrait draw.

const STYLE_CACHE = new Map();   // slug → { fetchedAt, art_style, canon_text }
const STYLE_TTL_MS = 5 * 60 * 1000;

async function fetchWorldRowFromDb(slug) {
  const supaUrl = process.env.QSS_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.QSS_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return null;
  try {
    const r = await fetch(
      `${supaUrl}/rest/v1/qss_worlds?slug=eq.${encodeURIComponent(slug)}&select=art_style,canon_text&limit=1`,
      {
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch { return null; }
}

// Returns merged { artStyle, canonText } for a slug. DB overrides win
// per-field; missing/empty DB fields fall through to the bundled
// hardcoded values in WORLDS above. Cached per-instance with a 5-min
// TTL so a busy draw burst hits Supabase at most once.
export async function loadWorldStyle(slug) {
  const key = sanitizeSlug(slug);
  const now = Date.now();
  const cached = STYLE_CACHE.get(key);
  if (cached && (now - cached.fetchedAt) < STYLE_TTL_MS) {
    return mergeStyle(key, cached);
  }
  const row = await fetchWorldRowFromDb(key);
  const entry = {
    fetchedAt: now,
    art_style: row?.art_style && typeof row.art_style === 'object' ? row.art_style : null,
    canon_text: typeof row?.canon_text === 'string' && row.canon_text.length ? row.canon_text : null,
  };
  STYLE_CACHE.set(key, entry);
  return mergeStyle(key, entry);
}

function mergeStyle(slug, entry) {
  const bundled = WORLDS[slug] || WORLDS[DEFAULT_WORLD];
  const bundledArt = bundled.artStyle || {};
  const dbArt = entry.art_style || {};
  // Per-field override: any non-empty string in DB beats bundled.
  const artStyle = {
    styleBlock: stringPick(dbArt.styleBlock, bundledArt.styleBlock),
    references: stringPick(dbArt.references, bundledArt.references),
    dontList:   stringPick(dbArt.dontList,   bundledArt.dontList),
    paper:      stringPick(dbArt.paper,      bundledArt.paper),
    slug,
  };
  const canonText = stringPick(entry.canon_text, bundled.canonText);
  return { artStyle, canonText, slug, name: bundled.name };
}

function stringPick(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.length) return c;
  }
  return '';
}

// Resolve an arbitrary slug to a KNOWN world key, driven by the WORLDS
// registry itself — NOT a hardcoded allowlist. This is the same logic
// resolveWorld() uses; keeping the two in sync is the whole point.
// Previously this was `if (s === 'burgundy') return 'burgundy'`, which
// silently mis-routed any future third world (carried on a story's
// world_slug) into queen-scarlet's art register. Registry-driven means
// adding a world to WORLDS above is the only edit ever needed.
export function sanitizeSlug(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return WORLDS[s] ? s : DEFAULT_WORLD;
}

// Cache-bust hook — call from PUT handler after writing so the next
// draw picks up the new style without waiting out the TTL.
export function invalidateWorldStyleCache(slug) {
  if (slug) STYLE_CACHE.delete(sanitizeSlug(slug));
  else STYLE_CACHE.clear();
}
