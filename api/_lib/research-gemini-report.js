// Pure report assembler for the Gemini deep-research path (api/research-gemini.js).
//
// Takes the parsed Gemini generateContent response and builds the markdown
// report shown in the research tool, plus the counts the frontend renders
// ("grounded on N sources via M queries").
//
// Contract note: groundingChunks routinely repeat the same web.uri (one source
// cited across multiple grounding spans), so the report's "## Sources" list is
// DEDUPED. The returned `sources` count is the deduped count too — it must match
// the number of sources actually listed, not the raw chunk count. (The old inline
// code returned the raw chunk count, overstating how many sources the report shows.)
export function buildGeminiReport(data) {
  const cand = data?.candidates?.[0];
  const text = cand?.content?.parts?.map(p => p.text ?? '').join('\n').trim() ?? '(empty)';

  const rawSources = [];
  for (const ch of cand?.groundingMetadata?.groundingChunks ?? []) {
    if (ch.web?.uri) rawSources.push(ch.web.uri);
  }
  const sources = [...new Set(rawSources)]; // deduped — exactly what the report lists

  const queries = cand?.groundingMetadata?.webSearchQueries ?? [];

  const report = text +
    (sources.length ? `\n\n## Sources\n${sources.map((u, i) => `${i + 1}. ${u}`).join('\n')}` : '') +
    (queries.length ? `\n\n_Search queries used: ${queries.map(q => `\`${q}\``).join(', ')}_` : '');

  return { report, sources: sources.length, queries: queries.length };
}
