import { Node, mergeAttributes } from '@tiptap/core';

export const SpeakerBlock = Node.create({
  name: 'speakerBlock',
  group: 'block',
  content: 'paragraph+',

  addAttributes() {
    return {
      speaker: { default: '' },
      color: { default: '#DD2C1E' },
      visible: { default: true },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-speaker-block]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = mergeAttributes(HTMLAttributes, {
      'data-speaker-block': '',
      'data-speaker': node.attrs.speaker,
      'style': `--speaker-color: ${node.attrs.color}; ${node.attrs.visible ? '' : 'opacity: 0.35;'}`,
      'class': 'editor-speaker-block',
    });
    return ['div', attrs, ['div', { class: 'editor-speaker-name', contenteditable: 'false' }, node.attrs.speaker], ['div', { class: 'editor-speaker-content' }, 0]];
  },
});
