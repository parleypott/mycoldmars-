const BATCH_SIZE = 20;

/**
 * Run `fn(item)` on each entry of `items` with bounded concurrency.
 * Results are returned in original-index order. Replaces a naked
 * `Promise.all(items.map(fn))` when fn() hits a network endpoint —
 * 30 parallel /api/claude calls hammered the proxy, saturated the
 * browser net stack, and made progress jump in chunks. Concurrency
 * 5 keeps the pipeline busy without melting it.
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.max(1, Math.min(concurrency, items.length)); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return out;
}

/**
 * Call Claude via our proxy. Streams the response and accumulates text.
 * All waiting happens in the browser — the proxy just pipes bytes.
 */
async function callClaude(systemPrompt, userMessage, maxTokens = 2000) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      stream: true,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error ${res.status}: ${text.slice(0, 200)}`);
  }

  // Parse SSE stream in the browser. The reader MUST be cancelled in a
  // finally block — leaving it dangling holds the underlying HTTP
  // connection open, and browsers cap ~6 connections per origin, so a
  // few leaks freeze every subsequent request.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.text) {
            fullText += event.delta.text;
          }
        } catch {}
      }
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }

  return fullText;
}

/** Extract JSON from Claude's text response */
export function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch {}

  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch {}

  const startArr = text.indexOf('[');
  const startObj = text.indexOf('{');
  const start = startArr === -1 ? startObj : startObj === -1 ? startArr : Math.min(startArr, startObj);
  if (start !== -1) {
    const open = text[start], close = open === '[' ? ']' : '}';
    // String-aware bracket matcher. A naive depth counter miscounts when a JSON
    // string VALUE contains a literal bracket — e.g. a transcript string like
    // `"she said [inaudible"` (lone `[` → depth never returns to 0) or a note
    // ending in `}` (closes the object early) — and throws away the whole
    // response. Track whether we're inside a quoted string and skip escaped
    // characters so only STRUCTURAL brackets move the depth. Runs only after a
    // clean parse + fenced parse already failed, so it can't regress those.
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }
  throw new Error('Could not parse response from Claude');
}

export function isGenericSpeaker(name) {
  if (!name) return true;
  return /^speaker\s*\d+$/i.test(name.trim());
}

// ── Analyze ──

export async function analyzeTranscript(segments) {
  const tagged = segments.map(s => ({ ...s, isGeneric: isGenericSpeaker(s.speaker) }));
  // Undiarized transcript (all speakers blank/generic): analyze ALL segments
  // instead of stripping everything and sending Claude an empty transcript.
  const allGeneric = tagged.length > 0 && tagged.every(s => s.isGeneric);
  const labeled = allGeneric ? tagged : tagged.filter(s => !s.isGeneric);
  const genericCount = allGeneric ? 0 : tagged.filter(s => s.isGeneric).length;
  const genericNums = allGeneric ? [] : tagged.filter(s => s.isGeneric).map(s => s.number);

  const transcriptText = labeled
    .map(s => `${s.number}. [${s.speaker}]: ${s.text}`)
    .join('\n');

  const systemPrompt = `You are a translation analysis assistant for a documentary video production team.

Your job:
1. Read the dialogue as one continuous narrative.
2. Identify which language each speaker uses.
3. Identify 3-6 major themes/topics.
4. Flag ambiguous passages needing clarification (max 10).

Respond with JSON only (no markdown fencing):
{
  "narrative_summary": "2-3 sentence summary",
  "themes": ["theme 1", "theme 2"],
  "language_map": { "Speaker Name": "Language" },
  "questions": [{ "id": "q1", "segment_range": "15-18", "quoted_text": "...", "question": "...", "why": "..." }]
}`;

  const rawText = await callClaude(
    systemPrompt,
    `Transcript (${labeled.length} labeled, ${genericCount} unlabeled ignored):\n\n${transcriptText}`,
    2000,
  );

  const result = extractJSON(rawText);
  result.generic_segments = genericNums;
  return result;
}

// ── Translate ──

function buildTranslatePrompt(context) {
  return `You are a professional subtitle translator for a documentary production team.

${context}

RULES:
1. Translate non-English segments into natural English for subtitles.
2. English segments: pass through as-is, mark kept_original: true.
3. Keep the speaker's tone. Be concise. No quotes or speaker labels.
4. Garbled transcription: infer from context or output "[inaudible]".

Respond with JSON array only (no markdown):
[{"number": 1, "original": "...", "translated": "...", "language": "...", "kept_original": false}]

Maintain exact order and count.`;
}

function buildContext({ narrativeSummary, editorialFocus, languageMap, clarifications }) {
  let context = `NARRATIVE CONTEXT:\n${narrativeSummary || 'No summary available.'}\n\n`;
  if (editorialFocus) context += `EDITORIAL FOCUS:\n${editorialFocus}\n\n`;
  if (languageMap && Object.keys(languageMap).length > 0) {
    context += `LANGUAGES:\n${Object.entries(languageMap).map(([s, l]) => `- ${s}: ${l}`).join('\n')}\n\n`;
  }
  if (clarifications?.length > 0) {
    context += `CLARIFICATIONS:\n${clarifications.map(c => `- Q(${c.id}): ${c.answer}`).join('\n')}\n\n`;
  }
  return context;
}

/**
 * Re-attach one batch's model output to the right segments.
 *
 * The model is asked to return a JSON array of translation objects, each
 * carrying its source `number`, "in exact order and count". But LLMs DO drop
 * or merge an item inside a 20-segment list, and the original reassembly paired
 * results purely by POSITION (`translated[j]`). One dropped item there shifts
 * every later segment in the batch onto the WRONG translation and silently
 * corrupts the subtitles. So: match each segment to the returned object by
 * `number` first (robust to a drop/reorder), fall back to positional pairing
 * only for an UNtagged object (older models that omit `number`), and finally to
 * a pass-through fallback. Numbers are compared as strings so a model that
 * stringifies `"number": "7"` still aligns with a numeric segment 7.
 *
 * Byte-identical to positional pairing on the happy path (a full, in-order,
 * correctly-numbered array).
 *
 * @param {Array}  batch       — [{ segment, resultIndex }]
 * @param {*}      translated  — the model's parsed reply (expected: array)
 * @param {Array}  segments    — full segment list (for the fallback shape)
 * @returns {Array} [{ resultIndex, value }]
 */
export function reassembleBatch(batch, translated, segments) {
  const arr = Array.isArray(translated) ? translated : [];
  const byNumber = new Map();
  for (const t of arr) {
    if (t && typeof t === 'object' && t.number != null) {
      const key = String(t.number);
      if (!byNumber.has(key)) byNumber.set(key, t); // first occurrence wins
    }
  }
  return batch.map(({ segment, resultIndex }, j) => {
    const keyed = byNumber.get(String(segment.number));
    // Positional fallback ONLY for an untagged object — never silently snap a
    // mis-numbered object onto this slot (that's the corruption we're fixing).
    const positional = !keyed && arr[j] && typeof arr[j] === 'object' && arr[j].number == null ? arr[j] : null;
    const value = keyed || positional || {
      number: segments[resultIndex].number,
      original: segments[resultIndex].text,
      translated: segments[resultIndex].text,
      language: 'unknown',
      kept_original: true,
    };
    return { resultIndex, value };
  });
}

export async function translateSegments({ segments, languageMap, narrativeSummary, clarifications, editorialFocus, onProgress }) {
  const results = new Array(segments.length);
  const labeledWithIndex = [];

  // No real speaker labels at all (undiarized import where every speaker is ''):
  // translate every segment instead of marking them [unintelligible]. The
  // generic-skip only exists to separate REAL speakers from chatter; with no
  // real speaker to contrast against, it would strip the whole transcript.
  const allGeneric = segments.length > 0 && segments.every(s => isGenericSpeaker(s.speaker));
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (isGenericSpeaker(s.speaker) && !allGeneric) {
      results[i] = {
        number: s.number,
        original: s.text,
        translated: '[unintelligible]',
        language: 'unknown',
        kept_original: false,
        unintelligible: true,
      };
    } else {
      labeledWithIndex.push({ segment: s, resultIndex: i });
    }
  }

  if (labeledWithIndex.length === 0) return Array.from(results);

  // Split into batches
  const batches = [];
  for (let i = 0; i < labeledWithIndex.length; i += BATCH_SIZE) {
    batches.push(labeledWithIndex.slice(i, i + BATCH_SIZE));
  }

  const context = buildContext({ narrativeSummary, editorialFocus, languageMap, clarifications });
  const systemPrompt = buildTranslatePrompt(context);

  // Run batches with bounded concurrency. Was fully parallel
  // (Promise.all over every batch) — on a 600-segment transcript
  // that's 30 batches firing simultaneously: hammers the proxy,
  // saturates the browser network stack, and progress jumps in
  // chunks of 30 rather than ticking smoothly. Concurrency=5
  // keeps the pipeline saturated without melting it.
  let completed = 0;
  const runBatch = async (batch) => {
    const batchSegments = batch.map(b => b.segment);
    const segmentText = batchSegments
      .map(s => `SEG ${s.number} [${s.speaker || ''}]: ${s.text}`)
      .join('\n');

    const rawText = await callClaude(
      systemPrompt,
      `Translate these ${batchSegments.length} segments:\n\n${segmentText}`,
      8192,
    );

    let translated;
    try {
      translated = extractJSON(rawText);
    } catch (e) {
      console.error('Failed to parse batch response. Raw text:', rawText.slice(0, 500));
      throw new Error(`Batch parse failed: ${e.message}`);
    }
    if (!Array.isArray(translated)) {
      console.error('Not an array. Got:', typeof translated, rawText.slice(0, 500));
      throw new Error('Translation response is not an array');
    }

    completed++;
    if (onProgress) onProgress(completed, batches.length);

    return { batch, translated };
  };

  const batchResults = await mapWithConcurrency(batches, 5, runBatch);

  for (const { batch, translated } of batchResults) {
    for (const { resultIndex, value } of reassembleBatch(batch, translated, segments)) {
      results[resultIndex] = value;
    }
  }

  return Array.from(results);
}

// ── Soundbite Workshop ──

/**
 * Auto-detect 8–12 broad recurring themes from the transcript.
 * Themes can be topical ("ON JOINING NATO"), claim-shaped ("FINLAND IS SMALL"),
 * or perspective-based ("US SOLDIER PERSPECTIVE"). Each gets a short description
 * explaining what kind of soundbite belongs there.
 */
export async function detectThemes(segments, { editorialFocus, narrativeSummary } = {}) {
  const nonGeneric = segments.filter(s => !isGenericSpeaker(s.speaker));
  // Undiarized transcripts (every speaker blank/generic) would filter to empty
  // and yield zero themes — fall back to ALL segments so themes still generate.
  const labeled = nonGeneric.length ? nonGeneric : segments;
  const transcriptText = labeled
    .map(s => `${s.number}. [${s.speaker}]: ${s.text}`)
    .join('\n');

  const systemPrompt = `You are an editorial assistant for a documentary video team.

Your job: identify 8–12 broad recurring themes in this transcript that would make good organizing buckets for "soundbites" — short standalone quotes (typically 5–30 seconds) the editor will pull and arrange.

Themes should be useful editorial buckets, not just topic labels. They can be:
- TOPICAL: a subject area ("ON JOINING NATO", "RELATIONSHIP WITH RUSSIA")
- CLAIM-SHAPED: a perspective or argument the speakers articulate ("FINLAND IS SMALL", "CHANGE OF OPINION")
- EXPERIENTIAL: a vantage point ("US SOLDIER PERSPECTIVE", "STREET INTERVIEWS")

Aim for themes the editor would actually want to organize their cut around — not generic ones like "general thoughts." Use ALL CAPS for theme names. Each theme should be distinct; avoid overlap.

For each theme, write a short description (1–2 sentences) explaining what kind of quote belongs there.

Respond with JSON only (no markdown fencing):
{
  "themes": [
    { "name": "ON JOINING NATO", "description": "Reasons, motivations, and the political process around the decision to join NATO." },
    { "name": "FINLAND IS SMALL", "description": "Quotes that frame Finland's identity through smallness — vulnerability, modesty, or punching above weight." }
  ]
}`;

  const userMsg = [
    narrativeSummary ? `NARRATIVE SUMMARY:\n${narrativeSummary}\n` : '',
    editorialFocus ? `EDITORIAL FOCUS:\n${editorialFocus}\n` : '',
    `TRANSCRIPT (${labeled.length} segments):\n\n${transcriptText}`,
  ].filter(Boolean).join('\n');

  const rawText = await callClaude(systemPrompt, userMsg, 2000);
  const result = extractJSON(rawText);
  return Array.isArray(result?.themes) ? result.themes : [];
}

/**
 * Extract soundbites — short standalone quotes — and tag each with the themes it fits.
 * A soundbite is a segment (or sometimes a few contiguous segments) that stands alone
 * as a clear declarative point. Multi-label: one segment can belong to multiple themes.
 *
 * Returns: [{ segmentNumber, themes: [name, ...], label?: string }]
 */
export async function extractSoundbites({ segments, themes, editorialFocus, narrativeSummary, onProgress }) {
  const nonGeneric = segments.filter(s => !isGenericSpeaker(s.speaker));
  // Fall back to ALL segments when nothing has a real speaker (undiarized import).
  const labeled = nonGeneric.length ? nonGeneric : segments;
  if (labeled.length === 0 || themes.length === 0) return [];

  // Chunk transcript so we don't blow out a single context. ~80 segments per chunk.
  const CHUNK_SIZE = 80;
  const chunks = [];
  for (let i = 0; i < labeled.length; i += CHUNK_SIZE) {
    chunks.push(labeled.slice(i, i + CHUNK_SIZE));
  }

  const themeList = themes.map(t => `- ${t.name}: ${t.description || '(no description)'}`).join('\n');

  const systemPrompt = `You are an editorial assistant for a documentary video team. The editor has defined a set of THEMES and wants you to extract SOUNDBITES from the transcript that fit them.

A SOUNDBITE is:
- A short, standalone quote — typically 5–30 seconds.
- A single declarative thought, not a multi-segment ramble.
- Clear and self-contained — works without surrounding context.
- Punchy, memorable, or emotionally resonant.

THEMES (the editor's organizing buckets):
${themeList}

For EACH segment in the chunk, decide:
1. Does it stand alone as a soundbite? (Skip if it's filler, mid-thought, an interviewer prompt, or only meaningful with neighboring segments.)
2. If yes, which of the themes above does it fit? (Multi-label allowed — a quote can belong to multiple themes. Use the theme names EXACTLY as listed.)
3. Optionally: a short label (5–10 words) summarizing the quote's point.

Be selective. Most segments are NOT soundbites. A typical 80-segment chunk might yield 10–25 soundbites.

Respond with JSON only (no markdown fencing):
{
  "soundbites": [
    { "segmentNumber": 12, "themes": ["ON JOINING NATO"], "label": "Deterrence wasn't enough anymore" },
    { "segmentNumber": 47, "themes": ["FINLAND IS SMALL", "RELATIONSHIP WITH RUSSIA"], "label": "Long border, careful neighbors" }
  ]
}`;

  let completed = 0;
  let failedChunks = 0;
  const runChunk = async (chunk) => {
    const chunkText = chunk
      .map(s => `${s.number}. [${s.speaker}]: ${s.text}`)
      .join('\n');

    const userMsg = [
      narrativeSummary ? `NARRATIVE SUMMARY:\n${narrativeSummary}\n` : '',
      editorialFocus ? `EDITORIAL FOCUS:\n${editorialFocus}\n` : '',
      `TRANSCRIPT CHUNK (${chunk.length} segments):\n\n${chunkText}`,
    ].filter(Boolean).join('\n');

    // Per-chunk try/catch so a single network blip doesn't reject the
    // whole batch. Returns [] on parse OR fetch failure — caller
    // surface includes the failed-chunk count so the user knows a
    // partial result is just partial.
    let rawText;
    try {
      rawText = await callClaude(systemPrompt, userMsg, 4000);
    } catch (e) {
      console.warn('[extractSoundbites] chunk fetch failed:', e?.message || e);
      failedChunks++;
      completed++;
      if (onProgress) onProgress(completed, chunks.length);
      return [];
    }
    let parsed;
    try {
      parsed = extractJSON(rawText);
    } catch (e) {
      console.error('Soundbite chunk parse failed:', rawText.slice(0, 400));
      failedChunks++;
      completed++;
      if (onProgress) onProgress(completed, chunks.length);
      return [];
    }
    completed++;
    if (onProgress) onProgress(completed, chunks.length);
    return Array.isArray(parsed?.soundbites) ? parsed.soundbites : [];
  };

  const chunkResults = await mapWithConcurrency(chunks, 5, runChunk);
  const bites = chunkResults.flat();
  // Return both the bites and the failed-chunk count so the caller can
  // surface "N segments couldn't be analyzed — re-run to retry."
  return { bites, totalChunks: chunks.length, failedChunks };
}

/**
/**
 * Transcribe a media file via the Whisper proxy at /api/transcribe.
 *
 * @param {object} opts
 * @param {string} opts.mediaUrl — short-lived signed URL to the file in storage
 * @param {number} opts.mediaSizeBytes — size guard for Whisper's 25MB limit
 * @param {string} [opts.language] — ISO 639-1 source language (auto-detect if omitted)
 * @param {string} [opts.prompt] — bias hint (proper nouns, jargon)
 * @returns {Promise<{ language, duration_seconds, full_text, segments, word_timings }>}
 */
export async function transcribeMedia({ mediaUrl, mediaSizeBytes, language, prompt }) {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaUrl, mediaSizeBytes, language, prompt }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || j?.error?.code || '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    const err = new Error(`Transcription failed (${res.status}): ${detail || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Polish a single soundbite — propose strikethroughs to remove
 * filler/repetition/asides, plus a final cleaned version. Meaning,
 * voice, and ordering of remaining text are preserved.
 *
 * Returns: { chunks: [{ type: 'keep'|'strike', text }], polished: string }
 */
export async function polishSoundbite(text) {
  if (!text || !text.trim()) return { chunks: [], polished: '' };

  const systemPrompt = `You are an editor cleaning up a documentary soundbite for a producer's selects sequence. The speaker said something verbose; your job is to identify which words are filler / repetition / clarifying-tangents that can be cut, and which words are essential.

You must:
- Preserve meaning. Keep the speaker's voice.
- Cut filler ("uh", "you know", "I mean"), repeated phrases, restated points, parenthetical clarifications that aren't load-bearing.
- Keep the same ORDER of remaining text — do not rearrange (the original audio plays in order).
- The cuts may produce a slightly choppier read than the original; that's fine.

Return JSON only (no fencing). Two parallel views of the edit:

{
  "chunks": [
    { "type": "keep",   "text": "I'm from Kinmen, born and raised. " },
    { "type": "strike", "text": "I was born in 1984, " },
    { "type": "keep",   "text": "when Kinmen was still under military rule." }
  ],
  "polished": "I'm from Kinmen, born and raised. When Kinmen was still under military rule."
}

Rules:
- Concatenating all chunk text in order MUST equal the original text exactly (including spacing and punctuation).
- "polished" is the cleaned version — concatenate the keep chunks, then lightly fix capitalization at sentence starts after a strike.
- Aim to cut 20-50% of words. If the text is already tight, cut less.`;

  const rawText = await callClaude(
    systemPrompt,
    `Soundbite to polish:\n\n${text}`,
    1200,
  );
  const result = extractJSON(rawText);
  if (!Array.isArray(result?.chunks)) {
    throw new Error('Polish response missing chunks array');
  }
  return {
    chunks: result.chunks,
    polished: result.polished || result.chunks.filter(c => c.type === 'keep').map(c => c.text).join(''),
  };
}
