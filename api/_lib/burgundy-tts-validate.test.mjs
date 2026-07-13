// Locks the request-validation contract of the BERGUNDY paragraph narrator
// (api/burgundy-tts.js) — a PUBLIC, un-gated, SPEND-BEARING endpoint (bills
// ElevenLabs). Imports the REAL validator so any loosening of the spend cap
// OR — the load-bearing one — the voice_id regex that keeps path separators
// out of the Supabase storage key `${voice}/${hash}.mp3` breaks this test.

import assert from 'node:assert/strict';
import { validateTtsRequest, resolveVoice, VOICE_DEFAULT, MAX_CHARS } from './burgundy-tts-validate.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; };

// ── validateTtsRequest: null-safe body (matches the live "null → 400" probe) ──
eq(validateTtsRequest(null).status, 400, 'null body → 400 (not a crash)');
eq(validateTtsRequest(null).error, 'text required', 'null body reason');
eq(validateTtsRequest(undefined).status, 400, 'undefined body → 400');
eq(validateTtsRequest({}).status, 400, 'no text field → 400');
eq(validateTtsRequest({ text: '   ' }).status, 400, 'whitespace-only text → 400');
// a numeric text coerces to a non-empty string → allowed (cap/voice are what we guard)
ok(!validateTtsRequest({ text: 42 }).error, 'numeric text coerces to "42" and passes');

// ── the spend cap: MAX_CHARS is load-bearing (worst-case ElevenLabs bill) ──
{
  const under = 'a'.repeat(MAX_CHARS);
  const over = 'a'.repeat(MAX_CHARS + 1);
  ok(!validateTtsRequest({ text: under }).error, 'exactly MAX_CHARS accepted');
  eq(validateTtsRequest({ text: over }).status, 413, 'over cap → 413');
  eq(validateTtsRequest({ text: over }).error, `text too long (max ${MAX_CHARS})`, '413 reason');
  ok(MAX_CHARS <= 2600, 'cap not silently inflated past the documented 2600');
}

// ── happy path: text trimmed, default voice when none given ──
{
  const v = validateTtsRequest({ text: '  the amber horizon  ' });
  eq(v.error, undefined, 'valid body has no error');
  eq(v.text, 'the amber horizon', 'text trimmed');
  eq(v.voice, VOICE_DEFAULT, 'no voice_id → default narrator');
}

// ── resolveVoice: the path-injection guard (SECURITY-load-bearing) ──
eq(resolveVoice('XrExE9yKIg1WjnnlVkGX'), 'XrExE9yKIg1WjnnlVkGX', 'valid 20-char id kept');
eq(resolveVoice('abcd1234'), 'abcd1234', 'valid 8-char id kept (min length)');
// anything that could escape the storage path MUST fall back to the default:
eq(resolveVoice('../../etc'), VOICE_DEFAULT, 'path-traversal id rejected → default');
eq(resolveVoice('a/b/c/1234'), VOICE_DEFAULT, 'slash in id rejected → default');
eq(resolveVoice('voice.mp3xxxx'), VOICE_DEFAULT, 'dot in id rejected → default');
eq(resolveVoice('has space12'), VOICE_DEFAULT, 'whitespace in id rejected → default');
eq(resolveVoice('short'), VOICE_DEFAULT, 'too-short id rejected → default');
eq(resolveVoice('a'.repeat(41)), VOICE_DEFAULT, 'too-long id (41) rejected → default');
eq(resolveVoice(''), VOICE_DEFAULT, 'empty id → default');
eq(resolveVoice(null), VOICE_DEFAULT, 'null id → default (no crash)');
eq(resolveVoice(undefined), VOICE_DEFAULT, 'undefined id → default');
eq(resolveVoice({}), VOICE_DEFAULT, 'object id → default (no crash)');

// the resolved voice can NEVER contain a path separator or dot — the invariant
// the storage-key interpolation depends on:
for (const probe of ['../secret', 'a/b', 'x.y.z.abc', '  ', 'DROP/TABLE', '%2e%2e', 'good1234/../bad']) {
  const r = resolveVoice(probe);
  ok(/^[A-Za-z0-9]+$/.test(r), `resolveVoice(${JSON.stringify(probe)}) is separator-free: ${r}`);
}

// mutation guard: if the whole thing degenerated to "return input", these fail.
ok(resolveVoice('a/b/c/1234') === VOICE_DEFAULT && resolveVoice('../../etc') === VOICE_DEFAULT,
   'both traversal probes map to default (regex not neutered to pass-through)');

console.log(`burgundy-tts-validate: ${pass} assertions passed`);
