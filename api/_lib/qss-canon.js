// Queen Scarlet's School — canonical world facts.
//
// (regex-literal escaper lives in the shared ./escape-regexp.js so this file and
//  qss-signals.js can never drift — see obs 6441.)
//
// Anything that's TRUE about the story regardless of which block Henry's on.
// Server-side modules import this and inject relevant facts into their
// prompts (Wordy's TUTOR/DIRECTIONS/STORY/SCRIBE, the character-card
// synopsis + portrait, the arc extractor). The user's editable "bible" in
// the Story Rules modal LAYERS ON TOP of this — never replaces it.
//
// Lookup is name-based and case-insensitive. New canonical characters get
// added here; that's the only file to touch.

import { escapeRegExp } from './escape-regexp.js';

export const QSS_CANON = {
  // Always-present world facts, regardless of which characters are on-page.
  world: [
    "The story is set at Queen Scarlet's Academy (full name: \"Queen Scarlet's Totally Safe Academy\" — the \"Totally Safe\" part is sarcastic). It is famously not safe.",
    "The tone is dark, satirical, deadpan-absurd. Earnestness gets undercut. Bureaucratic safety language is used to describe genuinely dangerous things.",
  ],

  // Specific canon characters. Keyed by lower-cased name. Whenever a
  // prompt would describe one of these characters, the server overlays
  // these facts on top of whatever the model thinks it knows.
  characters: {
    'queen scarlet': {
      // Henry almost always calls her just "Scarlet". Without these aliases
      // the canon overlay (esp. the must-not-draw-her-cute guardrail below)
      // silently dropped whenever he used the short name — so the image
      // generator was free to render the cartoon-mascot version we forbid.
      aliases: ['scarlet'],
      species: 'red dragon',
      look: "A genuinely fierce, kinda-scary RED DRAGON. Big. Yellow horns. Sharp teeth. The school's brand depicts her as a friendly cartoon mascot (red dragon with a yellow tooth showing, teal-and-orange wings), but in the actual story she is intimidating and powerful — not cute.",
      role: 'Headmistress / founder of Queen Scarlet\'s Academy. Total authority. Faintly threatening even when she\'s being polite.',
      voice: 'Speaks with deadpan authority. Means business. Treats catastrophic risk as a paperwork issue.',
      donts: 'Never draw her as a cartoon mascot, plush dragon, kid-friendly anime dragon, or a human queen. She is a real dragon, scary at scale. No tiaras or pageant-queen iconography.',
    },
    // Add new canon characters here as Johnny establishes them.
    // 'kevin':   { species: 'human kid', look: '...', role: '...', voice: '...' },
    // 'benny':   { species: 'beaver',    look: '...', role: '...', voice: '...' },
  },
};

// Every term that should resolve to a given canon key: the key itself plus
// any declared aliases, all lower-cased.
function matchTerms(key, ch) {
  const terms = [key, ...(Array.isArray(ch.aliases) ? ch.aliases : [])];
  return terms.map(t => String(t || '').toLowerCase().trim()).filter(Boolean);
}


// Whole-word match so "Scarlet" doesn't fire inside "scarletina" and a short
// alias can't latch onto a longer word — same \b discipline as the b-roll and
// voice-segmenter fixes. `includes()` was both too loose (substring) and too
// strict (only ever tested the full key, never the short names Henry uses).
function termMatchesText(term, lowerText) {
  return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(lowerText);
}

// Match characters by name in arbitrary user text. Returns matched canon
// entries (deduped by canonical key). Used by prompts that don't already have
// a character list (e.g. Wordy's tutor calls — we just scan the user's message
// + recent blocks for canon names). Matches the canonical name AND any alias,
// but always returns the canonical `name` so downstream canonContextBlock()
// filtering (which keys off the canonical name) keeps working.
export function findCanonCharactersInText(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const hits = [];
  for (const [key, ch] of Object.entries(QSS_CANON.characters)) {
    if (matchTerms(key, ch).some(term => termMatchesText(term, lower))) {
      hits.push({ name: titleCase(key), ...ch });
    }
  }
  return hits;
}

// Build a system-prompt-ready string of canon to overlay onto the model's
// context. Pass `relevantNames` (an array of strings) to filter just the
// characters in play; pass null/undefined to include all canon characters.
export function canonContextBlock(relevantNames = null) {
  const lines = [];
  if (QSS_CANON.world?.length) {
    lines.push('WORLD CANON (always true):');
    for (const w of QSS_CANON.world) lines.push(`- ${w}`);
    lines.push('');
  }
  let chars = Object.entries(QSS_CANON.characters);
  if (Array.isArray(relevantNames) && relevantNames.length) {
    const want = new Set(
      relevantNames.map(n => String(n || '').toLowerCase().trim()).filter(Boolean)
    );
    chars = chars.filter(([k, ch]) => matchTerms(k, ch).some(t => want.has(t)));
  }
  if (chars.length) {
    lines.push('CHARACTER CANON (overlays anything the user wrote — these traits are non-negotiable):');
    for (const [key, ch] of chars) {
      lines.push(`- ${titleCase(key)}:`);
      if (ch.species) lines.push(`    species: ${ch.species}`);
      if (ch.look)    lines.push(`    look: ${ch.look}`);
      if (ch.role)    lines.push(`    role: ${ch.role}`);
      if (ch.voice)   lines.push(`    voice: ${ch.voice}`);
      if (ch.donts)   lines.push(`    must-not: ${ch.donts}`);
    }
  }
  return lines.join('\n').trim();
}

// Get the canon entry for one specific character by name, case-insensitive.
// Resolves aliases too, so canonForName('Scarlet') returns the Queen Scarlet
// entry just like canonForName('Queen Scarlet') does.
export function canonForName(name) {
  if (!name) return null;
  const want = String(name).toLowerCase().trim();
  if (!want) return null;
  const direct = QSS_CANON.characters[want];
  if (direct) return direct;
  for (const [key, ch] of Object.entries(QSS_CANON.characters)) {
    if (matchTerms(key, ch).includes(want)) return ch;
  }
  return null;
}

function titleCase(s) {
  return String(s || '').replace(/\b\w/g, c => c.toUpperCase());
}
