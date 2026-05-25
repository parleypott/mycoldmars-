// queen-scarlet-school: centralized art direction.
//
// ONE place that knows:
//   - the global storybook style preface (warm classroom-comedy
//     register, ink + flat color, ban on panels/text/bubbles)
//   - the composition rule (one hero moment per scene)
//   - the prop rule (signature props belong to ONE character at a
//     time; extras are normal-looking)
//   - the per-character lookbook (canonical signature + do + don't)
//
// Every image-gen call (storyboard, storybook, edit modal,
// scene-illustrate) builds its final prompt by calling
// `assembleImagePrompt({ sceneText, charactersInScene, extra })`.
// If Johnny ever needs to fix a recurring problem (Mark Rober gets
// a calculator-helmet, Benny appears without his vest), ONE edit
// here propagates to every entry point.
//
// USAGE:
//   import { assembleImagePrompt, CHARACTER_LOOKBOOK, GLOBAL_PROP_RULE } from './qss-art-direction.js';
//   const prompt = assembleImagePrompt({
//     sceneText: "Mark sat at his desk, staring at the contract...",
//     charactersInScene: ['mark rober', 'queen scarlet'],
//     extra: 'EXTRA INSTRUCTION: make the dragon bigger.',
//   });

// ─────────────────────────────────────────────────────────────
//  GLOBAL STYLE PREFACE
// ─────────────────────────────────────────────────────────────
// Rewritten 2026-05-25 against Google's official nano-banana prompting
// guide: narrative paragraphs beat keyword lists, positive framing beats
// negative ("empty street", not "no cars"). One tight paragraph.
export const GLOBAL_STYLE_PREFACE = `Hand-drawn children's storybook illustration, 16:9 single full-bleed frame, thick black ink outlines with slightly varied hand-drawn weight, flat cel-shaded color blocks on a warm cream paper background (#F4ECD8). Soft natural light, no gradients, no airbrush, no photorealism. Mood: classroom-comedy in the tradition of Lauren Child and Oliver Jeffers — scrappy, warm, expressive, a smart illustrator's hand. Palette: tomato red, butter yellow, teal, ochre, sky blue, mossy green, lavender, salmon pink. Skin tones rotate across deep brown, warm brown, golden, olive, freckled cream — white is the last option.`;

// ─────────────────────────────────────────────────────────────
//  COMPOSITION RULE — one hero moment per scene
// ─────────────────────────────────────────────────────────────
export const COMPOSITION_RULE = `COMPOSITION RULE (absolute, do not break):
- ONE single image. ONE moment. ONE composition. ONE camera angle.
- NEVER a comic panel layout. NEVER a multi-panel collage. NEVER split-screen.
- NEVER speech bubbles. NEVER thought bubbles. NEVER captions.
- NEVER any text, words, letters, numbers, signs, or labels visible inside the image.
- NEVER show a sequence of beats. Pick the ONE strongest visual moment from the scene below — the most surprising, the most physically dynamic, or the most emotionally loaded — and render ONLY that single picture.
- If the scene describes many things happening, choose the SINGLE image that captures the spirit best. Drop the rest.
- Treat the output like one page of a picture book, NOT a page of a graphic novel.`;

// ─────────────────────────────────────────────────────────────
//  GLOBAL PROP RULE — signature props belong to ONE character
// ─────────────────────────────────────────────────────────────
// This is the rule the model keeps wanting to break. We say it
// loudly, in two voices: a general principle + a list of the
// canonical character-prop pairs that already exist in the world.
export const GLOBAL_PROP_RULE = `PROP RULE (absolute, do not break):
- Signature visual props belong to ONE character at a time. NEVER copy a prop onto another character.
- The character lookbook below tells you which prop belongs to whom. Apply each character's signature ONLY when that character is in the scene.
- Background characters in any scene are ORDINARY-LOOKING kids and grown-ups with naturalistic features — varied skin tones, regular clothes, regular hair, NO calculator helmets, NO gas masks, NO antennae, NO doorknob noses. Most characters in any scene are normal.
- The absurdity lives in WHAT HAPPENS in the scene, not in every face.`;

// ─────────────────────────────────────────────────────────────
//  CHARACTER LOOKBOOK — canonical signature per character
// ─────────────────────────────────────────────────────────────
// Keyed by LOWERCASE name. Each entry:
//   { name, aliases?, signature, do?, dont? }
//
// `signature` = the canonical "this is what this character looks
// like" description. Always included when the character appears.
// `do` = positive constraints (e.g., always wears the orange vest).
// `dont` = negative constraints (e.g., NEVER has a calculator-helmet
// on Mark; NEVER without the vest on Benny). The negative rules are
// the load-bearing ones — they're what stops trope-bleed.
//
// Add new characters here as Henry creates them in his stories. Or
// pull from qss_cast in a future iteration so the kid can edit
// directly. For now, hardcoded canon for the established cast.
export const CHARACTER_LOOKBOOK = {
  kevin: {
    name: 'Kevin',
    signature: 'A school-age boy with a giant grey calculator-helmet completely swallowing his head, red display screen on the calculator showing "ERROR: 3000", teal hoodie with a "K" on the chest, blue backpack. Bagel sandwich sometimes in hand. The calculator-helmet IS his identity.',
    do: 'Always shows the calculator-helmet — that\'s how the reader knows it\'s Kevin.',
    dont: 'Never appears without the calculator-helmet. Never has any other helmet.',
  },
  benny: {
    name: 'Benny the Prepared Beaver',
    aliases: ['benny the beaver', 'benny the prepared beaver'],
    signature: 'An anthropomorphic brown beaver standing upright, wearing an orange high-visibility safety vest, sometimes operating a yellow forklift loaded with green cans of beans. Cartoonish friendly face. Buck teeth visible.',
    do: 'Always wears the orange safety vest.',
    dont: 'Never appears as a normal beaver without the vest. Never wears a calculator-helmet — that\'s Kevin.',
  },
  'queen scarlet': {
    name: 'Queen Scarlet',
    aliases: ['scarlet', 'queen scarlet'],
    signature: 'A large red cartoon dragon with yellow horns and teal-and-orange wings. Scaled body, claws, fierce-but-charming face. Often wearing some kind of sash or accessory tied to her latest scheme (Chief Monetization Officer sash, etc.).',
    do: 'Always red, always a dragon, always the dominant presence in any room.',
    dont: 'Never appears as a human. Never small. Never has a calculator-helmet.',
  },
  'mark rober': {
    name: 'Mark Rober',
    aliases: ['mark', 'mr rober'],
    signature: 'A normal Earth man in his late thirties — friendly face, short brown hair, light beard stubble or clean-shaven, blue or teal polo shirt, jeans. Average build. Looks like a real YouTuber filming in his studio. Normal hands. Normal expressions.',
    do: 'Looks like a regular guy. Earnest. Slightly anxious in awkward moments. Holds normal objects like a clipboard or a phone.',
    dont: 'NEVER wears a calculator-helmet. NEVER wears any helmet. NEVER has oversized props, antennae, or non-human features. He is a NORMAL HUMAN. If the model is tempted to give him a calculator-helmet, the answer is no — that\'s Kevin\'s.',
  },
  'principal gerald': {
    name: 'Principal Gerald',
    signature: 'A tall, slightly stooped older man in a brown suit, balding with grey hair on the sides, bushy eyebrows. Bureaucratic. Always carries a clipboard or a thick manila folder. Glasses on a chain.',
    do: 'Looks tired but proper. Slightly comic.',
    dont: 'Never wears a calculator-helmet. Never wears a costume.',
  },
  'lunch lady': {
    name: 'The Lunch Lady',
    signature: 'A middle-aged woman in a white kitchen apron and a hairnet, holding a giant ladle. Stern face. Big serving station behind her.',
    do: 'Always in the kitchen apron.',
    dont: 'Never wears a calculator-helmet.',
  },
  'teacher (first period)': {
    name: 'The First-Period Teacher',
    signature: 'A teacher at a chalkboard, dressed in plain professional clothes. Could be any age, any skin tone — rotate. Holds a piece of chalk or a textbook.',
    do: 'Looks like a real teacher.',
    dont: 'Never wears a calculator-helmet.',
  },
};

// ─────────────────────────────────────────────────────────────
//  CHARACTER DETECTION + LOOKBOOK SUBSET
// ─────────────────────────────────────────────────────────────
// Given the scene text (the actual prose being illustrated), find
// which lookbook characters appear and return their lookbook entries.
// Used by assembleImagePrompt to include only the relevant character
// constraints — keeps the prompt focused and prevents off-screen
// characters from leaking props into the scene.
export function detectCharactersInScene(sceneText) {
  const t = String(sceneText || '').toLowerCase();
  const hits = [];
  for (const [key, entry] of Object.entries(CHARACTER_LOOKBOOK)) {
    const names = [key, ...(entry.aliases || []), entry.name];
    let matched = false;
    for (const n of names) {
      const lname = String(n).toLowerCase();
      const re = new RegExp(`\\b${lname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(t)) { matched = true; break; }
    }
    if (matched) hits.push({ key, ...entry });
  }
  return hits;
}

// ─────────────────────────────────────────────────────────────
//  ASSEMBLE THE FINAL PROMPT
// ─────────────────────────────────────────────────────────────
// One assembly function used by every gen path. Order matters —
// style + composition + prop rule sit ABOVE the character lookbook
// so they constrain how the lookbook is applied, and the lookbook
// sits ABOVE the scene text so the model reads who's in the scene
// before reading what they're doing.
export function assembleImagePrompt({
  sceneText = '',
  charactersInScene = null,  // pass null to auto-detect, or pass an explicit list of name keys
  extra = '',
  variation = false,
}) {
  // Auto-detect if not provided
  const characters = (charactersInScene && charactersInScene.length)
    ? charactersInScene.map(key => CHARACTER_LOOKBOOK[String(key).toLowerCase()]).filter(Boolean)
    : detectCharactersInScene(sceneText);

  const lookbookBlock = characters.length
    ? `CHARACTERS IN THIS SCENE (use these established looks — only these characters get their signature props; all other faces in the scene are ordinary-looking extras):\n${characters.map(c => {
        const lines = [`- ${c.name}: ${c.signature}`];
        if (c.do) lines.push(`  DO: ${c.do}`);
        if (c.dont) lines.push(`  DON'T: ${c.dont}`);
        return lines.join('\n');
      }).join('\n\n')}`
    : 'CHARACTERS: no established cast members in this scene — render the people as normal-looking kids and grown-ups with naturalistic features.';

  const variationBlock = variation
    ? `\nVARIATION — same scene, same characters, but a meaningfully DIFFERENT camera angle, composition, or chosen moment from any previous attempt.`
    : '';
  const extraBlock = extra ? `\nEXTRA INSTRUCTION: ${extra}` : '';

  return [
    GLOBAL_STYLE_PREFACE,
    '',
    COMPOSITION_RULE,
    '',
    GLOBAL_PROP_RULE,
    '',
    lookbookBlock,
    '',
    `SCENE TO ILLUSTRATE:\n${sceneText.slice(0, 1800)}${variationBlock}${extraBlock}`,
  ].join('\n');
}
