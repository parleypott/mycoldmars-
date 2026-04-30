/**
 * Floating "chatty" loader. Sits in the bottom-right of the page, pulses,
 * and rotates through phrases every ~5s while any loader is active.
 *
 * Usage:
 *   const id = chattyStart('workshop-process', WORKSHOP_PROCESSING_PHRASES, { progress: 0 });
 *   chattyUpdate(id, { progress: 0.4 });
 *   chattyEnd(id);
 *
 * If multiple loaders are active, the toast cycles through one phrase from
 * each, so the user sees a quick montage of what's happening.
 */

const ROTATE_MS = 5000;

const loaders = new Map(); // id → { phrases, progress, phraseIdx }
let toastEl = null;
let textEl = null;
let progressEl = null;
let rotateTimer = null;
let cursor = 0;

function ensureToast() {
  if (toastEl) return;
  toastEl = document.createElement('div');
  toastEl.className = 'chatty-toast hidden';
  toastEl.innerHTML = `
    <span class="chatty-dot"></span>
    <span class="chatty-text"></span>
    <div class="chatty-progress"><div class="chatty-progress-fill"></div></div>
  `;
  document.body.appendChild(toastEl);
  textEl = toastEl.querySelector('.chatty-text');
  progressEl = toastEl.querySelector('.chatty-progress-fill');
}

function rotate() {
  if (loaders.size === 0) {
    hideToast();
    return;
  }
  ensureToast();
  toastEl.classList.remove('hidden');
  // Pick the next loader in rotation, advance its phrase.
  const ids = Array.from(loaders.keys());
  cursor = cursor % ids.length;
  const id = ids[cursor];
  cursor = (cursor + 1) % ids.length;
  const loader = loaders.get(id);
  loader.phraseIdx = (loader.phraseIdx + 1) % loader.phrases.length;
  setText(loader.phrases[loader.phraseIdx]);
  updateProgressBar();
}

function setText(text) {
  if (!textEl) return;
  textEl.classList.remove('show');
  // Fade out, swap, fade back in
  setTimeout(() => {
    textEl.textContent = text;
    textEl.classList.add('show');
  }, 150);
}

function updateProgressBar() {
  if (!progressEl) return;
  // Show the highest known progress across active loaders (so a single chunk
  // bar still makes sense even if multiple loaders are stacked).
  let max = -1;
  for (const l of loaders.values()) {
    if (typeof l.progress === 'number' && l.progress > max) max = l.progress;
  }
  if (max < 0) {
    progressEl.parentElement.style.display = 'none';
  } else {
    progressEl.parentElement.style.display = '';
    progressEl.style.width = Math.max(0, Math.min(1, max)) * 100 + '%';
  }
}

function hideToast() {
  if (!toastEl) return;
  toastEl.classList.add('hidden');
  if (rotateTimer) {
    clearInterval(rotateTimer);
    rotateTimer = null;
  }
}

export function chattyStart(id, phrases, opts = {}) {
  if (!phrases || phrases.length === 0) phrases = ['Working on it...'];
  loaders.set(id, {
    phrases,
    progress: typeof opts.progress === 'number' ? opts.progress : null,
    phraseIdx: 0,
  });
  ensureToast();
  toastEl.classList.remove('hidden');
  setText(phrases[0]);
  updateProgressBar();
  if (!rotateTimer) rotateTimer = setInterval(rotate, ROTATE_MS);
  return id;
}

export function chattyUpdate(id, opts = {}) {
  const loader = loaders.get(id);
  if (!loader) return;
  if (typeof opts.progress === 'number') loader.progress = opts.progress;
  updateProgressBar();
}

export function chattyEnd(id) {
  loaders.delete(id);
  if (loaders.size === 0) hideToast();
}

// ── Phrase banks ──

export const SUMMARY_PHRASES = [
  "Reading every word your subjects said...",
  "This is the part where the AI earns its keep — hold tight",
  "Untangling who said what, when, and why",
  "Honestly wild this all happens in your browser",
  "Hunting for the throughline of the interview",
  "Big interview, big context. Nearly there.",
  "Trying to figure out what they actually meant",
  "Did you know we built this in like a week with no real coding",
  "Compressing two hours into something readable",
];

export const THEME_DETECT_PHRASES = [
  "Looking for the recurring threads...",
  "Themes are a vibe — give it a sec to feel them out",
  "Sifting for the patterns that keep coming back",
  "Trying to find the lens you'll want to organize around",
  "What does this interview keep returning to?",
  "Hunting for buckets the editor will actually want to use",
  "Yes this is just an LLM call. Yes it still feels magical.",
];

export const WORKSHOP_PROCESS_PHRASES = [
  "Reading the whole transcript, theme by theme...",
  "Picking out the punchy bits — this is the slow part",
  "Multi-labeling each quote across the themes you set",
  "Crazy that this used to take editors weeks. Anyway.",
  "Running chunks in parallel. Still, transcripts are long.",
  "Most segments aren't soundbites — being selective",
  "Hold tight — quality over speed",
  "If you've got 2000 segments, this is genuinely a lot of work",
  "It's an LLM. It's reading. It's reading every word.",
];
