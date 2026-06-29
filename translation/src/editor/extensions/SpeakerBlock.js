import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { escapeHtml } from '../../html-escape.js';

// In-app rename overlay — same Newpress editorial style as the rest of
// the modals. Returns immediately; calls onConfirm(trimmedString) when
// the user submits. Trim happens in here so the caller only ever sees
// a non-empty trimmed value (or null on cancel).
function openSpeakerRenameOverlay(currentName, onConfirm) {
  document.getElementById('np-speaker-rename-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'np-speaker-rename-overlay';
  overlay.className = 'np-modal';
  overlay.innerHTML = `
    <div class="np-modal-backdrop" data-close></div>
    <div class="np-modal-card" style="max-width: 420px;">
      <div class="np-modal-header">
        <h3 class="np-modal-title">Rename speaker</h3>
        <button class="np-modal-close" data-close aria-label="Close">×</button>
      </div>
      <p style="font-family:var(--np-font-mono);font-size:12px;color:var(--np-sepia);margin-bottom:12px;line-height:1.5;">
        Renames every occurrence of <strong>${escapeHtml(currentName)}</strong> across this transcript.
      </p>
      <input id="np-speaker-rename-input" class="np-textarea" type="text"
             style="min-height:auto;padding:10px 12px;font-size:14px;"
             value="${escapeAttr(currentName)}" />
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
        <button class="np-button" data-close>Cancel</button>
        <button class="np-button np-button--primary" id="np-speaker-rename-go">Rename</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#np-speaker-rename-input');
  const close = () => overlay.remove();
  const submit = () => {
    const trimmed = (input.value || '').trim();
    close();
    if (trimmed) onConfirm(trimmed);
  };
  overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
  overlay.querySelector('#np-speaker-rename-go').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  // Focus + select the existing name so user can just start typing.
  input.focus();
  input.select();
}

function escapeAttr(s) { return escapeHtml(s); }

export const SpeakerBlock = Node.create({
  name: 'speakerBlock',
  group: 'block',
  content: 'paragraph+',

  addAttributes() {
    return {
      speaker: { default: '' },
      color: { default: '#DD2C1E' },
      visible: { default: true },
      language: { default: '' },
      dismissed: { default: false },
      startTime: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-speaker-block]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const dismissed = node.attrs.dismissed;
    const classes = ['editor-speaker-block'];
    if (dismissed) classes.push('editor-speaker-dismissed');

    const attrs = mergeAttributes(HTMLAttributes, {
      'data-speaker-block': '',
      'data-speaker': node.attrs.speaker,
      'style': `--speaker-color: ${node.attrs.color}; ${node.attrs.visible ? '' : 'opacity: 0.35;'}`,
      'class': classes.join(' '),
    });
    const nameContent = [
      ['span', { class: 'editor-speaker-label' }, node.attrs.speaker],
    ];
    if (node.attrs.language) {
      nameContent.push(['span', { class: 'editor-lang-tag' }, node.attrs.language]);
    }
    nameContent.push(['span', { class: 'editor-dismiss-btn', title: dismissed ? 'Restore block' : 'Dismiss block' }, '\u00d7']);

    const headerChildren = [];
    if (node.attrs.startTime) {
      headerChildren.push(['div', { class: 'editor-timecode-tag', contenteditable: 'false' }, node.attrs.startTime]);
    }
    headerChildren.push(['div', { class: 'editor-speaker-name', contenteditable: 'false' }, ...nameContent]);

    return ['div', attrs, ...headerChildren, ['div', { class: 'editor-speaker-content' }, 0]];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              // Click on the dismiss button: toggle dismissed state.
              const dismissBtn = event.target.closest('.editor-dismiss-btn');
              if (dismissBtn) {
                event.preventDefault();
                event.stopPropagation();
                const blockEl = dismissBtn.closest('[data-speaker-block]');
                if (!blockEl) return false;
                const pos = view.posAtDOM(blockEl, 0);
                const resolved = view.state.doc.resolve(pos);
                for (let d = resolved.depth; d >= 0; d--) {
                  const node = resolved.node(d);
                  if (node.type.name === 'speakerBlock') {
                    const startPos = resolved.before(d);
                    const tr = view.state.tr.setNodeMarkup(startPos, undefined, {
                      ...node.attrs,
                      dismissed: !node.attrs.dismissed,
                    });
                    view.dispatch(tr);
                    return true;
                  }
                }
                return false;
              }

              // Click on the speaker label: rename via in-app overlay.
              // Renames every occurrence across the transcript by
              // dispatching an event the main app listens for. The app
              // owns speakerMap + segments and rebuilds the editor doc.
              //
              // Replaced window.prompt() with a styled overlay because
              // prompt() is blocked in sandboxed iframes, can't be styled
              // to match the editorial look, and feels like 1997.
              const labelEl = event.target.closest('.editor-speaker-label');
              if (labelEl) {
                event.preventDefault();
                event.stopPropagation();
                const blockEl = labelEl.closest('[data-speaker-block]');
                if (!blockEl) return false;
                const currentName = blockEl.getAttribute('data-speaker') || '';
                openSpeakerRenameOverlay(currentName, (trimmed) => {
                  if (!trimmed || trimmed === currentName) return;
                  window.dispatchEvent(new CustomEvent('np-speaker-rename', {
                    detail: { from: currentName, to: trimmed },
                  }));
                });
                return true;
              }

              return false;
            },
          },
        },
      }),
    ];
  },
});
