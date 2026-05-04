const BATCH_SIZE = 20;

/**
 * Call Claude via our proxy. Streams the response and accumulates text.
 * All waiting happens in the browser — the proxy just pipes bytes.
 */
async function callClaude(systemPrompt, userMessage, maxTokens = 2000) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
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
function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch {}

  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch {}

  const startArr = text.indexOf('[');
  const startObj = text.indexOf('{');
  const start = startArr === -1 ? startObj : startObj === -1 ? startArr : Math.min(startArr, startObj);
  if (start !== -1) {
    const open = text[start], close = open === '[' ? ']' : '}';
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch {}
        break;
      }
    }
  }
  throw new Error('Could not parse response from Claude');
}

function isGenericSpeaker(name) {
  if (!name) return true;
  return /^speaker\s*\d+$/i.test(name.trim());
}

// ── Analyze ──

export async function analyzeTranscript(segments) {
  const tagged = segments.map(s => ({ ...s, isGeneric: isGenericSpeaker(s.speaker) }));
  const labeled = tagged.filter(s => !s.isGeneric);
  const genericCount = tagged.filter(s => s.isGeneric).length;
  const genericNums = tagged.filter(s => s.isGeneric).map(s => s.number);

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

export async function translateSegments({ segments, languageMap, narrativeSummary, clarifications, editorialFocus, onProgress }) {
  const results = new Array(segments.length);
  const labeledWithIndex = [];

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (isGenericSpeaker(s.speaker)) {
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

  // Run batches in parallel
  let completed = 0;
  const batchPromises = batches.map(async (batch) => {
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
  });

  const batchResults = await Promise.all(batchPromises);

  for (const { batch, translated } of batchResults) {
    for (let j = 0; j < batch.length; j++) {
      const { resultIndex } = batch[j];
      results[resultIndex] = translated[j] || {
        number: segments[resultIndex].number,
        original: segments[resultIndex].text,
        translated: segments[resultIndex].text,
        language: 'unknown',
        kept_original: true,
      };
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
  const labeled = segments.filter(s => !isGenericSpeaker(s.speaker));
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
  const labeled = segments.filter(s => !isGenericSpeaker(s.speaker));
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
  const chunkPromises = chunks.map(async (chunk) => {
    const chunkText = chunk
      .map(s => `${s.number}. [${s.speaker}]: ${s.text}`)
      .join('\n');

    const userMsg = [
      narrativeSummary ? `NARRATIVE SUMMARY:\n${narrativeSummary}\n` : '',
      editorialFocus ? `EDITORIAL FOCUS:\n${editorialFocus}\n` : '',
      `TRANSCRIPT CHUNK (${chunk.length} segments):\n\n${chunkText}`,
    ].filter(Boolean).join('\n');

    const rawText = await callClaude(systemPrompt, userMsg, 4000);
    let parsed;
    try {
      parsed = extractJSON(rawText);
    } catch (e) {
      console.error('Soundbite chunk parse failed:', rawText.slice(0, 400));
      return [];
    }
    completed++;
    if (onProgress) onProgress(completed, chunks.length);
    return Array.isArray(parsed?.soundbites) ? parsed.soundbites : [];
  });

  const chunkResults = await Promise.all(chunkPromises);
  return chunkResults.flat();
}
