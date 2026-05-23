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
      styleBlock: `STYLE: Whimsical, weird, prop-driven sticker illustration. As imaginative as a brilliant 13-year-old's drawings of his own characters. EVERY character has at least ONE absurd, oversized, story-specific physical feature or prop — a calculator-helmet head, a forklift, a gas mask, antennae, extra eyes, a doorknob for a nose. The prop or feature IS the character. Thick uniform black ink outlines. Flat saturated cel-shaded colors — no gradients, no painterly textures. Palette: tomato red, butter yellow, teal, ochre, sky blue, mossy green, lavender, salmon pink, warm cream. Plain warm cream / off-white paper background (#F4ECD8). Cinematic 3/4 or head-and-shoulders framing. Deadpan, sincere, faintly satirical expression — never smiling at the camera. Vinyl laptop sticker quality. Charmingly drawn, slightly dorky, not slick.`,
      references: `STYLE REFERENCES: (1) GOLD STANDARD — Kevin: a boy with a giant grey calculator-helmet swallowing his whole head, "ERROR: 3000" on the red screen, BEEP BEEP BEEP lozenges, bagel sandwich, teal hoodie with K, blue backpack. (2) Benny the beaver in orange safety vest + gas mask on a yellow forklift loaded with green BEANS cans. (3) Red cartoon dragon with yellow horns and teal-and-orange wings. EVERY new character must hit the Kevin bar.`,
      dontList: `DO NOT use: painterly brushwork, watercolor texture, photorealism, manga/anime conventions, gradient backgrounds, scenery, ambient props, text, labels, captions, signage, written words of any kind, generic smiling kid with no prop, stock cartoon boy face, default-white skin. NEVER default to white — human skin rotates deep brown / warm brown / golden / olive / freckled cream OR non-human (lavender, mossy green, sunshine yellow, slate blue, terracotta). White is the LAST option, not the first.`,
      paper: `Plain warm cream / off-white paper (#F4ECD8). No scenery. Centered subject.`,
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
