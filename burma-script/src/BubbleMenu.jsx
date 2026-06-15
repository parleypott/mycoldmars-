// Burma Script Tool — inline BubbleMenu.
// MIRRORS translation/src/editor/BubbleMenu.jsx: a fixed bar that floats above the
// current text selection with action buttons. Here the actions are the script's inline
// vocabulary — wrap the selection as a {TK} research request or a [visual] direction
// (the same marks the document-builder seeds), plus a quick clear. Swiss, icon-light.

import { useState, useEffect, useRef } from 'preact/hooks';

export function BurmaBubbleMenu({ editor }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      if (from === to || !editor.isFocused) { setVisible(false); return; }
      const a = editor.view.coordsAtPos(from);
      const b = editor.view.coordsAtPos(to);
      if (!a) { setVisible(false); return; }
      setPos({ top: a.top, left: (a.left + b.right) / 2 });
      setVisible(true);
    };
    const hide = () => setTimeout(() => {
      // keep open while interacting with the bar itself
      if (ref.current && ref.current.matches(':hover')) return;
      setVisible(false);
    }, 60);
    editor.on('selectionUpdate', update);
    editor.on('blur', hide);
    window.addEventListener('resize', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('blur', hide);
      window.removeEventListener('resize', update);
    };
  }, [editor]);

  if (!visible || !editor) return null;

  const wrap = (open, close) => {
    const { from, to } = editor.state.selection;
    const inner = editor.state.doc.textBetween(from, to, '');
    editor.chain().focus().insertContentAt({ from, to }, open + inner + close).run();
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
      <button class={`wp-bbtn wp-bbtn-tk ${tkActive ? 'active' : ''}`} title="Mark as {TK} research" onMouseDown={(e) => { e.preventDefault(); wrap('{tk ', '}'); }}>TK</button>
      <button class={`wp-bbtn wp-bbtn-visual ${visActive ? 'active' : ''}`} title="Mark as [visual] direction" onMouseDown={(e) => { e.preventDefault(); wrap('[', ']'); }}>VIS</button>
    </div>
  );
}
