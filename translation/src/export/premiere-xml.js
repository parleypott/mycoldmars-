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
 * Convert HH:MM:SS.mmm timecode to frame count.
 */
function timecodeToFrames(tc, fps = 24) {
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
  return Math.round(totalSeconds * fps);
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

/**
 * Build an FCP XML that creates a new sequence referencing the "sacred sequence"
 * as a nested clip. Each segment becomes a cut in the timeline using the
 * transcript timecodes as in/out points within the sacred sequence.
 *
 * @param {Object} opts
 * @param {string} opts.sacredSequenceName — name of the master sequence in Premiere
 * @param {string} opts.outputName — name for the new sequence
 * @param {Array}  opts.segments — transcript segments with start/end timecodes
 * @param {Array}  opts.translations — translation data (for text overlays / markers)
 * @param {Object} opts.interestVotes — optional: { segNum: 'interested' | 'not-interested' }
 * @param {Set}    opts.dismissedSegments — optional: segment numbers dismissed in editor
 * @param {number} opts.fps — frame rate (default 23.976)
 */
export function buildPremiereSequenceXML(opts) {
  const {
    sacredSequenceName,
    outputName,
    segments,
    translations,
    interestVotes,
    dismissedSegments,
    fps = 23.976,
  } = opts;

  const timebase = Math.round(fps);
  const isNtsc = (fps === 23.976 || fps === 29.97 || fps === 59.94);

  // Determine which segments to include
  let includedSegments = segments.filter(seg => {
    if (dismissedSegments && dismissedSegments.has(seg.number)) return false;
    if (interestVotes) {
      const vote = interestVotes[seg.number];
      if (vote === 'not-interested') return false;
    }
    return true;
  });

  // If no filtering applied, include all
  if (includedSegments.length === 0) includedSegments = segments;

  // Find the total duration of the sacred sequence (last segment end)
  const lastSeg = segments[segments.length - 1];
  const sacredDurationFrames = lastSeg ? timecodeToFrames(lastSeg.end, fps) : 0;

  // Build clip items — each segment is a portion of the sacred sequence
  let timelinePos = 0;
  const clipItems = [];

  for (const seg of includedSegments) {
    const inFrames = timecodeToFrames(seg.start, fps);
    const outFrames = timecodeToFrames(seg.end, fps);
    const duration = outFrames - inFrames;
    if (duration <= 0) continue;

    // Find matching translation for marker comment
    const trans = translations ? translations.find(t => t.number === seg.number) : null;
    const comment = trans ? (trans.translated || seg.text) : seg.text;
    const speaker = seg.speaker || '';

    clipItems.push({
      inFrame: inFrames,
      outFrame: outFrames,
      startFrame: timelinePos,
      endFrame: timelinePos + duration,
      duration,
      speaker,
      comment,
      segNumber: seg.number,
    });

    timelinePos += duration;
  }

  const totalDuration = timelinePos;

  // Generate a unique ID for the sacred sequence reference
  const sacredId = 'sacred-seq-1';
  const masterClipId = 'masterclip-sacred';

  // Build the file element with full media description (first occurrence only)
  const fileElementFull = `<file id="${sacredId}">
              <name>${escapeXml(sacredSequenceName)}</name>
              <duration>${sacredDurationFrames}</duration>
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

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence>
    <name>${escapeXml(outputName || 'Translated Selects')}</name>
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
${clipItems.map((clip, i) => `          <clipitem id="clip-${i + 1}">
            <masterclipid>${masterClipId}</masterclipid>
            <name>${escapeXml(sacredSequenceName)} — Seg ${clip.segNumber}</name>
            <duration>${sacredDurationFrames}</duration>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
            </rate>
            <start>${clip.startFrame}</start>
            <end>${clip.endFrame}</end>
            <in>${clip.inFrame}</in>
            <out>${clip.outFrame}</out>
            ${i === 0 ? fileElementFull : `<file id="${sacredId}"/>`}
            <link>
              <linkclipref>clip-${i + 1}</linkclipref>
              <mediatype>video</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${i + 1}</clipindex>
            </link>
            <link>
              <linkclipref>clip-audio-${i + 1}</linkclipref>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${i + 1}</clipindex>
            </link>
            <marker>
              <name>${escapeXml(clip.speaker)}</name>
              <comment>${escapeXml(clip.comment.slice(0, 200))}</comment>
              <in>0</in>
              <out>${clip.duration}</out>
            </marker>
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
${clipItems.map((clip, i) => `          <clipitem id="clip-audio-${i + 1}">
            <masterclipid>${masterClipId}</masterclipid>
            <name>${escapeXml(sacredSequenceName)} — Seg ${clip.segNumber}</name>
            <duration>${sacredDurationFrames}</duration>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
            </rate>
            <start>${clip.startFrame}</start>
            <end>${clip.endFrame}</end>
            <in>${clip.inFrame}</in>
            <out>${clip.outFrame}</out>
            <file id="${sacredId}"/>
            <sourcetrack>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
            </sourcetrack>
            <link>
              <linkclipref>clip-${i + 1}</linkclipref>
              <mediatype>video</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${i + 1}</clipindex>
            </link>
            <link>
              <linkclipref>clip-audio-${i + 1}</linkclipref>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${i + 1}</clipindex>
            </link>
          </clipitem>`).join('\n')}
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>`;

  return xml;
}

/**
 * Build an FCP XML from Sacred Sequencer soundbites.
 * Each soundbite becomes a NESTED SEQUENCE clip — a subclip of the sacred sequence.
 * When imported into the Premiere project containing the sacred sequence,
 * each clip is a nest referencing that sequence with in/out points.
 * Changes to the sacred sequence (captions, SRT, etc.) propagate into these nests.
 */
export function buildSacredSequencerXML({ soundbites, sacredSequenceName, outputName, fps = 23.976, gapFrames = 12, sourceSequenceXML = null }) {
  const timebase = Math.round(fps);
  const isNtsc = (fps === 23.976 || fps === 29.97 || fps === 59.94);

  // Find total sacred sequence duration (max of all clip out frames)
  let maxOutFrame = 0;
  const clips = [];

  for (const bite of soundbites) {
    const inFrames = timecodeToFrames(bite.start, fps);
    const outFrames = timecodeToFrames(bite.end, fps);
    if (outFrames > maxOutFrame) maxOutFrame = outFrames;
    clips.push({ inFrames, outFrames, text: bite.text, prefix: bite.prefix });
  }

  const sacredDurationFrames = maxOutFrame;
  const sacredSeqId = 'sacred-sequence-ref';

  // Place clips on timeline with gaps
  let timelinePos = 0;
  const clipItems = [];

  for (const clip of clips) {
    const duration = clip.outFrames - clip.inFrames;
    if (duration <= 0) continue;

    clipItems.push({
      inFrame: clip.inFrames,
      outFrame: clip.outFrames,
      startFrame: timelinePos,
      endFrame: timelinePos + duration,
      duration,
      text: clip.text,
      prefix: clip.prefix,
    });

    timelinePos += duration + gapFrames;
  }

  const totalDuration = timelinePos > 0 ? timelinePos - gapFrames : 0;
  const seqName = outputName || sacredSequenceName + '_Sacred Selects';

  // Build the nested sequence element for each clipitem.
  // When sourceSequenceXML is provided (from Premiere FCP XML export),
  // we inject the real sequence with all file/pathurl refs so Premiere resolves media.
  // Otherwise, fall back to the hollow nested sequence (offline, manual relink).
  let nestedSeqFull;

  if (sourceSequenceXML) {
    // Inject the full Premiere sequence XML with our reference id.
    // Strip any existing id attribute first to avoid duplicates, then add ours.
    nestedSeqFull = sourceSequenceXML
      .replace(/^<sequence(\s)/, '<sequence$1')
      .replace(/^<sequence(\s[^>]*)?\bid="[^"]*"/, '<sequence$1')
      .replace(/^<sequence(\s|>)/, `<sequence id="${sacredSeqId}"$1`);
  } else {
    nestedSeqFull = `<sequence id="${sacredSeqId}">
              <name>${escapeXml(sacredSequenceName)}</name>
              <duration>${sacredDurationFrames}</duration>
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
                  <track/>
                </video>
                <audio>
                  <format>
                    <samplecharacteristics>
                      <depth>16</depth>
                      <samplerate>48000</samplerate>
                    </samplecharacteristics>
                  </format>
                  <track/>
                </audio>
              </media>
            </sequence>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence>
    <name>${escapeXml(seqName)}</name>
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
${clipItems.map((clip, i) => `          <clipitem id="nest-${i + 1}">
            <name>${escapeXml(clip.prefix)}</name>
            <duration>${sacredDurationFrames}</duration>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
            </rate>
            <start>${clip.startFrame}</start>
            <end>${clip.endFrame}</end>
            <in>${clip.inFrame}</in>
            <out>${clip.outFrame}</out>
            ${i === 0 ? nestedSeqFull : `<sequence id="${sacredSeqId}"/>`}
            <link>
              <linkclipref>nest-${i + 1}</linkclipref>
              <mediatype>video</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${i + 1}</clipindex>
            </link>
            <link>
              <linkclipref>nest-audio-${i + 1}</linkclipref>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${i + 1}</clipindex>
            </link>
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
${clipItems.map((clip, i) => `          <clipitem id="nest-audio-${i + 1}">
            <name>${escapeXml(clip.prefix)}</name>
            <duration>${sacredDurationFrames}</duration>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
            </rate>
            <start>${clip.startFrame}</start>
            <end>${clip.endFrame}</end>
            <in>${clip.inFrame}</in>
            <out>${clip.outFrame}</out>
            <sequence id="${sacredSeqId}"/>
            <sourcetrack>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
            </sourcetrack>
            <link>
              <linkclipref>nest-${i + 1}</linkclipref>
              <mediatype>video</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${i + 1}</clipindex>
            </link>
            <link>
              <linkclipref>nest-audio-${i + 1}</linkclipref>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${i + 1}</clipindex>
            </link>
          </clipitem>`).join('\n')}
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>`;

  return xml;
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
