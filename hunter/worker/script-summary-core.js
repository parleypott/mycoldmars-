/**
 * Pure core extracted VERBATIM from build-script-context.mjs so it can be unit-tested
 * headless. build-script-context.mjs builds a Supabase + GoogleGenAI client at module
 * load (and createClient throws on an undefined URL), so the worker itself can't be
 * imported in a node/bun test — the established worker-lock pattern (cf. scene-detection-core,
 * taste-aggregate-core, cross-tier-core, build-corpus-time) extracts the pure function here.
 *
 * buildScriptSummary turns one Google Docs script snapshot into the compact, diverse
 * training summary fed to Gemini in build-script-context's analyzeBatch — i.e. it is what
 * teaches the Hunter Script Copilot Johnny's color language, structure, and conventions.
 * A regression here silently corrupts the copilot's training corpus, with no signal.
 */
export function buildScriptSummary(snap, index) {
  const doc = snap.parsed_doc;
  const elements = doc.elements || [];
  const beats = elements.filter(e => e.type === 'beat');
  const headings = elements.filter(e => e.type === 'heading' && !e.isTab).map(e => e.text);

  // Color summary
  const colorSummary = Object.entries(snap.color_profile || {})
    .sort((a, b) => b[1].count - a[1].count)
    .map(([color, data]) => {
      const samples = (data.sampleTexts || []).slice(0, 3).map(s => `"${s.slice(0, 50)}"`).join(', ');
      return `  ${color}: ${data.count}x — ${samples}`;
    })
    .join('\n');

  // Sample beats — take from beginning, middle, and end for diversity
  const sampleIndices = [];
  if (beats.length <= 20) {
    for (let i = 0; i < beats.length; i++) sampleIndices.push(i);
  } else {
    // 7 from start, 6 from middle, 7 from end
    for (let i = 0; i < 7; i++) sampleIndices.push(i);
    const mid = Math.floor(beats.length / 2);
    for (let i = mid - 3; i < mid + 3; i++) sampleIndices.push(i);
    for (let i = beats.length - 7; i < beats.length; i++) sampleIndices.push(i);
  }

  const sampleBeats = [...new Set(sampleIndices)].map(i => {
    const beat = beats[i];
    if (!beat) return '';

    const fmtRuns = (runs) => (runs || []).map(r => {
      const s = r.style || {};
      const a = [];
      if (s.highlight) a.push(s.highlight);
      if (s.bold) a.push('BOLD');
      if (s.italic) a.push('ITALIC');
      if (s.strikethrough) a.push('STRUCK');
      const txt = (r.text || '').trim().slice(0, 80);
      return a.length ? `[${a.join('/')}: ${txt}]` : txt;
    }).filter(Boolean).join(' ');

    const voice = fmtRuns(beat.voice?.runs) || beat.voice?.text?.slice(0, 100) || '(empty)';
    const visual = fmtRuns(beat.visual?.runs) || beat.visual?.text?.slice(0, 100) || '(empty)';
    return `  Beat ${i + 1}/${beats.length}:\n    VOICE: ${voice}\n    VISUAL: ${visual}`;
  }).filter(Boolean).join('\n');

  return `=== SCRIPT ${index + 1}: "${doc.title}" ===
Stats: ${beats.length} beats, ${doc.stats?.wordCount || '?'} words, ${doc.stats?.coloredRunCount || 0} colored runs
Headings: ${headings.join(' → ') || '(none)'}
Colors:
${colorSummary || '  (no colors)'}
Sample beats:
${sampleBeats}`;
}
