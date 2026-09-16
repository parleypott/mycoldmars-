// CUT DOCK — the attached cut, docked bottom-left, bound to the script's anchored boxes.
//
// Mounts ONLY when the active project's config carries a cut (`getEpisode().cut.url`); every
// other project renders nothing here and is untouched. Two bindings, both view-local:
//   • click on an anchored cartridge (`.ProseMirror [data-cut-tc]`) → the player seeks there
//   • player `timeupdate` → the anchored cartridge with the greatest tc <= playhead gets
//     highlighted through one dynamic <style> rule keyed on its data-cut-tc (no doc change, no transaction)
// Unanchored boxes are inert on both paths. The ONE write is the explicit "ANCHOR @ PLAYHEAD"
// button (edit mode only): it stamps `cutTc` on the block that holds the selection through the
// editor's normal transaction path, so it saves, syncs and undoes like any other edit.
//
// COLLAB LOOP LAW: nothing here listens to editor transactions or dispatches on its own.
import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { getEpisode, onEpisodeChange } from './episode-config.js';
import { isEditMode } from './edit-mode.js';
import { readCut, activeAnchor, formatTc, normalizeCutTc } from './cut-anchor.js';

// The live cartridge is highlighted through ONE dynamic <style> rule keyed on the anchor attribute the
// NodeView itself renders (data-cut-tc). Anything written onto the cartridge DOM directly — a class, an
// attribute — is lost the next time ProseMirror re-creates the node view (decorations change on every
// transaction), which is what emptied the highlight ~1 s after a real seek on the live site. A selector
// survives re-creation because the new DOM carries the same data-cut-tc.
const STYLE_ID = 'wp-cut-active-style';
const activeRule = (tc) => tc == null ? '' : `.ProseMirror .wp-cart[data-cut-tc="${tc}"]{outline:2px solid var(--ink);outline-offset:2px}.ProseMirror .wp-cart[data-cut-tc="${tc}"][data-cut-label]::before{background:#2b7fff}`;
function activeStyleEl() { let el = document.getElementById(STYLE_ID); if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); } return el; }
const LS_COLLAPSED = 'wp_cut_dock_collapsed_v1';

// Controls inside a cartridge (REC pill, VO tag, grips, buttons) must keep their own click; only
// a click on the box's body/text is a "go there" gesture.
function isControlClick(target) {
  return !!(target && target.closest && target.closest('button, [role="button"], a, input, select, textarea, .wp-rec, .wp-vo-tag, .wp-grip, .wp-cart-head, [data-wp-control]'));
}

function anchorsInDoc(root) {
  const out = [];
  root.querySelectorAll('[data-cut-tc]').forEach((el) => {
    const tc = parseFloat(el.getAttribute('data-cut-tc'));
    if (Number.isFinite(tc)) out.push({ tc, el });
  });
  return out;
}

// PURE CORE — the transaction that stamps cutTc on the cartridge holding the selection. Walks up from
// the selection's $from to the nearest ancestor whose type declares a `cutTc` attribute (every script
// cartridge does via baseAttrs; paragraphs/table cells/doc do not). Returns { tr, tc } or null when the
// caret is not inside a cartridge. Testable with a bare EditorState (cut-anchor-tr.test.mjs).
export function anchorTrFor(state, seconds) {
  const tc = normalizeCutTc(seconds);
  if (!state || tc == null) return null;
  const $from = state.selection.$from;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node?.type?.spec?.attrs && 'cutTc' in node.type.spec.attrs) {
      const pos = $from.before(d);
      return { tr: state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, cutTc: tc }), tc };
    }
  }
  return null;
}

// Editor wrapper: dispatch the core transaction through the editor (so it saves, syncs and undoes like
// any other edit). Returns the stamped seconds or null.
export function anchorSelectionAt(editor, seconds) {
  if (!editor || editor.isDestroyed) return null;
  const r = anchorTrFor(editor.state, seconds);
  if (!r) return null;
  editor.view.dispatch(r.tr);
  try { editor.commands.focus(); } catch {}
  return r.tc;
}

export function CutDock({ editorRef, readOnly = false }) {
  const [cut, setCut] = useState(() => { try { return readCut(getEpisode()); } catch { return null; } });
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(LS_COLLAPSED) === '1'; } catch { return false; } });
  const [now, setNow] = useState(0);
  const [editUi, setEditUi] = useState(isEditMode());
  const videoRef = useRef(null);

  useEffect(() => onEpisodeChange((ep) => { try { setCut(readCut(ep)); } catch { setCut(null); } }), []);
  // The library's per-project config hydrate lands AFTER the engine boots (the list row carries no
  // config); boot.jsx forwards the cut it finds as `wp-cut-config` so the dock can mount without a
  // second open. Only ever ADDS a cut — a later event never removes one already showing.
  useEffect(() => {
    const onCfg = (e) => { const c = readCut({ cut: e?.detail?.cut }); if (c) setCut(c); };
    window.addEventListener('wp-cut-config', onCfg);
    return () => window.removeEventListener('wp-cut-config', onCfg);
  }, []);
  useEffect(() => {
    const onMode = () => setEditUi(isEditMode());
    window.addEventListener('wp-edit-mode', onMode);
    return () => window.removeEventListener('wp-edit-mode', onMode);
  }, []);

  // CLICK → SEEK. Capture phase on the document so the cartridge's own handlers (caret placement,
  // REC pill, drag grip) still run untouched; we only read the anchor and move the player.
  useEffect(() => {
    if (!cut) return undefined;
    const onClick = (e) => {
      const t = e.target;
      if (!t || !t.closest || isControlClick(t)) return;
      const box = t.closest('.ProseMirror [data-cut-tc]');
      if (!box) return;
      const tc = parseFloat(box.getAttribute('data-cut-tc'));
      const v = videoRef.current;
      if (!v || !Number.isFinite(tc)) return;
      try { v.currentTime = tc; } catch {}
      setCollapsed(false);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [cut]);

  // PLAYHEAD → HIGHLIGHT. One <style> rule; the cartridge DOM is never touched.
  const paintActive = useCallback((t) => {
    const root = document.querySelector('.ProseMirror');
    if (!root) return;
    const anchors = anchorsInDoc(root);
    const live = activeAnchor(anchors, t);
    activeStyleEl().textContent = activeRule(live ? live.tc : null);
  }, []);
  useEffect(() => {
    if (!cut) return undefined;
    const v = videoRef.current;
    if (!v) return undefined;
    const onTime = () => { const t = Number.isFinite(v.currentTime) ? v.currentTime : 0; setNow(t); paintActive(t); };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onTime);
    return () => { v.removeEventListener('timeupdate', onTime); v.removeEventListener('seeked', onTime); const st = document.getElementById(STYLE_ID); if (st) st.textContent = ''; };
  }, [cut, collapsed, paintActive]);

  if (!cut) return null;

  const toggle = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem(LS_COLLAPSED, n ? '1' : '0'); } catch {} return n; });
  const anchorHere = () => {
    const v = videoRef.current; const ed = editorRef?.current;
    if (!v || !ed) return;
    const tc = anchorSelectionAt(ed, Number.isFinite(v.currentTime) ? v.currentTime : 0);
    try {
      window.dispatchEvent(new CustomEvent('wp-toast', { detail: tc == null
        ? { tone: 'error', msg: 'PUT THE CURSOR IN A BOX FIRST' }
        : { tone: 'ok', msg: formatTc(tc), lab: 'ANCHORED' } }));
    } catch {}
  };
  const canAnchor = !readOnly && editUi;

  return (
    <aside class={`wp-cut-dock${collapsed ? ' is-collapsed' : ''}`} data-wp-control aria-label="attached cut">
      <div class="wp-cut-dock-head">
        <span class="wp-cut-dock-kind">CUT</span>
        <span class="wp-cut-dock-label" title={cut.label || cut.url}>{cut.label || 'attached cut'}</span>
        <span class="wp-cut-dock-time">{formatTc(now)}</span>
        <button class="wp-cut-dock-btn" onClick={toggle} title={collapsed ? 'show the cut' : 'collapse the cut'}>{collapsed ? '▲' : '▼'}</button>
      </div>
      {!collapsed && (
        <div class="wp-cut-dock-body">
          <video ref={videoRef} class="wp-cut-video" src={cut.url} controls preload="metadata" playsInline />
          <div class="wp-cut-dock-foot">
            <span class="wp-cut-dock-hint">click an anchored box → seek · playhead lights the box</span>
            {canAnchor && <button class="wp-cut-dock-btn wp-cut-anchor" onClick={anchorHere} title="stamp the selected box with the playhead time">ANCHOR @ PLAYHEAD</button>}
          </div>
        </div>
      )}
      {collapsed && <video ref={videoRef} class="wp-cut-video is-hidden" src={cut.url} preload="metadata" playsInline />}
    </aside>
  );
}
