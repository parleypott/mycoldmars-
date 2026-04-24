const BASE = '/api';
const BATCH_SIZE = 50;

async function post(path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }

  return res.json();
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
  // Separate labeled vs generic
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

  // Split labeled segments into batches
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

  // Run all batches in parallel
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

  // Merge results back in order
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
