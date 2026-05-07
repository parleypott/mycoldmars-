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
    cachedPeaks = null,   // [[number,...]] from media_uploads.waveform — skips peak compute when present
    onSeek = () => {},
    onTimeUpdate = () => {},
    onPeaksReady = null,  // (peaks) => void — fires once after the first decode so caller can persist
  } = opts;

  if (!signedUrl) {
    return mountInert();
  }

  // ── DOM scaffolding ────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'media-deck';
  // SVG icons inline so we don't need an icon font. Stroke uses currentColor
  // so hover states can recolor with CSS.
  const ICON_SKIP_BACK = `
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
        d="M11 6 L4 12 L11 18 M20 6 L13 12 L20 18"/>
    </svg>`;
  const ICON_SKIP_FWD = `
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
        d="M4 6 L11 12 L4 18 M13 6 L20 12 L13 18"/>
    </svg>`;
  const ICON_PLAY = `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M7 5 L19 12 L7 19 Z"/>
    </svg>`;
  const ICON_PAUSE = `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" fill="currentColor"/>
      <rect x="14" y="5" width="4" height="14" fill="currentColor"/>
    </svg>`;

  root.innerHTML = `
    <div class="media-deck-video" data-deck-video>
      <div class="media-deck-grip" data-deck-grip title="Drag to move">⋮⋮</div>
      <button type="button" class="media-deck-collapse" data-deck-collapse aria-label="Collapse" title="Collapse">−</button>
      <video data-deck-videoel preload="metadata" playsinline></video>
      <div class="media-deck-error" data-deck-error hidden></div>
      <div class="media-deck-novideo" data-deck-novideo hidden>
        <span class="media-deck-novideo-eye">audio only</span>
        <span class="media-deck-novideo-sub">browser can't decode this video format (likely a Premiere ProRes proxy). Audio + transcript still work.</span>
      </div>
      <div class="media-deck-controls">
        <div class="media-deck-controls-center">
          <button type="button" class="media-deck-btn media-deck-btn--skip" data-deck-skipback aria-label="Skip back 10 seconds" title="← 10s">
            ${ICON_SKIP_BACK}
            <span class="media-deck-skip-label">10</span>
          </button>
          <button type="button" class="media-deck-btn media-deck-btn--play" data-deck-playpause aria-label="Play/Pause" title="Space">
            ${ICON_PLAY}
          </button>
          <button type="button" class="media-deck-btn media-deck-btn--skip" data-deck-skipfwd aria-label="Skip forward 10 seconds" title="10s →">
            <span class="media-deck-skip-label">10</span>
            ${ICON_SKIP_FWD}
          </button>
        </div>
        <span class="media-deck-time" data-deck-time>0:00 / 0:00</span>
        <select class="media-deck-rate" data-deck-rate title="Playback speed">
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

  const videoFrame = root.querySelector('[data-deck-video]');
  const video = root.querySelector('[data-deck-videoel]');
  const playPauseBtn = root.querySelector('[data-deck-playpause]');
  const skipBackBtn = root.querySelector('[data-deck-skipback]');
  const skipFwdBtn = root.querySelector('[data-deck-skipfwd]');
  const timeEl = root.querySelector('[data-deck-time]');
  const rateSelect = root.querySelector('[data-deck-rate]');
  const waveformMount = root.querySelector('[data-deck-waveform]');
  const grip = root.querySelector('[data-deck-grip]');
  const collapseBtn = root.querySelector('[data-deck-collapse]');
  const errorEl = root.querySelector('[data-deck-error]');
  const noVideoEl = root.querySelector('[data-deck-novideo]');

  // ── Restore saved position + collapsed state ────────────────────
  try {
    const saved = JSON.parse(localStorage.getItem('mcm_media_deck_pos') || 'null');
    if (saved && typeof saved.left === 'number' && typeof saved.bottom === 'number') {
      videoFrame.style.left = `${saved.left}px`;
      videoFrame.style.bottom = `${saved.bottom}px`;
      videoFrame.style.right = 'auto';
    }
    if (saved && saved.collapsed) {
      videoFrame.classList.add('media-deck-video--collapsed');
      collapseBtn.textContent = '+';
      collapseBtn.title = 'Expand';
    }
  } catch {}

  // ── Drag-to-move via the grip handle ───────────────────────────
  let dragState = null;
  grip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = videoFrame.getBoundingClientRect();
    dragState = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    document.body.classList.add('media-deck-dragging');
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    e.preventDefault();
    const left = Math.max(0, Math.min(window.innerWidth - dragState.width, e.clientX - dragState.offsetX));
    const top  = Math.max(0, Math.min(window.innerHeight - dragState.height, e.clientY - dragState.offsetY));
    // Convert top → bottom so resizes don't push the player off-screen.
    const bottom = window.innerHeight - top - dragState.height;
    videoFrame.style.left = `${left}px`;
    videoFrame.style.bottom = `${bottom}px`;
    videoFrame.style.right = 'auto';
  });
  window.addEventListener('mouseup', () => {
    if (!dragState) return;
    dragState = null;
    document.body.classList.remove('media-deck-dragging');
    // Persist the final position
    try {
      const left = parseFloat(videoFrame.style.left) || 16;
      const bottom = parseFloat(videoFrame.style.bottom) || 86;
      const collapsed = videoFrame.classList.contains('media-deck-video--collapsed');
      localStorage.setItem('mcm_media_deck_pos', JSON.stringify({ left, bottom, collapsed }));
    } catch {}
  });

  // ── Collapse / expand the video frame (controls + waveform stay) ─
  collapseBtn.addEventListener('click', () => {
    const isCollapsed = videoFrame.classList.toggle('media-deck-video--collapsed');
    collapseBtn.textContent = isCollapsed ? '+' : '−';
    collapseBtn.title = isCollapsed ? 'Expand' : 'Collapse';
    try {
      const cur = JSON.parse(localStorage.getItem('mcm_media_deck_pos') || '{}');
      localStorage.setItem('mcm_media_deck_pos', JSON.stringify({ ...cur, collapsed: isCollapsed }));
    } catch {}
  });

  const isVideoMime = !mimeType || mimeType.startsWith('video/');
  if (!isVideoMime) {
    // Audio-only: hide the video frame, keep controls.
    root.classList.add('media-deck--audio-only');
  }

  video.src = signedUrl;
  // The waveform pulls its audio from the same media element so the two
  // are inherently in sync — no manual time-pushing required.
  const wavesurferConfig = {
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
  };
  // If we have cached peaks (from a previous decode of this same media),
  // hand them to Wavesurfer so the waveform renders instantly without
  // waiting for the audio buffer to download + decode. Still needs the
  // media to load for playback, but the visual is up-front.
  if (Array.isArray(cachedPeaks) && cachedPeaks.length > 0) {
    wavesurferConfig.peaks = cachedPeaks;
    // duration helps Wavesurfer scale the cached peaks correctly before
    // the media element reports its own duration.
    if (typeof opts.cachedDuration === 'number' && opts.cachedDuration > 0) {
      wavesurferConfig.duration = opts.cachedDuration;
    }
  }
  const wavesurfer = WaveSurfer.create(wavesurferConfig);

  // First-decode peak export: when Wavesurfer finishes its initial decode,
  // pull the peaks out and hand them to the caller for persistence. Only
  // runs when there were no cached peaks to begin with — no point
  // re-exporting what we already had.
  if (!wavesurferConfig.peaks && typeof onPeaksReady === 'function') {
    wavesurfer.once('ready', () => {
      try {
        const peaks = wavesurfer.exportPeaks({ channels: 1, maxLength: 4000, precision: 1000 });
        const duration = video.duration || 0;
        onPeaksReady({ peaks, duration });
      } catch (err) {
        console.warn('[media-deck] peak export failed:', err);
      }
    });
  }

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
    playPauseBtn.innerHTML = ICON_PAUSE;
    playPauseBtn.setAttribute('aria-label', 'Pause');
  });
  video.addEventListener('pause', () => {
    playPauseBtn.innerHTML = ICON_PLAY;
    playPauseBtn.setAttribute('aria-label', 'Play');
  });

  // Surface load errors instead of silently failing. CORS, 403, or media
  // codec issues all show up here. Without this we'd just see a dead player.
  video.addEventListener('error', () => {
    const err = video.error;
    const code = err ? err.code : 'unknown';
    const msg = err ? err.message : '';
    console.error('[media-deck] video error', { code, msg, src: video.currentSrc || video.src });
    showError(`Couldn't load video (code ${code}). Check console for details.`);
  });

  function tryPlay() {
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        console.error('[media-deck] play() rejected:', err?.name, err?.message || err);
        // NotAllowedError = autoplay policy. AbortError = source still loading.
        if (err && err.name === 'NotAllowedError') {
          showError('Click the video to start playback (browser blocked autoplay).');
        }
      });
    }
  }
  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
  function clearError() {
    if (!errorEl) return;
    errorEl.hidden = true;
    errorEl.textContent = '';
  }
  video.addEventListener('playing', clearError);
  video.addEventListener('loadeddata', clearError);

  // Codec sniff: when metadata loads, if videoWidth is 0 the browser
  // can't decode the visual track (very common for Premiere ProRes
  // proxies, which Chrome won't render). Fall back to an "audio only"
  // panel — audio + waveform + transcript still all work.
  video.addEventListener('loadedmetadata', () => {
    if (!noVideoEl) return;
    if (video.videoWidth === 0 && (video.duration || 0) > 0) {
      noVideoEl.hidden = false;
      videoFrame.classList.add('media-deck-video--audioonly');
    }
  });

  playPauseBtn.addEventListener('click', () => {
    if (video.paused) tryPlay();
    else video.pause();
  });
  // Click the video itself to play/pause too — important when the controls
  // bar is small and the video is the obvious target.
  video.addEventListener('click', () => {
    if (video.paused) tryPlay();
    else video.pause();
  });
  skipBackBtn.addEventListener('click', () => {
    seekTo((video.currentTime || 0) - 10);
  });
  skipFwdBtn.addEventListener('click', () => {
    seekTo((video.currentTime || 0) + 10);
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

    // Trint parity: plain click snaps the playhead to that word's time
    // AND lets the cursor land there for editing. Cmd/Ctrl/Alt-click also
    // starts playback. We skip the seek when the click was actually the
    // end of a drag-select (selection has range) so highlighting text
    // doesn't yank the playhead around.
    const sel = window.getSelection?.();
    const isDragSelect = sel && !sel.isCollapsed;
    if (isDragSelect) return;

    if (e.metaKey || e.ctrlKey || e.altKey) {
      e.preventDefault();
      seekTo(seconds);
      tryPlay();
    } else {
      // Don't preventDefault — the cursor still positions at the click.
      seekTo(seconds);
    }
  }
  if (editorContainer) editorContainer.addEventListener('click', onEditorClick);

  // ── "Current segment" highlight + auto-scroll to follow playback ──
  // We mark the segment whose [start, end] window contains currentTime.
  // While the video plays, the transcript auto-scrolls so the current
  // segment stays in view — but only when the user hasn't scrolled
  // manually in the last few seconds (so manual exploration isn't
  // hijacked by the playhead). Manual scroll is detected via wheel/
  // touchmove on the editor container.
  let lastHighlightedNumber = null;
  let lastUserScrollAt = 0;
  const USER_SCROLL_GRACE_MS = 3000;

  if (editorContainer) {
    const noteUserScroll = () => { lastUserScrollAt = Date.now(); };
    editorContainer.addEventListener('wheel',     noteUserScroll, { passive: true });
    editorContainer.addEventListener('touchmove', noteUserScroll, { passive: true });
    editorContainer.addEventListener('keydown', (e) => {
      // Page-Up/Down, Home/End, Arrow keys → user is navigating manually
      if (['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(e.key)) {
        lastUserScrollAt = Date.now();
      }
    });
  }

  function highlightCurrentSegment(currentTime) {
    if (!editorContainer) return;
    // Find the matching segment by linear scan of the segment list.
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
    const targets = editorContainer.querySelectorAll(`span[data-segment][data-number="${num}"]`);
    targets.forEach(el => el.classList.add('is-playing'));

    // Auto-scroll: only if the video is actually playing AND the user
    // hasn't manually scrolled recently. Use the FIRST element of the
    // segment (a segment can span multiple lines/spans) as the anchor.
    if (video.paused) return;
    if (Date.now() - lastUserScrollAt < USER_SCROLL_GRACE_MS) return;
    const anchor = targets[0];
    if (!anchor) return;
    if (!isInViewportFairly(anchor)) {
      try {
        anchor.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch {
        anchor.scrollIntoView();
      }
    }
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
    tryPlay();
    onSeek(region.start);
  });

  // ── Public API ────────────────────────────────────────────────────
  function seekTo(seconds) {
    if (!isFinite(seconds)) return;
    try { video.currentTime = Math.max(0, seconds); } catch {}
    refreshTimeLabel();
    onSeek(seconds);
  }

  // ── Keyboard shortcuts (Final Cut J/K/L + space + arrows) ──────
  // Gated so they don't fire when the user is typing in the editor or
  // any input — we check the active element, contentEditable state,
  // and whether the focus is inside ProseMirror's editor surface.
  function isTyping() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = a.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (a.isContentEditable) return true;
    if (a.closest && a.closest('.ProseMirror')) return true;
    return false;
  }
  function onKeydown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // don't shadow OS shortcuts
    if (isTyping()) return;
    const k = e.key;
    let handled = true;
    if (k === ' ' || k === 'Spacebar') {
      if (video.paused) tryPlay();
      else video.pause();
    } else if (k === 'k' || k === 'K') {
      video.pause();
    } else if (k === 'l' || k === 'L') {
      // L: play; pressing repeatedly bumps the rate up toward 2x like Final Cut
      if (video.paused) { video.playbackRate = 1; tryPlay(); }
      else { video.playbackRate = Math.min(2, (video.playbackRate || 1) * 1.5); }
      rateSelect.value = String(closestRate(video.playbackRate));
    } else if (k === 'j' || k === 'J') {
      // J: rewind; toggles into "play backward" by stepping back if unsupported
      // Most browsers don't support negative playbackRate, so we do step-back at 5s.
      seekTo((video.currentTime || 0) - 5);
    } else if (k === 'ArrowLeft')  { seekTo((video.currentTime || 0) - 10); }
    else if  (k === 'ArrowRight') { seekTo((video.currentTime || 0) + 10); }
    else if  (k === 'ArrowDown')  { video.playbackRate = Math.max(0.25, (video.playbackRate || 1) - 0.25); rateSelect.value = String(closestRate(video.playbackRate)); }
    else if  (k === 'ArrowUp')    { video.playbackRate = Math.min(2,    (video.playbackRate || 1) + 0.25); rateSelect.value = String(closestRate(video.playbackRate)); }
    else handled = false;
    if (handled) e.preventDefault();
  }
  window.addEventListener('keydown', onKeydown);

  function closestRate(r) {
    const choices = [0.5, 0.75, 1, 1.25, 1.5, 2];
    return choices.reduce((best, c) => Math.abs(c - r) < Math.abs(best - r) ? c : best, 1);
  }

  function destroy() {
    try { video.pause(); } catch {}
    try { wavesurfer.destroy(); } catch {}
    if (editorContainer) editorContainer.removeEventListener('click', onEditorClick);
    window.removeEventListener('keydown', onKeydown);
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

// Returns true if the element is mostly already visible — within a 25%
// vertical buffer above the deck (the bottom ~320px is occupied by the
// video player + waveform). Avoids scrolling the page on every tiny tick.
function isInViewportFairly(el) {
  const rect = el.getBoundingClientRect();
  const h = window.innerHeight || document.documentElement.clientHeight;
  // Viewport "comfort zone": 15% from top to (h - 320 - 80px). The
  // 320 reserves space for the deck; 80 gives breathing room above it.
  const topComfort = h * 0.15;
  const bottomComfort = h - 320 - 80;
  return rect.top >= topComfort && rect.bottom <= bottomComfort;
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
