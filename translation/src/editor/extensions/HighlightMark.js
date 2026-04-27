import { Mark, mergeAttributes } from '@tiptap/core';

export const HighlightMark = Mark.create({
  name: 'highlight',

  addAttributes() {
    return {
      tagId: { default: null },
      tagName: { default: '' },
      color: { default: '#DD2C1E' },
      segmentNumbers: { default: [] },
      originalText: { default: '' },
      note: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-highlight]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, {
      'data-highlight': '',
      'data-tag-id': HTMLAttributes.tagId,
      'data-tag-name': HTMLAttributes.tagName,
      'class': 'editor-highlight',
      'style': `background-color: ${HTMLAttributes.color}22; border-bottom: 2px solid ${HTMLAttributes.color};`,
      'title': HTMLAttributes.tagName || 'Highlight',
    }), 0];
  },

  addCommands() {
    return {
      setHighlightMark: (attrs) => ({ commands }) => {
        return commands.setMark(this.name, attrs);
      },
      unsetHighlightMark: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      },
    };
  },
});
