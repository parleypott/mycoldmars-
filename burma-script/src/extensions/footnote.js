// FACT-CHECK FOOTNOTE — the receipt that rides beside a verified fact.
//
// The {fc}/{TK} chips are the CLAIMS — they stay live and clickable forever (lineage law:
// never bake a marker into plain text). This node is the separate RECEIPT: a small green
// circle-check icon pinned inline right after the asserted fact. Click it and a comment
// card flies out — Google-Docs-margin style — holding the fact-check CONTEXT and the
// SOURCE, both editable in place. It is an inline ATOM: the note/source/claim live in node
// attrs, so they travel with the doc through autosave, cloud snapshots, IndexedDB recovery,
// Yjs collab, and copy/paste — no side table, nothing to desync.
//
// EXPORT LAW — docToBlocks() serializes the footnote as a `{fn <note> || <source>}` token
// (document-builder nodeText), and inlineContent() parses that token back into a real
// fcFootnote node. So even the derived blocks view never silently drops the writer's
// fact-check words — the one export/rebuild round-trip keeps note + source intact.
//
// Born from the Workshop dock's CREATE FOOTNOTE button (Editor.jsx 'wp-create-footnote'
// listener, stale-range-guarded like every Workshop insert) or auto-attached when a
// researched option / suggested edit replaces a marker (lineage rides along).

import { Node, mergeAttributes } from '@tiptap/core';
import { isReadOnly } from '../read-mode.js';
import { getEpisode } from '../episode-config.js';

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

export function mintNoteId() {
  return 'fn_' + Math.random().toString(36).slice(2, 9);
}

// ── the fly-out comment card (one live instance) ────────────────────────────────────────────
// Fixed-position card near the clicked icon, clamped to the viewport, closed on Escape /
// click-away / scroll — the same calm floating discipline as the slash / convert menus.
// Edits debounce into ONE setNodeMarkup per pause (500ms), with a hard flush on close, so
// the doc always holds the latest words and the history isn't shredded per keystroke.
let openPanel = null;
export function closeOpenFootnotePanel() {
  if (openPanel) { openPanel.close(); openPanel = null; }
}

function createFootnotePanel(editor, getPos, iconDom) {
  const readOnly = isReadOnly();
  const panel = el('div', 'wp-fnote-panel', { contenteditable: 'false', role: 'dialog', 'aria-label': 'fact-check footnote' });

  const liveAttrs = () => {
    const pos = typeof getPos === 'function' ? getPos() : getPos;
    if (typeof pos !== 'number') return null;
    const node = editor.state.doc.nodeAt(pos);
    return node && node.type.name === 'fcFootnote' ? node.attrs : null;
  };
  const attrs0 = liveAttrs() || {};

  let onDocDown = null;
  let onKey = null;
  let onScroll = null;
  let saveTimer = null;
  const pending = {};

  const flush = () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!Object.keys(pending).length) return;
    const pos = typeof getPos === 'function' ? getPos() : getPos;
    if (typeof pos !== 'number') return;
    const cur = editor.state.doc.nodeAt(pos);
    if (!cur || cur.type.name !== 'fcFootnote') return;
    if (editor.view.editable === false) return; // READ MODE: fly-out edits are writes
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...pending }),
    );
    for (const k in pending) delete pending[k];
  };
  const queueSave = (patch) => {
    Object.assign(pending, patch);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 500);
  };

  // DURABLE TEARDOWN FLUSH (audit 2026-07-07, HIGH data-loss): the debounced save only
  // commits to the doc on the 500ms timer or on close(). A hard reload / tab-close never
  // calls close(), so anything typed in the trailing window was lost — the same class of
  // bug the Editor's pagehide flush fixes. pending{} holds the latest textarea values
  // synchronously (queueSave assigns immediately; the timer only defers the dispatch), so a
  // synchronous flush here captures everything. Both events fire reliably before teardown.
  const onTeardown = () => { try { flush(); } catch {} };
  const onVis = () => { if (document.visibilityState === 'hidden') onTeardown(); };
  window.addEventListener('pagehide', onTeardown);
  window.addEventListener('beforeunload', onTeardown);
  document.addEventListener('visibilitychange', onVis);

  const close = () => {
    if (!panel.parentNode) return;
    flush(); // never lose in-flight words
    window.removeEventListener('pagehide', onTeardown);
    window.removeEventListener('beforeunload', onTeardown);
    document.removeEventListener('visibilitychange', onVis);
    if (onDocDown) document.removeEventListener('mousedown', onDocDown, true);
    if (onKey) document.removeEventListener('keydown', onKey, true);
    if (onScroll) {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    }
    panel.remove();
  };

  // HEAD — green check identity + close
  const head = el('div', 'wp-fnote-head');
  const badge = el('span', 'wp-fnote-badge');
  const paintBadge = (status) => {
    badge.textContent = status === 'needed' ? '▪ FACT CHECK — TO DO' : '✓ FACT CHECK';
    badge.classList.toggle('is-needed', status === 'needed');
  };
  paintBadge(attrs0.status || '');
  head.appendChild(badge);
  const closeBtn = el('button', 'wp-fnote-close', { type: 'button', title: 'Close' });
  closeBtn.textContent = '×';
  closeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); close(); openPanel = null; });
  head.appendChild(closeBtn);
  panel.appendChild(head);

  // THE CLAIM — the original marker text, quiet + read-only (the lineage line)
  if (attrs0.marker) {
    const claim = el('div', 'wp-fnote-claim');
    claim.textContent = attrs0.marker;
    panel.appendChild(claim);
  }

  // ── STATUS ROW (Johnny 2026-07-07): three squares that set the CLAIM SPAN's state —
  // red = uncheck / work-in-progress, yellow = feels solid but not fully checked,
  // green ✓ = verified. The span's wash + end-of-run flag follow (marks.js/styles.css).
  // The row only renders when a factCheckSpan run sits right before this ✓ atom.
  const fcMarkType = editor.state.schema.marks.factCheckSpan;
  const adjacentClaimRun = () => {
    try {
      const pos = typeof getPos === 'function' ? getPos() : getPos;
      if (typeof pos !== 'number' || !fcMarkType) return null;
      const $pos = editor.state.doc.resolve(pos);
      const parent = $pos.parent;
      const start = $pos.start();
      const frags = [];
      parent.forEach((child, offset) => {
        const cFrom = start + offset;
        frags.push({
          from: cFrom, to: cFrom + child.nodeSize,
          hasMark: child.isText && child.marks.some((m) => m.type === fcMarkType),
          status: child.isText ? (child.marks.find((m) => m.type === fcMarkType)?.attrs?.status || 'pending') : null,
        });
      });
      let i = frags.findIndex((f) => f.to === pos && f.hasMark);
      if (i < 0) return null;
      let from = frags[i].from;
      const to = frags[i].to;
      const status = frags[i].status;
      while (i > 0 && frags[i - 1].hasMark && frags[i - 1].to === from) { i--; from = frags[i].from; }
      return { from, to, status };
    } catch { return null; }
  };
  const claimRun0 = adjacentClaimRun();
  if (!readOnly && claimRun0) {
    const stLabel = el('label', 'wp-fnote-label');
    stLabel.textContent = 'Status';
    panel.appendChild(stLabel);
    const stRow = el('div', 'wp-fnote-status-row');
    const states = [
      ['pending', 'not checked yet — back to work-in-progress', ''],
      ['solid', 'feels solid — not fully checked', ''],
      ['checked', 'verified', '✓'],
    ];
    const btns = [];
    const paintStatus = (active) => btns.forEach((b) => b.classList.toggle('is-active', b.dataset.status === active));
    for (const [status, title, glyph] of states) {
      const b = el('button', 'wp-fnote-status-btn', { type: 'button', title });
      b.dataset.status = status;
      b.textContent = glyph;
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (editor.view.editable === false) return; // READ MODE: status flip is a write
        const run = adjacentClaimRun();
        if (!run) return;
        editor.view.dispatch(
          editor.state.tr.addMark(run.from, run.to, fcMarkType.create({ status })).setMeta('addToHistory', true),
        );
        paintStatus(status);
      });
      btns.push(b);
      stRow.appendChild(b);
    }
    paintStatus(claimRun0.status || 'pending');
    panel.appendChild(stRow);
  } else if (!readOnly && !claimRun0) {
    // STANDALONE /footnote — no claim span to grade, so the footnote carries its OWN state.
    // One toggle: RED "needs check" ⇄ GREEN "checked". Flipping it saves the node's status attr
    // (queueSave → setNodeMarkup), which the NodeView.update repaints into the red-square/green
    // icon live. This is what turns a fresh red /footnote green once Johnny has vetted it.
    const stLabel = el('label', 'wp-fnote-label');
    stLabel.textContent = 'Status';
    panel.appendChild(stLabel);
    const stRow = el('div', 'wp-fnote-status-row');
    // Button tokens 'needed'/'checked' reuse the existing red/green status-btn styles; the NODE
    // attr they write is 'needed' or '' (green). Kept off the empty-string attr selector on purpose.
    const states = [['needed', 'still checking — red', '▪'], ['checked', 'checked — green', '✓']];
    const nodeStatusOf = (btnStatus) => (btnStatus === 'checked' ? '' : 'needed');
    const btnStatusOf = (nodeStatus) => (nodeStatus === 'needed' ? 'needed' : 'checked');
    const btns = [];
    const paint = (activeBtn) => btns.forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-status') === activeBtn));
    for (const [btnStatus, title, glyph] of states) {
      const b = el('button', 'wp-fnote-status-btn', { type: 'button', title, 'data-status': btnStatus });
      b.textContent = glyph;
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (editor.view.editable === false) return; // READ MODE: status flip is a write
        const nodeStatus = nodeStatusOf(btnStatus);
        queueSave({ status: nodeStatus });
        flush();               // commit now so the icon flips immediately
        paint(btnStatus);
        paintBadge(nodeStatus);
      });
      btns.push(b);
      stRow.appendChild(b);
    }
    paint(btnStatusOf(attrs0.status || ''));
    panel.appendChild(stRow);
  }

  // ── THE BLURB (Johnny 2026-07-07: no CONTEXT box) — the verbatim quote from the source is
  // the main content (RECHECK's quote-hunt writes it here). Reads as a quote; DOUBLE-CLICK
  // to edit in place; Escape cancels, blur/Cmd-Enter commits. Same debounced note attr.
  let noteValue = String(attrs0.note || '');
  const blurb = el('div', 'wp-fnote-blurb', { title: readOnly ? '' : 'double-click to edit' });
  const noteEd = el('textarea', 'wp-fnote-text wp-fnote-blurb-ed', { rows: '4' });
  noteEd.hidden = true;
  const renderBlurb = () => {
    blurb.textContent = noteValue || 'no quote pulled yet — hit RECHECK to fish one from the sources';
    blurb.classList.toggle('is-empty', !noteValue);
  };
  renderBlurb();
  if (!readOnly) {
    blurb.addEventListener('dblclick', (e) => {
      e.preventDefault();
      noteEd.value = noteValue;
      blurb.hidden = true;
      noteEd.hidden = false;
      noteEd.focus();
    });
    const commitBlurb = () => {
      noteValue = noteEd.value;
      queueSave({ note: noteValue });
      noteEd.hidden = true;
      blurb.hidden = false;
      renderBlurb();
    };
    noteEd.addEventListener('blur', () => { if (!noteEd.hidden) commitBlurb(); });
    noteEd.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitBlurb(); }
      if (e.key === 'Escape') { e.preventDefault(); noteEd.hidden = true; blurb.hidden = false; }
    });
  }
  panel.appendChild(blurb);
  panel.appendChild(noteEd);

  // ── SOURCES — hyperlinks first (click straight through); the raw textarea hides behind a
  // small "edit sources" toggle so adding/pruning sources stays possible without clutter.
  const srcLabel = el('label', 'wp-fnote-label');
  srcLabel.textContent = 'Sources';
  panel.appendChild(srcLabel);
  const links = el('div', 'wp-fnote-links');
  panel.appendChild(links);
  const src = el('textarea', 'wp-fnote-text wp-fnote-src', { rows: '2', placeholder: 'one link or citation per line' });
  src.value = attrs0.source || '';
  src.hidden = true;
  if (readOnly) src.setAttribute('disabled', '');
  src.addEventListener('input', () => { queueSave({ source: src.value }); renderLinks(); });
  const renderLinks = () => {
    links.textContent = '';
    const urls = String(src.value || '').match(/https?:\/\/\S+/g) || [];
    urls.slice(0, 6).forEach((u) => {
      const a = el('a', 'wp-fnote-link', { href: u, target: '_blank', rel: 'noopener noreferrer' });
      a.textContent = u.replace(/^https?:\/\//, '').slice(0, 46);
      links.appendChild(a);
    });
    if (!urls.length) {
      const none = el('span', 'wp-fnote-nolinks');
      none.textContent = 'no sources yet';
      links.appendChild(none);
    }
  };
  renderLinks();
  if (!readOnly) {
    const srcToggle = el('button', 'wp-fnote-src-toggle', { type: 'button', title: 'add or edit the source list' });
    srcToggle.textContent = 'edit sources';
    srcToggle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      src.hidden = !src.hidden;
      srcToggle.textContent = src.hidden ? 'edit sources' : 'done';
      if (!src.hidden) src.focus();
    });
    panel.appendChild(srcToggle);
  }
  panel.appendChild(src);

  // RECHECK — run a fresh source-hunt for the SPECIFIC quotation that checks this fact
  // (Johnny: "a button that says recheck which runs a new fact check to find the specific
  // quotation or blurb from the sources"). Calls the shared tk backend in mode:'quote';
  // the verbatim quotes land in the Context field (editable as ever) and any new URLs
  // append to Source. Same hard client timeout discipline as the Workshop dock.
  if (!readOnly) {
    const reRow = el('div', 'wp-fnote-recheck-row');
    const reBtn = el('button', 'wp-fnote-recheck', { type: 'button', title: 'Find the exact quote from the sources that checks this fact' });
    reBtn.textContent = 'RECHECK';
    const reErr = el('div', 'wp-fnote-recheck-err');
    let checking = false;
    reBtn.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      if (checking) return;
      const attrs = liveAttrs() || {};
      // The claim: the stored marker (lineage) first; else whatever prose precedes the icon
      // in its paragraph — enough for the checker to know what fact it's chasing.
      let claim = String(attrs.marker || '').trim();
      let blockText = '';
      const pos = typeof getPos === 'function' ? getPos() : getPos;
      if (typeof pos === 'number') {
        try {
          const $pos = editor.state.doc.resolve(pos);
          blockText = $pos.parent.textContent.slice(0, 2000);
          if (!claim) claim = $pos.parent.textBetween(0, $pos.parentOffset, ' ').slice(-300).trim();
        } catch {}
      }
      if (!claim) claim = String(noteValue || '').trim().slice(0, 300);
      if (!claim) { reErr.textContent = 'nothing to check yet — give the footnote a claim or some context first'; return; }

      checking = true;
      reErr.textContent = '';
      const t0 = Date.now();
      const tick = setInterval(() => { reBtn.textContent = `CHECKING… ${Math.floor((Date.now() - t0) / 1000)}s`; }, 1000);
      reBtn.textContent = 'CHECKING…';
      const ac = new AbortController();
      const killer = setTimeout(() => ac.abort(), 70_000);
      try {
        const res = await fetch(getEpisode()?.cloud?.tkApi || '/api/burma-tk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'quote', marker: claim, block: blockText, context: [noteValue, src.value].filter(Boolean).join('\n').slice(0, 3000) }),
          signal: ac.signal,
        });
        const rawBody = await res.text();
        let data;
        try { data = rawBody ? JSON.parse(rawBody) : {}; } catch {
          throw new Error(res.status === 504 || /timed?\s*out/i.test(rawBody) ? 'the recheck timed out — try again' : `server error (${res.status})`);
        }
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

        const quotes = Array.isArray(data.quotes) ? data.quotes : [];
        const lines = [];
        if (data.finding) lines.push(String(data.finding).trim());
        for (const q of quotes) {
          if (!q || !q.quote) continue;
          lines.push(`“${String(q.quote).trim()}” — ${String(q.source || '').trim()}`);
        }
        if (lines.length) {
          noteValue = (noteValue ? noteValue.trim() + '\n\n' : '') + lines.join('\n\n');
          queueSave({ note: noteValue });
          renderBlurb();
        }
        const newUrls = quotes.map((q) => String(q.url || '').trim()).filter((u) => u && !src.value.includes(u));
        if (newUrls.length) {
          src.value = (src.value ? src.value.trim() + '\n' : '') + newUrls.join('\n');
          queueSave({ source: src.value });
          renderLinks();
        }
        if (data.verdict) queueSave({ verdict: String(data.verdict) });
        flush(); // the receipt is on the doc the moment it lands — never only in the panel
        if (!lines.length && !newUrls.length) reErr.textContent = 'no verbatim quote surfaced — the sources may be thin here';
      } catch (err) {
        reErr.textContent = err?.name === 'AbortError' ? 'the recheck timed out after 70s — try again' : (err?.message || String(err));
      } finally {
        clearTimeout(killer);
        clearInterval(tick);
        checking = false;
        reBtn.textContent = 'RECHECK';
      }
    });
    reRow.appendChild(reBtn);
    panel.appendChild(reRow);
    panel.appendChild(reErr);
  }

  // DELETE — writers only
  if (!readOnly) {
    const del = el('button', 'wp-fnote-delete', { type: 'button' });
    del.textContent = 'Delete footnote';
    del.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (editor.view.editable === false) return; // READ MODE: delete is a write
      const pos = typeof getPos === 'function' ? getPos() : getPos;
      if (typeof pos !== 'number') return;
      const cur = editor.state.doc.nodeAt(pos);
      if (!cur || cur.type.name !== 'fcFootnote') return;
      close(); openPanel = null;
      editor.view.dispatch(editor.state.tr.delete(pos, pos + cur.nodeSize));
      editor.view.focus();
    });
    panel.appendChild(del);
  }

  document.body.appendChild(panel);

  // Fly out beside the icon — right of it when there's room (margin-comment feel), else left.
  const r = iconDom.getBoundingClientRect();
  panel.style.position = 'fixed';
  const bw = panel.getBoundingClientRect().width || 320;
  let left = r.right + 10;
  if (left + bw > window.innerWidth - 8) left = Math.max(8, r.left - bw - 10);
  panel.style.left = `${left}px`;
  panel.style.top = `${Math.max(8, Math.min(r.top - 8, window.innerHeight - panel.getBoundingClientRect().height - 8))}px`;

  onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); openPanel = null; editor.view.focus(); }
  };
  onDocDown = (e) => { if (!panel.contains(e.target) && e.target !== iconDom && !iconDom.contains(e.target)) { close(); openPanel = null; } };
  onScroll = (e) => { if (panel.contains(e.target)) return; close(); openPanel = null; };
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  // No default-focused field anymore: the blurb is a read view (double-click to edit), so
  // stealing focus from the editor on open would be pure loss.

  return { panel, close };
}

// ── the node ─────────────────────────────────────────────────────────────────────────────────
export const FcFootnote = Node.create({
  name: 'fcFootnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      noteId: { default: null },
      note: { default: '' },     // fact-check context — editable in the fly-out
      source: { default: '' },   // source link / citation — editable in the fly-out
      marker: { default: '' },   // the original {fc}/{TK} claim text (lineage, read-only)
      verdict: { default: '' },  // supported / contradicted / unclear ('' = unset)
      // status (Johnny 2026-07-08 /footnote): 'needed' → a RED SQUARE fact-check waiting to be
      // filled/verified; '' (default) → the verified green ✓ receipt (every legacy footnote).
      status: { default: '' },
    };
  },

  parseHTML() {
    return [{
      tag: 'span[data-fcnote]',
      getAttrs: (dom) => ({
        noteId: dom.getAttribute('data-note-id') || null,
        note: dom.getAttribute('data-note') || '',
        source: dom.getAttribute('data-source') || '',
        marker: dom.getAttribute('data-marker') || '',
        verdict: dom.getAttribute('data-verdict') || '',
        status: dom.getAttribute('data-status') || '',
      }),
    }];
  },

  renderHTML({ node }) {
    const a = node.attrs;
    return ['span', mergeAttributes({
      'data-fcnote': '',
      'data-note-id': a.noteId || '',
      'data-note': a.note || '',
      'data-source': a.source || '',
      'data-marker': a.marker || '',
      'data-verdict': a.verdict || '',
      'data-status': a.status || '',
      class: 'wp-fcnote',
    }), a.status === 'needed' ? '▪' : '✓'];
  },

  addNodeView() {
    return ({ editor, node, getPos }) => {
      const dom = el('span', 'wp-fcnote', { 'data-fcnote': '', contenteditable: 'false', role: 'button', 'aria-label': 'fact-check footnote' });
      // Two faces (Johnny 2026-07-08): a RED SQUARE while the fact-check is still open
      // (status:'needed'), and the green circle-check once it's verified. paint() is called on
      // first mount AND from update() so marking it checked in the fly-out flips the icon live.
      const GREEN =
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
        + '<circle cx="8" cy="8" r="7.25" class="wp-fcnote-circle"/>'
        + '<path d="M4.7 8.4l2.1 2.1 4.4-4.6" class="wp-fcnote-check" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
        + '</svg>';
      const RED =
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
        + '<rect x="2" y="2" width="12" height="12" rx="2.5" class="wp-fcnote-square"/>'
        + '</svg>';
      let painted = null;
      const paint = (status) => {
        if (status === painted) return;
        painted = status;
        dom.classList.toggle('is-needed', status === 'needed');
        dom.innerHTML = status === 'needed' ? RED : GREEN;
        dom.title = status === 'needed' ? 'fact-check to do — click to add notes & sources' : 'fact-check footnote — click to open';
      };
      paint(node?.attrs?.status || '');
      dom.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeOpenFootnotePanel();
        openPanel = createFootnotePanel(editor, getPos, dom);
      });
      return {
        dom,
        // repaint the icon when the fly-out flips status (red ⇄ green); ignore other attr saves.
        update(updated) {
          if (updated.type.name !== 'fcFootnote') return false;
          paint(updated.attrs.status || '');
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
});

// ── /footnote — drop a RED-SQUARE fact-check footnote at the cursor and pop its editor open
// so Johnny can add notes + sources on the spot (2026-07-08). Unlike the green receipt born
// from a verified claim, this one starts OPEN (status:'needed') and turns green when he marks
// it checked in the fly-out. One transaction (delete trigger + insert) → one undo, one save.
function findFootnotePos(editor, noteId) {
  let found = null;
  editor.state.doc.descendants((n, pos) => {
    if (found != null) return false;
    if (n.type.name === 'fcFootnote' && n.attrs.noteId === noteId) { found = pos; return false; }
    return true;
  });
  return found;
}

export function insertFcFootnote(editor, range) {
  if (editor.view.editable === false) return false;
  const noteId = mintNoteId();
  const ok = editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({ type: 'fcFootnote', attrs: { noteId, note: '', source: '', marker: '', verdict: '', status: 'needed' } })
    .run();
  if (!ok) return false;
  // Pop the fly-out open on the just-inserted node so he types straight into it. getPos
  // re-finds by noteId every call, so it survives collab/edits shifting positions.
  setTimeout(() => {
    const pos = findFootnotePos(editor, noteId);
    if (pos == null) return;
    const dom = editor.view.nodeDOM(pos);
    if (!dom) return;
    closeOpenFootnotePanel();
    openPanel = createFootnotePanel(editor, () => findFootnotePos(editor, noteId), dom);
  }, 0);
  return true;
}
