import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

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
              const btn = event.target.closest('.editor-dismiss-btn');
              if (!btn) return false;

              event.preventDefault();
              event.stopPropagation();

              // Find the speakerBlock node that contains this button
              const blockEl = btn.closest('[data-speaker-block]');
              if (!blockEl) return false;

              const pos = view.posAtDOM(blockEl, 0);
              const resolved = view.state.doc.resolve(pos);

              // Walk up to find the speakerBlock node
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
            },
          },
        },
      }),
    ];
  },
});
