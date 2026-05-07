// Trint-style media deck for the editor view.
//
// Renders three coordinated surfaces:
//   • A pinned video player (bottom-left, draggable in v2)
//   • A full-width audio waveform along the bottom of the screen
//   • The existing TipTap editor — extended here with click-to-seek
//     handlers and a "current segment" highlight that follows playback.
//
// All three share a single time source: the <video> element's currentTime.
// The waveform and transcript both read from it and write to it.
//
// Highlights are mirrored as yellow regions on the waveform so the editor
// can see at a glance where the marked moments are along the timeline.
//
// Public API:
//   const deck = mountMediaDeck(editorContainer, {
//     signedUrl, mimeType, segments, highlights,
//     onSeek?(seconds), onTimeUpdate?(seconds),
//   });
//   deck.setHighlights(newHighlights);
//   deck.seekTo(seconds);
//   deck.destroy();

import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';

import { parseTimecodeToSeconds } from '../timecode-utils.js';

const VIDEO_HEIGHT = 200;
const WAVEFORM_HEIGHT = 72;

export function mountMediaDeck(editorContainer, opts = {}) {
  const {
    signedUrl,
    mimeType = '',
    segments = [],
    wordTimings = null,   // flat array [{ word, start, end }] from Whisper/Deepgram
    highlights = [],
    onSeek = () => {},
    onTimeUpdate = () => {},
  } = opts;

  if (!signedUrl) {
    return mountInert();
  }

  // ── DOM scaffolding ────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'media-deck';
  root.innerHTML = `
    <div class="media-deck-video" data-deck-video>
      <video data-deck-videoel preload="metadata" playsinline></video>
      <div class="media-deck-controls">
        <button type="button" class="media-deck-btn" data-deck-playpause aria-label="Play/Pause">▶</button>
        <span class="media-deck-time" data-deck-time>0:00 / 0:00</span>
        <select class="media-deck-rate" data-deck-rate>
          <option value="0.5">0.5×</option>
          <option value="0.75">0.75×</option>
          <option value="1" selected>1×</option>
          <option value="1.25">1.25×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
        </select>
      </div>
    </div>
    <div class="media-deck-waveform" data-deck-waveform></div>
  `;
  document.body.appendChild(root);
  document.body.classList.add('has-media-deck');

  const video = root.querySelector('[data-deck-videoel]');
  const playPauseBtn = root.querySelector('[data-deck-playpause]');
  const timeEl = root.querySelector('[data-deck-time]');
  const rateSelect = root.querySelector('[data-deck-rate]');
  const waveformMount = root.querySelector('[data-deck-waveform]');

  const isVideoMime = !mimeType || mimeType.startsWith('video/');
  if (!isVideoMime) {
    // Audio-only: hide the video frame, keep controls.
    root.classList.add('media-deck--audio-only');
  }

  video.src = signedUrl;
  // The waveform pulls its audio from the same media element so the two
  // are inherently in sync — no manual time-pushing required.
  const wavesurfer = WaveSurfer.create({
    container: waveformMount,
    height: WAVEFORM_HEIGHT,
    waveColor: 'rgba(65, 44, 39, 0.45)',     // np-sepia
    progressColor: 'rgba(221, 44, 30, 0.85)', // np-red
    cursorColor: 'rgba(221, 44, 30, 1)',
    cursorWidth: 1,
    barWidth: 2,
    barGap: 1,
    barRadius: 1,
    media: video, // bind to the same <video> — wavesurfer reads currentTime/play/pause from it
    normalize: true,
    interact: true,
    dragToSeek: true,
  });

  const regionsPlugin = wavesurfer.registerPlugin(RegionsPlugin.create());

  // ── Time sync ──────────────────────────────────────────────────────
  function pad(n) { return String(Math.floor(n)).padStart(2, '0'); }
  function fmt(secs) {
    if (!isFinite(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${pad(s)}`;
  }
  function refreshTimeLabel() {
    const cur = video.currentTime || 0;
    const total = video.duration || 0;
    timeEl.textContent = `${fmt(cur)} / ${fmt(total)}`;
  }
  video.addEventListener('timeupdate', () => {
    refreshTimeLabel();
    highlightCurrentSegment(video.currentTime);
    onTimeUpdate(video.currentTime);
  });
  video.addEventListener('loadedmetadata', refreshTimeLabel);
  video.addEventListener('play', () => {
    playPauseBtn.textContent = '❚❚';
    playPauseBtn.setAttribute('aria-label', 'Pause');
  });
  video.addEventListener('pause', () => {
    playPauseBtn.textContent = '▶';
    playPauseBtn.setAttribute('aria-label', 'Play');
  });

  playPauseBtn.addEventListener('click', () => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  });
  rateSelect.addEventListener('change', () => {
    const r = parseFloat(rateSelect.value);
    if (isFinite(r) && r > 0) video.playbackRate = r;
  });

  // ── Click-to-seek wiring on the editor ────────────────────────────
  // The TipTap editor renders each segment as a <span data-segment data-start="HH:MM:SS.mmm">
  // (see src/editor/extensions/Segment.js). Capture clicks at the
  // editor container level and seek either to the segment start (no
  // word_timings) or to the precise word-level position (when
  // word_timings is provided).
  //
  // Word-level: we compute the [segStart, segEnd] window from data-start
  // and data-end, find the words from the flat word_timings array whose
  // [start, end] fall inside that window, then pick the word at the
  // proportional click position within the segment text. That's "good
  // enough" precision without re-rendering each word as its own span.
  function onEditorClick(e) {
    const segEl = e.target?.closest?.('span[data-segment]');
    if (!segEl) return;
    const segStart = parseTimecodeToSeconds(segEl.getAttribute('data-start'));
    const segEnd   = parseTimecodeToSeconds(segEl.getAttribute('data-end'));
    if (!isFinite(segStart)) return;

    let seconds = segStart;

    // Word-level seek: if we have word_timings AND a precise click,
    // map the click to the closest word inside this segment's window.
    if (wordTimings && Array.isArray(wordTimings) && isFinite(segEnd) && segEnd > segStart) {
      const wordSeconds = wordTimeFromClick(e, segEl, segStart, segEnd, wordTimings);
      if (isFinite(wordSeconds)) seconds = wordSeconds;
    }

    // Cmd/Ctrl/Alt-click: seek and play. Shift-click: seek only.
    // Plain click stays out of the way so text editing/selection works.
    if (e.metaKey || e.ctrlKey || e.altKey) {
      e.preventDefault();
      seekTo(seconds);
      video.play().catch(() => {});
    } else if (e.shiftKey) {
      e.preventDefault();
      seekTo(seconds);
    }
  }
  if (editorContainer) editorContainer.addEventListener('click', onEditorClick);

  // ── "Current segment" highlight that follows playback ─────────────
  // We mark the segment whose [start, end] window contains currentTime.
  // Implemented as a CSS class that the editor's stylesheet should
  // visually treat (see media-deck.css).
  let lastHighlightedNumber = null;
  function highlightCurrentSegment(currentTime) {
    if (!editorContainer) return;
    // Find the matching segment by linear scan of the segment list.
    // Segments are typically ordered, so this is O(n) once per timeupdate.
    let match = null;
    for (const s of segments) {
      const startSec = typeof s.startSec === 'number' ? s.startSec : parseTimecodeToSeconds(s.start);
      const endSec   = typeof s.endSec   === 'number' ? s.endSec   : parseTimecodeToSeconds(s.end);
      if (currentTime >= startSec && currentTime < endSec) { match = s; break; }
    }
    if (!match) return;
    const num = match.number;
    if (num === lastHighlightedNumber) return;
    lastHighlightedNumber = num;
    editorContainer.querySelectorAll('span[data-segment].is-playing')
      .forEach(el => el.classList.remove('is-playing'));
    editorContainer.querySelectorAll(`span[data-segment][data-number="${num}"]`)
      .forEach(el => el.classList.add('is-playing'));
  }

  // ── Highlights → waveform regions ─────────────────────────────────
  // Each highlight reflects a tagged moment in the transcript. Render
  // them as transparent yellow regions on the waveform so the editor
  // can see where the marked moments live along the timeline.
  function setHighlights(newHighlights) {
    regionsPlugin.clearRegions();
    if (!newHighlights || newHighlights.length === 0) return;
    for (const h of newHighlights) {
      const span = highlightTimeSpan(h, segments);
      if (!span) continue;
      regionsPlugin.addRegion({
        start: span.start,
        end: span.end,
        color: h.color || 'rgba(221, 200, 30, 0.35)',
        drag: false,
        resize: false,
      });
    }
  }
  setHighlights(highlights);

  // Clicking a region jumps the playhead and notifies the host.
  regionsPlugin.on('region-clicked', (region, e) => {
    e.stopPropagation();
    seekTo(region.start);
    video.play().catch(() => {});
    onSeek(region.start);
  });

  // ── Public API ────────────────────────────────────────────────────
  function seekTo(seconds) {
    if (!isFinite(seconds)) return;
    try { video.currentTime = Math.max(0, seconds); } catch {}
    refreshTimeLabel();
    onSeek(seconds);
  }

  function destroy() {
    try { video.pause(); } catch {}
    try { wavesurfer.destroy(); } catch {}
    if (editorContainer) editorContainer.removeEventListener('click', onEditorClick);
    if (root.parentNode) root.parentNode.removeChild(root);
    document.body.classList.remove('has-media-deck');
  }

  return { setHighlights, seekTo, destroy, root };
}

// Returns null when there's no media to display (avoids creating dead DOM).
function mountInert() {
  return {
    setHighlights() {},
    seekTo() {},
    destroy() {},
    root: null,
  };
}

// Map a click within a segment span to a precise word timestamp.
//
// Strategy:
//   1. Get the words from the flat word_timings array whose [start, end]
//      falls inside this segment's [segStart, segEnd] window.
//   2. Use Range/getBoundingClientRect to find the offset inside the
//      segment's text where the click landed.
//   3. Pick the word at that proportional offset and return its start.
//
// If anything goes wrong (no words match, bad geometry), return NaN
// and the caller falls back to segStart.
function wordTimeFromClick(e, segEl, segStart, segEnd, wordTimings) {
  const wordsInSeg = wordTimings.filter(w =>
    typeof w.start === 'number' && typeof w.end === 'number' &&
    w.start >= segStart - 0.05 && w.end <= segEnd + 0.05
  );
  if (wordsInSeg.length === 0) return NaN;

  const text = segEl.textContent || '';
  const len = text.length;
  if (len === 0) return wordsInSeg[0].start;

  // Use a Range to translate clientX/Y to a character offset in the segment text.
  let offset = NaN;
  try {
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range && segEl.contains(range.startContainer)) {
        offset = caretOffsetWithin(segEl, range.startContainer, range.startOffset);
      }
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos && segEl.contains(pos.offsetNode)) {
        offset = caretOffsetWithin(segEl, pos.offsetNode, pos.offset);
      }
    }
  } catch {}
  if (!isFinite(offset)) {
    // Fallback: proportional position from clientX vs segment bounding box.
    const rect = segEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    offset = Math.floor(ratio * len);
  }

  // Translate character offset → word index within the segment's text.
  // We approximate by counting how many word boundaries we've crossed.
  const upTo = text.slice(0, Math.max(0, Math.min(len, offset)));
  // Word count = number of non-empty whitespace-delimited tokens
  const wordsBefore = (upTo.match(/\S+/g) || []).length;
  // Index into wordsInSeg: clamp so we never go past the last word
  const idx = Math.max(0, Math.min(wordsInSeg.length - 1, wordsBefore));
  const target = wordsInSeg[idx];
  return target?.start ?? segStart;
}

// Compute the character offset from segEl.textContent up to (node, offset).
function caretOffsetWithin(segEl, node, offset) {
  let count = 0;
  const walker = document.createTreeWalker(segEl, NodeFilter.SHOW_TEXT, null);
  let cur;
  // eslint-disable-next-line no-cond-assign
  while ((cur = walker.nextNode())) {
    if (cur === node) return count + offset;
    count += cur.textContent?.length || 0;
  }
  return count;
}

// Resolve a highlight to a {start, end} time span by looking up its
// segment numbers in the segments list. Highlights span 1..N segments.
function highlightTimeSpan(h, segments) {
  const nums = h.segment_numbers || h.segmentNumbers || [];
  if (!nums.length) return null;
  let start = Infinity, end = -Infinity;
  for (const n of nums) {
    const s = segments.find(seg => seg.number === n);
    if (!s) continue;
    const ss = typeof s.startSec === 'number' ? s.startSec : parseTimecodeToSeconds(s.start);
    const ee = typeof s.endSec   === 'number' ? s.endSec   : parseTimecodeToSeconds(s.end);
    if (isFinite(ss) && ss < start) start = ss;
    if (isFinite(ee) && ee > end)   end   = ee;
  }
  if (!isFinite(start) || !isFinite(end) || end <= start) return null;
  return { start, end };
}
