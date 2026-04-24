const BASE = '/api';
const BATCH_SIZE = 50;

/**
 * POST to API route. Handles streaming responses (keepalive spaces + JSON).
 * The server streams spaces to keep the connection alive, then sends JSON at the end.
 */
async function post(path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Try to read error as text (might be streamed)
    const text = await res.text();
    let error;
    try {
      error = JSON.parse(text.trim())?.error;
    } catch {
      error = res.statusText;
    }
    throw new Error(error || `API error ${res.status}`);
  }

  // Read full response as text, trim keepalive spaces, parse JSON
  const text = await res.text();
  const trimmed = text.trim();

  if (!trimmed) throw new Error('Empty response from API');

  const parsed = JSON.parse(trimmed);

  // Check if the response itself is an error object
  if (parsed.error) throw new Error(parsed.error);

  return parsed;
}

export function analyzeTranscript(segments) {
  return post('subtitle-analyze', { segments });
}

/** Check if a speaker name is generic (Speaker 1, Speaker 2, etc.) */
function isGenericSpeaker(name) {
  if (!name) return true;
  return /^speaker\s*\d+$/i.test(name.trim());
}

/**
 * Translate segments with client-side batching.
 * Filters out generic speakers, splits labeled segments into batches of 50,
 * sends each batch as a separate API call, then merges results back.
 */
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

  if (labeledWithIndex.length === 0) {
    return Array.from(results);
  }

  const batches = [];
  for (let i = 0; i < labeledWithIndex.length; i += BATCH_SIZE) {
    batches.push(labeledWithIndex.slice(i, i + BATCH_SIZE));
  }

  const sharedContext = {
    language_map: languageMap,
    narrative_summary: narrativeSummary,
    clarifications,
    editorial_focus: editorialFocus,
  };

  let completed = 0;
  const batchPromises = batches.map(async (batch) => {
    const batchSegments = batch.map(b => b.segment);
    const translated = await post('subtitle-translate', {
      segments: batchSegments,
      ...sharedContext,
    });

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
