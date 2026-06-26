// queen-scarlet-school: Book View — scene illustration prompt assembly.
//
// Extracted, byte-for-byte, from api/qss-scene-illustrate.js so the Henry-FACING
// illustration contract can be mutation-locked without touching the live Edge
// handler's behavior. The handler still does all async gathering (world style,
// per-character visual_notes, setting enrichment) and then calls buildScenePrompt
// with the resolved pieces — this module is the pure, deterministic tail.
//
// Why this is load-bearing: this prompt decides what EVERY storybook illustration
// looks like. The FRAMING guardrails (ONE single image, NEVER a comic panel,
// NEVER text in the picture) are what keep Henry's book from rendering as a
// graphic-novel collage with speech bubbles. The prose-extraction loop decides
// WHICH part of the story the picture depicts. Both are silent-failure surfaces.

// Absolute composition guardrails. Identical to the inline FRAMING in the handler.
export const SCENE_FRAMING = [
  'CINEMATIC single-frame illustration — one composition, one camera angle, one moment.',
  '',
  'COMPOSITION RULE (absolute, do not break):',
  '- ONE single image. ONE moment.',
  '- NEVER a comic panel layout. NEVER a multi-panel collage. NEVER split-screen.',
  '- NEVER speech bubbles. NEVER thought bubbles. NEVER captions.',
  '- NEVER any text, words, letters, numbers, signs, or labels visible inside the image.',
  '- NEVER show a sequence of beats. Pick the ONE strongest visual moment from the scene below — the most surprising, the most physically dynamic, or the most emotionally loaded — and render ONLY that single picture.',
  '- If the scene describes many things happening, choose the SINGLE image that captures the spirit best. Drop the rest.',
  '- Treat the output like one page of a picture book, NOT a page of a graphic novel.',
].join('\n');

// Pull the prose the scene covers out of the story's blocks[].
// blocks entries may be raw strings or { text } objects. The bounds mirror the
// handler exactly: walk start..end inclusive, but never past blocks.length, and
// drop empty/whitespace-only blocks. A non-numeric start (undefined/null) makes
// the loop body never run — caller then falls back to prose_excerpt.
export function extractSceneText(blocks, startBlock, endBlock) {
  const arr = Array.isArray(blocks) ? blocks : [];
  const out = [];
  for (let i = startBlock; i <= endBlock && i < arr.length; i++) {
    const b = arr[i];
    const text = (typeof b === 'string' ? b : b?.text || '').trim();
    if (text) out.push(text);
  }
  return out;
}

// "CHARACTERS in this scene" block — empty string when nobody is present so an
// absent input leaves no scar in the prompt.
export function buildCharBlock(charParts) {
  const parts = Array.isArray(charParts) ? charParts : [];
  return parts.length
    ? `\n\nCHARACTERS in this scene (preserve their established visual identity):\n${parts.join('\n')}`
    : '';
}

// "WHAT HAPPENS IN THIS SCENE" block, capped at 1500 chars so a long scene can't
// blow the prompt. Falls back to a one-line SCENE SUMMARY from prose_excerpt when
// no blocks resolved, and to '' when neither exists.
export function buildProseBlock(sceneTexts, proseExcerpt) {
  const texts = Array.isArray(sceneTexts) ? sceneTexts : [];
  return texts.length
    ? `\n\nWHAT HAPPENS IN THIS SCENE:\n${texts.join('\n\n').slice(0, 1500)}`
    : (proseExcerpt ? `\n\nSCENE SUMMARY: ${proseExcerpt}` : '');
}

// Assemble the full Gemini image prompt. Field order is load-bearing and matches
// the original inline template exactly:
//   STYLE \n\n FRAMING \n\n TITLE: <title> <settingBlock><timeBlock><charBlock><proseBlock><variantHint>
export function buildScenePrompt({
  style = '',
  title,
  settingBlock = '',
  timeOfDay,
  charParts = [],
  sceneTexts = [],
  proseExcerpt,
  isVariation = false,
}) {
  const charBlock = buildCharBlock(charParts);
  const timeBlock = timeOfDay ? `\n\nTIME: ${timeOfDay}` : '';
  const proseBlock = buildProseBlock(sceneTexts, proseExcerpt);
  const variantHint = isVariation
    ? `\n\nVARIATION — same characters, same setting, but a DIFFERENT moment / camera angle / composition from any previous attempt.`
    : '';
  return `${style}\n\n${SCENE_FRAMING}\n\nTITLE: ${title}${settingBlock}${timeBlock}${charBlock}${proseBlock}${variantHint}`;
}
