import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * DeletedMark — soft-delete mark that collapses content.
 * Text marked as deleted is hidden by default and replaced with
 * a "[N hidden]" indicator. Clicking the indicator expands the content.
 */
export const DeletedMark = Mark.create({
  name: 'deleted',

  addAttributes() {
    return {
      expanded: { default: false },
    };
  },

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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('deletedCollapse'),
        props: {
          decorations: (state) => {
            const decorations = [];
            const { doc } = state;

            doc.descendants((node, pos) => {
              if (node.isText && node.marks.some(m => m.type.name === 'deleted')) {
                // Add a CSS class that hides the content unless expanded
                decorations.push(
                  Decoration.inline(pos, pos + node.nodeSize, {
                    class: 'editor-deleted-content',
                  })
                );
              }
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
