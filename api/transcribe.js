// Vercel Node function — transcription router.
//
// NOTE: this runs on the NODE runtime (not Edge) with maxDuration: 300. Edge
// functions are capped at ~25s of wall-clock, so Deepgram transcription of a
// longer clip blew the cap and surfaced to the user as "Transcription failed
// (504)". The Node runtime + maxDuration:300 (also set in vercel.json) gives
// Deepgram the full 5 minutes it needs. Matches the cutter.js pattern.
//
// Routes to one of two providers based on availability and file size:
//   • Deepgram (preferred when DEEPGRAM_API_KEY is set): handles up to 2 GB,
//     accepts a URL — we pass the Supabase signed URL directly so Deepgram
//     fetches the file. Returns word + paragraph timestamps.
//   • OpenAI Whisper (fallback, OPENAI_API_KEY): 25 MB limit, multipart upload.
//
// Request body: { mediaUrl, mediaSizeBytes, language?, prompt?, provider? }
// Response (normalized): { language, duration_seconds, full_text, segments[], word_timings[], provider }

import { checkAccess } from './_lib/access.js';

export const config = { maxDuration: 300 };

const WHISPER_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

const DEEPGRAM_ENDPOINT = 'https://api.deepgram.com/v1/listen';
// Defaults tuned for documentary work: Nova-3 (best quality), smart formatting,
// punctuation, paragraph segmentation, utterance grouping for speakers.
const DEEPGRAM_QUERY = new URLSearchParams({
  model: 'nova-3',
  smart_format: 'true',
  punctuate: 'true',
  paragraphs: 'true',
  utterances: 'true',
  diarize: 'true',          // speaker labels
  filler_words: 'false',    // skip "um/uh" by default; can flip via opts
}).toString();

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, err('method_not_allowed', 'POST only'));

  // checkAccess expects a Request-like object with headers.get() (it was
  // written for the Edge runtime). Node's req.headers is a plain object.
  const reqLike = { method: req.method, headers: { get: (k) => req.headers[k.toLowerCase()] } };
  const denied = await checkAccess(reqLike);
  if (denied) {
    const body = await denied.json().catch(() => ({}));
    return res.status(denied.status).json(body);
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return send(res, 400, err('bad_json', 'Request body must be JSON'));

  const { mediaUrl, mediaSizeBytes, language, prompt, provider = 'auto' } = body;
  if (!mediaUrl) return send(res, 400, err('missing_media_url', 'mediaUrl is required (signed URL to the media file)'));
  // Reject anything that isn't an http(s) URL — closes SSRF angles (file://, internal URLs).
  if (!/^https?:\/\//i.test(mediaUrl)) return send(res, 400, err('bad_media_url', 'mediaUrl must be an http(s) URL.'));

  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  const whisperKey  = process.env.OPENAI_API_KEY;

  let chosen = provider;
  if (chosen === 'auto') {
    if (deepgramKey) chosen = 'deepgram';
    else if (whisperKey) chosen = 'whisper';
    else return send(res, 500, err('no_provider', 'Neither DEEPGRAM_API_KEY nor OPENAI_API_KEY is configured'));
  }

  let result;
  if (chosen === 'whisper') {
    if (!whisperKey) return send(res, 500, err('misconfigured', 'OPENAI_API_KEY not set'));
    if (typeof mediaSizeBytes !== 'number' || !Number.isFinite(mediaSizeBytes) || mediaSizeBytes <= 0) {
      return send(res, 400, err('missing_media_size',
        'mediaSizeBytes is required for Whisper provider so we can guard the 25 MB limit before fetching.'));
    }
    if (mediaSizeBytes > WHISPER_MAX_BYTES) {
      return send(res, 413, err('file_too_large',
        `Whisper API limit is 25 MB. Got ${(mediaSizeBytes / 1024 / 1024).toFixed(1)} MB. ` +
        `Set DEEPGRAM_API_KEY (handles up to 2 GB) or use 'provider: deepgram' explicitly.`));
    }
    result = await runWhisper({ mediaUrl, language, prompt, apiKey: whisperKey });
  } else if (chosen === 'deepgram') {
    if (!deepgramKey) return send(res, 500, err('misconfigured', 'DEEPGRAM_API_KEY not set'));
    result = await runDeepgram({ mediaUrl, language, prompt, apiKey: deepgramKey });
  } else {
    return send(res, 400, err('unknown_provider', `Unknown provider: ${chosen}`));
  }

  return send(res, result.status, result.body);
}

// Helpers return { status, body } so the handler can send via res.json().
function err(code, message) { return { error: { code, message } }; }
function send(res, status, body) { res.status(status).json(body); }

// ── Deepgram ─────────────────────────────────────────────────────────
async function runDeepgram({ mediaUrl, language, prompt, apiKey }) {
  const params = new URLSearchParams(DEEPGRAM_QUERY);
  if (language) params.set('language', language);
  // Deepgram keyterm boosting (Nova-3+): first 50 words of the prompt.
  const terms = buildDeepgramKeyterm(prompt);
  if (terms) params.set('keyterm', terms);
  const url = `${DEEPGRAM_ENDPOINT}?${params.toString()}`;

  let dgRes;
  try {
    dgRes = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: mediaUrl }),
    });
  } catch (e) {
    return { status: 502, body: err('deepgram_fetch_failed', e.message || String(e)) };
  }

  if (!dgRes.ok) {
    const errText = await dgRes.text().catch(() => '');
    return { status: dgRes.status, body: err('deepgram_api_error',
      `Deepgram: ${dgRes.status} ${dgRes.statusText}${errText ? ' — ' + redactApiErrorText(errText).slice(0, 400) : ''}`) };
  }

  let dg;
  try { dg = await dgRes.json(); }
  catch { return { status: 502, body: err('deepgram_bad_response', 'Deepgram returned non-JSON') }; }

  return { status: 200, body: normalizeDeepgram(dg) };
}

// Deepgram's verbose response → Interpreter's normalized shape.
export function normalizeDeepgram(dg) {
  const channel = dg?.results?.channels?.[0] || {};
  const alternative = channel.alternatives?.[0] || {};
  const detectedLang = channel.detected_language || dg?.results?.language || null;
  const duration = dg?.metadata?.duration || null;

  const paragraphs = alternative.paragraphs?.paragraphs || [];
  const utterances = dg?.results?.utterances || [];

  let segments = [];

  if (paragraphs.length > 0) {
    let n = 1;
    for (const p of paragraphs) {
      const speakerLabel = (typeof p.speaker === 'number') ? `Speaker ${p.speaker + 1}` : 'Speaker 1';
      // Fall back to the paragraph's own text when it carries no sentences. The
      // `|| []` form only caught a MISSING sentences field — an empty array []
      // is truthy, so an empty-sentences paragraph used to skip the loop and
      // silently drop its text from the transcript. Guard on length (and shape).
      const sents = (Array.isArray(p.sentences) && p.sentences.length)
        ? p.sentences
        : [{ text: p.text || '', start: p.start, end: p.end }];
      for (const sent of sents) {
        segments.push({
          index: n - 1, number: n++, speaker: speakerLabel,
          start: sent.start, end: sent.end, original: (sent.text || '').trim(),
        });
      }
    }
  } else if (utterances.length > 0) {
    let n = 1;
    for (const u of utterances) {
      const speakerLabel = (typeof u.speaker === 'number') ? `Speaker ${u.speaker + 1}` : 'Speaker 1';
      segments.push({
        index: n - 1, number: n++, speaker: speakerLabel,
        start: u.start, end: u.end, original: (u.transcript || '').trim(),
      });
    }
  } else {
    segments = [{
      index: 0, number: 1, speaker: 'Speaker 1',
      start: 0, end: duration || 0, original: (alternative.transcript || '').trim(),
    }];
  }

  const wordTimings = (alternative.words || []).map(w => ({
    word: w.punctuated_word || w.word,
    start: w.start, end: w.end,
    speaker: typeof w.speaker === 'number' ? w.speaker : null,
  }));

  return {
    provider: 'deepgram',
    language: detectedLang,
    duration_seconds: duration,
    full_text: alternative.transcript || '',
    segments,
    word_timings: wordTimings,
  };
}

// Pure normalization of a Whisper (verbose_json) response into the shared transcript shape.
// Exported + kept side-effect-free so it can be mutation-locked exactly like its Deepgram sibling
// (normalizeDeepgram). Whisper carries no diarization, so every segment is "Speaker 1" and word
// timings get a null speaker. Guards mirror the Deepgram contract: a missing OR non-array
// segments/words field degrades to [] (the old inline `.segments || []` form only caught a MISSING
// field — a non-array would have thrown on .map); each segment's text is trimmed; language falls
// back to the request language, then null. Byte-identical to the old inline map on every real
// (array / missing) response; the only behavior change is the non-array case (throw → []), which
// matches how normalizeDeepgram already salvages a non-array `sentences`.
export function normalizeWhisper(whisperJson, language = null) {
  const j = whisperJson || {};
  const segs = Array.isArray(j.segments) ? j.segments : [];
  const words = Array.isArray(j.words) ? j.words : [];
  return {
    provider: 'whisper',
    language: j.language || language || null,
    duration_seconds: j.duration || null,
    full_text: j.text || '',
    segments: segs.map((s, i) => ({
      index: i, number: i + 1, speaker: 'Speaker 1',
      start: s.start, end: s.end, original: (s.text || '').trim(),
    })),
    word_timings: words.map(w => ({ word: w.word, start: w.start, end: w.end, speaker: null })),
  };
}

// ── Whisper ──────────────────────────────────────────────────────────
async function runWhisper({ mediaUrl, language, prompt, apiKey }) {
  let mediaBlob;
  try {
    // 90s timeout on the upstream fetch so a Storage stall surfaces cleanly
    // instead of hanging the whole function against the 300s cap.
    const mediaRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(90_000) });
    if (!mediaRes.ok) {
      return { status: 502, body: err('media_fetch_failed', `Could not fetch media: ${mediaRes.status} ${mediaRes.statusText}`) };
    }
    mediaBlob = await mediaRes.blob();
  } catch (e) {
    return { status: 502, body: err('media_fetch_error', e.message || String(e)) };
  }

  const form = new FormData();
  form.append('file', mediaBlob, extractFilenameFromUrl(mediaUrl) || 'audio.bin');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  if (language) form.append('language', language);
  if (prompt)   form.append('prompt', prompt);

  let whisperRes;
  try {
    whisperRes = await fetch(WHISPER_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });
  } catch (e) {
    return { status: 502, body: err('whisper_fetch_failed', e.message || String(e)) };
  }

  if (!whisperRes.ok) {
    const errText = await whisperRes.text().catch(() => '');
    return { status: whisperRes.status, body: err('whisper_api_error',
      `Whisper API: ${whisperRes.status} ${whisperRes.statusText}${errText ? ' — ' + redactApiErrorText(errText).slice(0, 400) : ''}`) };
  }

  let whisperJson;
  try { whisperJson = await whisperRes.json(); }
  catch { return { status: 502, body: err('whisper_bad_response', 'Whisper returned non-JSON') }; }

  return { status: 200, body: normalizeWhisper(whisperJson, language) };
}

// ── helpers ─────────────────────────────────────────────────────────
// Build the Deepgram `keyterm` boost value from the caller-supplied prompt.
// Type-safe by design: `prompt` flows straight from the request body, so a
// non-string (a buggy client sending `prompt: 123`, an object, an array)
// must NOT crash — the old inline `prompt.split(...)` threw a TypeError on
// any non-string, and since runDeepgram is awaited with no try/catch that
// surfaced as an opaque 500 instead of a clean transcription. Returns the
// first 50 whitespace-separated words, '' when there's nothing usable.
export function buildDeepgramKeyterm(prompt) {
  if (typeof prompt !== 'string') return '';
  return prompt.trim().split(/\s+/).filter(Boolean).slice(0, 50).join(' ');
}

export function extractFilenameFromUrl(url) {
  try { const u = new URL(url); return u.pathname.split('/').pop() || null; }
  catch { return null; }
}

// Strip anything credential-shaped from provider error bodies before surfacing.
export function redactApiErrorText(text) {
  if (!text) return '';
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***REDACTED***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer ***REDACTED***')
    .replace(/\b[a-f0-9]{40,}\b/g, '***REDACTED***')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '***JWT***');
}
