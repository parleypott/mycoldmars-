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
