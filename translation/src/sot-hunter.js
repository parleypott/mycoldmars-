// SOT HUNTER — paste a messy soundbite reference (rough timecode + approximate text)
// and locate the matching span in the loaded transcript using Claude. Highlights the
// match in the editor and logs thumbs feedback to localStorage so we can audit
// guess quality over time.
import { formatPreciseTimecode } from './timecode-utils.js';

const FEEDBACK_KEY = 'np_sot_hunter_feedback_v1';

// Pixel-art Robin Hood archer, Atari-sprite style.
// 18×14 grid. Legend: F=feather, H=hat/hair, S=skin, G=green tunic,
// B=brown bow, A=arrow shaft, .=transparent.
const ROBIN_PIXELS = (() => {
  const grid = [
    '....F.............',
    '...HHF............',
    '..HHHH............',
    '...HHH....B.......',
    '..SSSS.....B......',
    '..SSSS......B.....',
    '...SS.......B.....',
    '.GGGGAAAAAAAAB....',
    'GGGGGG......B.....',
    'GGGGGG.....B......',
    '.GGGG.....B.......',
    '.GGGG....B........',
    '..GG..............',
    '.GG.GG............',
  ];
  const PX = 5;
  const COLOR = {
    F: '#dd2c1e',
    H: '#5a3a1d',
    S: '#f5c089',
    G: '#1f6f2e',
    B: '#5a3a1d',
    A: '#cdb487',
  };
  const W = grid[0].length, H = grid.length;
  const rects = [];
  for (let y = 0; y < H; y++) {
    const row = grid[y];
    for (let x = 0; x < W; x++) {
      const fill = COLOR[row[x]];
      if (!fill) continue;
      rects.push(`<rect x="${x * PX}" y="${y * PX}" width="${PX}" height="${PX}" fill="${fill}"/>`);
    }
  }
  const w = W * PX, h = H * PX;
  return `<svg class="sot-hunter-icon" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects.join('')}</svg>`;
})();

function loadFeedback() {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]'); }
  catch { return []; }
}

function saveFeedback(entries) {
  try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(entries.slice(-200))); }
  catch {}
}

function logFeedback(entry) {
  const all = loadFeedback();
  all.push({ ...entry, at: new Date().toISOString() });
  saveFeedback(all);
}

function fmtTimecode(tc) {
  if (tc == null || tc === '') return '';
  const s = typeof tc === 'string' ? tc : String(tc);
  if (/^\d+(\.\d+)?$/.test(s)) return formatPreciseTimecode(parseFloat(s));
  return s;
}

function buildTranscriptForPrompt(segments) {
  return segments.map(s => {
    const start = fmtTimecode(s.start);
    const end = fmtTimecode(s.end);
    const tc = start && end ? `[${start}–${end}]` : start ? `[${start}]` : '';
    const speaker = s.speaker ? ` ${s.speaker}:` : '';
    return `${s.number}. ${tc}${speaker} ${s.text || ''}`.trim();
  }).join('\n');
}

async function callHunter({ pasted, segments }) {
  const transcript = buildTranscriptForPrompt(segments);
  const system = `You are SOT HUNTER — an editor's assistant that finds the right soundbite in a transcript.

The user will paste a messy reference: maybe a rough timecode from another translation, maybe approximate text from an earlier transcription, maybe paraphrased editorial notes. Your job: find the SINGLE best matching span in the transcript below.

Match by MEANING and ORDER, not just verbatim text. The transcript and the reference may use different translations or different word choices for the same content. Use the rough timecode (if present) as a strong locality hint, but trust meaning over timecode if they conflict.

Return JSON only (no fencing):
{
  "matchSegments": [12, 13, 14],     // segment numbers from the transcript, contiguous, in order
  "confidence": 0,                    // 0-100 how sure you are
  "label": "Brief 5-10 word label",
  "reasoning": "Short why-this-matches explanation (1-2 sentences)"
}

Rules:
- "confidence" 80-100 = very confident; 50-79 = probable; 20-49 = best guess only; 0-19 = no real match found.
- If nothing plausibly matches, return matchSegments: [] and confidence: 0.
- Prefer tight matches (1-5 segments) over sprawling ones. Only widen if the reference clearly spans more.

TRANSCRIPT (numbered, with timecodes):
${transcript}`;

  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      stream: true,
      system,
      messages: [{ role: 'user', content: `Find the best match for this reference:\n\n${pasted}` }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hunter API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const ev = JSON.parse(data);
        if (ev.type === 'content_block_delta' && ev.delta?.text) full += ev.delta.text;
      } catch {}
    }
  }

  return parseHunterJSON(full);
}

function parseHunterJSON(text) {
  try { return JSON.parse(text.trim()); } catch {}
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch {}
  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }
      }}
    }
  }
  throw new Error('Could not parse hunter response');
}

function confidenceLabel(c) {
  if (c >= 80) return 'Locked on';
  if (c >= 50) return 'Probable';
  if (c >= 20) return 'Best guess';
  return 'No clean match';
}

function highlightSegmentsInEditor(segNums) {
  if (!segNums || segNums.length === 0) return null;
  const editorRoot = document.querySelector('#editor-mount .tiptap');
  if (!editorRoot) return null;

  // Clear any prior highlights.
  editorRoot.querySelectorAll('.sot-hunter-highlight').forEach(el => {
    el.classList.remove('sot-hunter-highlight');
  });

  let firstEl = null;
  for (const n of segNums) {
    const el = editorRoot.querySelector(`[data-number="${n}"]`);
    if (el) {
      el.classList.add('sot-hunter-highlight');
      if (!firstEl) firstEl = el;
    }
  }

  if (firstEl) {
    firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return firstEl;
}

function clearHighlights() {
  document.querySelectorAll('.sot-hunter-highlight').forEach(el => {
    el.classList.remove('sot-hunter-highlight');
  });
}

function buildMatchSnippet(segments, segNums) {
  if (!segNums || segNums.length === 0) return '';
  const matched = segments.filter(s => segNums.includes(s.number));
  if (matched.length === 0) return '';
  const text = matched.map(s => s.text || '').join(' ').trim();
  const start = matched[0].start ? fmtTimecode(matched[0].start) : '';
  const end = matched[matched.length - 1].end ? fmtTimecode(matched[matched.length - 1].end) : '';
  const tc = start && end ? `${start} – ${end}` : start || '';
  return { text, tc };
}

export function initSotHunter({ getSegments }) {
  if (document.getElementById('sot-hunter-root')) return;

  const root = document.createElement('div');
  root.id = 'sot-hunter-root';
  root.innerHTML = `
    <button id="sot-hunter-toggle" class="sot-hunter-toggle" type="button" title="SOT Hunter — find a soundbite from messy notes">
      ${ROBIN_PIXELS}
      <span class="sot-hunter-toggle-label">SOT&nbsp;HUNTER</span>
    </button>
    <div id="sot-hunter-panel" class="sot-hunter-panel" hidden>
      <div class="sot-hunter-header">
        <div class="sot-hunter-title">
          ${ROBIN_PIXELS}
          <div>
            <div class="sot-hunter-eyebrow">SOT&nbsp;HUNTER</div>
            <div class="sot-hunter-tag">paste a messy reference. let the arrow fly.</div>
          </div>
        </div>
        <button class="sot-hunter-close" type="button" aria-label="Close">×</button>
      </div>
      <textarea id="sot-hunter-input" class="sot-hunter-textarea" placeholder="Paste a soundbite or rough notes — old timecodes, approximate translations, editorial paraphrases. Anything goes."></textarea>
      <div class="sot-hunter-actions">
        <button id="sot-hunter-fire" class="sot-hunter-fire" type="button">Hunt</button>
        <span id="sot-hunter-status" class="sot-hunter-status"></span>
      </div>
      <div id="sot-hunter-result" class="sot-hunter-result" hidden></div>
    </div>
  `;
  document.body.appendChild(root);

  const toggleBtn = root.querySelector('#sot-hunter-toggle');
  const panel = root.querySelector('#sot-hunter-panel');
  const closeBtn = root.querySelector('.sot-hunter-close');
  const fireBtn = root.querySelector('#sot-hunter-fire');
  const input = root.querySelector('#sot-hunter-input');
  const status = root.querySelector('#sot-hunter-status');
  const resultBox = root.querySelector('#sot-hunter-result');

  function openPanel() {
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('open'));
    setTimeout(() => input.focus(), 50);
  }
  function closePanel() {
    panel.classList.remove('open');
    setTimeout(() => { panel.hidden = true; }, 200);
  }

  toggleBtn.addEventListener('click', () => {
    if (panel.hidden) openPanel(); else closePanel();
  });
  closeBtn.addEventListener('click', closePanel);

  let lastResult = null;

  async function hunt() {
    const pasted = input.value.trim();
    if (!pasted) {
      status.textContent = 'Paste something first.';
      return;
    }
    const segments = (getSegments?.() || []).filter(s => s && s.text);
    if (segments.length === 0) {
      status.textContent = 'No transcript loaded.';
      return;
    }

    fireBtn.disabled = true;
    status.textContent = 'Drawing back the bow…';
    resultBox.hidden = true;
    resultBox.innerHTML = '';

    try {
      const result = await callHunter({ pasted, segments });
      lastResult = { pasted, result };
      renderResult(result, segments);
      status.textContent = '';
    } catch (err) {
      console.error('SOT Hunter failed:', err);
      status.textContent = `Miss — ${err.message || 'unknown error'}`;
    } finally {
      fireBtn.disabled = false;
    }
  }

  function renderResult(result, segments) {
    const segNums = Array.isArray(result?.matchSegments) ? result.matchSegments : [];
    const conf = Math.max(0, Math.min(100, Number(result?.confidence) || 0));
    const label = result?.label || '';
    const reasoning = result?.reasoning || '';
    const snippet = buildMatchSnippet(segments, segNums);

    resultBox.hidden = false;

    if (segNums.length === 0) {
      resultBox.innerHTML = `
        <div class="sot-hunter-conf sot-hunter-conf--miss">
          <div class="sot-hunter-conf-label">No clean match</div>
        </div>
        <p class="sot-hunter-reasoning">${escapeHtml(reasoning) || 'The hunter found nothing it would stake an arrow on.'}</p>
      `;
      clearHighlights();
      return;
    }

    const tone = conf >= 80 ? 'high' : conf >= 50 ? 'mid' : 'low';

    resultBox.innerHTML = `
      <div class="sot-hunter-conf sot-hunter-conf--${tone}">
        <div class="sot-hunter-conf-label">${confidenceLabel(conf)}</div>
        <div class="sot-hunter-conf-bar"><div class="sot-hunter-conf-fill" style="width:${conf}%"></div></div>
        <div class="sot-hunter-conf-pct">${conf}%</div>
      </div>
      ${label ? `<div class="sot-hunter-result-label">${escapeHtml(label)}</div>` : ''}
      <div class="sot-hunter-snippet">
        ${snippet?.tc ? `<div class="sot-hunter-snippet-tc">${escapeHtml(snippet.tc)} &middot; segments ${segNums.join(', ')}</div>` : ''}
        <div class="sot-hunter-snippet-text">"${escapeHtml(snippet?.text || '')}"</div>
      </div>
      <p class="sot-hunter-reasoning">${escapeHtml(reasoning)}</p>
      <div class="sot-hunter-feedback">
        <button type="button" class="sot-hunter-jump">Jump to it</button>
        <div class="sot-hunter-thumbs">
          <button type="button" class="sot-hunter-thumb sot-hunter-thumb--up" title="Got it">👍 Got it</button>
          <button type="button" class="sot-hunter-thumb sot-hunter-thumb--down" title="Missed it">👎 Missed</button>
        </div>
      </div>
    `;

    highlightSegmentsInEditor(segNums);

    resultBox.querySelector('.sot-hunter-jump').addEventListener('click', () => {
      highlightSegmentsInEditor(segNums);
    });
    resultBox.querySelector('.sot-hunter-thumb--up').addEventListener('click', () => {
      logFeedback({ pasted: lastResult.pasted, result, verdict: 'hit' });
      flashThumb(resultBox, 'up');
    });
    resultBox.querySelector('.sot-hunter-thumb--down').addEventListener('click', () => {
      logFeedback({ pasted: lastResult.pasted, result, verdict: 'miss' });
      flashThumb(resultBox, 'down');
    });
  }

  function flashThumb(container, kind) {
    const thumbs = container.querySelector('.sot-hunter-thumbs');
    if (!thumbs) return;
    thumbs.classList.add(`sot-hunter-thumbs--${kind}`);
    thumbs.innerHTML = kind === 'up'
      ? '<span class="sot-hunter-feedback-msg">Logged. The arrow flies truer next time.</span>'
      : '<span class="sot-hunter-feedback-msg">Logged. Hunter will sharpen its aim.</span>';
  }

  fireBtn.addEventListener('click', hunt);
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') hunt();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) closePanel();
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Show/hide the toggle based on whether a transcript is loaded and we're on the editor view.
export function setSotHunterVisible(visible) {
  const btn = document.getElementById('sot-hunter-toggle');
  if (btn) btn.style.display = visible ? '' : 'none';
  if (!visible) {
    const panel = document.getElementById('sot-hunter-panel');
    if (panel && !panel.hidden) {
      panel.classList.remove('open');
      setTimeout(() => { panel.hidden = true; }, 200);
    }
  }
}

// Exposed for debugging / future audit UI.
export function getSotHunterFeedback() { return loadFeedback(); }
