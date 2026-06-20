// Pure helpers for the QSS tutor's PRIMARY Claude path (api/nano-banana.js
// handleTutor). Wordy's editorial brain — the block-options / directions
// generator Henry hits on every tutor turn — is meant to run on Claude
// (claude-sonnet-4-6); the code falls back to Gemini Flash only when Claude is
// unavailable or errors, because Gemini was "producing crummy / generic prose".
//
// THE BUG these helpers fix: the inline Claude payload set BOTH `temperature`
// AND `top_p`. The Anthropic Messages API rejects a request that carries both
// sampling parameters on every Claude 4+ model (claude-sonnet-4-6 included)
// with a 400 invalid_request_error. So the primary Claude call 400'd on EVERY
// turn and silently fell through to the Gemini fallback — Henry's tutor has
// effectively never run on Claude, defeating the whole reason Claude was added.
//
// buildTutorClaudePayload builds a VALID Sonnet-4.6 request: a single sampling
// parameter (temperature only — keeping max-wide sampling, honoring the
// original "widen sampling" intent that top_p was reaching for), and the
// messages array routed through normalizeAnthropicMessages so a seeded/sliced
// history that opens on a model turn can't 400 either (the leading-assistant
// class fixed elsewhere this week).
//
// isTutorClaudeResultUsable is the strictly-non-regressive guard: the caller
// only RETURNS the Claude result when it carries usable options for the current
// phase; otherwise it falls through to the Gemini fallback exactly as a Claude
// error already does. So the fix can only ever match-or-beat today's behavior —
// Claude 400 (the bug), Claude network error, AND Claude-200-but-empty all land
// on the same Gemini floor; only a good Claude response changes anything.

import { normalizeAnthropicMessages } from './anthropic-messages.js';

export const TUTOR_CLAUDE_MODEL = 'claude-sonnet-4-6';
export const TUTOR_CLAUDE_MAX_TOKENS = 6000;
// Sonnet 4.6 accepts ONE sampling parameter (temperature OR top_p, never both).
// 1.0 is max-wide — the widest single-parameter setting, which is what the
// removed `top_p: 0.95` was trying to add on top of.
export const TUTOR_CLAUDE_TEMPERATURE = 1.0;

// Build the Anthropic Messages payload for the tutor's primary Claude call.
// `history` is the raw [{role, content}] chat log (roles 'user'|'wordy'|...);
// `userTurnText` is the final user turn to append.
export function buildTutorClaudePayload(systemText, history, userTurnText) {
  const mapped = (Array.isArray(history) ? history : []).map((m) => ({
    role: m && m.role === 'user' ? 'user' : 'assistant',
    content: m == null ? '' : m.content,
  }));
  mapped.push({ role: 'user', content: userTurnText });

  return {
    model: TUTOR_CLAUDE_MODEL,
    max_tokens: TUTOR_CLAUDE_MAX_TOKENS,
    temperature: TUTOR_CLAUDE_TEMPERATURE,
    system: systemText,
    messages: normalizeAnthropicMessages(mapped),
  };
}

// Accept the Claude result only when it carries usable options for the current
// phase; otherwise the caller falls through to the Gemini fallback.
export function isTutorClaudeResultUsable(phase, directions, blockOptions) {
  if (phase === 'directions') {
    return Array.isArray(directions) && directions.length > 0;
  }
  return Array.isArray(blockOptions) && blockOptions.length > 0;
}
