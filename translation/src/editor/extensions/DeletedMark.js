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
    // Cache against doc identity so we only rebuild the decoration set
    // when the doc actually changes. ProseMirror calls decorations()
    // on EVERY transaction — for a 10k-segment transcript, walking
    // doc.descendants on each keystroke was the dominant cost during
    // type-then-delete loops. Doc identity (===) is stable across
    // selection-only transactions, so cursor moves now reuse the set.
    let cachedDoc = null;
    let cachedSet = DecorationSet.empty;
    return [
      new Plugin({
        key: new PluginKey('deletedCollapse'),
        props: {
          decorations: (state) => {
            const { doc } = state;
            if (doc === cachedDoc) return cachedSet;
            const decorations = [];
            doc.descendants((node, pos) => {
              if (node.isText && node.marks.some(m => m.type.name === 'deleted')) {
                decorations.push(
                  Decoration.inline(pos, pos + node.nodeSize, {
                    class: 'editor-deleted-content',
                  })
                );
              }
            });
            cachedDoc = doc;
            cachedSet = DecorationSet.create(doc, decorations);
            return cachedSet;
          },
        },
      }),
    ];
  },
});
