// SOT HUNTER — paste a messy soundbite reference (rough timecode + approximate text)
// and locate the matching span in the loaded transcript using Claude. Highlights the
// match in the editor and logs thumbs feedback to localStorage so we can audit
// guess quality over time.
import { formatPreciseTimecode } from './timecode-utils.js';
import { extractSequenceBase, getSequenceMetadata, cleanSpeakerName } from './csv-parser.js';

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

// Merge segments + translations so each segment's `text` is the English
// translation. The hunter only ever shows English to the user, and matches
// against English so the user can paste/think in English regardless of the
// original language.
function buildEnglishSegments(segments, translations) {
  if (!translations || translations.length === 0) return segments;
  const byNum = new Map();
  for (const t of translations) {
    if (t && t.number != null) byNum.set(t.number, t);
  }
  return segments.map(s => {
    const t = byNum.get(s.number);
    if (!t) return s;
    if (t.unintelligible) return null;
    const english = (t.translated && t.translated.trim()) || t.original || s.text;
    return { ...s, text: english };
  }).filter(Boolean);
}

// Build the Anthropic-format `content` for a user message. If any images are
// attached, emit an array of image+text blocks; otherwise a plain string.
function buildUserContent(text, images) {
  if (!images || images.length === 0) return text;
  const blocks = images.map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
  }));
  blocks.push({ type: 'text', text });
  return blocks;
}

async function callHunter({ pasted, segments, images }) {
  const transcript = buildTranscriptForPrompt(segments);
  const system = `You are SOT HUNTER — an editor's assistant that finds the right soundbite in a transcript. The transcript is already in English. The user only ever wants to see clean, natural English.

The user will provide a messy reference. It may be: a rough timecode from another translation, approximate text from an earlier transcription, paraphrased editorial notes, AND/OR a screenshot of a transcript or notes (in any language — read it visually). Your job: find the SINGLE best matching span in the transcript below.

Match by MEANING and ORDER, not just verbatim text. Use any rough timecode as a strong locality hint, but trust meaning over timecode if they conflict.

Return JSON only (no fencing):
{
  "matchSegments": [12, 13, 14],     // segment numbers from the transcript, contiguous, in order
  "confidence": 0,                    // 0-100 how sure you are
  "label": "Brief 5-10 word label",
  "text": "The polished English text of the soundbite. Stitch the matched segments together, fix translation rough edges, drop filler, but DO NOT change meaning or invent content. Keep the speaker's voice. This is what the editor will read and hand to a producer."
}

Rules:
- "confidence" 80-100 = very confident; 50-79 = probable; 20-49 = best guess only; 0-19 = no real match found.
- If nothing plausibly matches, return matchSegments: [] and confidence: 0 and text: "".
- Prefer tight matches (1-5 segments) over sprawling ones. Only widen if the reference clearly spans more.
- "text" must be natural English. No Chinese, no other languages, no ellipses for skipped filler — just the cleaned soundbite.

TRANSCRIPT (numbered, with timecodes, English):
${transcript}`;

  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      stream: true,
      system,
      messages: [{
        role: 'user',
        content: buildUserContent(
          `Find the best match for this reference${images?.length ? ' (text and/or attached image[s])' : ''}:\n\n${pasted || '(see attached image)'}`,
          images,
        ),
      }],
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

async function callThemeHunter({ theme, segments, images }) {
  const transcript = buildTranscriptForPrompt(segments);
  const system = `You are SOT HUNTER in THEME mode. The transcript is already in English. The user only ever wants clean, natural English back.

Given an editorial theme or topic, extract the soundbites from the transcript that best fit it.

A soundbite is:
- A short, standalone quote — typically one or a few contiguous segments.
- Self-contained: makes sense without surrounding context.
- Punchy, declarative, or emotionally resonant on the theme.

Match by MEANING, not just keyword. Quotes may not contain the theme word verbatim.

Return JSON only (no fencing):
{
  "soundbites": [
    {
      "matchSegments": [12, 13],
      "confidence": 0,
      "label": "Brief 5-10 word headline for this soundbite",
      "text": "The polished English text of the soundbite. Stitch the matched segments together, smooth out translation rough edges, drop filler, but DO NOT change meaning or invent content. Keep the speaker's voice. This is what the editor will read and hand to a producer."
    }
  ]
}

Rules:
- Order soundbites by confidence (best first). Aim for 3-12 quality matches; quality > quantity.
- "confidence": 80-100 = strong fit; 50-79 = solid; 20-49 = thematically adjacent; below 20 = skip.
- Skip filler, mid-thought fragments, and interviewer prompts.
- Keep matchSegments tight (1-5 segments). Only widen for genuinely multi-segment quotes.
- "text" must be natural English. No Chinese, no other languages, no ellipses for skipped filler — just the cleaned soundbite, ready to read aloud.
- If nothing fits, return { "soundbites": [] }.

TRANSCRIPT (numbered, with timecodes, English):
${transcript}`;

  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      stream: true,
      system,
      messages: [{
        role: 'user',
        content: buildUserContent(
          `Theme to find${images?.length ? ' (text and/or attached image[s] for additional context)' : ''}: ${theme || '(see attached image)'}`,
          images,
        ),
      }],
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

  const parsed = parseHunterJSON(full);
  return Array.isArray(parsed?.soundbites) ? parsed.soundbites : [];
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

// Build the standard soundbite prefix used elsewhere in the app:
//   [260322-04-113-Matzu | 22:55.3 → 23:00.5]: TEXT
// `seqMeta` comes from getSequenceMetadata(segments). When the soundbite's
// speaker differs from the primary speaker we append ` - SPEAKER` to the base.
function formatSoundbiteLine(segments, segNums, seqMeta, polishedText) {
  if (!segNums || segNums.length === 0) return '';
  const matched = segments.filter(s => segNums.includes(s.number));
  if (matched.length === 0) return '';

  const text = (polishedText && polishedText.trim()) || matched.map(s => s.text || '').join(' ').trim();
  const start = matched[0].start ? fmtTimecode(matched[0].start) : '';
  const end = matched[matched.length - 1].end ? fmtTimecode(matched[matched.length - 1].end) : '';
  const tc = start && end ? `${start} → ${end}` : start;

  // Sequence base (e.g. "260322-04-113-Matzu") from the first labeled speaker.
  const primaryBase = extractSequenceBase(seqMeta?.sequenceName || '');
  let prefix = primaryBase || seqMeta?.sequenceName || '';

  // If this soundbite's speaker differs from primary, append it.
  const blockSpeakerRaw = matched[0].speaker || '';
  const blockClean = cleanSpeakerName(blockSpeakerRaw);
  const primary = seqMeta?.primarySpeaker || '';
  if (prefix && blockClean && primary && blockClean.toUpperCase() !== primary.toUpperCase()) {
    prefix += ` - ${blockClean.toUpperCase()}`;
  }

  const head = [prefix, tc].filter(Boolean).join(' | ');
  return head ? `[${head}]: ${text}` : text;
}

function buildMatchSnippet(segments, segNums, polishedText) {
  if (!segNums || segNums.length === 0) return '';
  const matched = segments.filter(s => segNums.includes(s.number));
  if (matched.length === 0) return '';
  const text = (polishedText && polishedText.trim()) || matched.map(s => s.text || '').join(' ').trim();
  const start = matched[0].start ? fmtTimecode(matched[0].start) : '';
  const end = matched[matched.length - 1].end ? fmtTimecode(matched[matched.length - 1].end) : '';
  const tc = start && end ? `${start} – ${end}` : start || '';
  return { text, tc };
}

export function initSotHunter({ getSegments, getTranslations }) {
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
            <div class="sot-hunter-tag" id="sot-hunter-tag">paste a messy reference. let the arrow fly.</div>
          </div>
        </div>
        <button class="sot-hunter-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="sot-hunter-modes" role="tablist">
        <button type="button" class="sot-hunter-mode active" data-mode="paste" role="tab" aria-selected="true">Paste reference</button>
        <button type="button" class="sot-hunter-mode" data-mode="theme" role="tab" aria-selected="false">By theme</button>
      </div>
      <div id="sot-hunter-dropzone" class="sot-hunter-dropzone">
        <textarea id="sot-hunter-input" class="sot-hunter-textarea" placeholder="Paste a soundbite or rough notes — old timecodes, approximate translations, editorial paraphrases. Or drop / paste a screenshot."></textarea>
        <div class="sot-hunter-drop-overlay">
          <div class="sot-hunter-drop-overlay-inner">drop screenshot to attach</div>
        </div>
      </div>
      <div id="sot-hunter-attachments" class="sot-hunter-attachments" hidden></div>
      <div class="sot-hunter-actions">
        <button id="sot-hunter-fire" class="sot-hunter-fire" type="button">Hunt</button>
        <button id="sot-hunter-attach" class="sot-hunter-attach" type="button" title="Attach an image">+ image</button>
        <input type="file" id="sot-hunter-file" accept="image/*" multiple hidden>
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
  const dropZone = root.querySelector('#sot-hunter-dropzone');
  const attachmentsBox = root.querySelector('#sot-hunter-attachments');
  const attachBtn = root.querySelector('#sot-hunter-attach');
  const fileInput = root.querySelector('#sot-hunter-file');

  // Attached image state. Each entry: { id, dataUrl, mediaType, base64, name, size }.
  const attachedImages = [];

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
        if (!m) return reject(new Error('Could not read image'));
        resolve({
          id: 'img_' + Math.random().toString(36).slice(2, 9),
          dataUrl,
          mediaType: m[1],
          base64: m[2],
          name: file.name || 'screenshot',
          size: file.size,
        });
      };
      reader.onerror = () => reject(reader.error || new Error('Read failed'));
      reader.readAsDataURL(file);
    });
  }

  async function attachFiles(files) {
    const imgs = Array.from(files).filter(f => f && f.type && f.type.startsWith('image/'));
    if (imgs.length === 0) return;
    for (const f of imgs) {
      try {
        const img = await readImageFile(f);
        attachedImages.push(img);
      } catch (err) {
        console.warn('Image read failed:', err);
      }
    }
    renderAttachments();
  }

  function renderAttachments() {
    if (attachedImages.length === 0) {
      attachmentsBox.hidden = true;
      attachmentsBox.innerHTML = '';
      return;
    }
    attachmentsBox.hidden = false;
    attachmentsBox.innerHTML = attachedImages.map(img => `
      <div class="sot-hunter-thumb-wrap" data-id="${img.id}">
        <img class="sot-hunter-thumb-img" src="${img.dataUrl}" alt="">
        <button type="button" class="sot-hunter-thumb-x" title="Remove" aria-label="Remove">×</button>
      </div>
    `).join('');
    attachmentsBox.querySelectorAll('.sot-hunter-thumb-x').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.sot-hunter-thumb-wrap')?.dataset.id;
        const idx = attachedImages.findIndex(i => i.id === id);
        if (idx >= 0) attachedImages.splice(idx, 1);
        renderAttachments();
      });
    });
  }

  // Drag-and-drop on the panel itself.
  let dragDepth = 0;
  panel.addEventListener('dragenter', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
      dragDepth++;
      dropZone.classList.add('drag-active');
    }
  });
  panel.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
    }
  });
  panel.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.classList.remove('drag-active');
  });
  panel.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      dragDepth = 0;
      dropZone.classList.remove('drag-active');
      attachFiles(e.dataTransfer.files);
    }
  });

  // Paste an image from clipboard (Cmd/Ctrl-V on the textarea or panel).
  panel.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      attachFiles(files);
    }
  });

  // "+ image" button → file picker.
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) attachFiles(e.target.files);
    fileInput.value = '';
  });

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
  let mode = 'paste';

  const modeBtns = root.querySelectorAll('.sot-hunter-mode');
  const tagEl = root.querySelector('#sot-hunter-tag');

  function setMode(next) {
    mode = next;
    modeBtns.forEach(b => {
      const on = b.dataset.mode === next;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (next === 'theme') {
      input.placeholder = 'Describe a theme or topic — e.g. "moments of regret about joining NATO" or "anything where she talks about her father."';
      fireBtn.textContent = 'Find soundbites';
      tagEl.textContent = 'name a theme. the hunter brings back several quotes.';
      panel.classList.add('mode-theme');
    } else {
      input.placeholder = 'Paste a soundbite or rough notes — old timecodes, approximate translations, editorial paraphrases. Anything goes.';
      fireBtn.textContent = 'Hunt';
      tagEl.textContent = 'paste a messy reference. let the arrow fly.';
      panel.classList.remove('mode-theme');
    }
    resultBox.hidden = true;
    resultBox.innerHTML = '';
    panel.classList.remove('expanded');
  }
  modeBtns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  async function hunt() {
    const value = input.value.trim();
    if (!value && attachedImages.length === 0) {
      status.textContent = mode === 'theme'
        ? 'Name a theme or attach an image first.'
        : 'Paste something or attach an image first.';
      return;
    }
    const rawSegments = (getSegments?.() || []).filter(s => s && s.text);
    if (rawSegments.length === 0) {
      status.textContent = 'No transcript loaded.';
      return;
    }
    const translations = getTranslations?.() || [];
    if (translations.length === 0) {
      status.textContent = 'Translate the transcript first — the hunter only works in English.';
      return;
    }
    const segments = buildEnglishSegments(rawSegments, translations);
    if (segments.length === 0) {
      status.textContent = 'No translated segments available to hunt through.';
      return;
    }

    fireBtn.disabled = true;
    status.textContent = mode === 'theme' ? 'Stalking the theme through the brush…' : 'Drawing back the bow…';
    resultBox.hidden = true;
    resultBox.innerHTML = '';

    try {
      const images = attachedImages.slice();
      if (mode === 'theme') {
        const soundbites = await callThemeHunter({ theme: value, segments, images });
        lastResult = { mode, query: value, soundbites, imageCount: images.length };
        renderThemeResults(soundbites, segments);
      } else {
        const result = await callHunter({ pasted: value, segments, images });
        lastResult = { mode, pasted: value, result, imageCount: images.length };
        renderResult(result, segments);
      }
      status.textContent = '';
    } catch (err) {
      console.error('SOT Hunter failed:', err);
      status.textContent = `Miss — ${err.message || 'unknown error'}`;
    } finally {
      fireBtn.disabled = false;
    }
  }

  function renderThemeResults(soundbites, segments) {
    resultBox.hidden = false;
    panel.classList.add('expanded');

    if (!soundbites || soundbites.length === 0) {
      resultBox.innerHTML = `
        <div class="sot-hunter-conf sot-hunter-conf--miss">
          <div class="sot-hunter-conf-label">No soundbites found for that theme</div>
        </div>
        <p class="sot-hunter-reasoning">The hunter combed the transcript and didn't find anything that fit.</p>
      `;
      clearHighlights();
      return;
    }

    const seqMeta = getSequenceMetadata(segments);
    const allLines = [];

    const cardsHtml = soundbites.map((sb, i) => {
      const segNums = Array.isArray(sb.matchSegments) ? sb.matchSegments : [];
      const conf = Math.max(0, Math.min(100, Number(sb.confidence) || 0));
      const tone = conf >= 80 ? 'high' : conf >= 50 ? 'mid' : 'low';
      const line = formatSoundbiteLine(segments, segNums, seqMeta, sb.text);
      allLines.push(line);
      return `
        <div class="sot-hunter-bite" data-i="${i}" data-segs="${segNums.join(',')}">
          <div class="sot-hunter-bite-head">
            <div class="sot-hunter-bite-label">${escapeHtml(sb.label || 'Soundbite')}</div>
            <div class="sot-hunter-bite-conf sot-hunter-conf--${tone}">
              <span class="sot-hunter-conf-dot"></span>${conf}%
            </div>
          </div>
          <div class="sot-hunter-bite-line">${escapeHtml(line)}</div>
          <div class="sot-hunter-bite-actions">
            <button type="button" class="sot-hunter-bite-jump">Jump</button>
            <button type="button" class="sot-hunter-bite-copy">Copy</button>
            <span class="sot-hunter-thumbs">
              <button type="button" class="sot-hunter-thumb sot-hunter-thumb--up" title="Good find">👍</button>
              <button type="button" class="sot-hunter-thumb sot-hunter-thumb--down" title="Bad fit">👎</button>
            </span>
          </div>
        </div>
      `;
    }).join('');

    resultBox.innerHTML = `
      <div class="sot-hunter-bites-head">
        <div class="sot-hunter-bites-count">${soundbites.length} soundbite${soundbites.length === 1 ? '' : 's'}</div>
        <button type="button" id="sot-hunter-copy-all" class="sot-hunter-jump">Copy all</button>
      </div>
      <div class="sot-hunter-bites">${cardsHtml}</div>
    `;

    // Highlight all matches and scroll to the first.
    const allSegNums = soundbites.flatMap(sb => Array.isArray(sb.matchSegments) ? sb.matchSegments : []);
    highlightSegmentsInEditor(allSegNums);

    resultBox.querySelector('#sot-hunter-copy-all').addEventListener('click', () => {
      const txt = allLines.filter(Boolean).join('\n\n');
      navigator.clipboard?.writeText(txt);
      flashCopy(resultBox.querySelector('#sot-hunter-copy-all'));
    });

    resultBox.querySelectorAll('.sot-hunter-bite').forEach((card) => {
      const i = Number(card.dataset.i);
      const segs = card.dataset.segs.split(',').filter(Boolean).map(Number);
      const sb = soundbites[i];
      const line = allLines[i];

      card.querySelector('.sot-hunter-bite-jump').addEventListener('click', () => {
        highlightSegmentsInEditor(segs);
      });
      card.querySelector('.sot-hunter-bite-copy').addEventListener('click', (e) => {
        navigator.clipboard?.writeText(line);
        flashCopy(e.currentTarget);
      });
      card.querySelector('.sot-hunter-thumb--up').addEventListener('click', () => {
        logFeedback({ mode: 'theme', query: lastResult.query, soundbite: sb, verdict: 'hit' });
        markBiteVerdict(card, 'up');
      });
      card.querySelector('.sot-hunter-thumb--down').addEventListener('click', () => {
        logFeedback({ mode: 'theme', query: lastResult.query, soundbite: sb, verdict: 'miss' });
        markBiteVerdict(card, 'down');
      });
    });
  }

  function flashCopy(btn) {
    const orig = btn.textContent;
    btn.textContent = 'Copied';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1200);
  }

  function markBiteVerdict(card, kind) {
    const thumbs = card.querySelector('.sot-hunter-thumbs');
    if (!thumbs) return;
    thumbs.innerHTML = `<span class="sot-hunter-feedback-msg">${kind === 'up' ? 'Logged 👍' : 'Logged 👎'}</span>`;
  }

  function renderResult(result, segments) {
    const segNums = Array.isArray(result?.matchSegments) ? result.matchSegments : [];
    const conf = Math.max(0, Math.min(100, Number(result?.confidence) || 0));
    const label = result?.label || '';
    const snippet = buildMatchSnippet(segments, segNums, result?.text);

    resultBox.hidden = false;

    if (segNums.length === 0) {
      resultBox.innerHTML = `
        <div class="sot-hunter-conf sot-hunter-conf--miss">
          <div class="sot-hunter-conf-label">No clean match</div>
        </div>
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
