/**
 * FCP7 XML parser for Hunter.
 * Reads Premiere Pro FCP7 XML exports to extract sequence structure,
 * cut points, and source clip references. Used for selects ingest.
 */

/**
 * Parse an FCP7 XML string and extract all sequences with their clips.
 * Returns an array of sequence objects, each containing clip items with
 * in/out points, source file refs, and track positions.
 */
export function parseFCP7XML(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML: ' + parseError.textContent.slice(0, 200));
  }

  // Only grab TOP-LEVEL sequences — not nested ones inside <clipitem>.
  // Premiere FCP7 XML nests sequences inside clip items as references;
  // those are internal constructs, not user-built sequences.
  //
  // Real sequences live at paths like:
  //   xmeml > sequence
  //   xmeml > project > children > sequence
  //   xmeml > project > children > bin > children > sequence
  //
  // Nested (skip) sequences live at:
  //   ... > clipitem > sequence
  const sequences = [];
  const allSeqElements = doc.querySelectorAll('sequence');

  for (const seqEl of allSeqElements) {
    // Walk up the parent chain — if any ancestor is a <clipitem>, skip
    if (isNestedInClipItem(seqEl)) continue;

    const seq = parseSequence(seqEl);
    if (!seq) continue;

    // Skip empty sequences
    const totalClips = seq.videoTracks.reduce((sum, t) => sum + t.clips.length, 0);
    if (totalClips === 0) continue;

    // Skip auto-generated "Nested Sequence N" names (Premiere creates these)
    if (/^Nested Sequence\s*\d*$/i.test(seq.name)) continue;

    sequences.push(seq);
  }

  return sequences;
}

function parseSequence(seqEl) {
  const name = getText(seqEl, ':scope > name');
  const duration = getNum(seqEl, ':scope > duration');
  const rateEl = seqEl.querySelector(':scope > rate');
  const timebase = rateEl ? getNum(rateEl, 'timebase') : 24;
  const ntsc = rateEl ? getText(rateEl, 'ntsc') === 'TRUE' : false;
  const fps = ntsc ? (timebase === 24 ? 23.976 : timebase === 30 ? 29.97 : timebase) : timebase;

  const videoTracks = [];
  const audioTracks = [];

  // Parse video tracks
  const videoEl = seqEl.querySelector(':scope > media > video');
  if (videoEl) {
    const trackEls = videoEl.querySelectorAll(':scope > track');
    for (let t = 0; t < trackEls.length; t++) {
      const clips = parseTrackClips(trackEls[t], fps);
      videoTracks.push({ index: t + 1, clips });
    }
  }

  // Parse audio tracks
  const audioEl = seqEl.querySelector(':scope > media > audio');
  if (audioEl) {
    const trackEls = audioEl.querySelectorAll(':scope > track');
    for (let t = 0; t < trackEls.length; t++) {
      const clips = parseTrackClips(trackEls[t], fps);
      audioTracks.push({ index: t + 1, clips });
    }
  }

  return {
    name,
    duration,
    fps,
    timebase,
    ntsc,
    videoTracks,
    audioTracks,
  };
}

function parseTrackClips(trackEl, fps) {
  const clips = [];
  const clipEls = trackEl.querySelectorAll(':scope > clipitem');

  for (const clipEl of clipEls) {
    const clip = parseClipItem(clipEl, fps);
    if (clip) clips.push(clip);
  }

  return clips;
}

function parseClipItem(clipEl, fps) {
  const name = getText(clipEl, ':scope > name');
  const start = getNum(clipEl, ':scope > start');  // position on timeline (frames)
  const end = getNum(clipEl, ':scope > end');      // end on timeline (frames)
  const inPoint = getNum(clipEl, ':scope > in');   // source in (frames)
  const outPoint = getNum(clipEl, ':scope > out'); // source out (frames)
  const duration = getNum(clipEl, ':scope > duration');

  // Source file info
  const fileEl = clipEl.querySelector(':scope > file');
  let sourceFile = null;
  if (fileEl) {
    const fileId = fileEl.getAttribute('id');
    const fileName = getText(fileEl, 'name');
    const pathUrl = getText(fileEl, 'pathurl');
    if (fileName || pathUrl) {
      sourceFile = { id: fileId, name: fileName, pathUrl };
    }
  }

  // Markers
  const markers = [];
  const markerEls = clipEl.querySelectorAll(':scope > marker');
  for (const m of markerEls) {
    markers.push({
      name: getText(m, 'name'),
      comment: getText(m, 'comment'),
      inPoint: getNum(m, 'in'),
      outPoint: getNum(m, 'out'),
    });
  }

  // Convert frames to seconds
  const startSeconds = fps > 0 ? start / fps : 0;
  const endSeconds = fps > 0 ? end / fps : 0;
  const inSeconds = fps > 0 ? inPoint / fps : 0;
  const outSeconds = fps > 0 ? outPoint / fps : 0;

  return {
    name,
    start,
    end,
    inPoint,
    outPoint,
    duration,
    startSeconds: Math.round(startSeconds * 100) / 100,
    endSeconds: Math.round(endSeconds * 100) / 100,
    inSeconds: Math.round(inSeconds * 100) / 100,
    outSeconds: Math.round(outSeconds * 100) / 100,
    sourceFile,
    markers,
  };
}

/**
 * Extract corpus units from parsed FCP7 XML.
 * Each clip on the primary video track becomes a corpus unit.
 * Returns flat array of { startSeconds, endSeconds, sourceClipName, trackLabel }.
 */
export function extractCorpusUnits(sequences) {
  const units = [];

  for (const seq of sequences) {
    for (const track of seq.videoTracks) {
      for (const clip of track.clips) {
        // Skip generator clips (titles, black, etc.)
        if (!clip.sourceFile && !clip.name) continue;

        const sourceClipName = clip.sourceFile?.name || clip.name || 'unknown';

        // Use in/out points as the source range (what part of the source clip is used)
        units.push({
          startSeconds: clip.inSeconds,
          endSeconds: clip.outSeconds,
          sourceClipName,
          trackLabel: `V${track.index}`,
          timelineStart: clip.startSeconds,
          timelineEnd: clip.endSeconds,
          sequenceName: seq.name,
        });
      }
    }
  }

  return units;
}

/**
 * Extract unique source clips referenced in the XML.
 * Returns array of { name, pathUrl, appearances } for Dropbox matching.
 */
export function extractSourceClips(sequences) {
  const clipMap = new Map();

  for (const seq of sequences) {
    for (const track of [...seq.videoTracks, ...seq.audioTracks]) {
      for (const clip of track.clips) {
        if (!clip.sourceFile) continue;
        const key = clip.sourceFile.name || clip.sourceFile.pathUrl || clip.name;
        if (!key) continue;

        if (!clipMap.has(key)) {
          clipMap.set(key, {
            name: clip.sourceFile.name || clip.name,
            pathUrl: clip.sourceFile.pathUrl,
            appearances: 0,
          });
        }
        clipMap.get(key).appearances++;
      }
    }
  }

  return Array.from(clipMap.values());
}

// ── Helpers ──

function isNestedInClipItem(el) {
  let node = el.parentElement;
  while (node) {
    if (node.tagName === 'clipitem' || node.nodeName === 'clipitem') return true;
    node = node.parentElement;
  }
  return false;
}

function getText(el, selector) {
  const child = el.querySelector(selector);
  return child ? child.textContent.trim() : '';
}

function getNum(el, selector) {
  const text = getText(el, selector);
  const n = parseFloat(text);
  return isNaN(n) ? 0 : n;
}
