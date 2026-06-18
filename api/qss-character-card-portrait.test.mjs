/**
 * Tests for buildPortraitPrompt (api/qss-character-card.js).
 *
 * Run: node qss-character-card-portrait.test.mjs  (from api/)  — or `bun run test`.
 *
 * buildPortraitPrompt is the load-bearing, previously ZERO-COVERAGE prompt
 * assembler behind EVERY QSS character portrait. It composes the Gemini
 * image-gen prompt from a dozen inputs, and its BRANCHING is what makes Henry's
 * characters render correctly:
 *   • canonBlock           — non-negotiable canon (species/look/role/donts) that
 *                            must OVERRIDE contradicting story context.
 *   • notesBlock           — Henry's AUTHORED VISUAL TRAITS (what makes Kevin
 *                            look like Kevin every redraw).
 *   • vibe-shift contract  — when Henry hits 👎 (vibeShift=true), the function
 *                            MUST emit the VIBE SHIFT DIRECTIVE and MUST suppress
 *                            the reviseBlock (whose whole job is continuity), or
 *                            the "break continuity" intent silently fails.
 *   • revise contract      — isRevise+newMessage → apply THIS change; isRevise
 *                            alone → generic tighten; neither → nothing.
 *   • per-world register    — burgundy → painterly OUTPUT; everything else →
 *                            sticker OUTPUT. Wrong register = wrong art.
 *   • diversity-law gating — enforced ONLY in queen-scarlet (or no world);
 *                            burgundy must NOT get it (would break its brief).
 *   • filter(Boolean)      — empty blocks dropped so absent inputs leave no scar.
 *
 * No live bug found — the assembler is correct — so this is a verifier-layer
 * LOCK (same standard as the qss-report / render-geometry / admin-auth locks),
 * PLUS a small robustness hardening: themes/tones/recentBlocks now default to []
 * so a legacy/direct caller passing undefined can't crash on `.length`/`.map`.
 * (The live handler always passes arrays, so behavior there is byte-identical.)
 *
 * Mutation-proven a real verifier — see run-mutations.sh alongside; each of the
 * 4 source mutations turns this suite RED, restore → GREEN.
 */

import { buildPortraitPrompt } from './qss-character-card.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${label}`); }
}

const QS = { slug: 'queen-scarlet', artStyle: {} };
const BURG = {
  slug: 'burgundy',
  artStyle: {
    styleBlock: ['STYLE: painterly cinematic Ghibli register.'],
    references: ['REFS: Iron Giant.'],
    dontList: ['DONT: stickers.'],
    paper: 'aged linen',
  },
};

// ── (0) ROBUSTNESS HARDENING: minimal args must not throw ───────────────────
// RED PROOF: without the `themes=[] / tones=[] / recentBlocks=[]` defaults the
// function throws on `tones.length` / `recentBlocks.map`. With them it returns
// a usable prompt. (The OLD inline form is reconstructed in run-mutations.sh.)
let minimal;
let threw = false;
try { minimal = buildPortraitPrompt({ name: 'Solo' }); } catch { threw = true; }
ok(!threw, 'minimal-args call (only name) does NOT throw (array defaults)');
ok(typeof minimal === 'string' && minimal.includes('SUBJECT: A character named Solo'),
  'minimal call still produces a real prompt with the SUBJECT line');

// ── (1) SUBJECT line + variation block always present ───────────────────────
const base = buildPortraitPrompt({
  name: 'Kevin', currentState: '', themes: [], tones: [], recentBlocks: [], world: QS,
});
ok(base.startsWith('SUBJECT: A character named Kevin.'), 'SUBJECT line leads, carries the name');
ok(base.includes('Render exactly ONE character'), 'one-character guard present');
ok(base.includes('SHOT VARIATION'), 'variation block always present');
ok(/Framing: .+\./.test(base) && /Pose: .+\./.test(base) && /Expression: .+\./.test(base),
  'variation block carries Framing/Pose/Expression lines');

// ── (2) canonBlock: present iff subjectCanon, fields conditional ────────────
const withCanon = buildPortraitPrompt({
  name: 'Scarlet', themes: [], tones: [], recentBlocks: [],
  subjectCanon: { species: 'dragon', look: 'red with yellow horns', role: 'tyrant', donts: 'cute mascot' },
  world: QS,
});
ok(withCanon.includes('CANONICAL SUBJECT'), 'canon header present when subjectCanon given');
ok(withCanon.includes('- species: dragon'), 'canon species flows in');
ok(withCanon.includes('- look: red with yellow horns'), 'canon look flows in');
ok(withCanon.includes('- role: tyrant'), 'canon role flows in');
ok(withCanon.includes('- must NOT draw: cute mascot'), 'canon donts flows in');
ok(!base.includes('CANONICAL SUBJECT'), 'no canon header when subjectCanon absent');
// partial canon: only provided fields render, no blank bullets
const partialCanon = buildPortraitPrompt({
  name: 'X', themes: [], tones: [], recentBlocks: [], subjectCanon: { species: 'cat' }, world: QS,
});
ok(partialCanon.includes('- species: cat'), 'partial canon: species renders');
ok(!partialCanon.includes('- look:') && !partialCanon.includes('- role:'),
  'partial canon: absent fields leave NO blank bullet (filter(Boolean))');

// ── (3) notesBlock: present iff visualNotes ─────────────────────────────────
const withNotes = buildPortraitPrompt({
  name: 'Kevin', themes: [], tones: [], recentBlocks: [], visualNotes: 'calculator helmet, always', world: QS,
});
// distinctive header — the phrase "AUTHORED VISUAL TRAITS" also appears in the
// always-present variation block, so match the notesBlock's unique prefix.
ok(withNotes.includes('AUTHORED VISUAL TRAITS (Henry has been refining'),
  'authored-traits header present with visualNotes');
ok(withNotes.includes('calculator helmet, always'), 'visualNotes text flows in');
ok(!base.includes('AUTHORED VISUAL TRAITS (Henry has been refining'),
  'no authored-traits header when visualNotes empty');

// ── (4) VIBE-SHIFT contract — the load-bearing continuity-break ─────────────
// vibeShift MUST emit the directive AND suppress reviseBlock even when isRevise
// + newMessage are set (the caller relies on this to break continuity on 👎).
const vibe = buildPortraitPrompt({
  name: 'Kevin', themes: [], tones: [], recentBlocks: [],
  isRevise: true, newMessage: 'make him taller', vibeShift: true, world: QS,
});
ok(vibe.includes('VIBE SHIFT DIRECTIVE'), 'vibeShift emits the VIBE SHIFT DIRECTIVE');
ok(!vibe.includes('THIS DRAW IS A REVISION'), 'vibeShift SUPPRESSES the reviseBlock (continuity break)');
ok(!vibe.includes('make him taller'), 'vibeShift does NOT leak the revise newMessage');
// non-vibe revise still carries the revise block (proves the suppression is conditional)
const nonVibe = buildPortraitPrompt({
  name: 'Kevin', themes: [], tones: [], recentBlocks: [],
  isRevise: true, newMessage: 'make him taller', vibeShift: false, world: QS,
});
ok(nonVibe.includes('THIS DRAW IS A REVISION'), 'non-vibe revise KEEPS the reviseBlock');
ok(!nonVibe.includes('VIBE SHIFT DIRECTIVE'), 'non-vibe draw has no vibe-shift directive');

// ── (5) REVISE contract — specific vs generic vs none ───────────────────────
const reviseSpecific = buildPortraitPrompt({
  name: 'Kevin', themes: [], tones: [], recentBlocks: [],
  isRevise: true, newMessage: 'give him a monocle', world: QS,
});
ok(reviseSpecific.includes('APPLY THIS SPECIFIC CHANGE: "give him a monocle"'),
  'revise+newMessage → specific change directive with the message');
const reviseGeneric = buildPortraitPrompt({
  name: 'Kevin', themes: [], tones: [], recentBlocks: [], isRevise: true, newMessage: '', world: QS,
});
ok(reviseGeneric.includes('THIS DRAW IS A REVISION') && !reviseGeneric.includes('APPLY THIS SPECIFIC CHANGE'),
  'revise without newMessage → generic revise directive (no APPLY line)');
ok(!base.includes('THIS DRAW IS A REVISION'), 'no revise directive on a fresh draw');

// ── (6) per-world OUTPUT register ───────────────────────────────────────────
ok(base.includes('OUTPUT: A single sticker-style character illustration'),
  'queen-scarlet → sticker OUTPUT directive');
ok(!base.includes('painterly cinematic portrait'), 'queen-scarlet → NOT painterly');
const burg = buildPortraitPrompt({ name: 'Doggo', themes: [], tones: [], recentBlocks: [], world: BURG });
ok(burg.includes('OUTPUT: A single painterly cinematic portrait'),
  'burgundy → painterly OUTPUT directive');
ok(!burg.includes('sticker-style character illustration'), 'burgundy → NOT sticker OUTPUT');
// no-world legacy caller falls back to sticker
const noWorld = buildPortraitPrompt({ name: 'Legacy', themes: [], tones: [], recentBlocks: [] });
ok(noWorld.includes('OUTPUT: A single sticker-style character illustration'),
  'no world → sticker OUTPUT (legacy fallback)');

// ── (7) DIVERSITY-LAW gating ────────────────────────────────────────────────
ok(base.includes('DIVERSITY LAW'), 'queen-scarlet enforces the diversity law');
ok(noWorld.includes('DIVERSITY LAW'), 'no-world (legacy) enforces the diversity law');
ok(!burg.includes('DIVERSITY LAW'), 'burgundy does NOT get the diversity law (would break its brief)');

// ── (8) per-world art-style fallback ────────────────────────────────────────
ok(base.includes('STYLE: Whimsical, weird, prop-driven sticker'),
  'no artStyle.styleBlock → default sticker STYLE');
ok(burg.includes('STYLE: painterly cinematic Ghibli register.'),
  'world.artStyle.styleBlock overrides the default STYLE');
ok(burg.includes('PAPER / BACKGROUND: aged linen'), 'world.artStyle.paper flows into the prompt');
ok(!base.includes('PAPER / BACKGROUND:'), 'no paper line when artStyle.paper absent');

// ── (9) recentSnippet: last-3 blocks, capped 400 ────────────────────────────
const manyBlocks = [
  { text: 'first beat about a beaver' },
  { text: 'second beat' }, { text: 'third beat' }, { text: 'fourth beat keep-me' },
];
const withStory = buildPortraitPrompt({
  name: 'Kevin', themes: [], tones: [], recentBlocks: manyBlocks, world: QS,
});
ok(withStory.includes('Snippet of recent story'), 'recent-story hook present when blocks given');
ok(withStory.includes('fourth beat keep-me') && !withStory.includes('first beat about a beaver'),
  'recentSnippet keeps the LAST 3 blocks, drops the oldest');
const longBlock = [{ text: 'z'.repeat(1000) }];
const capped = buildPortraitPrompt({
  name: 'Kevin', themes: [], tones: [], recentBlocks: longBlock, world: QS,
});
const snip = (capped.match(/visual hooks[^"]*"(z+)"/) || [])[1] || '';
ok(snip.length === 400, `recentSnippet capped at 400 chars (got ${snip.length})`);

// ── (10) themes/tones lines: present iff non-empty ──────────────────────────
const withMeta = buildPortraitPrompt({
  name: 'Kevin', currentState: 'mid-meltdown', themes: ['power'], tones: ['anxious', 'absurd'],
  recentBlocks: [], world: QS,
});
ok(withMeta.includes('Story tone keywords') && withMeta.includes('anxious, absurd'),
  'tones render when present');
ok(withMeta.includes('Story themes') && withMeta.includes('power'), 'themes render when present');
ok(withMeta.includes('Where they are right now in the story: "mid-meltdown"'),
  'currentState renders the traits line');
ok(!base.includes('Story tone keywords') && !base.includes('Story themes'),
  'no tone/theme lines when arrays empty');

// ── (11) filter(Boolean) join: no blank-run scars ───────────────────────────
ok(!base.includes('\n\n\n'), 'empty blocks dropped — no triple-newline scar from absent inputs');

// ── report ──────────────────────────────────────────────────────────────────
console.log(fails.join('\n'));
console.log(`\nqss-character-card-portrait: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
