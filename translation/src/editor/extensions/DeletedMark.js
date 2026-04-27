import { Mark, mergeAttributes } from '@tiptap/core';

export const DeletedMark = Mark.create({
  name: 'deleted',

  parseHTML() {
    return [{ tag: 'span[data-deleted]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-deleted': '',
      'class': 'editor-deleted',
    }), 0];
  },

  addCommands() {
    return {
      toggleDeleted: () => ({ commands }) => {
        return commands.toggleMark(this.name);
      },
    };
  },
});
