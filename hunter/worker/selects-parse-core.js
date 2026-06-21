// FCP7/Premiere XML parse core for the selects-ingest worker.
//
// Extracted verbatim from ingest-selects.mjs (the established worker-lock
// pattern) so the pure parse cluster is headless-testable with @xmldom — the
// same DOM implementation the worker uses at runtime. childNodes/getAttribute
// based (no querySelector), so it runs identically under @xmldom and Node.
//
// The fileDefs resolution (buildFileDefs + the bare-<file id> resolve in
// parseClipItem) is the real correctness fix: selects sequences pull many cuts
// from one source file, and Premiere writes the full <file> only on the first
// reference, then bare <file id="..."/> for every repeat. Without resolution
// those repeats dropped to sourceFile=null, undercounting source-clip
// appearances and (when a timeline clip is renamed) mis-keying the selects→raw
// cross-reference via the clip.name fallback.

import { DOMParser } from '@xmldom/xmldom';

export function getText(el, tagName) {
  if (!el) return '';
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    if (children[i].nodeName === tagName) {
      return children[i].textContent?.trim() || '';
    }
  }
  return '';
}

export function getNum(el, tagName) {
  const n = parseFloat(getText(el, tagName));
  return isNaN(n) ? 0 : n;
}

export function getDirectChildren(el, tagName) {
  const results = [];
  if (!el) return results;
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    if (children[i].nodeName === tagName) results.push(children[i]);
  }
  return results;
}

export function isNestedInClipItem(el) {
  let node = el.parentNode;
  while (node) {
    if (node.nodeName === 'clipitem') return true;
    node = node.parentNode;
  }
  return false;
}

export function parseClipItem(clipEl, fps, fileDefs) {
  const name = getText(clipEl, 'name');
  const start = getNum(clipEl, 'start');
  const end = getNum(clipEl, 'end');
  const inPoint = getNum(clipEl, 'in');
  const outPoint = getNum(clipEl, 'out');
  const duration = getNum(clipEl, 'duration');

  // Source file
  const fileEls = getDirectChildren(clipEl, 'file');
  let sourceFile = null;
  if (fileEls.length > 0) {
    const fileEl = fileEls[0];
    const fileId = fileEl.getAttribute('id');
    let fileName = getText(fileEl, 'name');
    let pathUrl = getText(fileEl, 'pathurl');
    // Bare reference (<file id="..."/>) — resolve from the document's full file
    // definitions so repeat cuts keep their real source (selects pull many cuts
    // from one file, written as bare refs after the first full definition).
    if (!fileName && !pathUrl && fileId && fileDefs && fileDefs.has(fileId)) {
      const def = fileDefs.get(fileId);
      fileName = def.name;
      pathUrl = def.pathUrl;
    }
    if (fileName || pathUrl) {
      sourceFile = { id: fileId, name: fileName, pathUrl };
    }
  }

  const startSeconds = fps > 0 ? start / fps : 0;
  const endSeconds = fps > 0 ? end / fps : 0;
  const inSeconds = fps > 0 ? inPoint / fps : 0;
  const outSeconds = fps > 0 ? outPoint / fps : 0;

  return {
    name,
    start, end, inPoint, outPoint, duration,
    startSeconds: Math.round(startSeconds * 100) / 100,
    endSeconds: Math.round(endSeconds * 100) / 100,
    inSeconds: Math.round(inSeconds * 100) / 100,
    outSeconds: Math.round(outSeconds * 100) / 100,
    sourceFile,
  };
}

export function parseSequence(seqEl, fileDefs) {
  const name = getText(seqEl, 'name');
  const duration = getNum(seqEl, 'duration');
  const rateEl = getDirectChildren(seqEl, 'rate')[0];
  const timebase = rateEl ? getNum(rateEl, 'timebase') : 24;
  const ntsc = rateEl ? getText(rateEl, 'ntsc') === 'TRUE' : false;
  const fps = ntsc ? (timebase === 24 ? 23.976 : timebase === 30 ? 29.97 : timebase) : timebase;

  const videoTracks = [];
  const mediaEl = getDirectChildren(seqEl, 'media')[0];
  const videoEl = mediaEl ? getDirectChildren(mediaEl, 'video')[0] : null;

  if (videoEl) {
    const trackEls = getDirectChildren(videoEl, 'track');
    for (let t = 0; t < trackEls.length; t++) {
      const clipEls = getDirectChildren(trackEls[t], 'clipitem');
      const clips = clipEls.map(c => parseClipItem(c, fps, fileDefs)).filter(Boolean);
      videoTracks.push({ index: t + 1, clips });
    }
  }

  return { name, duration, fps, timebase, ntsc, videoTracks };
}

// Scan the whole document for full <file> definitions (id → name/pathurl) so
// bare <file id="..."/> references on repeat cuts resolve to their source.
export function buildFileDefs(doc) {
  const defs = new Map();
  const fileEls = doc.getElementsByTagName('file');
  for (let i = 0; i < fileEls.length; i++) {
    const fileEl = fileEls[i];
    const id = fileEl.getAttribute('id');
    if (!id || defs.has(id)) continue;
    const name = getText(fileEl, 'name');
    const pathUrl = getText(fileEl, 'pathurl');
    if (name || pathUrl) defs.set(id, { name, pathUrl });
  }
  return defs;
}

export function parseFCP7XML(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  const fileDefs = buildFileDefs(doc);
  const sequences = [];
  const allSeqElements = doc.getElementsByTagName('sequence');

  for (let i = 0; i < allSeqElements.length; i++) {
    const seqEl = allSeqElements[i];
    if (isNestedInClipItem(seqEl)) continue;

    const seq = parseSequence(seqEl, fileDefs);
    const totalClips = seq.videoTracks.reduce((sum, t) => sum + t.clips.length, 0);
    if (totalClips === 0) continue;
    if (/^Nested Sequence\s*\d*$/i.test(seq.name)) continue;

    sequences.push(seq);
  }

  return sequences;
}

export function extractCorpusUnits(sequences) {
  const units = [];
  for (const seq of sequences) {
    for (const track of seq.videoTracks) {
      for (const clip of track.clips) {
        if (!clip.sourceFile && !clip.name) continue;
        const sourceClipName = clip.sourceFile?.name || clip.name || 'unknown';

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
