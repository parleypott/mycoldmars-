import { render, h } from 'preact';
import { TranscriptEditor } from './Editor.jsx';

let currentUnmount = null;
let currentProps = null;
let currentContainer = null;

/**
 * Mount the Tiptap editor into a DOM container.
 *
 * The unmount path now also explicitly clears the container after the
 * Preact render-null call so any stale CSS injected by the editor (e.g.
 * the per-instance speaker-filter <style> tag in Editor.jsx) doesn't
 * survive between sessions. Without this, switching transcripts 20+
 * times in a session left a trail of detached DOM and stale styles
 * that compounded into a multi-hundred-MB tab leak.
 */
export function mountEditor(container, props) {
  // Unmount previous if any. ALSO clears the prior container even if
  // mountEditor is invoked from a different container (rare, but
  // defensive — prevents zombie editor instances).
  if (currentUnmount) {
    try { currentUnmount(); } catch (e) { console.warn('[mountEditor] prior unmount failed:', e); }
    currentUnmount = null;
  }

  currentProps = { ...props };
  currentContainer = container;
  render(h(TranscriptEditor, currentProps), container);

  currentUnmount = () => {
    try { render(null, container); } catch {}
    // Belt-and-suspenders: nuke any straggling children Preact didn't
    // reconcile (e.g. nodes appended by extensions after mount).
    try { while (container.firstChild) container.removeChild(container.firstChild); } catch {}
  };

  return {
    unmount: () => {
      if (currentUnmount) currentUnmount();
      currentUnmount = null;
      currentProps = null;
      currentContainer = null;
    },
    update: (newProps) => {
      if (!currentProps) currentProps = {};
      // Merge partial updates into existing props
      currentProps = { ...currentProps, ...newProps };
      render(h(TranscriptEditor, currentProps), container);
    },
  };
}
