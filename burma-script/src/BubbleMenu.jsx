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

export function BurmaBubbleMenu({ editor }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);

  useEffect(() => {
    if (!editor) return;

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

  // Apply (or clear) an inline span mark. We wrap the selected text in literal braces
  // AND carry the real mark on those braces — so it renders red, is clickable, and the
  // blocks export round-trips the {tk …}/[…] token. Toggling off unwraps both.
  const applySpan = (markName, open, close) => {
    if (editor.isActive(markName)) {
      // already a span here → strip the mark (braces stay as plain text; harmless)
      editor.chain().focus().unsetMark(markName).run();
      return;
    }
    const { from, to } = editor.state.selection;
    let inner = editor.state.doc.textBetween(from, to, '');
    inner = inner.replace(/^[\[{]+|[\]}]+$/g, ''); // avoid double-bracing
    const wrapped = open + inner + close;
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, wrapped)
      .setTextSelection({ from, to: from + wrapped.length })
      .setMark(markName)
      .run();
  };

  const tkActive = editor.isActive('tkSpan');
  const visActive = editor.isActive('visualSpan');

  return (
    <div
      ref={ref}
      class="wp-bubble"
      style={{ position: 'fixed', top: `${pos.top}px`, left: `${pos.left}px`, transform: 'translate(-50%, calc(-100% - 8px))', zIndex: 200 }}
    >
      <button class="wp-bbtn" title="Bold" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}><b>B</b></button>
      <button class="wp-bbtn" title="Italic" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}><i>I</i></button>
      <span class="wp-bsep" />
      <button class={`wp-bbtn wp-bbtn-tk ${tkActive ? 'active' : ''}`} title="Mark as {TK} research" onMouseDown={(e) => { e.preventDefault(); applySpan('tkSpan', '{tk ', '}'); }}>TK</button>
      <button class={`wp-bbtn wp-bbtn-visual ${visActive ? 'active' : ''}`} title="Mark as [visual] direction" onMouseDown={(e) => { e.preventDefault(); applySpan('visualSpan', '[', ']'); }}>VIS</button>
    </div>
  );
}
