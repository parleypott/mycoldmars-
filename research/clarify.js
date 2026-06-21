// Pure, XSS-safe renderer for the research clarifier panel.
//
// The clarifier questions come from the research-clarify LLM (Claude), driven
// by the user's own prompt — model output, the least-trusted content here.
// Its output (summary, question text, example chips, question id) is assigned
// straight into panel.innerHTML, so EVERY interpolation must be escaped or a
// quote in an example/id breaks out of its attribute and injects a handler.
// This is the same attribute-breakout class fixed in md.js's link transform —
// this sibling render path was the surviving copy.

// Escape for double-quoted HTML attributes AND text. Matches app.js escapeHtml
// (& < > "), which is what q.question already shipped with, so output is
// byte-identical for safe inputs; sufficient because every attribute here is
// double-quoted.
export function escAttr(s) {
  return (s ?? "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Build the inner HTML for the clarifier panel. Pure string -> string.
export function renderClarifyPanel(summary, questions) {
  const qs = Array.isArray(questions) ? questions : [];
  return `
      <div class="clarify-head">
        <div class="clarify-eyebrow">scope · before we dispatch</div>
        <div class="clarify-summary">${escAttr(summary)}</div>
      </div>
      <div class="clarify-questions">
        ${qs
          .map((q, i) => {
            const placeholder = (q?.examples ?? []).join(" · ") || "optional";
            return `
          <div class="clarify-q">
            <label class="clarify-q-label">${escAttr(q?.question)}</label>
            <input class="clarify-q-input" data-qid="${escAttr(q?.id ?? `q${i}`)}" data-question="${escAttr(q?.question)}" placeholder="${escAttr(placeholder)}" autocomplete="off" spellcheck="false" />
          </div>
        `;
          })
          .join("")}
      </div>
      <div class="clarify-actions">
        <button id="clarify-skip" class="ghost-btn">skip — just research it</button>
        <button id="clarify-go" class="primary-btn">dispatch with my answers →</button>
      </div>
    `;
}
