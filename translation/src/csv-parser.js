/**
 * Extract the speaker name from a raw field.
 *
 * Two patterns to handle:
 *   1. Sequence-prefixed speaker — e.g. "260317-04-104-JERRY - JOHNNY"
 *      → strip the numeric prefix, return just the trailing speaker ("Johnny").
 *   2. Plain multi-word speaker name — e.g. "ALL JH ONCAM", "Mikael Antell"
 *      → return as-is, preserving casing. No digits means no prefix to strip.
 *
 * Heuristic: if the raw name contains digits, treat it as a sequence prefix
 * and strip to the last alpha word. Otherwise the whole string is the name.
 */
export function cleanSpeakerName(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';

  // No digits → assume the whole string is the speaker name. Preserve casing.
  if (!/\d/.test(trimmed)) return trimmed;

  // Has digits → likely a sequence prefix with trailing speaker. Walk backward
  // for the last all-alpha word.
  const words = trimmed.split(/[\s\-_]+/);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i].replace(/['']/g, ''); // strip apostrophes
    if (/^[a-zA-Z]{2,}$/i.test(w)) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }
  }
  return trimmed;
}

/**
 * Parse the Premiere sequence name from a raw speaker field.
 * The sequence is the full raw name of the first speaker entry.
 */
export function parseSequenceInfo(rawSpeakerName) {
  if (!rawSpeakerName) return { sequenceName: '', dateFilmed: null };
  // Try to extract date from the beginning: YYMMDD or YYYYMMDD patterns
  const dateMatch = rawSpeakerName.match(/(\d{6})/);
  let dateFilmed = null;
  if (dateMatch) {
    const d = dateMatch[1];
    // YYMMDD format: 260317 = 2026-03-17
    const year = 2000 + parseInt(d.slice(0, 2));
    const month = parseInt(d.slice(2, 4));
    const day = parseInt(d.slice(4, 6));
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      dateFilmed = new Date(year, month - 1, day);
    }
  }
  return { sequenceName: rawSpeakerName.trim(), dateFilmed };
}

/**
 * Extract the sequence base prefix from a raw sequence name.
 * Finds the first alphabetic word (2+ chars) — the primary speaker — and returns
 * everything up to and including it.
 * e.g. "260317'-04'-104'-JERRY - JOHNNY" → "260317'-04'-104'-JERRY"
 */
export function extractSequenceBase(seqName) {
  if (!seqName) return seqName;
  const match = seqName.match(/[a-zA-Z]{2,}/);
  if (match) {
    return seqName.slice(0, match.index + match[0].length);
  }
  return seqName;
}

/** Check if speaker is generic/unlabeled */
export function isGenericSpeaker(name) {
  if (!name) return true;
  const cleaned = name.trim();
  // "Speaker 1", "Speaker 2", etc.
  if (/^speaker\s*\d+$/i.test(cleaned)) return true;
  // Pure numbers or codes with no alpha word
  const words = cleaned.split(/[\s\-_]+/);
  const hasAlphaWord = words.some(w => /^[a-zA-Z]{2,}$/.test(w.replace(/['']/g, '')) && !/^speaker$/i.test(w));
  return !hasAlphaWord;
}

/** Build a speaker map: raw CSV name → clean display name */
export function buildSpeakerMap(segments) {
  const map = {};
  for (const seg of segments) {
    const raw = seg.speaker || '';
    if (!raw || map[raw] !== undefined) continue;
    map[raw] = cleanSpeakerName(raw);
  }
  return map;
}

/**
 * Extract sequence metadata from the first labeled speaker in segments.
 * Returns { sequenceName, dateFilmed, primarySpeaker }
 */
export function getSequenceMetadata(segments) {
  // First non-generic speaker is the sequence identifier
  const firstLabeled = segments.find(s => s.speaker && !isGenericSpeaker(s.speaker));
  if (!firstLabeled) return { sequenceName: '', dateFilmed: null, primarySpeaker: '' };
  const { sequenceName, dateFilmed } = parseSequenceInfo(firstLabeled.speaker);
  const primarySpeaker = cleanSpeakerName(firstLabeled.speaker);
  return { sequenceName, dateFilmed, primarySpeaker };
}

/**
 * Parse Happy Scribe semicolon-delimited CSV.
 * Expected header: Number;Speaker;Start time;End time;Duration;Text
 */
export function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV file appears empty');

  // Detect delimiter — Happy Scribe uses semicolons
  const header = lines[0];
  const delimiter = header.includes(';') ? ';' : ',';
  const cols = header.split(delimiter).map(c => c.trim().toLowerCase());

  const numIdx = cols.findIndex(c => c === 'number' || c === '#');
  const speakerIdx = cols.findIndex(c => c === 'speaker');
  const startIdx = cols.findIndex(c => c.includes('start'));
  const endIdx = cols.findIndex(c => c.includes('end'));
  const durationIdx = cols.findIndex(c => c.includes('duration'));
  const textIdx = cols.findIndex(c => c === 'text' || c === 'content');

  if (textIdx === -1) throw new Error('Could not find "Text" column in CSV');
  if (startIdx === -1) throw new Error('Could not find "Start time" column in CSV');
  if (endIdx === -1) throw new Error('Could not find "End time" column in CSV');

  const segments = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseLine(line, delimiter);
    const text = (fields[textIdx] || '').trim();
    if (!text) continue;

    segments.push({
      number: numIdx !== -1 ? parseInt(fields[numIdx], 10) || i : i,
      speaker: speakerIdx !== -1 ? (fields[speakerIdx] || '').trim() : '',
      start: fields[startIdx]?.trim() || '',
      end: fields[endIdx]?.trim() || '',
      duration: durationIdx !== -1 ? (fields[durationIdx] || '').trim() : '',
      text,
    });
  }

  if (segments.length === 0) throw new Error('No segments found in CSV');
  return segments;
}

/** Parse a single CSV line, respecting quoted fields */
function parseLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

/** Compute stats from parsed segments */
export function getStats(segments) {
  const speakers = new Set(segments.map(s => s.speaker).filter(Boolean));
  const lastEnd = segments[segments.length - 1]?.end || '';
  return {
    segmentCount: segments.length,
    speakerCount: speakers.size,
    speakers: [...speakers],
    duration: lastEnd,
  };
}
