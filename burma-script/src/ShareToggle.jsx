import { useState, useEffect } from 'preact/hooks';
import { buildShareUrl, copyShareLink } from './extensions/table.js';
import { findProjectRow } from './share-project-match.js';

// SHARE — a small masthead popover (edit-mode only) that owns the script's LINK-SHARE STATUS.
//
// This is a real, revocable status stored on the doc (script_projects.is_public), NOT a cosmetic
// switch: flip it ON and anyone with the link can read the script with no login; flip it OFF and
// every outstanding ?read link — full-script AND bookmark deep-links — goes dark on the next load
// (the doc GET starts refusing logged-out viewers; see api/script-doc.js). Johnny himself always
// loads either way, because his signed-in editor sends the access header the guard honors.
//
// The copy buttons hand out the CANONICAL read-only link (buildShareUrl forces the standalone
// /burma-script/?read door, never the login-gated library). Bookmarks share the same way — the ⚑
// on each row copies a read-only deep link. No per-recipient state: the link IS the capability.
//
// `project` is the CURRENT episode id (main.jsx passes EPISODE.id) — burma / palau / palau2 for legacy
// configs, or a cloud UUID for a library project. It is NOT hardcoded: this same engine boots every
// episode, so a fixed slug would flip the WRONG script's sharing when a non-burma episode is open.
export function ShareToggle({ project = 'burma' }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: true, id: null, isPublic: true, err: null });
  const [busy, setBusy] = useState(false);

  // Load the current status the first time the panel opens (the PATCH-gated list carries is_public).
  useEffect(() => {
    if (!open || state.id) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/script-projects', { headers: { Accept: 'application/json' } });
        const body = await res.json().catch(() => null);
        const row = findProjectRow(body && body.projects, project);
        if (!alive) return;
        if (row) setState({ loading: false, id: row.id, isPublic: row.is_public !== false, err: null });
        else setState({ loading: false, id: null, isPublic: true, err: 'not-found' });
      } catch {
        if (alive) setState({ loading: false, id: null, isPublic: true, err: 'load-failed' });
      }
    })();
    return () => { alive = false; };
  }, [open]);

  const flip = async () => {
    if (busy || !state.id) return;
    const next = !state.isPublic;
    setBusy(true);
    setState((s) => ({ ...s, isPublic: next })); // optimistic — snappy switch
    try {
      const res = await fetch('/api/script-projects?id=' + encodeURIComponent(state.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: next }),
      });
      if (!res.ok) throw new Error('patch failed');
      window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tc: next ? 'SHARING ON' : 'SHARING OFF' } }));
    } catch {
      setState((s) => ({ ...s, isPublic: !next })); // revert — never a false green
      try { window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone: 'error', msg: 'could not change sharing — try again' } })); } catch {}
    } finally {
      setBusy(false);
    }
  };

  const on = state.isPublic;
  const copyRead = () => copyShareLink(buildShareUrl({}), 'READ LINK');

  return (
    <div class={`wp-share${open ? ' is-open' : ''}`}>
      <button
        class="wp-share-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Share this script"
      >
        <span class="wp-share-glyph" aria-hidden="true">↗</span>
        <span class="wp-share-lab">share</span>
        {on && <span class="wp-share-dot" aria-hidden="true" title="link sharing is on" />}
      </button>

      <div class="wp-share-body" aria-hidden={!open}>
        <div class="wp-share-head">SHARE</div>

        <button
          class={`wp-share-switch${on ? ' is-on' : ''}`}
          role="switch"
          aria-checked={on}
          disabled={busy || state.loading || !state.id}
          onClick={flip}
        >
          <span class="wp-share-track"><span class="wp-share-knob" /></span>
          <span class="wp-share-switch-lab">Anyone with the link can view</span>
        </button>

        <p class="wp-share-note">
          {state.loading
            ? 'Checking sharing status…'
            : state.err
              ? 'Could not read the sharing status — try reopening this panel.'
              : on
                ? 'On — send the link and anyone can read this script, no login. They can’t reach your library or edit anything.'
                : 'Off — the link is dead. Only you, signed in, can open it.'}
        </p>

        <button class="wp-share-copy" disabled={!on || state.loading} onClick={copyRead}>
          Copy read-only link
        </button>

        <p class="wp-share-hint">
          For a specific spot, click the <b>⚑</b> on any bookmarked row — it copies a read-only link straight to that bookmark.
        </p>
      </div>
    </div>
  );
}
