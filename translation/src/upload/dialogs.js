// Two modal dialogs that bracket the transcription pipeline:
//
//   • openPreTranscribeDialog — shown right after upload completes.
//     Surfaces file stats (filename, size, duration), language pickers
//     (source + optional target translation), and a big TRANSCRIBE
//     button. Resolves with { sourceLanguage, targetLanguage, prompt }.
//
//   • openSpeakerLabelDialog — shown after transcription returns.
//     Lists each detected speaker with an inline audio sample player
//     (plays a few seconds of that speaker's first segment from the
//     same signed URL the editor will use), a label input ("rename to"),
//     and an "ignore this speaker" checkbox. Resolves with
//     { renames: { 'Speaker 1': 'Johnny' }, hidden: ['Speaker 3'] }.
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
  ...ISO_LANG_CHOICES.slice(1), // skip auto-detect for the target
];

function langName(code) {
  const m = ISO_LANG_CHOICES.find(([c]) => c === code);
  return m ? m[1] : code;
}

function fmtBytes(n) {
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (n >= 1024 * 1024)         return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024)                return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

function fmtDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return 'unknown';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
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
export function openPreTranscribeDialog({ filename, sizeBytes, durationSeconds, mimeType }) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('pretranscribe-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'pretranscribe-modal';
    modal.className = 'np-modal';

    const sourceOpts = ISO_LANG_CHOICES
      .map(([code, label]) => `<option value="${code}"${code === '' ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('');
    const targetOpts = TARGET_LANG_CHOICES
      .map(([code, label]) => `<option value="${code}"${code === '' ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('');

    modal.innerHTML = `
      <div class="np-modal-backdrop" data-close></div>
      <div class="np-modal-card pretranscribe-card">
        <div class="np-modal-header">
          <h3 class="np-modal-title">Ready to transcribe</h3>
          <button class="np-modal-close" data-close aria-label="Close">×</button>
        </div>

        <div class="pretranscribe-stats">
          <div class="pretranscribe-stat">
            <div class="pretranscribe-stat-label">file</div>
            <div class="pretranscribe-stat-value" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>
          </div>
          <div class="pretranscribe-stat">
            <div class="pretranscribe-stat-label">size</div>
            <div class="pretranscribe-stat-value">${escapeHtml(fmtBytes(sizeBytes))}</div>
          </div>
          <div class="pretranscribe-stat">
            <div class="pretranscribe-stat-label">duration</div>
            <div class="pretranscribe-stat-value">${escapeHtml(fmtDuration(durationSeconds))}</div>
          </div>
          <div class="pretranscribe-stat">
            <div class="pretranscribe-stat-label">type</div>
            <div class="pretranscribe-stat-value">${escapeHtml(mimeType || 'unknown')}</div>
          </div>
        </div>

        <div class="pretranscribe-fields">
          <label class="pretranscribe-field">
            <span class="pretranscribe-field-label">What language is this?</span>
            <select class="np-select pretranscribe-select" data-source-language>${sourceOpts}</select>
          </label>

          <label class="pretranscribe-field">
            <span class="pretranscribe-field-label">Translate it into another language?</span>
            <select class="np-select pretranscribe-select" data-target-language>${targetOpts}</select>
          </label>

          <label class="pretranscribe-field">
            <span class="pretranscribe-field-label">Names, jargon, or context to help accuracy <span class="optional-tag">(optional)</span></span>
            <input type="text" class="np-textarea pretranscribe-input" data-prompt
              placeholder="e.g. interview with Shelly Rigger about Taiwan, Kaohsiung, Kuomintang">
          </label>
        </div>

        <div class="pretranscribe-actions">
          <button class="np-button" data-cancel>Cancel</button>
          <button class="np-button np-button--primary pretranscribe-go" data-go>TRANSCRIBE</button>
        </div>

        <div class="pretranscribe-footnote">
          Transcription typically takes ~10× faster than real-time. A 30-min interview lands in 2–4 minutes.
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const dismiss = () => { modal.remove(); reject(new Error('cancelled')); };
    modal.querySelectorAll('[data-close], [data-cancel]').forEach(el => el.addEventListener('click', dismiss));

    modal.querySelector('[data-go]').addEventListener('click', () => {
      const sourceLanguage = modal.querySelector('[data-source-language]').value || '';
      const targetLanguage = modal.querySelector('[data-target-language]').value || '';
      const prompt = (modal.querySelector('[data-prompt]').value || '').trim();
      modal.remove();
      resolve({
        sourceLanguage,
        targetLanguage,
        sourceLanguageLabel: sourceLanguage ? langName(sourceLanguage) : '',
        targetLanguageLabel: targetLanguage ? langName(targetLanguage) : '',
        prompt: prompt || null,
      });
    });
  });
}

// ── openSpeakerLabelDialog ───────────────────────────────────────────
export function openSpeakerLabelDialog({ segments, signedUrl }) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('speaker-label-modal');
    if (existing) existing.remove();

    // Group segments by speaker, capturing the FIRST segment with non-trivial
    // text (>= 8 chars) as the audio sample anchor. Falls back to the very
    // first segment if nothing else is long enough.
    const bySpeaker = new Map();
    for (const seg of segments) {
      if (!bySpeaker.has(seg.speaker)) bySpeaker.set(seg.speaker, []);
      bySpeaker.get(seg.speaker).push(seg);
    }
    const speakers = [...bySpeaker.entries()].map(([name, segs]) => {
      const sample = segs.find(s => (s.text || '').trim().length >= 8) || segs[0];
      return { name, segs, sample };
    });

    // Skip the dialog entirely if there are zero speakers (nothing to label).
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
        <div class="np-modal-header">
          <h3 class="np-modal-title">Who's talking?</h3>
          <button class="np-modal-close" data-close aria-label="Close">×</button>
        </div>
        <p class="speaker-label-intro">
          Click play on each speaker to hear a sample, then type their name. Toggle <em>ignore</em> to drop a speaker (background voices, crew chatter) from the transcript.
        </p>

        <audio data-shared-audio preload="metadata" src="${escapeHtml(signedUrl)}" style="display:none"></audio>

        <div class="speaker-label-list">
          ${speakers.map((sp, i) => `
            <div class="speaker-label-row" data-speaker="${escapeHtml(sp.name)}">
              <button type="button" class="speaker-sample-btn" data-sample-btn
                data-start="${sp.sample.startSec ?? 0}"
                data-end="${sp.sample.endSec ?? (sp.sample.startSec ?? 0) + 4}"
                aria-label="Play sample">▶</button>
              <div class="speaker-label-fields">
                <div class="speaker-label-original">${escapeHtml(sp.name)} <span class="speaker-label-segcount">${sp.segs.length} segment${sp.segs.length !== 1 ? 's' : ''}</span></div>
                <input type="text" class="speaker-label-input" data-rename
                  placeholder="${escapeHtml(`Rename to (e.g. ${i === 0 ? 'Johnny' : 'Shelly'})`)}">
                <div class="speaker-label-quote">${escapeHtml((sp.sample.text || '').slice(0, 160))}${(sp.sample.text || '').length > 160 ? '…' : ''}</div>
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
          <button class="np-button np-button--primary" data-done>Continue to editor →</button>
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
        activePlayBtn.textContent = '▶';
        activePlayBtn.classList.remove('is-playing');
        activePlayBtn = null;
      }
    }

    modal.querySelectorAll('[data-sample-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        // Toggle off if this button is already playing.
        if (activePlayBtn === btn) { stopPlayback(); return; }
        stopPlayback();
        const start = parseFloat(btn.getAttribute('data-start')) || 0;
        const end = parseFloat(btn.getAttribute('data-end')) || (start + 4);
        const playLen = Math.max(1, Math.min(8, end - start));
        try {
          audio.currentTime = start;
          audio.play().then(() => {
            btn.textContent = '❚❚';
            btn.classList.add('is-playing');
            activePlayBtn = btn;
            // Auto-stop at the end of the sample window.
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
