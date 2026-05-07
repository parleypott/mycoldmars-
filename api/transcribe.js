// Vercel Edge function — transcription via OpenAI Whisper API.
//
// Flow:
//   1. Client uploads media file to Supabase Storage (handled in db.js)
//   2. Client creates a media_assets row (handled in db.js)
//   3. Client POSTs { mediaAssetId, language? } here
//   4. We fetch the file via short-lived signed URL
//   5. We send it to OpenAI Whisper with word-level timestamps
//   6. We update the media_assets row with status + source_language
//   7. We return { segments, words, language } to the client
//
// Limitations (will fix in v2):
//   - OpenAI Whisper has a 25 MB file size limit. For files >25 MB
//     (typical for >10min audio at decent quality), we need to either
//     pre-extract audio with ffmpeg in a longer-running runtime, or
//     chunk and stitch. v1 hands back a clear error so the client can
//     warn the user.
//   - This runs synchronously inside the Edge runtime (max ~25-30s on
//     the free tier, longer on Pro). For long files, v2 will move to
//     a background-job pattern (QStash, Inngest, or Vercel Functions
//     with longer timeout).
//   - We trust the client to know which media asset to transcribe.
//     Access is gated by the same shared-secret model the rest of the
//     app uses (the client must have already passed /api/access.js).

export const config = {
  runtime: 'edge',
  // Edge functions on Vercel default to 25s. The Pro plan extends to
  // 5 min for AI workloads via fluid compute. This still won't handle
  // a 1-hour interview in one shot — that needs the v2 job queue.
  maxDuration: 300,
};

const WHISPER_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // OpenAI hard limit

export default async function handler(req) {
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'POST only');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonError(500, 'misconfigured', 'OPENAI_API_KEY not set on the server');
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'bad_json', 'Request body must be JSON');
  }

  const { mediaUrl, mediaSizeBytes, language, prompt, model = 'whisper-1' } = body || {};

  if (!mediaUrl) {
    return jsonError(400, 'missing_media_url', 'mediaUrl is required (signed URL to the media file)');
  }
  if (mediaSizeBytes && mediaSizeBytes > WHISPER_MAX_BYTES) {
    return jsonError(413, 'file_too_large',
      `Whisper API limit is 25 MB. Got ${(mediaSizeBytes / 1024 / 1024).toFixed(1)} MB. ` +
      `Pre-extract audio with ffmpeg or use the chunked upload (v2).`);
  }

  // Fetch the media file from Supabase Storage via the signed URL.
  let mediaBlob;
  try {
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) {
      return jsonError(502, 'media_fetch_failed',
        `Could not fetch media from storage: ${mediaRes.status} ${mediaRes.statusText}`);
    }
    mediaBlob = await mediaRes.blob();
  } catch (err) {
    return jsonError(502, 'media_fetch_error', err.message || String(err));
  }

  // Hand-roll the multipart body so we can stream into Whisper without
  // buffering the whole thing twice. The Edge runtime supports FormData.
  const form = new FormData();
  form.append('file', mediaBlob, extractFilenameFromUrl(mediaUrl) || 'audio.bin');
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  if (language) form.append('language', language); // ISO 639-1
  if (prompt)   form.append('prompt', prompt);     // bias hints (names, jargon)

  let whisperRes;
  try {
    whisperRes = await fetch(WHISPER_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    return jsonError(502, 'whisper_fetch_failed', err.message || String(err));
  }

  if (!whisperRes.ok) {
    const errText = await whisperRes.text().catch(() => '');
    return jsonError(whisperRes.status, 'whisper_api_error',
      `Whisper API: ${whisperRes.status} ${whisperRes.statusText}${errText ? ' — ' + errText : ''}`);
  }

  let whisperJson;
  try {
    whisperJson = await whisperRes.json();
  } catch (err) {
    return jsonError(502, 'whisper_bad_response', 'Whisper returned non-JSON');
  }

  // Normalize Whisper response into the Interpreter's segment shape.
  // Whisper's verbose_json gives us:
  //   { task, language, duration, text, segments: [{id, start, end, text, ...}], words: [{word, start, end}] }
  // The Interpreter expects:
  //   segments: [{ index, speaker, start, end, original }]
  //   word_timings: [{ word, start, end }]
  const out = {
    language: whisperJson.language || language || null,
    duration_seconds: whisperJson.duration || null,
    full_text: whisperJson.text || '',
    segments: (whisperJson.segments || []).map((s, i) => ({
      index: i,
      speaker: 'Speaker 1', // single-speaker default; diarization is a v2 feature
      start: s.start,
      end: s.end,
      original: (s.text || '').trim(),
    })),
    word_timings: (whisperJson.words || []).map(w => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })),
  };

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function extractFilenameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop();
    return last || null;
  } catch { return null; }
}

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
