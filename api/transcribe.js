// Vercel Edge function — transcription router.
//
// Routes to one of two providers based on availability and file size:
//
//   • Deepgram (preferred when DEEPGRAM_API_KEY is set):
//       Handles up to 2 GB. Accepts a URL — we pass the Supabase signed
//       URL directly, so Deepgram fetches the file and we don't have to
//       stream it through Vercel. Returns word + paragraph timestamps.
//   • OpenAI Whisper (fallback, OPENAI_API_KEY required):
//       25 MB hard limit. We fetch the file via signed URL, send as
//       multipart, and normalize the verbose_json response.
//
// Request body: { mediaUrl, mediaSizeBytes, language?, prompt?, provider? }
//   - provider: 'auto' (default) | 'deepgram' | 'whisper'
//
// Response (both providers normalized to the same shape):
//   { language, duration_seconds, full_text, segments[], word_timings[], provider }

export const config = {
  runtime: 'edge',
  maxDuration: 300,
};

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

export default async function handler(req) {
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'POST only');
  }

  let body;
  try { body = await req.json(); }
  catch { return jsonError(400, 'bad_json', 'Request body must be JSON'); }

  const { mediaUrl, mediaSizeBytes, language, prompt, provider = 'auto' } = body || {};
  if (!mediaUrl) {
    return jsonError(400, 'missing_media_url', 'mediaUrl is required (signed URL to the media file)');
  }

  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  const whisperKey  = process.env.OPENAI_API_KEY;

  // Pick a provider.
  let chosen = provider;
  if (chosen === 'auto') {
    if (deepgramKey) chosen = 'deepgram';            // prefer Deepgram when available
    else if (whisperKey) chosen = 'whisper';
    else return jsonError(500, 'no_provider', 'Neither DEEPGRAM_API_KEY nor OPENAI_API_KEY is configured');
  }

  if (chosen === 'whisper') {
    if (!whisperKey) return jsonError(500, 'misconfigured', 'OPENAI_API_KEY not set');
    if (mediaSizeBytes && mediaSizeBytes > WHISPER_MAX_BYTES) {
      return jsonError(413, 'file_too_large',
        `Whisper API limit is 25 MB. Got ${(mediaSizeBytes / 1024 / 1024).toFixed(1)} MB. ` +
        `Set DEEPGRAM_API_KEY (handles up to 2 GB) or use 'provider: deepgram' explicitly.`);
    }
    return runWhisper({ mediaUrl, language, prompt, apiKey: whisperKey });
  }

  if (chosen === 'deepgram') {
    if (!deepgramKey) return jsonError(500, 'misconfigured', 'DEEPGRAM_API_KEY not set');
    return runDeepgram({ mediaUrl, language, prompt, apiKey: deepgramKey });
  }

  return jsonError(400, 'unknown_provider', `Unknown provider: ${chosen}`);
}

// ── Deepgram ─────────────────────────────────────────────────────────
async function runDeepgram({ mediaUrl, language, prompt, apiKey }) {
  const params = new URLSearchParams(DEEPGRAM_QUERY);
  if (language) params.set('language', language);
  if (prompt) {
    // Deepgram supports keyterm boosting via `keyterm` param (Nova-3+)
    // Take the first 50 words of the prompt as boost terms.
    const terms = prompt.split(/\s+/).slice(0, 50).join(' ');
    if (terms) params.set('keyterm', terms);
  }
  const url = `${DEEPGRAM_ENDPOINT}?${params.toString()}`;

  let dgRes;
  try {
    dgRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: mediaUrl }),
    });
  } catch (err) {
    return jsonError(502, 'deepgram_fetch_failed', err.message || String(err));
  }

  if (!dgRes.ok) {
    const errText = await dgRes.text().catch(() => '');
    return jsonError(dgRes.status, 'deepgram_api_error',
      `Deepgram: ${dgRes.status} ${dgRes.statusText}${errText ? ' — ' + errText.slice(0, 400) : ''}`);
  }

  let dg;
  try { dg = await dgRes.json(); }
  catch { return jsonError(502, 'deepgram_bad_response', 'Deepgram returned non-JSON'); }

  return new Response(JSON.stringify(normalizeDeepgram(dg)), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Deepgram's verbose response → Interpreter's normalized shape.
function normalizeDeepgram(dg) {
  const channel = dg?.results?.channels?.[0] || {};
  const alternative = channel.alternatives?.[0] || {};
  const detectedLang = channel.detected_language || dg?.results?.language || null;
  const duration = dg?.metadata?.duration || null;

  // Prefer paragraphs (semantic) → utterances (speaker turns) → fallback to single block
  const paragraphs = alternative.paragraphs?.paragraphs || [];
  const utterances = dg?.results?.utterances || [];

  let segments = [];

  if (paragraphs.length > 0) {
    let n = 1;
    for (const p of paragraphs) {
      const speakerLabel = (typeof p.speaker === 'number') ? `Speaker ${p.speaker + 1}` : 'Speaker 1';
      // Paragraphs contain sentences; flatten each sentence into its own segment
      for (const sent of (p.sentences || [{ text: p.text || '', start: p.start, end: p.end }])) {
        segments.push({
          index: n - 1,
          number: n++,
          speaker: speakerLabel,
          start: sent.start,
          end: sent.end,
          original: (sent.text || '').trim(),
        });
      }
    }
  } else if (utterances.length > 0) {
    let n = 1;
    for (const u of utterances) {
      const speakerLabel = (typeof u.speaker === 'number') ? `Speaker ${u.speaker + 1}` : 'Speaker 1';
      segments.push({
        index: n - 1,
        number: n++,
        speaker: speakerLabel,
        start: u.start,
        end: u.end,
        original: (u.transcript || '').trim(),
      });
    }
  } else {
    // Fallback: single big segment from full transcript
    segments = [{
      index: 0, number: 1, speaker: 'Speaker 1',
      start: 0, end: duration || 0,
      original: (alternative.transcript || '').trim(),
    }];
  }

  const wordTimings = (alternative.words || []).map(w => ({
    word: w.punctuated_word || w.word,
    start: w.start,
    end: w.end,
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

// ── Whisper ──────────────────────────────────────────────────────────
async function runWhisper({ mediaUrl, language, prompt, apiKey }) {
  let mediaBlob;
  try {
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) {
      return jsonError(502, 'media_fetch_failed',
        `Could not fetch media: ${mediaRes.status} ${mediaRes.statusText}`);
    }
    mediaBlob = await mediaRes.blob();
  } catch (err) {
    return jsonError(502, 'media_fetch_error', err.message || String(err));
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
  } catch (err) {
    return jsonError(502, 'whisper_fetch_failed', err.message || String(err));
  }

  if (!whisperRes.ok) {
    const errText = await whisperRes.text().catch(() => '');
    return jsonError(whisperRes.status, 'whisper_api_error',
      `Whisper API: ${whisperRes.status} ${whisperRes.statusText}${errText ? ' — ' + errText : ''}`);
  }

  let whisperJson;
  try { whisperJson = await whisperRes.json(); }
  catch { return jsonError(502, 'whisper_bad_response', 'Whisper returned non-JSON'); }

  const out = {
    provider: 'whisper',
    language: whisperJson.language || language || null,
    duration_seconds: whisperJson.duration || null,
    full_text: whisperJson.text || '',
    segments: (whisperJson.segments || []).map((s, i) => ({
      index: i,
      number: i + 1,
      speaker: 'Speaker 1',
      start: s.start,
      end: s.end,
      original: (s.text || '').trim(),
    })),
    word_timings: (whisperJson.words || []).map(w => ({
      word: w.word, start: w.start, end: w.end, speaker: null,
    })),
  };

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── helpers ─────────────────────────────────────────────────────────
function extractFilenameFromUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.split('/').pop() || null;
  } catch { return null; }
}

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
