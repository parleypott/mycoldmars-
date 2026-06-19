// Pure prompt/context builders for api/cutter.js (the rough-cut editorial
// chatbot: Gemini reads a two-column breakdown of a cut and helps restructure
// the narrative). Extracted from the handler so they can be unit-tested
// headlessly — the handler itself only fetches Gemini.

import { buildGeminiChatContents } from './gemini-chat-contents.js';

/**
 * Build the system instruction for the restructuring chat: the editorial-
 * consultant framing + the full two-column script rendered from segments.
 */
export function buildSystemInstruction(segments, title) {
  const scriptText = (Array.isArray(segments) ? segments : []).map(s =>
    `[${s.timestamp_start}–${s.timestamp_end}]\n  WORDS: ${s.words}\n  VISUAL: ${s.visual}`
  ).join('\n\n');

  return `You are an editorial consultant reviewing a rough cut with a filmmaker.

You have read the complete two-column breakdown of the cut below. Your job is to help restructure the narrative.

When the filmmaker tells you what's not working, be specific and opinionated. Propose concrete reorderings using timestamps. Explain WHY each move improves the story — what it establishes, what tension it creates, what payoff it sets up.

Be direct. One idea at a time. No padding, no disclaimers.

THE CUT — "${title || 'Untitled'}"
${scriptText || '(no script loaded)'}`;
}

/**
 * Build the Gemini `contents` array: the last 12 history turns followed by the
 * new user message.
 *
 * Gemini requires a multi-turn request to BEGIN with a `user` turn — a contents
 * array whose first element has role 'model' is rejected ("First content should
 * be with role 'user'"). The 12-message window (or a loaded / seeded history
 * that opens on an assistant turn) can leave a leading model turn, so drop
 * leading model turns before returning. The appended user message guarantees
 * at least one user turn always exists, so an all-model window collapses
 * cleanly to just that message.
 */
export function buildChatContents(history, message) {
  return buildGeminiChatContents(history, message, { window: 12 });
}
