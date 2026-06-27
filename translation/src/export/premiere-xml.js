/**
 * Generate Premiere Pro marker XML from highlights.
 * Each highlight becomes a marker at its timecode position, tagged with the tag name.
 *
 * @param {Array}  highlights — [{ segmentNumbers, tagName, textPreview, color }]
 * @param {Array}  segments   — transcript segments
 * @param {string} transcriptName
 * @param {Object} [opts]
 * @param {number} [opts.fps=23.976] — frame rate. 23.976 (Newpress default),
 *                                     24, 25, 29.97, 30, 59.94, 60 supported.
 */
export function buildPremiereXML(highlights, segments, transcriptName, opts = {}) {
  const fps = opts.fps || 23.976;
  // Premiere/FCP XML rate: integer timebase + ntsc=TRUE for the NTSC-fractional
  // rates (23.976, 29.97, 59.94), integer timebase + ntsc=FALSE otherwise.
  // Shared helpers so all three builders agree (see isNtscRate's note on why
  // tolerance, not strict equality, is load-bearing).
  const timebase = ntscIntegerTimebase(fps);
  const isNtsc = isNtscRate(fps);

  const markers = [];

  for (const h of highlights) {
    if (!h.segmentNumbers || h.segmentNumbers.length === 0) continue;

    // Find the first segment to get the timecode
    const segNum = h.segmentNumbers[0];
    const seg = segments.find(s => s.number === segNum);
    if (!seg) continue;

    const startFrames = timecodeToFrames(seg.start, fps);
    const endSeg = segments.find(s => s.number === h.segmentNumbers[h.segmentNumbers.length - 1]);
    const endFrames = endSeg ? timecodeToFrames(endSeg.end, fps) : startFrames + Math.round(fps);

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
      <timebase>${timebase}</timebase>
      <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
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
 *
 * For NTSC-fractional rates (23.976, 29.97, 59.94) we round-trip through
 * the INTEGER timebase that's actually written into the XML so the frame
 * count stays inside the grid Premiere uses to render markers. The old
 * implementation multiplied by `fps` (23.976) but the XML's `<timebase>`
 * was 24 — drift was ~0.1%/hour, ~3.6s over a 1-hour transcript, visible
 * in real edits.
 *
 * The mapping is the standard FCP-XML convention: write integer timebase
 * (24/30/60) + `<ntsc>TRUE</ntsc>` so Premiere interprets frame counts
 * as 24000/1001 (= 23.976). The frame indices we generate ARE integer
 * timebase frames; Premiere does the pulldown at import time.
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
  // Convert seconds to integer-timebase frames. The audit flagged a
  // strict float-equality `fps === 23.976` check elsewhere — we use a
  // tolerance window so values arriving as 23.97599... still match.
  const timebase = ntscIntegerTimebase(fps);
  return Math.round(totalSeconds * timebase);
}

// For NTSC fractional rates return the integer timebase used in the XML.
// Otherwise the rate IS the timebase (24, 25, 30, 50, 60).
function ntscIntegerTimebase(fps) {
  if (Math.abs(fps - 23.976) < 0.01) return 24;
  if (Math.abs(fps - 29.97)  < 0.01) return 30;
  if (Math.abs(fps - 59.94)  < 0.01) return 60;
  return Math.round(fps);
}

// True for the NTSC-fractional rates (23.976, 29.97, 59.94). Tolerance-based,
// NOT strict equality — ffprobe reports these as 24000/1001 = 23.97602...,
// 30000/1001, 60000/1001, which a `fps === 23.976` check silently misses,
// mislabeling the sequence as a whole-number rate and reintroducing the
// ~0.1%/hour drift the integer-timebase + ntsc convention exists to prevent.
function isNtscRate(fps) {
  return (Math.abs(fps - 23.976) < 0.01) ||
         (Math.abs(fps - 29.97)  < 0.01) ||
         (Math.abs(fps - 59.94)  < 0.01);
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

  const timebase = ntscIntegerTimebase(fps);
  const isNtsc = isNtscRate(fps);

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
              <comment>${escapeXml(truncateForMarker(clip.comment))}</comment>
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
  const timebase = ntscIntegerTimebase(fps);
  const isNtsc = isNtscRate(fps);

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
  return String(str)
    // Drop XML-1.0-FORBIDDEN control chars FIRST. Per XML 1.0 §2.2 the only
    // control chars a document may contain are tab (0x09), LF (0x0A) and CR
    // (0x0D); 0x00-0x08, 0x0B, 0x0C and 0x0E-0x1F are illegal even as numeric
    // references, so passing one through raw makes Premiere/FCP REJECT THE
    // WHOLE XML at import (cryptic parse error, nothing lands). These slip in
    // when a transcript / marker comment / clip name is pasted from a PDF or
    // web page (vertical-tab 0x0B, form-feed 0x0C). Strip them so one bad glyph
    // can't kill the entire export. Well-formed text is byte-identical.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Premiere marker comments cap around 256 chars in older versions; trim to
// 200 to be safe but make the truncation visible with an ellipsis so the
// user can see something was dropped instead of silently losing context.
function truncateForMarker(text) {
  const s = String(text || '');
  if (s.length <= 200) return s;
  return s.slice(0, 197).trimEnd() + '…';
}
