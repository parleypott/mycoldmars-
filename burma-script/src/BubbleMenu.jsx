// Burma Script Tool — inline BubbleMenu.
// MIRRORS translation/src/editor/BubbleMenu.jsx: a floating bar above the current text
// selection with action buttons. Here the actions are the script's inline vocabulary —
// mark the selection as a {TK} research request or a [visual] direction (the SAME marks
// the document-builder seeds), plus bold/italic and a quick clear. Swiss, icon-light.
//
// LIVE-AUTHORING FIX: the TK / VIS buttons now apply the REAL tkSpan/visualSpan MARK (not
// literal-text insertion), so a live-marked span renders the Swiss-red underline + opens
// the workshop hub immediately. We still wrap the selection in literal {tk …}/[…] braces
// so the blocks export round-trips faithfully — but the braces carry the mark, so they
// are styled, clickable, and re-serialize cleanly. Toggling off strips both.
//
// VISIBILITY FIX: gate on selection.empty (not editor.isFocused) so range/programmatic
// selections also surface the bar, and reposition on the scroll parent, not just resize.

import { useState, useEffect, useRef } from 'preact/hooks';
import { isReadOnly } from './read-mode.js';

export function BurmaBubbleMenu({ editor }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);

  useEffect(() => {
    // GUARD: editor.view is a throwing Proxy until the ProseMirror view mounts (isInitialized).
    // With immediatelyRender the editor can reach this effect one commit before the view exists;
    // reading editor.view.dom below would throw and crash the mount. Bail until initialized — the
    // effect re-runs once `editor` is the mounted instance (immediatelyRender:false guarantees this).
    if (!editor || !editor.isInitialized) return;

    const update = () => {
      const sel = editor.state.selection;
      // Robust gate: a non-empty TEXT selection inside an editable block.
      if (sel.empty || sel.from === sel.to) {
        if (!(ref.current && ref.current.matches(':hover'))) setVisible(false);
        return;
      }
      let a, b;
      try {
        a = editor.view.coordsAtPos(sel.from);
        b = editor.view.coordsAtPos(sel.to);
      } catch { setVisible(false); return; }
      if (!a) { setVisible(false); return; }
      setPos({ top: a.top, left: (a.left + b.right) / 2 });
      setVisible(true);
    };

    const hide = () => setTimeout(() => {
      if (ref.current && ref.current.matches(':hover')) return;
      if (!editor.state.selection.empty) return; // keep open if still selected
      setVisible(false);
    }, 80);

    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    editor.on('blur', hide);

    // Reposition against the real scroll parent + window — coordsAtPos drifts otherwise.
    const scroller = editor.view.dom.closest('.wp-stage') || window;
    scroller.addEventListener('scroll', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      editor.off('blur', hide);
      scroller.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [editor]);

  if (!visible || !editor) return null;

  // Apply (or clear) an inline span mark over the LIVE selection — no text re-insertion.
  // The old path replaced the selection with a fresh plain text node, dropping any
  // coexisting bold/italic and misbehaving across block boundaries. We now just toggle
  // the mark over the existing range, preserving sibling marks. The {tk …}/[…] braces
  // are NOT written into the live text; document-builder.nodeText's wrapToken adds them
  // on export so the blocks round-trip stays faithful while the script READS clean.
  const applySpan = (markName) => {
    editor.chain().focus().setMark(markName).run();
  };
  const clearSpan = (markName) => {
    editor.chain().focus().unsetMark(markName).run();
  };

  const tkActive = editor.isActive('tkSpan');
  const fcActive = editor.isActive('factCheckSpan');
  const visActive = editor.isActive('visualSpan');

  // WRITE GATE — TipTap commands dispatch PAST editable:false (see marks.js), and a selection can
  // exist in READ mode, so alignment writes must be closed here. `?read` share is structurally
  // frozen; the sticky READ/EDIT latch flips editor.isEditable. Gate on BOTH.
  const canWrite = () => editor.isEditable && !isReadOnly();
  const setAlign = (dir) => { if (canWrite()) editor.chain().focus().setTextAlign(dir).run(); };
  const alignActive = (dir) => editor.isActive({ textAlign: dir });

  // Is the selection's row already a split (2+ columns)? Walk the selection up to its
  // tableRow ancestor — drives whether the bubble offers SPLIT (⊟) or MERGE (⊞).
  const rowIsSplit = (() => {
    const $from = editor.state.selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (n.type.name === 'tableRow') return (n.childCount || n.attrs.cols || 1) > 1;
    }
    return false;
  })();

  return (
    <div
      ref={ref}
      class="wp-bubble"
      style={{ position: 'fixed', top: `${pos.top}px`, left: `${pos.left}px`, transform: 'translate(-50%, calc(-100% - 8px))', zIndex: 200 }}
    >
      <button class="wp-bbtn" title="Bold" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}><b>B</b></button>
      <button class="wp-bbtn" title="Italic" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}><i>I</i></button>
      <span class="wp-bsep" />
      <button class={`wp-bbtn wp-bbtn-align ${alignActive('left') ? 'active' : ''}`} title="Align left" aria-label="Align left" onMouseDown={(e) => { e.preventDefault(); setAlign('left'); }}>⇤</button>
      <button class={`wp-bbtn wp-bbtn-align ${alignActive('center') ? 'active' : ''}`} title="Align center" aria-label="Align center" onMouseDown={(e) => { e.preventDefault(); setAlign('center'); }}>⇔</button>
      <button class={`wp-bbtn wp-bbtn-align ${alignActive('right') ? 'active' : ''}`} title="Align right" aria-label="Align right" onMouseDown={(e) => { e.preventDefault(); setAlign('right'); }}>⇥</button>
      <span class="wp-bsep" />
      <button class={`wp-bbtn wp-bbtn-tk ${tkActive ? 'active' : ''}`} title="Mark as {TK} writing helper" onMouseDown={(e) => { e.preventDefault(); tkActive ? clearSpan('tkSpan') : applySpan('tkSpan'); }}>TK</button>
      <button class={`wp-bbtn wp-bbtn-fc ${fcActive ? 'active' : ''}`} title="Mark as {fc} fact-check" onMouseDown={(e) => { e.preventDefault(); fcActive ? clearSpan('factCheckSpan') : applySpan('factCheckSpan'); }}>FC</button>
      <button class={`wp-bbtn wp-bbtn-visual ${visActive ? 'active' : ''}`} title="Mark as [visual] direction" onMouseDown={(e) => { e.preventDefault(); visActive ? clearSpan('visualSpan') : applySpan('visualSpan'); }}>VIS</button>
      <span class="wp-bsep" />
      {rowIsSplit
        ? <button class="wp-bbtn wp-bbtn-merge" title="Merge said / shown columns back into one full-width row" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().mergeRow().run(); }}>⊞ MERGE</button>
        : <button class="wp-bbtn wp-bbtn-split" title="Split this row into said / shown columns" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().splitRow().run(); }}>⊟ SPLIT</button>}
    </div>
  );
}
