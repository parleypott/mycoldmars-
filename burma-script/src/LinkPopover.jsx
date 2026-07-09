// Burma Script Tool — inline Cmd+K link popover.
// MIRRORS BubbleMenu.jsx's positioning (coordsAtPos + position:fixed, translated above the
// selection) but is a small anchored editor for a single href — a Notion/Google-Docs-style mini
// link bar instead of a browser prompt(). Opened by LinkKeymap's Mod-k handler
// (extensions/link-kbd.js) via the `wp-link-open` CustomEvent — event-driven, not a direct prop
// call, because the keyboard shortcut only has `this.editor` and no Preact state setter; same
// idiom as the `wp-toast` event used elsewhere in this app.
//
// WRITES: setMark/unsetMark only fire when editor.view.editable && !isReadOnly() — the same dual
// gate every other write path uses (see footnote.js). Every write is a direct response to a
// keypress/click inside this popover — no automatic/appendTransaction dispatch, so it is safe
// under the COLLAB LOOP LAW.

import { useState, useEffect, useRef } from 'preact/hooks';
import { getMarkRange } from '@tiptap/core';
import { isReadOnly } from './read-mode.js';
import { normalizeHref } from './extensions/link-kbd.js';

export function LinkPopover({ editor }) {
  const [range, setRange] = useState(null); // {from, to} captured at open; null = closed
  const [value, setValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const inputRef = useRef(null);
  const ref = useRef(null);
  const rangeRef = useRef(null); // mirror of `range` for the scroll listener (no stale closure)

  const close = () => { rangeRef.current = null; setRange(null); };

  useEffect(() => {
    // GUARD: editor.view is a throwing Proxy until the ProseMirror view mounts (see BubbleMenu).
    if (!editor || !editor.isInitialized) return undefined;

    const place = (from, to) => {
      try {
        const a = editor.view.coordsAtPos(from);
        const b = editor.view.coordsAtPos(to);
        setPos({ top: a.top, left: (a.left + b.right) / 2 });
      } catch { /* keep last known position if this races a transaction */ }
    };

    const onOpen = () => {
      if (isReadOnly() || !editor.view.editable) return;
      const { state } = editor;
      const { selection, schema } = state;
      const linkType = schema.marks.link;
      let from = selection.from;
      let to = selection.to;
      const current = editor.getAttributes('link')?.href || '';
      // Caret inside an existing link with no selection: resolve the mark's TRUE bounds so the
      // popover anchors above the whole link, not just the caret point.
      if (selection.empty && current && linkType) {
        try {
          const r = getMarkRange(state.doc.resolve(selection.from), linkType);
          if (r && r.to > r.from) { from = r.from; to = r.to; }
        } catch {}
      }
      rangeRef.current = { from, to };
      setRange({ from, to });
      setValue(current);
      setIsEditing(!!current);
      place(from, to);
    };

    // Follow the doc while the popover is open (mirrors BubbleMenu's scroll reposition).
    const reposition = () => { const r = rangeRef.current; if (r) place(r.from, r.to); };
    const scroller = editor.view.dom.closest('.wp-stage') || window;

    window.addEventListener('wp-link-open', onOpen);
    scroller.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('wp-link-open', onOpen);
      scroller.removeEventListener('scroll', reposition);
      window.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
    };
  }, [editor]);

  // Focus + select the URL text each time the popover opens.
  useEffect(() => {
    if (range && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [range]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!range) return undefined;
    const onDocMouseDown = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [range]);

  if (!range || !editor) return null;

  const guard = () => {
    if (isReadOnly() || !editor.view.editable) { close(); return true; }
    return false;
  };

  const apply = () => {
    if (guard()) return;
    const href = normalizeHref(value);
    const chain = editor.chain().focus().setTextSelection(range).extendMarkRange('link');
    if (!href) chain.unsetMark('link').run();
    else chain.setMark('link', { href }).run();
    close();
  };

  const remove = () => {
    if (guard()) return;
    editor.chain().focus().setTextSelection(range).extendMarkRange('link').unsetMark('link').run();
    close();
  };

  return (
    <div
      ref={ref}
      class="wp-link-pop"
      style={{ position: 'fixed', top: `${pos.top}px`, left: `${pos.left}px`, transform: 'translate(-50%, calc(-100% - 8px))', zIndex: 210 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        class="wp-link-pop-input"
        type="text"
        placeholder="paste or type a URL"
        value={value}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); apply(); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
        }}
      />
      {isEditing && (
        <button
          class="wp-link-pop-remove"
          title="Remove link"
          onMouseDown={(e) => { e.preventDefault(); remove(); }}
        >✕</button>
      )}
    </div>
  );
}
