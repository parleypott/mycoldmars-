/* ═══════════════════════════════════════════════════════════════════════
 * voice-segmenter — segmentByVoice(text, activeVoiceMap, defaultVoice)
 *
 * Splits a block of story text into ordered [{text, voice, charStart,
 * charEnd}] segments, with dialogue lines attributed to assigned character
 * voices and everything else owned by the narrator (defaultVoice). This is
 * what lets QSS read a story aloud in a different voice for each character.
 *
 * Recognized patterns:
 *   • Name said|asked|whispered|…, "quoted text"
 *   • "quoted text," said|asked|… Name
 *   • Name: "quoted text"  (or  Name: bare line)
 *
 * Smart quotes get normalized to straight (positions preserved — same
 * codepoint length) so a single regex set works regardless of editor.
 * Segments are coalesced when adjacent and same-voice, so the output is the
 * minimum number of audio fetches.
 *
 * Names are matched with WORD BOUNDARIES (\b) so a mapped character name
 * never matches as a substring of a larger word — e.g. "Ann" must not match
 * inside "Joann" and steal that line's voice. (Patterns A and B were
 * substring-matching before; this is the fix.)
 *
 * Single source of truth: loaded as a classic <script> in index.html
 * (sets window.segmentByVoice) AND imported by voice-segmenter.test.mjs.
 * ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.segmentByVoice = api.segmentByVoice; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function segmentByVoice(text, activeVoiceMap, defaultVoice) {
    if (!text) return [];
    const defVoice = defaultVoice || 'matilda';
    const names = Object.keys(activeVoiceMap || {}).filter(n => activeVoiceMap[n]);
    if (!names.length) {
      return [{ text, voice: defVoice, charStart: 0, charEnd: text.length }];
    }

    // Normalize smart quotes → straight (codepoint-preserving)
    const norm = text
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");

    // Build name alternation, longest first so "Queen Scarlet" wins over "Scarlet"
    const sortedNames = names.slice().sort((a, b) => b.length - a.length);
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const namePat = sortedNames.map(escape).join('|');

    const VERBS = 'said|asked|whispered|shouted|yelled|muttered|murmured|hissed|growled|barked|sighed|laughed|replied|answered|cried|wailed|chanted|declared|announced|protested|complained|grumbled|snapped|continued|added|interrupted|insisted|repeated|called';

    // Quote-spans we'll attribute. Each marker = { start, end, voice }
    // where start/end span INCLUDING the surrounding quote chars.
    const markers = [];

    function addMarker(speakerName, quoteStart, quoteEnd) {
      const v = activeVoiceMap[speakerName.trim().toLowerCase()];
      if (!v) return;
      markers.push({ start: quoteStart, end: quoteEnd, voice: v });
    }

    // Pattern A: <Name> <verb>[,:]? "quote"
    // Captured groups: 1=name  2=opening quote+text+closing quote
    // \b around the name so it can't match inside a larger word ("Joann").
    const reA = new RegExp(
      `\\b(${namePat})\\b\\s+(?:${VERBS})[,:]?\\s+("[^"\\n]+")`,
      'gi'
    );
    let m;
    while ((m = reA.exec(norm)) !== null) {
      const quoteIdx = m.index + m[0].lastIndexOf(m[2]);
      addMarker(m[1], quoteIdx, quoteIdx + m[2].length);
    }

    // Pattern B: "quote"[,]? <verb> <Name>
    const reB = new RegExp(
      `("[^"\\n]+")[,]?\\s+(?:${VERBS})\\s+\\b(${namePat})\\b`,
      'gi'
    );
    while ((m = reB.exec(norm)) !== null) {
      const quoteIdx = m.index + m[0].indexOf(m[1]);
      addMarker(m[2], quoteIdx, quoteIdx + m[1].length);
    }

    // Pattern C: ^<Name>: "quote"  OR  ^<Name>: bare line
    // The "bare line" branch captures from the colon to end-of-line.
    // (^ + the trailing colon already bound the name, so no \b needed here.)
    const reC = new RegExp(
      `^(\\s*)(${namePat}):\\s*(.+?)\\s*$`,
      'gim'
    );
    while ((m = reC.exec(norm)) !== null) {
      const speaker = m[2];
      // Skip if the rest of the line is empty / just punctuation
      if (!m[3] || !m[3].trim().length) continue;
      const restIdx = m.index + m[0].indexOf(m[3]);
      addMarker(speaker, restIdx, restIdx + m[3].length);
    }

    // Sort + drop overlaps (first match wins)
    markers.sort((a, b) => a.start - b.start);
    const clean = [];
    for (const mk of markers) {
      const last = clean[clean.length - 1];
      if (last && mk.start < last.end) continue;
      clean.push(mk);
    }

    // Fill gaps with narrator
    const out = [];
    let cursor = 0;
    for (const mk of clean) {
      if (mk.start > cursor) {
        out.push({ text: text.slice(cursor, mk.start), voice: defVoice, charStart: cursor, charEnd: mk.start });
      }
      out.push({ text: text.slice(mk.start, mk.end), voice: mk.voice, charStart: mk.start, charEnd: mk.end });
      cursor = mk.end;
    }
    if (cursor < text.length) {
      out.push({ text: text.slice(cursor), voice: defVoice, charStart: cursor, charEnd: text.length });
    }

    // Coalesce adjacent same-voice segments (minimizes audio fetches)
    const merged = [];
    for (const seg of out) {
      const last = merged[merged.length - 1];
      if (last && last.voice === seg.voice) {
        last.text += seg.text;
        last.charEnd = seg.charEnd;
      } else {
        merged.push({ ...seg });
      }
    }

    return merged.filter(s => s.text.length > 0);
  }

  return { segmentByVoice };
});
