/**
 * FCP7 XML writer for Hunter.
 * Generates Premiere-importable XML sequences from AI-suggested clip collections.
 * Uses the same format as the Interpreter's premiere-xml.js but tailored for
 * Hunter's corpus-unit-based workflow.
 */

/**
 * Build an FCP7 XML sequence from a collection of corpus units.
 * Each unit becomes a clip on V1, referencing its source file.
 *
 * @param {Object} opts
 * @param {string} opts.sequenceName — name for the exported sequence
 * @param {Array}  opts.units — corpus units with { sourceClipName, startSeconds, endSeconds }
 * @param {number} opts.fps — frame rate (default 23.976)
 * @param {number} opts.gapFrames — frames of gap between clips (default 0)
 * @param {string} opts.label — optional label/tag for markers on each clip
 */
export function buildHunterSequenceXML(opts) {
  const {
    sequenceName = 'Hunter Export',
    units = [],
    fps = 23.976,
    gapFrames = 0,
    label = '',
  } = opts;

  const timebase = Math.round(fps);
  const isNtsc = (fps === 23.976 || fps === 29.97 || fps === 59.94);

  // Group units by source file
  const fileMap = new Map();
  for (const unit of units) {
    const key = unit.sourceClipName || 'unknown';
    if (!fileMap.has(key)) {
      fileMap.set(key, `file-${fileMap.size + 1}`);
    }
  }

  // Place each unit on the timeline
  let timelinePos = 0;
  const clipItems = [];

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const inFrames = secondsToFrames(unit.startSeconds, fps);
    const outFrames = secondsToFrames(unit.endSeconds, fps);
    const duration = outFrames - inFrames;
    if (duration <= 0) continue;

    const fileId = fileMap.get(unit.sourceClipName || 'unknown');
    const sourceDurationFrames = outFrames + secondsToFrames(60, fps); // estimate source duration

    clipItems.push({
      index: i + 1,
      name: unit.sourceClipName || `Unit ${i + 1}`,
      inFrame: inFrames,
      outFrame: outFrames,
      startFrame: timelinePos,
      endFrame: timelinePos + duration,
      duration,
      fileId,
      fileName: unit.sourceClipName || 'unknown',
      sourceDuration: sourceDurationFrames,
      analysis: unit.analysisText || '',
      label,
    });

    timelinePos += duration + gapFrames;
  }

  const totalDuration = timelinePos > 0 ? timelinePos - gapFrames : 0;

  // Build file elements (full on first use, reference on subsequent)
  const seenFiles = new Set();

  function fileElement(clip) {
    if (seenFiles.has(clip.fileId)) {
      return `<file id="${clip.fileId}"/>`;
    }
    seenFiles.add(clip.fileId);
    return `<file id="${clip.fileId}">
              <name>${escapeXml(clip.fileName)}</name>
              <duration>${clip.sourceDuration}</duration>
              <rate>
                <timebase>${timebase}</timebase>
                <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
              </rate>
              <media>
                <video>
                  <samplecharacteristics>
                    <width>1920</width>
                    <height>1080</height>
                  </samplecharacteristics>
                </video>
                <audio>
                  <samplecharacteristics>
                    <depth>16</depth>
                    <samplerate>48000</samplerate>
                  </samplecharacteristics>
                  <channelcount>2</channelcount>
                </audio>
              </media>
            </file>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence>
    <name>${escapeXml(sequenceName)}</name>
    <duration>${totalDuration}</duration>
    <rate>
      <timebase>${timebase}</timebase>
      <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
    </rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>1920</width>
            <height>1080</height>
          </samplecharacteristics>
        </format>
        <track>
${clipItems.map(clip => `          <clipitem id="clip-${clip.index}">
            <name>${escapeXml(clip.name)}</name>
            <duration>${clip.sourceDuration}</duration>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
            </rate>
            <start>${clip.startFrame}</start>
            <end>${clip.endFrame}</end>
            <in>${clip.inFrame}</in>
            <out>${clip.outFrame}</out>
            ${fileElement(clip)}
            <link>
              <linkclipref>clip-${clip.index}</linkclipref>
              <mediatype>video</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${clip.index}</clipindex>
            </link>
            <link>
              <linkclipref>clip-audio-${clip.index}</linkclipref>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${clip.index}</clipindex>
            </link>${clip.analysis || clip.label ? `
            <marker>
              <name>${escapeXml(clip.label || 'Hunter')}</name>
              <comment>${escapeXml(clip.analysis.slice(0, 300))}</comment>
              <in>0</in>
              <out>${clip.duration}</out>
            </marker>` : ''}
          </clipitem>`).join('\n')}
        </track>
      </video>
      <audio>
        <numOutputChannels>2</numOutputChannels>
        <format>
          <samplecharacteristics>
            <depth>16</depth>
            <samplerate>48000</samplerate>
          </samplecharacteristics>
        </format>
        <track>
${clipItems.map(clip => `          <clipitem id="clip-audio-${clip.index}">
            <name>${escapeXml(clip.name)}</name>
            <duration>${clip.sourceDuration}</duration>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
            </rate>
            <start>${clip.startFrame}</start>
            <end>${clip.endFrame}</end>
            <in>${clip.inFrame}</in>
            <out>${clip.outFrame}</out>
            <file id="${clip.fileId}"/>
            <sourcetrack>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
            </sourcetrack>
          </clipitem>`).join('\n')}
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>`;

  return xml;
}

/**
 * Trigger a browser download of XML content.
 */
export function downloadXML(xml, filename) {
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'hunter-export.xml';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function secondsToFrames(seconds, fps) {
  return Math.round(seconds * fps);
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
