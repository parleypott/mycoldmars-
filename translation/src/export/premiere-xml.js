/**
 * Generate Premiere Pro marker XML from highlights.
 * Each highlight becomes a marker at its timecode position, tagged with the tag name.
 */
export function buildPremiereXML(highlights, segments, transcriptName) {
  const markers = [];

  for (const h of highlights) {
    if (!h.segmentNumbers || h.segmentNumbers.length === 0) continue;

    // Find the first segment to get the timecode
    const segNum = h.segmentNumbers[0];
    const seg = segments.find(s => s.number === segNum);
    if (!seg) continue;

    const startFrames = timecodeToFrames(seg.start);
    const endSeg = segments.find(s => s.number === h.segmentNumbers[h.segmentNumbers.length - 1]);
    const endFrames = endSeg ? timecodeToFrames(endSeg.end) : startFrames + 30;

    markers.push({
      name: h.tagName || 'Highlight',
      comment: h.textPreview || '',
      start: startFrames,
      end: endFrames,
      color: tagColorToPremiereColor(h.color),
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence>
    <name>${escapeXml(transcriptName || 'Transcript')}</name>
    <rate>
      <timebase>24</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <media>
      <video>
        <track>
          ${markers.map(m => `<clipitem>
            <name>${escapeXml(m.name)}</name>
            <start>${m.start}</start>
            <end>${m.end}</end>
            <marker>
              <name>${escapeXml(m.name)}</name>
              <comment>${escapeXml(m.comment)}</comment>
              <in>${m.start}</in>
              <out>${m.end}</out>
              <color>${m.color}</color>
            </marker>
          </clipitem>`).join('\n          ')}
        </track>
      </video>
    </media>
  </sequence>
</xmeml>`;

  return xml;
}

/**
 * Convert HH:MM:SS.mmm timecode to frame count (assuming 24fps).
 */
function timecodeToFrames(tc) {
  if (!tc) return 0;

  let hours = 0, minutes = 0, seconds = 0, ms = 0;

  const parts = tc.replace(',', '.').split(':');
  if (parts.length === 3) {
    hours = parseInt(parts[0]) || 0;
    minutes = parseInt(parts[1]) || 0;
    const secParts = parts[2].split('.');
    seconds = parseInt(secParts[0]) || 0;
    ms = parseInt((secParts[1] || '0').padEnd(3, '0').slice(0, 3)) || 0;
  } else if (parts.length === 2) {
    minutes = parseInt(parts[0]) || 0;
    const secParts = parts[1].split('.');
    seconds = parseInt(secParts[0]) || 0;
    ms = parseInt((secParts[1] || '0').padEnd(3, '0').slice(0, 3)) || 0;
  }

  const totalSeconds = hours * 3600 + minutes * 60 + seconds + ms / 1000;
  return Math.round(totalSeconds * 24); // 24fps
}

function tagColorToPremiereColor(hex) {
  // Map to Premiere's limited color palette
  const colorMap = {
    '#DD2C1E': 'Red',
    '#004CFF': 'Blue',
    '#0D5921': 'Green',
    '#FFBF00': 'Yellow',
    '#520004': 'Fuchsia',
    '#6B5CE7': 'Lavender',
    '#E85D04': 'Orange',
    '#412C27': 'Tan',
  };
  return colorMap[hex] || 'Cyan';
}

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
