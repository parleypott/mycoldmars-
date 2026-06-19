// Single source of truth for building a Gemini `contents` array from a chat
// history + a new user message.
//
// Gemini requires a multi-turn request to BEGIN with a `user` turn — a contents
// array whose first element has role 'model' is rejected ("First content should
// be with role 'user'"). A loaded / seeded history that opens on an assistant
// turn (seeded greetings are a near-universal chat-UI pattern), or any short
// slice window that happens to begin on a model turn, can leave a leading model
// turn. So drop leading model turns before returning. The appended user message
// guarantees at least one user turn always exists, so an all-model window
// collapses cleanly to just that message.
//
// Extracted to consolidate the previously-divergent inline copies in
// api/cutter.js (window 12) and api/gemini.js handleChat + handleScriptChat
// (window 10) — all three now share this builder.
export function buildGeminiChatContents(history, message, { window = 12 } = {}) {
  const windowed = (Array.isArray(history) ? history : []).slice(-window).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  while (windowed.length && windowed[0].role === 'model') windowed.shift();

  windowed.push({ role: 'user', parts: [{ text: message }] });
  return windowed;
}
