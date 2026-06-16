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
  // Anchor the date match at the START so we don't accidentally pick
  // up a 6-digit run inside a phone number / id later in the string.
  const dateMatch = rawSpeakerName.match(/^\s*(\d{6})/);
  let dateFilmed = null;
  if (dateMatch) {
    const d = dateMatch[1];
    // YYMMDD format: 260317 = 2026-03-17
    const year = 2000 + parseInt(d.slice(0, 2));
    const month = parseInt(d.slice(2, 4));
    const day = parseInt(d.slice(4, 6));
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      // Construct in UTC. The Date constructor's local-time form gave
      // a date object that flipped a day across timezones — Johnny in
      // ET vs. a viewer in PT would see "Mar 16" vs "Mar 17" for the
      // same shoot day. Date.UTC keeps the "shoot day" semantic stable.
      dateFilmed = new Date(Date.UTC(year, month - 1, day));
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
  // Strip UTF-8 BOM (Excel-Windows and some Happy Scribe exports prepend
  // ﻿, which would otherwise land in the first header cell as
  // "﻿Number" and break the column-index lookup).
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // Normalize Windows CRLF to LF before splitting — otherwise every
  // line keeps a trailing \r that contaminates field values and breaks
  // strict-equality lookups elsewhere.
  text = text.replace(/\r\n?/g, '\n');
  // Quote-aware row split. A naive `split('\n')` shears any quoted field
  // that contains a line break (a multi-line transcript cell) — the second
  // physical line drops out as an orphan row and the cell's text is silently
  // truncated. splitRows only breaks on newlines OUTSIDE quotes, so a
  // multi-line cell survives as a single row.
  const lines = splitRows(text.trim());
  if (lines.length < 2) throw new Error('CSV file appears empty');

  // Detect delimiter — Happy Scribe uses semicolons; tab covers TSV
  // exports from Trint / Otter that some users paste in by mistake.
  const header = lines[0];
  const delimiter = header.includes('\t') ? '\t' : header.includes(';') ? ';' : ',';
  // Use the quote-aware parser for the header too. A naive split leaves the
  // surrounding quotes in each column name (`"Text"` stays as the literal
  // string `"text"` after lowercase), which makes strict-equality lookups
  // miss real columns. parseLine strips them properly.
  const cols = parseLine(header, delimiter).map(c => c.trim().toLowerCase());

  const numIdx = cols.findIndex(c => c === 'number' || c === '#');
  const speakerIdx = cols.findIndex(c => c === 'speaker' || c === 'speaker name' || c === 'name');
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

/**
 * Split raw CSV text into rows, respecting quoted fields that span newlines.
 * Only an unquoted newline ends a row; a `\n` inside a "..." field is kept as
 * part of that field's value. Doubled quotes ("") inside a quoted field are an
 * escaped literal quote and must NOT flip quote state.
 */
function splitRows(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        // Escaped quote — consume both, stay inside the field.
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if (ch === '\n' && !inQuotes) {
      rows.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
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
