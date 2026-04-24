const BASE = '/api';

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

export function translateSegments({ segments, languageMap, narrativeSummary, clarifications, chunkingPrefs }) {
  return post('subtitle-translate', {
    segments,
    language_map: languageMap,
    narrative_summary: narrativeSummary,
    clarifications,
    chunkingPrefs,
  });
}
