/**
 * Pure validation core for /api/burgundy-tts (the BERGUNDY paragraph narrator).
 *
 * Extracted so the request guards of a PUBLIC, SPEND-BEARING endpoint (it bills
 * ElevenLabs) can be mutation-locked headlessly. Two jobs:
 *
 *   validateTtsRequest(body) — null-safe body parse + the MAX_CHARS spend cap.
 *   resolveVoice(voiceId)    — the ONLY guard keeping arbitrary strings out of
 *                              the Supabase storage path `${voice}/${hash}.mp3`.
 *                              A loosened regex here = write-path traversal into
 *                              the public bucket, so it is locked hard below.
 *
 * Behaviour is byte-identical to the original inline handler logic for every
 * reachable input; the URL interpolation coerces the returned voice the same way.
 */

export const VOICE_DEFAULT = 'XrExE9yKIg1WjnnlVkGX';   // Matilda — the tool's default narrator
export const MAX_CHARS = 2600;                          // a long paragraph, not a chapter

// Strict: 8–40 chars, letters+digits ONLY. No '/', '.', '..', whitespace, or
// path separators can ever reach the storage key. Everything else → default.
const VOICE_RE = /^[A-Za-z0-9]{8,40}$/;

export function resolveVoice(voiceId) {
  const v = String(voiceId ?? '');
  return VOICE_RE.test(v) ? v : VOICE_DEFAULT;
}

export function validateTtsRequest(body) {
  const text = String(body?.text ?? '').trim();
  if (!text) return { error: 'text required', status: 400 };
  if (text.length > MAX_CHARS) return { error: `text too long (max ${MAX_CHARS})`, status: 413 };
  return { text, voice: resolveVoice(body?.voice_id) };
}
