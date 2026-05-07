// Three-step upload flow modals. Modeled on Trint's structured
// step-by-step pattern but rendered in Newpress's editorial voice
// (cream/sepia/red, monospace labels, lowercase-friendly copy, no
// marketing-shouty buttons).
//
//   • openPreTranscribeDialog — after the file lands in storage, show
//     a clean "configure" sheet: file stats as inline pills at top,
//     a horizontal options table (language / detect speakers /
//     translate to / hints), and a centered TRANSCRIBE button.
//
//   • openSpeakerLabelDialog — after transcription returns, list each
//     detected speaker with an inline audio sample player, a rename
//     input, and an "ignore" toggle. Header explains what's happening.
//
// Both reject when the user dismisses the modal so the caller can
// short-circuit cleanly.

const ISO_LANG_CHOICES = [
  ['',   'Auto-detect'],
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['zh', 'Chinese (Simplified)'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
  ['ru', 'Russian'],
  ['nl', 'Dutch'],
  ['sv', 'Swedish'],
  ['no', 'Norwegian'],
  ['da', 'Danish'],
  ['fi', 'Finnish'],
  ['pl', 'Polish'],
  ['tr', 'Turkish'],
  ['he', 'Hebrew'],
  ['th', 'Thai'],
  ['vi', 'Vietnamese'],
  ['id', 'Indonesian'],
  ['uk', 'Ukrainian'],
];

const TARGET_LANG_CHOICES = [
  ['',   'No translation — keep original'],
  ...ISO_LANG_CHOICES.slice(1),
];

function langName(code) {
  const m = ISO_LANG_CHOICES.find(([c]) => c === code);
  return m ? m[1] : code;
}

function fmtBytes(n) {
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (n >= 1024 * 1024)        return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024)               return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

function fmtDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── openPreTranscribeDialog ──────────────────────────────────────────
// Shown after upload completes, before transcription kicks off.
// Layout: file pills at top → options table → centered TRANSCRIBE.
export function openPreTranscribeDialog({ filename, sizeBytes, durationSeconds, mimeType }) {
  return new Promise((resolve, reject) => {
    document.getElementById('pretranscribe-modal')?.remove();

    const sourceOpts = ISO_LANG_CHOICES
      .map(([code, label]) => `<option value="${code}"${code === '' ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('');
    const targetOpts = TARGET_LANG_CHOICES
      .map(([code, label]) => `<option value="${code}"${code === '' ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('');

    const modal = document.createElement('div');
    modal.id = 'pretranscribe-modal';
    modal.className = 'np-modal';
    modal.innerHTML = `
      <div class="np-modal-backdrop" data-close></div>
      <div class="np-modal-card pretranscribe-card">

        <div class="pretranscribe-eyebrow">step 02 — configure</div>
        <h2 class="pretranscribe-title">Set the language. We'll handle the rest.</h2>
        <p class="pretranscribe-subtitle">A few details so the transcription lands accurately. You can step away once it's running — we'll save your work as it goes.</p>
        <button class="np-modal-close pretranscribe-close" data-close aria-label="Close">×</button>

        <div class="pretranscribe-file">
          <span class="pretranscribe-file-icon" aria-hidden="true">▌</span>
          <span class="pretranscribe-file-name" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
          <span class="pretranscribe-file-pill">${escapeHtml(fmtBytes(sizeBytes))}</span>
          <span class="pretranscribe-file-pill">${escapeHtml(fmtDuration(durationSeconds))}</span>
          <span class="pretranscribe-file-pill pretranscribe-file-pill--muted">${escapeHtml((mimeType || '').replace(/^.+\//, '') || 'media')}</span>
        </div>

        <div class="pretranscribe-table">
          <div class="pretranscribe-th">
            <div>Language</div>
            <div>Speakers</div>
            <div>Translate to</div>
          </div>
          <div class="pretranscribe-tr">
            <div class="pretranscribe-td">
              <select class="np-select" data-source-language>${sourceOpts}</select>
            </div>
            <div class="pretranscribe-td">
              <label class="pretranscribe-toggle">
                <input type="checkbox" data-detect-speakers checked>
                <span class="pretranscribe-toggle-track"></span>
                <span class="pretranscribe-toggle-text">detect change</span>
              </label>
            </div>
            <div class="pretranscribe-td">
              <select class="np-select" data-target-language>${targetOpts}</select>
            </div>
          </div>
        </div>

        <div class="pretranscribe-hints-wrap">
          <div class="pretranscribe-hints-label">Names, jargon, or context <span class="optional-tag">optional</span></div>
          <input type="text" class="pretranscribe-hints" data-prompt
            placeholder="e.g. interview with Shelly Rigger about Taiwan, Kuomintang, Kaohsiung">
          <div class="pretranscribe-hints-tip">A handful of proper nouns goes a long way — Whisper and Deepgram both bias toward them.</div>
        </div>

        <div class="pretranscribe-actions">
          <button class="np-button pretranscribe-cancel" data-cancel>Cancel</button>
          <button class="np-button np-button--primary pretranscribe-go" data-go>
            <span class="pretranscribe-go-arrow" aria-hidden="true">→</span>
            <span>Transcribe</span>
          </button>
        </div>

        <div class="pretranscribe-footnote">
          <span class="pretranscribe-footnote-glyph" aria-hidden="true">∿</span>
          Typically ~10× faster than real-time. A 30-min interview lands in ~3 minutes.
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const dismiss = () => { modal.remove(); reject(new Error('cancelled')); };
    modal.querySelectorAll('[data-close], [data-cancel]').forEach(el => el.addEventListener('click', dismiss));

    // Press Escape to dismiss.
    const onKey = (e) => { if (e.key === 'Escape') { window.removeEventListener('keydown', onKey); dismiss(); } };
    window.addEventListener('keydown', onKey);

    modal.querySelector('[data-go]').addEventListener('click', () => {
      window.removeEventListener('keydown', onKey);
      const sourceLanguage = modal.querySelector('[data-source-language]').value || '';
      const targetLanguage = modal.querySelector('[data-target-language]').value || '';
      const detectSpeakers = modal.querySelector('[data-detect-speakers]').checked;
      const prompt = (modal.querySelector('[data-prompt]').value || '').trim();
      modal.remove();
      resolve({
        sourceLanguage,
        targetLanguage,
        detectSpeakers,
        sourceLanguageLabel: sourceLanguage ? langName(sourceLanguage) : '',
        targetLanguageLabel: targetLanguage ? langName(targetLanguage) : '',
        prompt: prompt || null,
      });
    });
  });
}

// ── openSpeakerLabelDialog ───────────────────────────────────────────
// Shown after transcription returns. One row per detected speaker with
// a sample-audio play button, rename input, and ignore checkbox.
export function openSpeakerLabelDialog({ segments, signedUrl }) {
  return new Promise((resolve, reject) => {
    document.getElementById('speaker-label-modal')?.remove();

    const bySpeaker = new Map();
    for (const seg of segments) {
      if (!bySpeaker.has(seg.speaker)) bySpeaker.set(seg.speaker, []);
      bySpeaker.get(seg.speaker).push(seg);
    }
    const speakers = [...bySpeaker.entries()].map(([name, segs]) => {
      const sample = segs.find(s => (s.text || '').trim().length >= 8) || segs[0];
      const totalSec = segs.reduce((acc, s) => {
        const start = typeof s.startSec === 'number' ? s.startSec : 0;
        const end   = typeof s.endSec   === 'number' ? s.endSec   : start;
        return acc + Math.max(0, end - start);
      }, 0);
      return { name, segs, sample, totalSec };
    });

    if (speakers.length === 0) {
      resolve({ renames: {}, hidden: [] });
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'speaker-label-modal';
    modal.className = 'np-modal';
    modal.innerHTML = `
      <div class="np-modal-backdrop" data-close></div>
      <div class="np-modal-card speaker-label-card">

        <div class="pretranscribe-eyebrow">step 03 — who's talking</div>
        <h2 class="pretranscribe-title">Label the voices.</h2>
        <p class="pretranscribe-subtitle">Click play to hear a few seconds of each speaker, then give them a name. Toggle <em>ignore</em> to drop background voices or crew chatter from the transcript.</p>
        <button class="np-modal-close pretranscribe-close" data-close aria-label="Close">×</button>

        <audio data-shared-audio preload="metadata" src="${escapeHtml(signedUrl)}" style="display:none"></audio>

        <div class="speaker-label-list">
          ${speakers.map((sp, i) => `
            <div class="speaker-label-row" data-speaker="${escapeHtml(sp.name)}">
              <button type="button" class="speaker-sample-btn" data-sample-btn
                data-start="${sp.sample.startSec ?? 0}"
                data-end="${sp.sample.endSec ?? (sp.sample.startSec ?? 0) + 4}"
                aria-label="Play sample">
                <span class="speaker-sample-glyph">▶</span>
              </button>
              <div class="speaker-label-fields">
                <div class="speaker-label-meta">
                  <span class="speaker-label-original">${escapeHtml(sp.name)}</span>
                  <span class="speaker-label-segcount">${sp.segs.length} segment${sp.segs.length !== 1 ? 's' : ''}</span>
                  <span class="speaker-label-segcount">${escapeHtml(fmtDuration(sp.totalSec))}</span>
                </div>
                <input type="text" class="speaker-label-input" data-rename
                  placeholder="Rename to (e.g. ${escapeHtml(i === 0 ? 'Johnny' : i === 1 ? 'Shelly' : 'Guest')})">
                <div class="speaker-label-quote">"${escapeHtml((sp.sample.text || '').slice(0, 200))}${(sp.sample.text || '').length > 200 ? '…' : ''}"</div>
              </div>
              <label class="speaker-label-ignore">
                <input type="checkbox" data-ignore>
                <span>ignore</span>
              </label>
            </div>
          `).join('')}
        </div>

        <div class="speaker-label-actions">
          <button class="np-button" data-skip>Skip — keep all visible</button>
          <button class="np-button np-button--primary" data-done>
            <span class="pretranscribe-go-arrow" aria-hidden="true">→</span>
            <span>Open in editor</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const audio = modal.querySelector('[data-shared-audio]');
    let activePlayBtn = null;
    let pauseTimer = null;

    function stopPlayback() {
      try { audio.pause(); } catch {}
      if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
      if (activePlayBtn) {
        activePlayBtn.querySelector('.speaker-sample-glyph').textContent = '▶';
        activePlayBtn.classList.remove('is-playing');
        activePlayBtn = null;
      }
    }

    modal.querySelectorAll('[data-sample-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (activePlayBtn === btn) { stopPlayback(); return; }
        stopPlayback();
        const start = parseFloat(btn.getAttribute('data-start')) || 0;
        const end = parseFloat(btn.getAttribute('data-end')) || (start + 4);
        const playLen = Math.max(2, Math.min(8, end - start));
        try {
          audio.currentTime = start;
          audio.play().then(() => {
            btn.querySelector('.speaker-sample-glyph').textContent = '◼';
            btn.classList.add('is-playing');
            activePlayBtn = btn;
            pauseTimer = setTimeout(stopPlayback, playLen * 1000);
          }).catch((err) => {
            console.warn('[speaker sample] play failed:', err);
          });
        } catch (err) {
          console.warn('[speaker sample] seek failed:', err);
        }
      });
    });

    function readChoices() {
      const renames = {};
      const hidden = [];
      modal.querySelectorAll('.speaker-label-row').forEach(row => {
        const name = row.dataset.speaker;
        const renamed = (row.querySelector('[data-rename]').value || '').trim();
        const ignore = row.querySelector('[data-ignore]').checked;
        if (ignore) hidden.push(name);
        if (renamed && renamed !== name) renames[name] = renamed;
      });
      return { renames, hidden };
    }

    const dismiss = () => { stopPlayback(); modal.remove(); reject(new Error('cancelled')); };
    modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', dismiss));
    modal.querySelector('[data-skip]').addEventListener('click', () => {
      stopPlayback(); modal.remove(); resolve({ renames: {}, hidden: [] });
    });
    modal.querySelector('[data-done]').addEventListener('click', () => {
      const choices = readChoices();
      stopPlayback(); modal.remove(); resolve(choices);
    });
  });
}
