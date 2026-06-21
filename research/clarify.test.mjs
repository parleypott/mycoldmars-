// Tests for the research clarifier panel renderer (research/clarify.js).
// Imports the REAL shipped functions. Locks the XSS attribute-breakout fix:
// model-generated example chips and question ids must be escaped so a quote in
// them can't break out of the placeholder/data-qid attribute and inject a
// handler — the same class fixed in md.js, in this sibling render path.

import { renderClarifyPanel, escAttr } from "./clarify.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

// --- inline RED proof: reconstruct the OLD inline template (raw qid + placeholder) ---
const escapeHtmlOld = (s) => (s ?? "").toString()
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function oldRender(summary, questions) {
  return `
      <div class="clarify-head">
        <div class="clarify-eyebrow">scope · before we dispatch</div>
        <div class="clarify-summary">${escapeHtmlOld(summary)}</div>
      </div>
      <div class="clarify-questions">
        ${questions.map((q, i) => `
          <div class="clarify-q">
            <label class="clarify-q-label">${escapeHtmlOld(q.question)}</label>
            <input class="clarify-q-input" data-qid="${q.id ?? `q${i}`}" data-question="${escapeHtmlOld(q.question)}" placeholder="${(q.examples ?? []).join(' · ') || 'optional'}" autocomplete="off" spellcheck="false" />
          </div>
        `).join("")}
      </div>
      <div class="clarify-actions">
        <button id="clarify-skip" class="ghost-btn">skip — just research it</button>
        <button id="clarify-go" class="primary-btn">dispatch with my answers →</button>
      </div>
    `;
}

// A placeholder that breaks out of the double-quoted placeholder attr + injects a handler.
const evilExamples = ['x" onmouseover="alert(1)'];
const evilId = 'q" onfocus="alert(2)';

// RED proof: the OLD render LEAKS the breakout for both examples and id.
t("RED proof: old render leaks an example-chip attribute breakout", () => {
  const html = oldRender("s", [{ question: "Q?", examples: evilExamples }]);
  assert.ok(html.includes('onmouseover="alert(1)'), "old render should contain the raw injected handler");
});
t("RED proof: old render leaks a question-id attribute breakout", () => {
  const html = oldRender("s", [{ question: "Q?", id: evilId }]);
  assert.ok(html.includes('onfocus="alert(2)'), "old render should contain the raw injected id handler");
});

// --- the fix: shipped renderer neutralizes both ---
t("example-chip breakout is escaped (no live handler)", () => {
  const html = renderClarifyPanel("s", [{ question: "Q?", examples: evilExamples }]);
  assert.ok(!html.includes('onmouseover="alert(1)'), "must not contain a live onmouseover handler");
  assert.ok(html.includes("&quot;"), "the breakout quote must be entity-escaped");
  assert.ok(html.includes("onmouseover=&quot;alert(1)"), "handler text must be inert (quote escaped)");
});
t("question-id breakout is escaped (no live handler)", () => {
  const html = renderClarifyPanel("s", [{ question: "Q?", id: evilId }]);
  assert.ok(!html.includes('onfocus="alert(2)'), "must not contain a live onfocus handler");
  assert.ok(html.includes("onfocus=&quot;alert(2)"), "handler text must be inert");
});
t("summary breakout is escaped", () => {
  const html = renderClarifyPanel('s"><img src=x onerror="alert(3)', []);
  assert.ok(!html.includes("<img src=x"), "raw img tag must not survive");
  assert.ok(html.includes("&lt;img"), "tag must be entity-escaped");
});
t("question text breakout is escaped", () => {
  const html = renderClarifyPanel("s", [{ question: '<script>alert(4)</script>' }]);
  assert.ok(!html.includes("<script>alert(4)"), "raw script must not survive");
  assert.ok(html.includes("&lt;script&gt;"), "script tag must be escaped");
});

// hard invariant: across hostile shapes, no attribute string ever has a raw "
// double-quote immediately followed by an injected event-handler token.
t("hard invariant: no attribute breakout across hostile inputs", () => {
  const inputs = [
    { question: 'a" onclick="x', id: 'b" onload="y', examples: ['c" onpointerdown="z'] },
    { question: 'name with "quotes"', id: 'id"with"quotes', examples: ['ex"1', 'ex"2'] },
  ];
  const html = renderClarifyPanel('summary "quoted"', inputs);
  for (const evt of ["onclick", "onload", "onpointerdown", "onmouseover", "onerror", "onfocus"]) {
    assert.ok(!new RegExp(`"\\s+${evt}=`).test(html), `must not break out into ${evt}`);
  }
});

// --- no-regression: byte-identical to the OLD render for SAFE inputs ---
const safe = [
  { question: "What region are you focused on?", id: "region", examples: ["EU", "US", "APAC"] },
  { question: "What time horizon?", id: "horizon", examples: [] },
  { question: "Any sources to prioritise?" }, // no id, no examples
];
t("no-regression: byte-identical to old render for safe inputs", () => {
  const a = renderClarifyPanel("Sharpening the scope of your question.", safe);
  const b = oldRender("Sharpening the scope of your question.", safe);
  assert.strictEqual(a, b, "safe-input output must match the old template byte-for-byte");
});
t("no-regression: empty questions byte-identical", () => {
  assert.strictEqual(renderClarifyPanel("just a summary", []), oldRender("just a summary", []));
});
t("no-regression: empty examples falls back to 'optional'", () => {
  const html = renderClarifyPanel("s", [{ question: "Q?", id: "x", examples: [] }]);
  assert.ok(html.includes('placeholder="optional"'), "empty examples must render placeholder=optional");
});
t("no-regression: missing examples falls back to 'optional'", () => {
  const html = renderClarifyPanel("s", [{ question: "Q?", id: "x" }]);
  assert.ok(html.includes('placeholder="optional"'), "missing examples must render placeholder=optional");
});
t("no-regression: default qid q<i> when id absent", () => {
  const html = renderClarifyPanel("s", [{ question: "A" }, { question: "B" }]);
  assert.ok(html.includes('data-qid="q0"') && html.includes('data-qid="q1"'), "absent id -> q0/q1");
});
t("examples joined with ' · '", () => {
  const html = renderClarifyPanel("s", [{ question: "Q?", examples: ["one", "two"] }]);
  assert.ok(html.includes('placeholder="one · two"'), "examples joined with ' · '");
});

// --- robustness ---
t("non-array questions -> head/actions only, no throw", () => {
  const html = renderClarifyPanel("s", null);
  assert.ok(html.includes("clarify-head") && html.includes("clarify-actions"));
  assert.ok(!html.includes("clarify-q-input"), "no inputs for non-array questions");
});
t("null/undefined summary -> empty, no throw", () => {
  assert.ok(renderClarifyPanel(null, []).includes('class="clarify-summary"'));
  assert.ok(renderClarifyPanel(undefined, []).includes('class="clarify-summary"'));
});
t("question object missing fields -> no throw", () => {
  const html = renderClarifyPanel("s", [{}, { examples: ["e"] }]);
  assert.ok(html.includes("clarify-q-input"));
});

// --- escAttr unit ---
t("escAttr escapes the 4 attribute-relevant entities", () => {
  assert.strictEqual(escAttr('&<>"'), "&amp;&lt;&gt;&quot;");
});
t("escAttr ampersand-first (no double-escape)", () => {
  assert.strictEqual(escAttr("a&b"), "a&amp;b");
  assert.strictEqual(escAttr("&lt;"), "&amp;lt;");
});
t("escAttr null/undefined/number -> string", () => {
  assert.strictEqual(escAttr(null), "");
  assert.strictEqual(escAttr(undefined), "");
  assert.strictEqual(escAttr(0), "0");
});
t("escAttr leaves single quote (double-quoted attrs only)", () => {
  assert.strictEqual(escAttr("Henry's"), "Henry's");
});

console.log(`\nclarify.test.mjs: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
