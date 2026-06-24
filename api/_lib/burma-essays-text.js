// Pure text helpers for the Burma Essays narrator (api/burma-essays.js).
// Extracted so they can be unit-tested headlessly — stripMarkdown feeds the
// ElevenLabs TTS, so any markdown symbol it misses gets read ALOUD to the
// listener ("underscore", "tilde"), which is the whole reason it exists.

export function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, '')        // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')           // inline code
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')  // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links -> link text
    // Table separator rows (|---|:--:|) — strip BEFORE the row→comma pass below,
    // else the dashes read as "dash dash dash" or leak in as a bogus cell.
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/gm, '')
    // Pipe-bordered table rows (| City | Pop |) — speak the cells, drop the bars
    // (else ElevenLabs reads "vertical bar"). Only fires on lines that BOTH
    // start and end with a pipe, so prose containing a stray "|" is untouched.
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, inner) =>
      inner.split('|').map((c) => c.trim()).filter(Boolean).join(', '))
    // Thematic breaks (---, ***, ___, or spaced - - -) on their own line — these
    // dodge the bullet rule below (no trailing content) and get read aloud.
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
    // Setext heading underline (=== under a title); the H2 dash form is already
    // killed by the thematic-break rule above. Keeps the title text as prose.
    .replace(/^[ \t]*=+[ \t]*$/gm, '')
    .replace(/^#+\s*/gm, '')               // ATX headings
    .replace(/^\s*[-*]\s+/gm, '')          // bullet lists
    .replace(/^\s*\d+\.\s+/gm, '')         // numbered lists
    .replace(/~~([^~]+)~~/g, '$1')         // strikethrough (else reads "tilde")
    .replace(/\*\*([^*]+)\*\*/g, '$1')     // bold **
    .replace(/__([^_]+)__/g, '$1')         // bold __ (else leaves stray underscores)
    .replace(/\*([^*]+)\*/g, '$1')         // italic *
    .replace(/_([^_]+)_/g, '$1')           // italic _
    .replace(/^>+\s*/gm, '')               // blockquotes
    .replace(/\n{3,}/g, '\n\n')            // collapse blank runs
    .trim();
}

export function firstLine(t) {
  return (t || '').split('\n').map((s) => s.trim()).find(Boolean)?.slice(0, 80);
}

export function slug(t) {
  return (t || 'essay').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'essay';
}

export function clampNum(n) {
  n = Number(n);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Default per-request size for the ElevenLabs TTS call (api/burma-essays.js).
export const CHUNK_LIMIT = 4800;

// Split an essay into TTS-sized chunks. Two hard invariants, because in
// generateAudio() a SINGLE bad chunk (synth() returns null) fails the WHOLE
// essay's audio: (1) NO chunk is ever empty — an empty string POSTed to
// ElevenLabs 400s; (2) NO chunk ever exceeds `max` — an over-cap chunk is
// rejected by the per-request limit. The old inline version broke both: an
// empty leading buffer was flushed verbatim when a near-max first paragraph
// arrived, and a single sentence (or punctuation-less run-on, via the `?? [p]`
// fallback) longer than `max` was emitted as one over-cap chunk. Same bug
// class as the research-tts chunker.
export function chunkText(text, max = CHUNK_LIMIT) {
  text = typeof text === 'string' ? text : '';
  if (text.length <= max) return text.trim() ? [text] : [];
  const out = [];
  let buf = '';
  const flush = () => { const t = buf.trim(); if (t) out.push(t); buf = ''; };
  // Emit a single over-long string in <=max slices, never empty, never over cap.
  const hardSplit = (s) => { for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max)); };

  for (const p of text.split(/\n\n+/)) {
    if (p.length > max) {
      // Match terminated sentences AND any un-terminated trailing run, so a
      // giant paragraph that doesn't end in . ! ? doesn't silently drop its tail.
      const sentences = p.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [p];
      for (const s of sentences) {
        if (s.length > max) { flush(); hardSplit(s.trim()); continue; }
        if ((buf + ' ' + s).trim().length > max) { flush(); buf = s; }
        else buf = buf ? buf + ' ' + s : s;
      }
    } else if ((buf + '\n\n' + p).length > max) { flush(); buf = p; }
    else buf = buf ? buf + '\n\n' + p : p;
  }
  flush();
  return out;
}
