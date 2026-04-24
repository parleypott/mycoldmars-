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
