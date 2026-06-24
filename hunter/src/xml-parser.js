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

  // FCP7/Premiere defines each <file> once with full <name>/<pathurl>, then
  // references it on later clips by a BARE <file id="..."/> (no children).
  // Selects sequences pull many cuts from one source file, so most clips after
  // the first per-file are bare references. Build a document-wide id→def map so
  // those repeats resolve to their real source instead of dropping to null.
  const fileDefs = buildFileDefs(doc);

  const sequences = [];
  const allSeqElements = doc.querySelectorAll('sequence');

  for (const seqEl of allSeqElements) {
    // Walk up the parent chain — if any ancestor is a <clipitem>, skip
    if (isNestedInClipItem(seqEl)) continue;

    const seq = parseSequence(seqEl, fileDefs);
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

/**
 * Derive the true frame rate from an FCP7 <rate> (integer timebase + ntsc flag).
 * FCP7 XML never stores fractional rates directly: 59.94fps footage is written
 * as <timebase>60</timebase><ntsc>TRUE</ntsc>, 29.97 as 30+TRUE, 23.976 as 24+TRUE.
 * Maps each NTSC timebase back to the canonical fractional rate the Hunter's
 * xml-writer (isNtscRate) emits — the two MUST agree so a write→read round-trip
 * of an NTSC sequence preserves its rate. Without the 60→59.94 case a 59.94
 * import was read as a flat 60fps, inflating every frame→seconds conversion ~0.1%.
 */
export function deriveFps(timebase, ntsc) {
  if (!ntsc) return timebase;
  switch (timebase) {
    case 24: return 23.976;
    case 30: return 29.97;
    case 60: return 59.94;
    default: return timebase;
  }
}

function parseSequence(seqEl, fileDefs) {
  const name = getText(seqEl, ':scope > name');
  const duration = getNum(seqEl, ':scope > duration');
  const rateEl = seqEl.querySelector(':scope > rate');
  const timebase = rateEl ? getNum(rateEl, 'timebase') : 24;
  const ntsc = rateEl ? getText(rateEl, 'ntsc') === 'TRUE' : false;
  const fps = deriveFps(timebase, ntsc);

  const videoTracks = [];
  const audioTracks = [];

  // Parse video tracks
  const videoEl = seqEl.querySelector(':scope > media > video');
  if (videoEl) {
    const trackEls = videoEl.querySelectorAll(':scope > track');
    for (let t = 0; t < trackEls.length; t++) {
      const clips = parseTrackClips(trackEls[t], fps, fileDefs);
      videoTracks.push({ index: t + 1, clips });
    }
  }

  // Parse audio tracks
  const audioEl = seqEl.querySelector(':scope > media > audio');
  if (audioEl) {
    const trackEls = audioEl.querySelectorAll(':scope > track');
    for (let t = 0; t < trackEls.length; t++) {
      const clips = parseTrackClips(trackEls[t], fps, fileDefs);
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

function parseTrackClips(trackEl, fps, fileDefs) {
  const clips = [];
  const clipEls = trackEl.querySelectorAll(':scope > clipitem');

  for (const clipEl of clipEls) {
    const clip = parseClipItem(clipEl, fps, fileDefs);
    if (clip) clips.push(clip);
  }

  return clips;
}

// FCP7's interchange format uses -1 for an UNSET source in/out point ("clip not
// trimmed — use the full media"). FCP7-native and DaVinci Resolve FCP7-XML
// exports emit it. Left raw, -1/fps yields a NEGATIVE source timecode that
// poisons the corpus (extractCorpusUnits keys each unit's range on in/outSeconds).
// Normalize: a -1 in → 0; a -1 out → in + duration (run `duration` frames from
// in), or in when duration is unknown. Byte-identical for valid (>=0) in/out.
// Mirror of normalizeSourceFrames in worker/selects-parse-core.js.
export function normalizeSourceFrames(inPoint, outPoint, duration) {
  const inN = inPoint < 0 ? 0 : inPoint;
  let outN = outPoint;
  if (outN < 0) outN = duration > 0 ? inN + duration : inN;
  return { inPoint: inN, outPoint: outN };
}

function parseClipItem(clipEl, fps, fileDefs) {
  const name = getText(clipEl, ':scope > name');
  const start = getNum(clipEl, ':scope > start');  // position on timeline (frames)
  const end = getNum(clipEl, ':scope > end');      // end on timeline (frames)
  const duration = getNum(clipEl, ':scope > duration');
  let inPoint = getNum(clipEl, ':scope > in');     // source in (frames)
  let outPoint = getNum(clipEl, ':scope > out');   // source out (frames)
  ({ inPoint, outPoint } = normalizeSourceFrames(inPoint, outPoint, duration));

  // Source file info
  const fileEl = clipEl.querySelector(':scope > file');
  let sourceFile = null;
  if (fileEl) {
    const fileId = fileEl.getAttribute('id');
    let fileName = getText(fileEl, 'name');
    let pathUrl = getText(fileEl, 'pathurl');
    // Bare reference (<file id="..."/> with no children) — resolve from the
    // document's full file definitions so repeat cuts keep their real source.
    if (!fileName && !pathUrl && fileId && fileDefs && fileDefs.has(fileId)) {
      const def = fileDefs.get(fileId);
      fileName = def.name;
      pathUrl = def.pathUrl;
    }
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

/**
 * Scan the whole document for FULL <file> definitions (those carrying a
 * <name> or <pathurl>) and map fileId → { name, pathUrl }. Premiere defines
 * each file once and then references it by bare id; this lets parseClipItem
 * resolve those bare references. First full definition per id wins.
 */
function buildFileDefs(doc) {
  const defs = new Map();
  const fileEls = doc.querySelectorAll('file');
  for (const fileEl of fileEls) {
    const id = fileEl.getAttribute('id');
    if (!id || defs.has(id)) continue;
    const name = getText(fileEl, 'name');
    const pathUrl = getText(fileEl, 'pathurl');
    if (name || pathUrl) {
      defs.set(id, { name, pathUrl });
    }
  }
  return defs;
}

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
