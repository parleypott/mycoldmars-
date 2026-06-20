// Shared normalizer for the Anthropic Messages API `messages` array.
//
// The Anthropic Messages API enforces two structural rules that a naively-built
// chat history can violate:
//   1. The FIRST message must use the `user` role. A request whose first
//      message is `assistant` is rejected with a 400
//      ("messages: first message must use the \"user\" role"). This bites
//      whenever a chat history opens on a seeded assistant greeting, or a
//      sliced recent-history window happens to start on an assistant turn.
//   2. Turns must keep the user/assistant structure. Depending on the model,
//      the API either MERGES consecutive same-role turns into one or REJECTS
//      them with a 400 ("roles must alternate ...").
//
// `normalizeAnthropicMessages` makes an assembled array safe under BOTH
// behaviors, so it can only ever FIX a 400 — never introduce one:
//   - drops any leading non-`user` turns so the array always begins with a
//     `user` turn (the same move the shared Gemini contents builder makes);
//   - merges consecutive same-role string turns into one (joining the text
//     with a blank line). Merging is idempotent with the API's own merge, and
//     prevents a 400 if the model enforces strict alternation. No words are
//     lost — the merged turn carries every turn's text.
//   - drops empty/whitespace-only string turns (the API also rejects an empty
//     content turn) and non-{user,assistant} entries.
//
// An already-valid, alternating, user-first array of non-empty string turns is
// returned byte-equivalent (same roles, same content) — so wiring this in front
// of a working call site is behavior-preserving for the common case.
//
// Non-string content (e.g. multimodal content-block arrays) is preserved as-is
// and never merged across, so block content can't be corrupted by string-join.

function isChatTurn(m) {
  return (
    m &&
    (m.role === 'user' || m.role === 'assistant') &&
    m.content != null &&
    (typeof m.content !== 'string' || m.content.trim() !== '')
  );
}

export function normalizeAnthropicMessages(messages) {
  if (!Array.isArray(messages)) return [];

  const cleaned = messages.filter(isChatTurn);

  // Drop leading non-user turns so the array begins on a `user` turn.
  let start = 0;
  while (start < cleaned.length && cleaned[start].role !== 'user') start++;

  const out = [];
  for (const m of cleaned.slice(start)) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.role === m.role &&
      typeof prev.content === 'string' &&
      typeof m.content === 'string'
    ) {
      prev.content = `${prev.content}\n\n${m.content}`;
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}
