import { Mark, mergeAttributes } from '@tiptap/core';

export const Segment = Mark.create({
  name: 'segment',

  addAttributes() {
    return {
      number: { default: null },
      start: { default: '' },
      end: { default: '' },
      originalText: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-segment]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-segment': '',
      'data-number': HTMLAttributes.number,
      'data-start': HTMLAttributes.start,
      'data-end': HTMLAttributes.end,
      'data-original': HTMLAttributes.originalText,
      'class': 'editor-segment',
      'title': HTMLAttributes.originalText || '',
    }), 0];
  },
});
