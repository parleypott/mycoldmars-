// Find & Replace panel — the edit-only UI over the find-replace ProseMirror extension.
// Cmd/Ctrl+F opens it (and focuses the search field); Esc closes it and clears the highlights.
// It NEVER writes storage directly — every replace goes through the editor's command/transaction
// path (extensions/find-replace.js), so undo works and autosave/backup fire normally. Read-only
// sessions never mount this panel (Editor.jsx gates it on !readOnly), and the replace controls are
// additionally disabled if the editor is somehow non-editable — defense in depth.

import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { getFindState } from './extensions/find-replace.js';

export function FindReplacePanel({ editor }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [tick, setTick] = useState(0); // bump to re-read match count after a transaction
  const searchRef = useRef(null);

  // Re-read the live match state on every editor transaction so "N of M" stays honest as the
  // doc changes under a replace.
  useEffect(() => {
    if (!editor) return undefined;
    const onTx = () => setTick((t) => t + 1);
    editor.on('transaction', onTx);
    return () => { try { editor.off('transaction', onTx); } catch {} };
  }, [editor]);

  // Push the query/case into the extension whenever they change while the panel is open.
  useEffect(() => {
    if (!editor || !open) return;
    editor.commands.setFindQuery(query, caseSensitive);
  }, [editor, open, query, caseSensitive]);

  const close = useCallback(() => {
    setOpen(false);
    try { editor && editor.commands.clearFind(); } catch {}
    try { editor && editor.commands.focus(); } catch {}
  }, [editor]);

  // Cmd/Ctrl+F opens the panel and focuses search (preventing the browser's native find).
  useEffect(() => {
    const onKey = (e) => {
      const isFind = (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'f' || e.key === 'F');
      if (isFind) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => { try { searchRef.current && searchRef.current.select(); } catch {} }, 0);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!editor || !open) return null;

  const s = getFindState(editor); // { matches, current, ... }
  const total = s.matches.length;
  const idx = total ? s.current + 1 : 0;
  const editable = editor.isEditable !== false;

  const onSearchKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editor.commands[e.shiftKey ? 'findPrev' : 'findNext']();
      setTick((t) => t + 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const doReplace = () => { editor.commands.replaceCurrent(replaceTerm); setTick((t) => t + 1); };
  const doReplaceAll = () => { editor.commands.replaceAll(replaceTerm); setTick((t) => t + 1); };

  return (
    <div class="wp-find" role="dialog" aria-label="Find and replace">
      <div class="wp-find-row">
        <span class="wp-find-lab">FIND</span>
        <input
          ref={searchRef}
          class="wp-find-input"
          type="text"
          value={query}
          placeholder="search the script…"
          autoFocus
          aria-label="Find in script"
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onSearchKey}
        />
        <span class="wp-find-count" aria-live="polite">
          {query ? (total ? `${idx} of ${total}` : 'no matches') : ''}
        </span>
        <button
          class={`wp-find-case${caseSensitive ? ' is-on' : ''}`}
          title="Match case"
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((v) => !v)}
        >Aa</button>
        <button class="wp-find-nav" title="Previous match (Shift+Enter)" disabled={!total} onClick={() => { editor.commands.findPrev(); setTick((t) => t + 1); }}>‹</button>
        <button class="wp-find-nav" title="Next match (Enter)" disabled={!total} onClick={() => { editor.commands.findNext(); setTick((t) => t + 1); }}>›</button>
        <button class="wp-find-close" title="Close (Esc)" aria-label="Close find" onClick={close}>×</button>
      </div>
      {editable && (
        <div class="wp-find-row">
          <span class="wp-find-lab">WITH</span>
          <input
            class="wp-find-input"
            type="text"
            value={replaceTerm}
            placeholder="replace with…"
            aria-label="Replace with"
            onInput={(e) => setReplaceTerm(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doReplace(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } }}
          />
          <button class="wp-find-act" disabled={!total} onClick={doReplace}>REPLACE</button>
          <button class="wp-find-act" disabled={!total} onClick={doReplaceAll}>ALL</button>
        </div>
      )}
    </div>
  );
}
